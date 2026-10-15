// src/services/api/mock/evaluateOrder.ts —— quote 與 create 共用的單一驗證（BR-39、FLOW-22 步驟 6）
// 全部收集、不短路；頂層錯誤碼依 06 §3.2 的優先序。金額一律以「可成立內容」計算（BR-02、06 §5.8）。
import { allocateByProduct } from '@/domain/availability';
import type { AllocationLine, ProductFacts } from '@/domain/availability';
import { calcDeliveryFee, calcDiscount, calcTotal, unitPrice } from '@/domain/pricing';
import { asapAvailability, findSlot, generateSlotDays } from '@/domain/slots';
import { toIsoTaipei } from '@/domain/taipeiTime';
import { formatTime } from '@/domain/format';
import {
  CITIZEN_CERT_RE, DONATE_CODE_RE, MOBILE_BARCODE_RE, isValidTaxId,
} from '@/domain/validation';
import type {
  CreateOrderRequest, ErrorCode, ID, ISODate, OptionGroup, OrderLineInput, OrderType, PaymentMethod,
  QuoteCheck, QuoteResponse, QuotedLine,
} from '@/domain/types';
import { MINUTE_MS } from '@/domain/taipeiTime';
import type { Evaluation } from './createOrder';
import { toCatalogView } from './menuProfile';
import type { CouponSeed, TableSeed, ZoneSeed } from './seed/store';
import { containingCloseMs, toProductDetail } from './world';
import type { World, WorldProduct } from './world';

/** quote 與 create 共用的驗證輸入；create 另帶付款、發票與桌號（QuoteRequest 沒有這些欄位，06 §3.2） */
export interface EvaluationRequest {
  orderType: OrderType;
  items: OrderLineInput[];
  scheduledAt: string | null;
  zipCode?: string;
  couponCode?: string;
  create?: {
    contactPhone: string | null;
    paymentMethod: PaymentMethod;
    invoice: CreateOrderRequest['invoice'];
    dineIn?: CreateOrderRequest['dineIn'];
  };
}

export interface SelectedOption {
  groupId: ID;
  groupName: string;
  optionId: ID;
  name: string;
  priceDelta: number;
}

export interface EvaluatedLine {
  index: number;
  productId: ID;
  quantity: number;
  note: string | null;
  product: WorldProduct | null;
  selected: SelectedOption[];
  unitPrice: number;
  availableQuantity: number;
}

/** 供 commit 使用的解析結果（不屬 quote 回應） */
export interface EvaluationDetail {
  businessDate: ISODate;
  scheduledAtMs: number | null;
  lines: EvaluatedLine[];
  zone: ZoneSeed | null;
  coupon: { seed: CouponSeed; applied: boolean } | null;
  leadMinutes: number;
  table: TableSeed | null;
}

export interface EvaluationResult extends Evaluation {
  detail: EvaluationDetail;
}

/** VR-10：桌號 1～10 字元英數字（比對前已轉大寫） */
const TABLE_NO_RE = /^[A-Z0-9]{1,10}$/;

const ORDER_TYPE_LABEL: Record<OrderType, string> = { PICKUP: '自取', DELIVERY: '外送', DINE_IN: '內用' };

/** 06 §3.2 的頂層錯誤碼優先序（數字越小越優先） */
const ERROR_RANK: Partial<Record<ErrorCode, number>> = {
  STORE_PAUSED: 1, STORE_CLOSED: 1, SERVICE_NOT_AVAILABLE: 1,
  ITEM_UNLISTED: 2,
  ITEM_SOLD_OUT: 3,
  ITEM_STOCK_INSUFFICIENT: 4,
  OPTION_INVALID: 5, OPTION_UNAVAILABLE: 5,
  QUANTITY_EXCEEDED: 6,
  SLOT_UNAVAILABLE: 7, TABLE_NOT_FOUND: 7,
  OUT_OF_DELIVERY_AREA: 8, MIN_ORDER_NOT_MET: 8,
  COUPON_NOT_FOUND: 9, COUPON_EXPIRED: 9, COUPON_NOT_APPLICABLE: 9, COUPON_MIN_NOT_MET: 9,
  COUPON_USED_UP: 9, LOGIN_REQUIRED: 9,
  PAYMENT_METHOD_NOT_ALLOWED: 10, INVOICE_INVALID: 10,
};

export function topErrorOf(checks: ReadonlyArray<QuoteCheck>): ErrorCode | null {
  let best: { code: ErrorCode; rank: number } | null = null;
  for (const c of checks) {
    if (c.severity !== 'ERROR') continue;
    const rank = ERROR_RANK[c.code] ?? 99;
    if (best === null || rank < best.rank) best = { code: c.code, rank };
  }
  return best === null ? null : best.code;
}

interface OptionAnalysis {
  selected: SelectedOption[];
  invalid: boolean;
  unavailable: string | null;
}

/** BR-12：選項須屬於該商品；SINGLE 必選恰選 1、MULTIPLE 介於 min～max；不可用的選項另回報 */
function analyzeOptions(groups: ReadonlyArray<OptionGroup>, optionIds: ReadonlyArray<ID>): OptionAnalysis {
  const index = new Map<ID, { group: OptionGroup; gi: number; oi: number }>();
  groups.forEach((group, gi) => {
    group.options.forEach((o, oi) => index.set(o.id, { group, gi, oi }));
  });
  let invalid = false;
  let unavailable: string | null = null;
  const seen = new Set<ID>();
  const counts = new Map<ID, number>();
  const picked: Array<SelectedOption & { order: number }> = [];
  for (const id of optionIds) {
    const hit = index.get(id);
    if (hit === undefined || seen.has(id)) {
      invalid = true;
      continue;
    }
    seen.add(id);
    counts.set(hit.group.id, (counts.get(hit.group.id) ?? 0) + 1);
    const option = hit.group.options[hit.oi];
    if (option === undefined) continue;
    if (!option.isAvailable && unavailable === null) unavailable = option.name;
    picked.push({
      groupId: hit.group.id,
      groupName: hit.group.name,
      optionId: option.id,
      name: option.name,
      priceDelta: option.priceDelta,
      order: hit.gi * 1000 + hit.oi,
    });
  }
  for (const g of groups) {
    const n = counts.get(g.id) ?? 0;
    if (g.selectionType === 'SINGLE') {
      if (n > 1 || (g.minSelect >= 1 && n < 1)) invalid = true;
    } else if (n < g.minSelect || n > g.maxSelect) {
      invalid = true;
    }
  }
  picked.sort((a, b) => a.order - b.order);
  return {
    selected: picked.map(({ order: _order, ...rest }) => rest),
    invalid,
    unavailable,
  };
}

function shortSlotLabel(ms: number): string {
  return formatTime(ms);
}

export function evaluateOrder(world: World, req: EvaluationRequest): EvaluationResult {
  const settings = world.seed.settings;
  const nowMs = world.nowMs;
  const checks: QuoteCheck[] = [];
  const error = (
    code: ErrorCode,
    message: string,
    extra: { field?: string; lineIndex?: number } = {},
  ): void => {
    checks.push({ code, severity: 'ERROR', message, ...extra });
  };

  const scheduledMs = req.scheduledAt === null ? null : Date.parse(req.scheduledAt);
  const scheduledAtMs = scheduledMs !== null && Number.isFinite(scheduledMs) ? scheduledMs : null;
  const businessDate = world.businessDateOf(scheduledAtMs);
  const orderLabel = ORDER_TYPE_LABEL[req.orderType];

  // ── A. 店家狀態與取餐方式 ──
  const status = world.status;
  if (status.code === 'PAUSED') {
    error('STORE_PAUSED', '店家目前較忙，暫停接單。可稍後再試或直接來電');
  } else if (status.code === 'CLOSED' && scheduledAtMs === null) {
    error(
      'STORE_CLOSED',
      status.nextOpenAtMs === undefined
        ? '目前休息中，可預約取餐'
        : `目前休息中，可預約 ${formatTime(status.nextOpenAtMs)} 後取餐`,
    );
  }
  const serviceOn =
    req.orderType === 'PICKUP' ? settings.allowPickup
    : req.orderType === 'DELIVERY' ? settings.allowDelivery
    : settings.allowDineIn;
  if (!serviceOn) {
    error('SERVICE_NOT_AVAILABLE', `店家目前未開放${orderLabel}，請改選其他取餐方式`, { field: 'orderType' });
  }

  // ── B. 品項、選項、數量與庫存 ──
  if (req.items.length > settings.maxLines) {
    error('QUANTITY_EXCEEDED', `購物車最多 ${settings.maxLines} 項品項，請移除部分品項`, { field: 'items' });
  }

  const views = new Map<ID, ReturnType<typeof toCatalogView>>();
  const viewOf = (p: WorldProduct): ReturnType<typeof toCatalogView> => {
    let v = views.get(p.id);
    if (v === undefined) {
      v = toCatalogView(toProductDetail(world, p), world.demo.menuProfile);
      views.set(p.id, v);
    }
    return v;
  };

  const analyses = req.items.map((item) => {
    const p = world.products.get(item.productId) ?? null;
    return { p, analysis: p === null ? null : analyzeOptions(viewOf(p).optionGroups, item.optionIds) };
  });

  const allocationLines: AllocationLine[] = req.items.map((item, index) => {
    const a = analyses[index]?.analysis ?? null;
    return {
      index,
      productId: item.productId,
      quantity: item.quantity,
      optionsValid: a !== null && !a.invalid && a.unavailable === null,
    };
  });
  const facts = new Map<ID, ProductFacts>();
  for (const item of req.items) {
    const p = world.products.get(item.productId);
    if (p === undefined || facts.has(p.id)) continue;
    facts.set(p.id, {
      listed: p.listed,
      // 手動旗標僅約束當前營業日；預約其他營業日的訂單不受阻擋（BR-40）
      manualSoldOut: p.manualSoldOut && businessDate === world.currentBusinessDate,
      remaining: world.remaining(businessDate, p),
    });
  }
  const allocated = allocateByProduct(allocationLines, facts);

  const quotedLines: QuotedLine[] = [];
  const evaluated: EvaluatedLine[] = [];
  req.items.forEach((item, index) => {
    const entry = analyses[index];
    const p = entry?.p ?? null;
    const analysis = entry?.analysis ?? null;
    const alloc = allocated[index];
    const view = p === null ? null : viewOf(p);
    const name = p?.name ?? '未知商品';
    const selected = analysis?.selected ?? [];
    const unit = p === null ? 0 : unitPrice({ basePrice: p.basePrice, optionDeltas: selected.map((s) => s.priceDelta) });

    const cap = Math.min(item.quantity, settings.maxQuantityPerItem);
    const availableQuantity = Math.min(alloc?.availableQuantity ?? 0, cap);
    const exceeded = item.quantity > settings.maxQuantityPerItem;

    // 一行只回報優先序最高者：UNLISTED > SOLD_OUT > STOCK_INSUFFICIENT > OPTION_INVALID > OPTION_UNAVAILABLE > QUANTITY_EXCEEDED
    let issue: QuotedLine['issue'];
    if (alloc?.issue !== undefined) issue = alloc.issue;
    else if (analysis?.invalid === true) issue = 'OPTION_INVALID';
    else if (analysis?.unavailable !== null && analysis?.unavailable !== undefined) issue = 'OPTION_UNAVAILABLE';
    else if (exceeded) issue = 'QUANTITY_EXCEEDED';

    // checks[]：該行所有原因（issue 只是其中優先序最高者）
    const at = { field: 'items', lineIndex: index };
    if (alloc?.issue === 'ITEM_UNLISTED') {
      error('ITEM_UNLISTED', `${name}已下架`, at);
    } else if (alloc?.issue === 'ITEM_SOLD_OUT') {
      error('ITEM_SOLD_OUT', `${name}已售完`, at);
    } else if (alloc?.issue === 'ITEM_STOCK_INSUFFICIENT') {
      const left = alloc.remaining;
      error(
        'ITEM_STOCK_INSUFFICIENT',
        alloc.availableQuantity === 0
          ? `${name}的剩餘份數已被同商品其他品項占用`
          : `${name}只剩 ${left ?? alloc.availableQuantity} 份`,
        at,
      );
    }
    if (alloc?.issue === undefined || alloc.issue === 'ITEM_STOCK_INSUFFICIENT') {
      if (analysis?.invalid === true) {
        error('OPTION_INVALID', `${name}的選項不符規則，請重新選擇`, at);
      } else if (analysis?.unavailable !== null && analysis?.unavailable !== undefined) {
        error('OPTION_UNAVAILABLE', `${name}的「${analysis.unavailable}」暫無供應`, at);
      }
    }
    if (exceeded && alloc?.issue !== 'ITEM_UNLISTED') {
      error('QUANTITY_EXCEEDED', `${name}此品項最多 ${settings.maxQuantityPerItem} 份`, at);
    }

    const line: QuotedLine = {
      index,
      productId: item.productId,
      name,
      optionLabels: selected.map((s) => s.name),
      unitPrice: unit,
      quantity: item.quantity,
      lineTotal: unit * availableQuantity,
      available: availableQuantity >= item.quantity && issue === undefined,
      availableQuantity,
    };
    if (view?.imageUrl !== undefined) line.imageUrl = view.imageUrl;
    if (alloc?.remaining !== undefined) line.remaining = alloc.remaining;
    if (issue !== undefined) line.issue = issue;
    quotedLines.push(line);

    const note = item.note?.trim();
    evaluated.push({
      index,
      productId: item.productId,
      quantity: item.quantity,
      note: note === undefined || note === '' ? null : note,
      product: p,
      selected,
      unitPrice: unit,
      availableQuantity,
    });
  });

  const allUnavailable = quotedLines.length > 0 && quotedLines.every((l) => l.availableQuantity === 0);
  const subtotal = quotedLines.reduce((s, l) => s + l.lineTotal, 0);

  // ── C. 時段與桌號 ──
  const zone = req.orderType === 'DELIVERY' && req.zipCode !== undefined ? world.zone(req.zipCode) : null;
  const leadMinutes = world.leadMinutes(req.orderType, req.zipCode);
  if (req.orderType === 'DINE_IN') {
    if (scheduledAtMs !== null) {
      error('SLOT_UNAVAILABLE', '內用不提供預約，請改選盡快', { field: 'scheduledAt' });
    }
  } else if (scheduledAtMs !== null) {
    const days = generateSlotDays({
      nowMs,
      leadMinutes,
      businessHours: world.hours.businessHours,
      specialDays: world.hours.specialDays,
      rules: {
        intervalMinutes: settings.slotIntervalMinutes,
        maxAdvanceDays: settings.maxAdvanceDays,
        lastOrderOffsetMinutes: settings.lastOrderOffsetMinutes,
        maxOrdersPerSlot: settings.maxOrdersPerSlot,
      },
      bookedAt: (t) => world.bookedAt(t),
    });
    const slot = findSlot(days, scheduledAtMs);
    if (slot === null) {
      error('SLOT_UNAVAILABLE', `${shortSlotLabel(scheduledAtMs)} 已來不及準備，請重新選擇時段`, {
        field: 'scheduledAt',
      });
    } else if (slot.status === 'FULL') {
      error('SLOT_UNAVAILABLE', `${shortSlotLabel(scheduledAtMs)} 這個時段已額滿`, { field: 'scheduledAt' });
    }
  } else if (status.code === 'OPEN') {
    // 盡快：預估完成不得晚於打烊（BR-08）；外送較長的前置可能比自取更早無法接受即時單
    const asap = asapAvailability({
      status: status.code,
      nowMs,
      leadMinutes,
      containingCloseMs: containingCloseMs(world),
    });
    if (!asap.available) {
      error('SLOT_UNAVAILABLE', '目前來不及在打烊前準備完成，請改選預約時段', { field: 'scheduledAt' });
    }
  }

  // 內用可以沒有桌號（自由入座、先領餐號叫號）：沒提供 tableNo 與 qrToken（空字串 / 全空白視同未提供）就不檢查；
  // 有提供才驗證 VR-10 格式與店家桌位，否則 TABLE_NOT_FOUND（QR 權杖優先於手動桌號）。
  let table: TableSeed | null = null;
  if (req.create !== undefined && req.orderType === 'DINE_IN') {
    const dineIn = req.create.dineIn;
    const token = dineIn?.qrToken?.trim().toUpperCase() ?? '';
    const no = dineIn?.tableNo?.trim().toUpperCase() ?? '';
    if (token !== '' || no !== '') {
      table =
        world.seed.tables.find(
          (t) =>
            t.isActive &&
            (token !== '' ? t.qrToken.toUpperCase() === token : TABLE_NO_RE.test(no) && t.tableNo.toUpperCase() === no),
        ) ?? null;
      if (table === null) error('TABLE_NOT_FOUND', '找不到這個桌號，請洽店員', { field: 'dineIn.tableNo' });
    }
  }

  // ── D. 外送範圍、最低消費與運費 ──
  let minOrderShortfall: number | undefined;
  if (req.orderType === 'DELIVERY') {
    if (req.zipCode !== undefined) {
      if (zone === null) {
        error('OUT_OF_DELIVERY_AREA', '此地址不在外送範圍內，可改為自取', { field: 'delivery.zipCode' });
      } else if (!allUnavailable && subtotal < zone.minOrderAmount) {
        minOrderShortfall = zone.minOrderAmount - subtotal;
        error('MIN_ORDER_NOT_MET', `還差 $${minOrderShortfall} 可外送`, { field: 'items' });
      }
    }
  } else if (!allUnavailable && settings.minOrderAmount > 0 && subtotal < settings.minOrderAmount) {
    minOrderShortfall = settings.minOrderAmount - subtotal;
    error('MIN_ORDER_NOT_MET', `還差 $${minOrderShortfall} 可${orderLabel}`, { field: 'items' });
  }
  const deliveryFee = allUnavailable ? 0 : calcDeliveryFee(req.orderType, subtotal, zone);

  // ── E. 折扣碼（BR-20：存在 → 啟用 → 有效期 → 適用取餐方式 → 最低消費 → 會員限定 → 總量 / 個人上限） ──
  let discount = 0;
  let couponInfo: QuoteResponse['coupon'];
  let couponDetail: EvaluationDetail['coupon'] = null;
  const code = req.couponCode?.trim().toUpperCase() ?? '';
  if (code !== '') {
    const found = world.couponByCode(code);
    if (found === null || !found.seed.isActive) {
      error('COUPON_NOT_FOUND', '找不到此折扣碼', { field: 'couponCode' });
    } else {
      const c = found.seed;
      let applied = false;
      if (nowMs < c.startsAt || nowMs > c.endsAt) {
        error('COUPON_EXPIRED', nowMs < c.startsAt ? '此折扣碼尚未生效' : '此折扣碼已過期', {
          field: 'couponCode',
        });
      } else if (!c.applicableOrderTypes.includes(req.orderType)) {
        error('COUPON_NOT_APPLICABLE', '此取餐方式不適用', { field: 'couponCode' });
      } else if (!allUnavailable && subtotal < c.minOrderAmount) {
        error('COUPON_MIN_NOT_MET', `還差 $${c.minOrderAmount - subtotal} 可使用`, { field: 'couponCode' });
      } else if (c.memberOnly && world.userId === null) {
        error('LOGIN_REQUIRED', '此折扣碼僅限會員', { field: 'couponCode' });
      } else {
        const phone = req.create?.contactPhone ?? null;
        const personalUses = world.couponUsesBy(c.id, { userId: world.userId, phone });
        const exhausted = c.totalQuota !== null && found.usedCount >= c.totalQuota;
        const personalExceeded = c.perUserLimit !== null && personalUses >= c.perUserLimit;
        if (exhausted || personalExceeded) {
          error('COUPON_USED_UP', '此折扣碼已被領完或已使用', { field: 'couponCode' });
        } else {
          applied = true;
          discount = allUnavailable
            ? 0
            : calcDiscount(
                {
                  discountType: c.discountType,
                  discountValue: c.discountValue,
                  maxDiscountAmount: c.maxDiscountAmount,
                },
                subtotal,
                deliveryFee,
              );
        }
      }
      couponInfo = { code: c.code, name: c.name, discountType: c.discountType, applied };
      couponDetail = { seed: c, applied };
    }
  }

  // ── F. 付款與發票（僅 POST /orders；QuoteRequest 沒有這些欄位，06 §3.2） ──
  if (req.create !== undefined) {
    if (!world.seed.paymentMethods.includes(req.create.paymentMethod)) {
      error('PAYMENT_METHOD_NOT_ALLOWED', '此付款方式目前無法使用，請重新選擇', { field: 'paymentMethod' });
    }
    const inv = req.create.invoice;
    if (inv.type === 'MOBILE_BARCODE' && !MOBILE_BARCODE_RE.test(inv.carrierCode ?? '')) {
      error('INVOICE_INVALID', '手機條碼格式不正確（例：/ABC1234）', { field: 'invoice.carrierCode' });
    } else if (inv.type === 'CITIZEN_CERT' && !CITIZEN_CERT_RE.test(inv.carrierCode ?? '')) {
      error('INVOICE_INVALID', '自然人憑證條碼格式不正確', { field: 'invoice.carrierCode' });
    } else if (inv.type === 'DONATION' && !DONATE_CODE_RE.test(inv.donateCode ?? '')) {
      error('INVOICE_INVALID', '愛心碼為 3～7 位數字', { field: 'invoice.donateCode' });
    } else if (inv.type === 'COMPANY' && !isValidTaxId(inv.taxId ?? '')) {
      error('INVOICE_INVALID', '統一編號格式不正確', { field: 'invoice.taxId' });
    }
  }

  // ── 彙整 ──
  const total = calcTotal(subtotal, deliveryFee, discount);
  const quote: QuoteResponse = {
    valid: !checks.some((c) => c.severity === 'ERROR'),
    items: quotedLines,
    subtotal,
    deliveryFee,
    discount,
    total,
    checks,
  };
  if (couponInfo !== undefined) quote.coupon = couponInfo;
  if (minOrderShortfall !== undefined) quote.minOrderShortfall = minOrderShortfall;
  quote.estimatedReadyAt = toIsoTaipei(scheduledAtMs ?? nowMs + leadMinutes * MINUTE_MS);

  return {
    quote,
    topError: topErrorOf(checks),
    detail: {
      businessDate,
      scheduledAtMs,
      lines: evaluated,
      zone,
      coupon: couponDetail,
      leadMinutes,
      table,
    },
  };
}

/** 422 的頂層 message：單一項取該項（時段類用通用句），多項彙整為「有 n 項需要調整：…」（06 §5.9 範例） */
export function summarizeChecks(checks: ReadonlyArray<QuoteCheck>): string {
  const errors = checks.filter((c) => c.severity === 'ERROR');
  if (errors.length === 0) return '';
  if (errors.length === 1) {
    const only = errors[0];
    if (only?.code === 'SLOT_UNAVAILABLE' && only.message.includes('額滿')) {
      return '此時段已額滿，請選擇其他時段';
    }
    return only?.message ?? '';
  }
  return `有 ${errors.length} 項需要調整：${errors.map((c) => c.message).join('、')}`;
}
