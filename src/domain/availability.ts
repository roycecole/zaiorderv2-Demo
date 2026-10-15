// src/domain/availability.ts
import type { CartLine } from './cart';
import type {
  BusinessHour, ErrorCode, HHmm, ID, ISODate, ISODateTime, OrderStatus, QuoteResponse,
  SpecialDay, TWD, Weekday,
} from './types';

// ───────── 計入集合與剩餘份數（BR-38） ─────────

export interface CountableOrder {
  status: OrderStatus;
  /** payment.expiresAt（epoch ms）；僅 PENDING_PAYMENT 有值 */
  paymentExpiresAtMs: number | null;
}

/**
 * BR-38：訂單是否計入已售份數與時段已訂數。半開區間：付款期限當下即不計入；CANCELLED 一律不計入。
 * nowMs 在後端為資料庫時鐘（05 §6.3），在 Mock 為 getClock().now()；不得混用應用伺服器時間。
 */
export function countsTowardStock(o: CountableOrder, nowMs: number): boolean {
  if (o.status === 'CANCELLED') return false;
  if (o.status === 'PENDING_PAYMENT' && o.paymentExpiresAtMs !== null && o.paymentExpiresAtMs <= nowMs) {
    return false;
  }
  return true;
}

/** 取餐營業日尚可購買份數；null = 不限量；不得為負（店家調降限量低於已售時夾為 0） */
export function remainingOf(limit: number | null, consumed: number): number | null {
  return limit === null ? null : Math.max(0, limit - consumed);
}

/** 剩餘份數 ≤ 此值才向顧客揭露「今日剩 n 份」（FR-MN-06） */
export const REMAINING_DISCLOSE_MAX = 10;

/** 要顯示的剩餘份數；不限量、售完（0）、未提供或超過揭露門檻時回傳 null */
export function disclosedRemaining(remaining: number | null | undefined): number | null {
  if (remaining === null || remaining === undefined) return null;
  return remaining >= 1 && remaining <= REMAINING_DISCLOSE_MAX ? remaining : null;
}

// ───────── 同商品多行配置（BR-40） ─────────

export interface AllocationLine {
  /** QuoteRequest.items 的索引 */
  index: number;
  productId: ID;
  quantity: number;
  /** false = 選項不符或暫無供應：不參與配置，availableQuantity 為 0（issue 由選項驗證給出） */
  optionsValid: boolean;
}

export interface ProductFacts {
  /** 未下架 */
  listed: boolean;
  /** is_sold_out 手動旗標；僅約束當前營業日，取餐營業日不是當前營業日時由呼叫端傳入 false（BR-40） */
  manualSoldOut: boolean;
  /** 取餐營業日的剩餘份數；null = 不限量 */
  remaining: number | null;
}

export type AllocationIssue = 'ITEM_UNLISTED' | 'ITEM_SOLD_OUT' | 'ITEM_STOCK_INSUFFICIENT';

export interface AllocatedLine {
  index: number;
  availableQuantity: number;
  /** 同商品多行加總前的剩餘份數；null = 不限量；省略 = 不適用（已下架或查無商品） */
  remaining?: number | null;
  issue?: AllocationIssue;
}

/**
 * 同商品多行以 productId 加總，依請求順序配置剩餘量，後面的行先被縮減。
 * 只有可供應的行（未下架、選項有效）參與配置；已被前面的行用完而配置為 0 時，
 * 只要商品層級仍有剩餘就是 ITEM_STOCK_INSUFFICIENT（已被同商品其他行占用），不是 ITEM_SOLD_OUT（BR-40）。
 */
export function allocateByProduct(
  lines: ReadonlyArray<AllocationLine>,
  facts: ReadonlyMap<ID, ProductFacts>,
): AllocatedLine[] {
  const left = new Map<ID, number | null>();
  return lines.map((l): AllocatedLine => {
    const f = facts.get(l.productId);
    if (f === undefined || !f.listed) {
      return { index: l.index, availableQuantity: 0, issue: 'ITEM_UNLISTED' };
    }
    const base: AllocatedLine = { index: l.index, availableQuantity: 0, remaining: f.remaining };
    if (f.manualSoldOut || f.remaining === 0) return { ...base, issue: 'ITEM_SOLD_OUT' };
    if (!l.optionsValid) return base;

    const want = Math.max(0, l.quantity);
    const cap = left.has(l.productId) ? left.get(l.productId) ?? null : f.remaining;
    if (cap === null) {
      left.set(l.productId, null);
      return { ...base, availableQuantity: want };
    }
    const take = Math.min(want, cap);
    left.set(l.productId, cap - take);
    return take < want
      ? { ...base, availableQuantity: take, issue: 'ITEM_STOCK_INSUFFICIENT' }
      : { ...base, availableQuantity: take };
  });
}

/**
 * 步進器 / 「＋」可增加到的上限（FR-PD-04）：remaining 為 null 或未提供時只受 maxPerLine 限制。
 * maxPerLine 由呼叫端傳入 MAX_QTY_PER_LINE（domain/cart.ts），避免模組間的值相依。
 */
export function maxAddable(
  remaining: number | null | undefined,
  otherLinesQty: number,
  maxPerLine: number,
): number {
  const cap =
    remaining === null || remaining === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, remaining - Math.max(0, otherLinesQty));
  return Math.max(0, Math.min(maxPerLine, cap));
}

/** 時段是否還有名額：max_orders_per_slot 為 null 代表不限 */
export function slotHasCapacity(maxOrdersPerSlot: number | null, booked: number): boolean {
  return maxOrdersPerSlot === null || booked < maxOrdersPerSlot;
}

// ───────── 取餐營業日（BR-23、BR-40） ─────────

export interface BusinessCalendar {
  /** 店家時區相對 UTC 的分鐘位移（Asia/Taipei = 480；不含夏令時間） */
  utcOffsetMinutes: number;
  businessHours: ReadonlyArray<BusinessHour>;
  specialDays?: ReadonlyArray<SpecialDay>;
}

const DAY_MS = 86_400_000;

function minutesOf(hhmm: HHmm): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** 自 1970-01-01 起的日數 → "YYYY-MM-DD"（civil_from_days；純算術，不使用 Date 建構子） */
function isoFromDays(days: number): ISODate {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 某營業日跨午夜時段的收店分鐘數（隔日 00:00 起算）；特殊營業日優先於一般營業時段 */
function overnightCloses(days: number, cal: BusinessCalendar): number[] {
  const date = isoFromDays(days);
  const weekday = ((((days + 4) % 7) + 7) % 7) as Weekday;
  const special = cal.specialDays?.find((s) => s.date === date);
  let spans: Array<{ open: HHmm; close: HHmm }>;
  if (special !== undefined) {
    spans =
      special.type === 'SPECIAL_HOURS' && special.open !== undefined && special.close !== undefined
        ? [{ open: special.open, close: special.close }]
        : [];
  } else {
    spans = cal.businessHours.filter((h) => h.weekday === weekday);
  }
  return spans
    .filter((s) => minutesOf(s.close) < minutesOf(s.open))
    .map((s) => minutesOf(s.close));
}

/**
 * 訂單的取餐營業日：即時單為 now 所屬營業日，預約單為 scheduledAt 所屬營業日。
 * 跨午夜營業的時段歸屬開始營業的那一日（BR-23）：18:00–01:00 的店，00:30 屬於前一日。
 */
export function targetBusinessDate(
  nowMs: number,
  scheduledAt: ISODateTime | null,
  cal: BusinessCalendar,
): ISODate {
  const parsed = scheduledAt === null ? nowMs : Date.parse(scheduledAt);
  const instant = Number.isFinite(parsed) ? parsed : nowMs;
  const local = instant + cal.utcOffsetMinutes * 60_000;
  const days = Math.floor(local / DAY_MS);
  const minutes = Math.floor((local - days * DAY_MS) / 60_000);
  const spillsOver = overnightCloses(days - 1, cal).some((close) => minutes < close);
  return isoFromDays(spillsOver ? days - 1 : days);
}

// ───────── 結帳異動清單（FR-CK-16、FLOW-23） ─────────

/** 依顯示順序（FLOW-23 的類別編號）：1 無法購買 → 2 數量不足 → 3 時段 · 取餐方式 → 4 折扣 · 付款 · 發票 · 外送條件 → 5 價格更新 */
export type CheckoutIssueKind = 'UNAVAILABLE' | 'QUANTITY' | 'SLOT' | 'CONDITION' | 'PRICE';
export type PriceIssueCode = 'PRICE_UPDATED' | 'DISCOUNT_LOST' | 'TOTAL_CHANGED';

/** 店家狀態類不進清單：呼叫端立即 invalidate /status 與 StoreInfo，於狀態列顯示店家狀態說明（休息 → 改預約；暫停 → 唯讀與店家電話） */
export type StoreIssue = 'STORE_PAUSED' | 'STORE_CLOSED';

export interface CheckoutIssue {
  kind: CheckoutIssueKind;
  code: ErrorCode | PriceIssueCode;
  /** 阻擋送出並計入「還有 n 項需要處理」；只有價格更新不阻擋（LOGIN_REQUIRED 與其他折扣碼錯誤同為阻擋，BR-33） */
  blocking: boolean;
  /** 對應 quote.items 的索引與購物車行；「行數超過 maxLines」為無 lineIndex 的整單項 */
  lineIndex?: number;
  lineId?: string;
  productId?: ID;
  /** 落點欄位：items、orderType、scheduledAt、couponCode、delivery.zipCode、paymentMethod、invoice、dineIn.tableNo */
  field?: string;
  requestedQuantity?: number;
  availableQuantity?: number;
  /** 商品層級剩餘份數（同商品多行加總前；null = 不限量；省略 = 不適用）：0 為限量用盡（補充說明份數可能釋出，Q-15），並供同商品組標題「今日只剩 n 份」 */
  remaining?: number | null;
  /** ITEM_SOLD_OUT：前一次報價（previous）顯示此行可購買，即送出被退回時的「剛剛被訂走了」；未提供前一次報價時省略 */
  wasAvailable?: boolean;
  /** 價格更新：單價（PRICE_UPDATED）或總額（DISCOUNT_LOST、TOTAL_CHANGED）的舊值與新值 */
  from?: TWD;
  to?: TWD;
  /** DISCOUNT_LOST：失效的折扣金額 */
  discountLost?: TWD;
  /** 伺服器訊息；未知錯誤碼時作為顯示用的降級文字（已知錯誤碼的文案由前端依 code 與份數組成，03 §9） */
  message?: string;
}

export interface CheckoutIssueResult {
  issues: CheckoutIssue[];
  /** 店家狀態類（STORE_PAUSED 優先於 STORE_CLOSED）；沒有則為 null。不進 issues，也不計入鎖定數 */
  storeIssue: StoreIssue | null;
}

type LineRef = Pick<CheckoutIssue, 'lineIndex' | 'lineId' | 'productId' | 'field'>;

/**
 * 顧客目前據以送出的金額（即送出請求的 expectedTotal）：進入結帳時為購物車快照加總（已被移除的行不計），
 * 之後為顧客已看見並確認的最近一次 quote.total；不是最新一次 quote 的值，否則永遠看不到「總額增加」（FLOW-23）。
 */
export interface ShownTotals {
  total: TWD;
  discount: TWD;
}

const KIND_ORDER: Record<CheckoutIssueKind, number> = {
  UNAVAILABLE: 0, QUANTITY: 1, SLOT: 2, CONDITION: 3, PRICE: 4,
};

const UNAVAILABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'ITEM_UNLISTED', 'ITEM_SOLD_OUT', 'OPTION_INVALID', 'OPTION_UNAVAILABLE',
]);
const QUANTITY_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'ITEM_STOCK_INSUFFICIENT', 'QUANTITY_EXCEEDED',
]);
/** 第 4 類（FLOW-23 的類別編號即顯示順序）：每個 422 錯誤碼在畫面上都有落點欄位 */
const CONDITION_FIELDS: Partial<Record<ErrorCode, string>> = {
  COUPON_NOT_FOUND: 'couponCode',
  COUPON_EXPIRED: 'couponCode',
  COUPON_NOT_APPLICABLE: 'couponCode',
  COUPON_MIN_NOT_MET: 'couponCode',
  COUPON_USED_UP: 'couponCode',
  LOGIN_REQUIRED: 'couponCode',
  MIN_ORDER_NOT_MET: 'items',
  OUT_OF_DELIVERY_AREA: 'delivery.zipCode',
  PAYMENT_METHOD_NOT_ALLOWED: 'paymentMethod',
  INVOICE_INVALID: 'invoice',
  TABLE_NOT_FOUND: 'dineIn.tableNo',
};

/**
 * 前端：QuoteResponse（含 POST /orders 被退回時的 error.quote）+ 該 quote 請求當時的 lineId 快照 + 目前購物車
 * → 異動項與店家狀態旗標。同一個函式處理 quote 預檢與送出被退回（FLOW-23）；每個 422 錯誤碼都有落點，不靜默丟棄：
 * STORE_PAUSED / STORE_CLOSED 以 storeIssue 回傳，SERVICE_NOT_AVAILABLE 列為第 3 類（field = orderType）。
 * lineIds[i] 為該 quote 請求當時 QuoteRequest.items[i] 對應的購物車行 lineId（隨 quote 一併保存的快照，重新計價期間沿用）：
 * 以 lineId 在「目前」的購物車找行並驗證 productId 一致；對不到（該行已移除）或不一致者略過，不指到別的品項（R-Y）。
 * 快照使用期間（就地動作送出到新 quote 回來之間）逐行動作停用，避免連續點擊作用在已改變的購物車。
 * shown 為顧客目前據以送出的金額（見 ShownTotals），供折扣失效與總額變動判斷；
 * previous 為前一次已呈現的報價，供「剛剛被訂走了」判斷（wasAvailable）。
 */
export function deriveCheckoutIssues(
  quote: QuoteResponse,
  lineIds: ReadonlyArray<string>,
  cartLines: ReadonlyArray<CartLine>,
  shown?: ShownTotals,
  previous?: QuoteResponse,
): CheckoutIssueResult {
  const out: CheckoutIssue[] = [];
  const seen = new Set<string>();
  // 每個 lineIndex 只列優先序最高的一項（06 §4.3：issue 為該行主要原因），其餘 check 不重複計入 n
  const handledLines = new Set<number>();
  const push = (i: CheckoutIssue): void => {
    const key = `${i.code}|${i.lineIndex ?? ''}|${i.field ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(i);
  };
  const cartById = new Map<string, CartLine>();
  for (const l of cartLines) cartById.set(l.lineId, l);
  /** quote 第 index 行對應的目前購物車行；快照的 lineId 對不到，或 productId 與 quote 不一致者為 undefined（略過） */
  const bind = (index: number, productId: ID | undefined): CartLine | undefined => {
    const lineId = lineIds[index];
    const cart = lineId === undefined ? undefined : cartById.get(lineId);
    if (cart === undefined) return undefined;
    return productId !== undefined && cart.productId !== productId ? undefined : cart;
  };
  const lineRef = (index: number, cart: CartLine): LineRef => ({
    lineIndex: index, field: 'items', lineId: cart.lineId, productId: cart.productId,
  });

  // 1) 品項行：issue 為單一最高優先序；未帶 issue 但可購買量不足者視為數量不足
  for (const q of quote.items) {
    const code: ErrorCode | undefined =
      q.issue ?? (q.availableQuantity < q.quantity ? 'ITEM_STOCK_INSUFFICIENT' : undefined);
    if (code === undefined) continue;
    const cart = bind(q.index, q.productId);
    if (cart === undefined) continue; // 該行已移除，或與 quote 請求時不是同一品項：略過
    handledLines.add(q.index);
    const base = lineRef(q.index, cart);
    if (UNAVAILABLE_CODES.has(code)) {
      const issue: CheckoutIssue = { kind: 'UNAVAILABLE', code, blocking: true, ...base, availableQuantity: 0 };
      if (q.remaining !== undefined) issue.remaining = q.remaining;
      if (code === 'ITEM_SOLD_OUT' && previous !== undefined) {
        issue.wasAvailable = previous.items.some(
          (p) => p.index === q.index && p.productId === q.productId && p.available,
        );
      }
      push(issue);
    } else {
      const issue: CheckoutIssue = {
        kind: 'QUANTITY', code, blocking: true, ...base,
        requestedQuantity: q.quantity, availableQuantity: q.availableQuantity,
      };
      if (q.remaining !== undefined) issue.remaining = q.remaining;
      push(issue);
    }
  }

  // 2) checks[]：店家狀態、時段 · 取餐方式、數量上限（含行數）與第 4 類；已由品項行呈現的行不重複列出
  let storeIssue: StoreIssue | null = null;
  let hasCouponError = false;
  for (const c of quote.checks) {
    if (c.severity !== 'ERROR') continue;
    if (c.code === 'STORE_PAUSED') {
      storeIssue = 'STORE_PAUSED';
      continue;
    }
    if (c.code === 'STORE_CLOSED') {
      if (storeIssue === null) storeIssue = 'STORE_CLOSED';
      continue;
    }
    if (c.code === 'SERVICE_NOT_AVAILABLE') {
      // 第 3 類：呼叫端重新載入 StoreInfo 並停用該取餐方式；動作「改為其他取餐方式」
      push({ kind: 'SLOT', code: c.code, blocking: true, message: c.message, field: 'orderType' });
      continue;
    }
    // 指向品項行的 check：以快照 lineId 綁定目前購物車行，綁不到者略過；整單項（無 lineIndex）不受影響
    let ref: LineRef = {};
    if (c.lineIndex !== undefined) {
      const cart = bind(c.lineIndex, quote.items.find((x) => x.index === c.lineIndex)?.productId);
      if (cart === undefined) continue;
      ref = lineRef(c.lineIndex, cart);
      if (UNAVAILABLE_CODES.has(c.code) || QUANTITY_CODES.has(c.code)) {
        if (handledLines.has(c.lineIndex)) continue;
        handledLines.add(c.lineIndex);
      }
    }
    const common = { code: c.code, blocking: true, message: c.message, ...ref };
    if (UNAVAILABLE_CODES.has(c.code)) {
      push({ kind: 'UNAVAILABLE', ...common, field: c.field ?? 'items' });
    } else if (QUANTITY_CODES.has(c.code)) {
      // 單行超過上限，或「行數超過 maxLines」（無 lineIndex 的整單項，動作「移除品項」）
      push({ kind: 'QUANTITY', ...common, field: c.field ?? 'items' });
    } else if (c.code === 'SLOT_UNAVAILABLE') {
      push({ kind: 'SLOT', ...common, field: 'scheduledAt' });
    } else {
      const field = c.field ?? CONDITION_FIELDS[c.code] ?? 'items';
      if (field === 'couponCode') hasCouponError = true;
      push({ kind: 'CONDITION', ...common, field });
    }
  }

  // 3) 價格更新（不計入阻擋數）：單價與購物車快照不同；折扣失效；其餘總額變動
  let explained = false;
  for (const q of quote.items) {
    const cart = bind(q.index, q.productId);
    if (cart === undefined || q.availableQuantity === 0) continue;
    if (cart.snapshot.unitPrice !== q.unitPrice) {
      explained = true;
      push({
        kind: 'PRICE', code: 'PRICE_UPDATED', blocking: false, ...lineRef(q.index, cart),
        from: cart.snapshot.unitPrice, to: q.unitPrice,
      });
    }
  }
  if (shown !== undefined) {
    const lost = shown.discount - quote.discount;
    if (hasCouponError && lost > 0) {
      explained = true;
      push({
        kind: 'PRICE', code: 'DISCOUNT_LOST', blocking: false, field: 'couponCode',
        from: shown.total, to: quote.total, discountLost: lost,
      });
    }
    const blockingTotal = out.filter((i) => i.blocking).length;
    if (!explained && blockingTotal === 0 && quote.total !== shown.total) {
      push({ kind: 'PRICE', code: 'TOTAL_CHANGED', blocking: false, from: shown.total, to: quote.total });
    }
  }

  // 同類別內依行序；無 lineIndex 的整單項（行數超過 maxLines）排在所屬類別最前（FLOW-23）
  const issues = out.sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.lineIndex ?? -1) - (b.lineIndex ?? -1),
  );
  return { issues, storeIssue };
}

/** 「還有 n 項需要處理」的 n：只計阻擋項，價格更新不計入 */
export function blockingCount(issues: ReadonlyArray<CheckoutIssue>): number {
  return issues.filter((i) => i.blocking).length;
}

/** 購物車內所有品項都無法購買 → 以 EmptyState 取代清單（金額皆為 0） */
export function hasNothingToBuy(quote: QuoteResponse): boolean {
  return quote.items.length > 0 && quote.items.every((i) => i.availableQuantity === 0);
}

// ───────── 送出鈕與 Ctrl/⌘ + Enter 的鎖定語意（FLOW-23、BR-27） ─────────

export interface SubmitContext {
  /** 送出中（按鈕 aria-busy）：不動作，避免重複送出 */
  submitting: boolean;
  /**
   * 冷卻中：429（POST /orders 專屬限流）或附 retryAfterSeconds 的 503（建單鎖等待逾時）之後，依該秒數暫停送出（FLOW-24）；
   * 不動作。按鈕以 aria-disabled 呈現並以 aria-describedby 帶倒數說明（可聚焦，同送出中）
   */
  coolingDown: boolean;
  /** 店家暫停接單（PAUSED）：不動作 */
  storePaused: boolean;
  /** 重新計價中：排入佇列，quote 回來後再決定（FLOW-23） */
  repricing: boolean;
  /** 價格差異已展示（清單已展開並呈現差異）；總額增加時須先展示才能送出（FLOW-23） */
  priceDiffShown: boolean;
}

export type SubmitDecision =
  | { type: 'NOOP' }
  | { type: 'QUEUE' }
  | { type: 'FOCUS_LIST'; blockingCount: number }
  | { type: 'REVEAL_PRICE_DIFF' }
  | { type: 'SEND' };

/**
 * 點擊送出鈕或 Ctrl/⌘ + Enter 時的決策（兩者共用）：
 * 有阻擋項 → 聚焦並捲動到清單、不送出；總額增加且差異尚未展示 → 第一次只展開差異並聚焦清單，第二次才送出；
 * 僅降價或價格不變可一鍵送出。判斷順序：送出中 / 冷卻中 / 暫停接單 → 重新計價中 → 阻擋項 → 價格差異 → 送出（FLOW-19 相同）。
 * shownTotal 為顧客目前據以送出的金額（ShownTotals.total）；quotedTotal 為最新的 quote.total（送出被退回時為 error.quote.total）。
 */
export function decideSubmit(
  issues: ReadonlyArray<CheckoutIssue>,
  shownTotal: TWD,
  quotedTotal: TWD,
  ctx: SubmitContext,
): SubmitDecision {
  if (ctx.submitting || ctx.coolingDown || ctx.storePaused) return { type: 'NOOP' };
  if (ctx.repricing) return { type: 'QUEUE' };
  const n = blockingCount(issues);
  if (n > 0) return { type: 'FOCUS_LIST', blockingCount: n };
  if (quotedTotal > shownTotal && !ctx.priceDiffShown) return { type: 'REVEAL_PRICE_DIFF' };
  return { type: 'SEND' };
}
