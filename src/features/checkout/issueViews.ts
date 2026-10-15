// src/features/checkout/issueViews.ts —— 異動項（deriveCheckoutIssues 的輸出）→ 清單卡片與就地動作（CMP-40、FLOW-23、03 §9）
//
// 純函式：文案由前端依錯誤碼與份數組成（伺服器 message 只作未知碼的降級）；
// 動作以資料（IssueActionSpec）描述，由結帳頁依目前狀態執行，因此可單獨測試。
import type { CheckoutIssue, CheckoutIssueKind } from '@/domain/availability';
import type { CartLine } from '@/domain/cart';
import { formatTWD, formatTime } from '@/domain/format';
import type { OrderType, QuoteResponse, Slot } from '@/domain/types';
import { t } from '@/i18n/zh-TW';
import { checkout as tCheckout } from '@/i18n/strings/checkout';

const L = tCheckout.issues;

export type IssueFieldTarget =
  'couponCode' | 'delivery' | 'paymentMethod' | 'invoice' | 'tableNo' | 'items';

export type IssueActionSpec =
  | { type: 'FIT'; lineId: string; quantity: number }
  | { type: 'REMOVE_LINE'; lineId: string }
  | { type: 'RESELECT'; lineId: string }
  | { type: 'PICK_SLOT'; startAt: string }
  | { type: 'OTHER_SLOT' }
  | { type: 'ASAP' }
  | { type: 'TOMORROW'; startAt: string }
  | { type: 'SWITCH_ORDER_TYPE'; orderType: OrderType | null }
  | { type: 'FOCUS_FIELD'; field: IssueFieldTarget }
  | { type: 'REMOVE_COUPON' }
  | { type: 'LOGIN' }
  | { type: 'CONTINUE_ORDERING' }
  | { type: 'REMOVE_LINES' };

export interface IssueAction {
  spec: IssueActionSpec;
  label: string;
  /** 含品名的可存取名稱（「將雙人分享餐改為 2 份」「移除古早味紅茶」） */
  ariaLabel: string | undefined;
  destructive: boolean;
}

export type IssueTone = 'danger' | 'warning' | 'info';

export interface IssueRow {
  key: string;
  lineId: string | undefined;
  /** 選項摘要（同商品多行的各行標示） */
  label: string;
  body: string;
  actions: IssueAction[];
}

export interface IssueCard {
  key: string;
  kind: CheckoutIssueKind;
  tone: IssueTone;
  blocking: boolean;
  /** 品名、取餐時段、折扣碼… */
  heading: string;
  /** 選項摘要等次要資訊 */
  sub: string | undefined;
  /** 原因（「今日售完」「今日只剩 2 份（已選 3 份）」） */
  body: string;
  /** 補充說明（限量用盡的份數可能釋出） */
  note: string | undefined;
  /** 同商品多行分組：各行建議；有此欄位時 actions 為空 */
  rows: IssueRow[] | undefined;
  actions: IssueAction[];
  /** 對應的購物車行（供訂單明細的狀態槽使用）；分組時為全部行 */
  lineIds: string[];
  /** 視覺隱藏摘要用的完整句（品名 + 原因） */
  summary: string;
}

export interface SlotContext {
  /** 最近可選時段（nearestAvailableSlot）；沒有則 null */
  nearest: Slot | null;
  asapAvailable: boolean;
  /** 目前所選時段在最新時段資料中的狀態 */
  scheduledStatus: 'FULL' | 'PASSED' | 'OK' | 'UNKNOWN';
  /** 之後營業日的第一個可選時段（預約明天） */
  tomorrow: Slot | null;
}

export interface IssueViewContext {
  cartLines: ReadonlyArray<CartLine>;
  quote: QuoteResponse | null;
  /** 「今日」或「明天（M/D）」「M/D」（03 §9 取餐日非今日變體） */
  dayWord: string;
  kiosk: boolean;
  orderType: OrderType;
  scheduledAt: string | null;
  slot: SlotContext;
  /** 其他可用的取餐方式（改為其他取餐方式）；沒有則 null */
  alternativeOrderType: OrderType | null;
  pickupAvailable: boolean;
  couponCode: string;
  maxLines: number;
  maxPerItem: number;
}

const action = (
  spec: IssueActionSpec,
  label: string,
  ariaLabel?: string,
  destructive = false,
): IssueAction => ({ spec, label, ariaLabel, destructive });

const optionSummary = (line: CartLine | undefined): string | undefined => {
  const labels = line?.snapshot.optionLabels ?? [];
  return labels.length > 0 ? labels.join('・') : undefined;
};

function orderTypeLabel(orderType: OrderType, kiosk: boolean): string {
  return kiosk ? tCheckout.kioskOrderTypeLabel[orderType] : tCheckout.orderTypeLabel[orderType];
}

function removeAction(line: CartLine | undefined, lineId: string): IssueAction {
  return action(
    { type: 'REMOVE_LINE', lineId },
    L.remove,
    line ? L.removeAria(line.snapshot.name) : undefined,
    true,
  );
}

function fitAction(line: CartLine | undefined, lineId: string, quantity: number): IssueAction {
  return action(
    { type: 'FIT', lineId, quantity },
    L.fit(quantity),
    line ? L.fitAria(line.snapshot.name, quantity) : undefined,
  );
}

function slotActions(ctx: IssueViewContext): IssueAction[] {
  const out: IssueAction[] = [];
  const { nearest, asapAvailable, tomorrow } = ctx.slot;
  if (nearest !== null) {
    out.push(
      action(
        { type: 'PICK_SLOT', startAt: nearest.startAt },
        L.pickSlot(formatTime(nearest.startAt)),
      ),
    );
  }
  out.push(action({ type: 'OTHER_SLOT' }, L.otherSlot));
  if (asapAvailable && ctx.scheduledAt !== null) out.push(action({ type: 'ASAP' }, L.asap));
  if (tomorrow !== null && nearest === null) {
    out.push(action({ type: 'TOMORROW', startAt: tomorrow.startAt }, L.tomorrow));
  }
  return out;
}

/** 異動項 → 卡片（保持 issues 的順序：deriveCheckoutIssues 已依類別與行序排好） */
export function buildIssueCards(
  issues: ReadonlyArray<CheckoutIssue>,
  ctx: IssueViewContext,
): IssueCard[] {
  const lineById = new Map(ctx.cartLines.map((l) => [l.lineId, l]));
  const cards: IssueCard[] = [];

  // 同商品多行的「數量不足」以商品分組（BR-40）：至少 2 行才分組
  const stockByProduct = new Map<string, CheckoutIssue[]>();
  for (const i of issues) {
    if (
      i.code === 'ITEM_STOCK_INSUFFICIENT' &&
      i.productId !== undefined &&
      i.lineId !== undefined
    ) {
      const list = stockByProduct.get(i.productId) ?? [];
      list.push(i);
      stockByProduct.set(i.productId, list);
    }
  }
  const grouped = new Set<string>();

  issues.forEach((issue, index) => {
    const base = `${issue.code}|${issue.lineId ?? ''}|${issue.field ?? ''}|${index}`;
    const line = issue.lineId !== undefined ? lineById.get(issue.lineId) : undefined;
    const name = line?.snapshot.name ?? tCheckout.issues.itemsHeading;
    const sub = optionSummary(line);

    switch (issue.kind) {
      case 'UNAVAILABLE': {
        let body: string;
        let note: string | undefined;
        if (issue.code === 'ITEM_UNLISTED') body = L.unlisted;
        else if (issue.code === 'ITEM_SOLD_OUT') {
          body = issue.wasAvailable === true ? L.justSoldOut : L.soldOut(ctx.dayWord);
          if (issue.remaining === 0) note = ctx.kiosk ? L.stockRestockKiosk : L.stockRestock;
        } else if (issue.code === 'OPTION_INVALID') body = L.optionInvalid;
        else body = L.optionUnavailable;
        const actions: IssueAction[] = [];
        if (issue.lineId !== undefined) {
          if (issue.code === 'OPTION_INVALID' || issue.code === 'OPTION_UNAVAILABLE') {
            actions.push(
              action({ type: 'RESELECT', lineId: issue.lineId }, L.reselect, L.reselectAria(name)),
            );
          }
          actions.push(removeAction(line, issue.lineId));
        }
        cards.push({
          key: base,
          kind: 'UNAVAILABLE',
          tone: 'danger',
          blocking: issue.blocking,
          heading: name,
          sub,
          body,
          note,
          rows: undefined,
          actions,
          lineIds: issue.lineId !== undefined ? [issue.lineId] : [],
          summary: `${name}${body}`,
        });
        break;
      }

      case 'QUANTITY': {
        // 整單項：品項行數超過上限
        if (issue.lineId === undefined) {
          const body = L.tooManyLines(ctx.maxLines);
          cards.push({
            key: base,
            kind: 'QUANTITY',
            tone: 'warning',
            blocking: issue.blocking,
            heading: tCheckout.issues.itemsHeading,
            sub: undefined,
            body,
            note: undefined,
            rows: undefined,
            actions: [action({ type: 'REMOVE_LINES' }, L.removeLines)],
            lineIds: [],
            summary: body,
          });
          break;
        }

        if (issue.code === 'QUANTITY_EXCEEDED') {
          const max = issue.availableQuantity ?? ctx.maxPerItem;
          const body = L.quantityExceeded(max);
          cards.push({
            key: base,
            kind: 'QUANTITY',
            tone: 'warning',
            blocking: issue.blocking,
            heading: name,
            sub,
            body,
            note: undefined,
            rows: undefined,
            actions: [
              ...(max > 0 ? [fitAction(line, issue.lineId, max)] : []),
              removeAction(line, issue.lineId),
            ],
            lineIds: [issue.lineId],
            summary: `${name}${body}`,
          });
          break;
        }

        // 同商品在購物車內有多行：以商品分組（BR-40），組標題為合計已選份數與商品層級剩餘
        const siblings =
          issue.productId !== undefined ? (stockByProduct.get(issue.productId) ?? []) : [];
        const productLines =
          issue.productId !== undefined
            ? ctx.cartLines.filter((l) => l.productId === issue.productId)
            : [];
        if (productLines.length >= 2 && issue.productId !== undefined) {
          if (grouped.has(issue.productId)) break; // 已併入商品分組卡
          grouped.add(issue.productId);
          const selected = productLines.reduce((s, l) => s + l.quantity, 0);
          const issueByLine = new Map(siblings.map((x) => [x.lineId, x]));
          const availableTotal = productLines.reduce(
            (s, l) => s + (issueByLine.get(l.lineId)?.availableQuantity ?? l.quantity),
            0,
          );
          const remaining =
            siblings.find((x) => typeof x.remaining === 'number')?.remaining ?? availableTotal;
          const body = L.groupTitle(ctx.dayWord, selected, remaining ?? 0);
          const rows: IssueRow[] = productLines.map((l, n) => {
            const x = issueByLine.get(l.lineId);
            const available = x?.availableQuantity ?? l.quantity;
            const actions: IssueAction[] = [];
            if (x !== undefined) {
              if (available > 0) actions.push(fitAction(l, l.lineId, available));
              actions.push(removeAction(l, l.lineId));
            }
            return {
              key: `${base}|row${n}`,
              lineId: l.lineId,
              label: optionSummary(l) ?? name,
              body:
                x === undefined
                  ? `${l.quantity} 份`
                  : available === 0
                    ? L.occupiedBySameProduct
                    : L.fit(available),
              actions,
            };
          });
          cards.push({
            key: `STOCK|${issue.productId}`,
            kind: 'QUANTITY',
            tone: 'warning',
            blocking: true,
            heading: name,
            sub: undefined,
            body,
            note: undefined,
            rows,
            actions: [],
            lineIds: productLines.map((l) => l.lineId),
            summary: `${name}${body}`,
          });
          break;
        }

        const available = issue.availableQuantity ?? 0;
        const occupied = available === 0;
        const body = occupied
          ? L.occupiedBySameProduct
          : L.stockInsufficient(
              ctx.dayWord,
              typeof issue.remaining === 'number' ? issue.remaining : available,
              issue.requestedQuantity ?? available,
            );
        cards.push({
          key: base,
          kind: 'QUANTITY',
          tone: 'warning',
          blocking: issue.blocking,
          heading: name,
          sub,
          body,
          note: undefined,
          rows: undefined,
          actions: [
            ...(!occupied ? [fitAction(line, issue.lineId, available)] : []),
            removeAction(line, issue.lineId),
          ],
          lineIds: [issue.lineId],
          summary: `${name}${occupied ? `${sub !== undefined ? sub : ''}${body}` : body}`,
        });
        break;
      }

      case 'SLOT': {
        if (issue.code === 'SERVICE_NOT_AVAILABLE') {
          const body = L.serviceNotAvailable(orderTypeLabel(ctx.orderType, ctx.kiosk));
          cards.push({
            key: base,
            kind: 'SLOT',
            tone: 'warning',
            blocking: issue.blocking,
            heading: L.orderTypeHeading,
            sub: undefined,
            body,
            note: undefined,
            rows: undefined,
            actions: [
              action(
                { type: 'SWITCH_ORDER_TYPE', orderType: ctx.alternativeOrderType },
                L.switchOtherOrderType,
              ),
            ],
            lineIds: [],
            summary: body,
          });
          break;
        }
        const time = ctx.scheduledAt !== null ? formatTime(ctx.scheduledAt) : null;
        let body: string;
        if (time === null) body = L.slotAsapUnavailable;
        else if (ctx.slot.scheduledStatus === 'FULL') body = L.slotFull(time);
        else if (ctx.slot.scheduledStatus === 'PASSED') body = L.slotPassed(time);
        else body = (issue.message ?? '').includes('額滿') ? L.slotFull(time) : L.slotPassed(time);
        cards.push({
          key: base,
          kind: 'SLOT',
          tone: 'warning',
          blocking: issue.blocking,
          heading: L.slotHeading(time),
          sub: undefined,
          body,
          note: undefined,
          rows: undefined,
          actions: slotActions(ctx),
          lineIds: [],
          summary: `${L.slotHeading(time)}${body}`,
        });
        break;
      }

      case 'CONDITION': {
        const cond = conditionCard(issue, ctx, base);
        cards.push(cond);
        break;
      }

      case 'PRICE': {
        const from = issue.from ?? 0;
        const to = issue.to ?? 0;
        let heading = name;
        let body: string;
        if (issue.code === 'PRICE_UPDATED') {
          body = L.priceUpdated(formatTWD(from), formatTWD(to));
        } else if (issue.code === 'DISCOUNT_LOST') {
          heading = L.couponHeading;
          body = L.discountLost(
            formatTWD(-(issue.discountLost ?? 0)),
            formatTWD(from),
            formatTWD(to),
          );
        } else {
          heading = tCheckout.summary.total;
          body = L.totalChanged(formatTWD(from), formatTWD(to));
        }
        cards.push({
          key: base,
          kind: 'PRICE',
          tone: to > from ? 'warning' : 'info',
          blocking: false,
          heading,
          sub: issue.code === 'PRICE_UPDATED' ? sub : undefined,
          body,
          note: L.priceNote,
          rows: undefined,
          actions: [],
          lineIds: issue.lineId !== undefined ? [issue.lineId] : [],
          summary: `${heading}${body}`,
        });
        break;
      }
    }
  });

  return cards;
}

function conditionCard(issue: CheckoutIssue, ctx: IssueViewContext, key: string): IssueCard {
  const common = {
    key,
    kind: 'CONDITION' as const,
    tone: 'warning' as IssueTone,
    blocking: issue.blocking,
    note: undefined,
    rows: undefined,
    lineIds: [] as string[],
    sub: undefined,
  };
  const msg = (fallback: string): string =>
    t.errors.message(
      issue.code,
      issue.message !== undefined && issue.message !== '' ? issue.message : fallback,
    );

  switch (issue.code) {
    case 'LOGIN_REQUIRED': {
      const body = t.errors.couponMemberOnly;
      return {
        ...common,
        heading: L.couponHeading,
        sub: ctx.couponCode || undefined,
        body,
        actions: [
          action({ type: 'REMOVE_COUPON' }, L.removeCoupon),
          action({ type: 'LOGIN' }, L.login),
        ],
        summary: `${L.couponHeading}${body}`,
      };
    }
    case 'COUPON_NOT_FOUND':
    case 'COUPON_EXPIRED':
    case 'COUPON_NOT_APPLICABLE':
    case 'COUPON_MIN_NOT_MET':
    case 'COUPON_USED_UP': {
      const body = msg('');
      return {
        ...common,
        heading: L.couponHeading,
        sub: ctx.couponCode || undefined,
        body,
        actions: [
          action({ type: 'FOCUS_FIELD', field: 'couponCode' }, L.fixCoupon),
          action({ type: 'REMOVE_COUPON' }, L.removeCoupon),
        ],
        summary: `${L.couponHeading}${body}`,
      };
    }
    case 'MIN_ORDER_NOT_MET': {
      const shortfall = ctx.quote?.minOrderShortfall;
      const label =
        ctx.orderType === 'DELIVERY' ? '外送' : ctx.orderType === 'DINE_IN' ? '內用' : '自取';
      const body =
        typeof shortfall === 'number' && shortfall > 0
          ? L.minOrderShortfall(formatTWD(shortfall), label)
          : msg('');
      return {
        ...common,
        heading: L.itemsHeading,
        body,
        actions: [action({ type: 'CONTINUE_ORDERING' }, L.continueOrdering)],
        summary: body,
      };
    }
    case 'OUT_OF_DELIVERY_AREA': {
      const body = msg('');
      const actions: IssueAction[] = [];
      if (ctx.pickupAvailable) {
        actions.push(action({ type: 'SWITCH_ORDER_TYPE', orderType: 'PICKUP' }, L.switchPickup));
      }
      actions.push(action({ type: 'FOCUS_FIELD', field: 'delivery' }, L.fixAddress));
      return {
        ...common,
        heading: L.deliveryHeading,
        body,
        actions,
        summary: `${L.deliveryHeading}${body}`,
      };
    }
    case 'PAYMENT_METHOD_NOT_ALLOWED': {
      const body = msg('');
      return {
        ...common,
        heading: L.paymentHeading,
        body,
        actions: [action({ type: 'FOCUS_FIELD', field: 'paymentMethod' }, L.fixPayment)],
        summary: `${L.paymentHeading}${body}`,
      };
    }
    case 'INVOICE_INVALID': {
      const body = msg('');
      return {
        ...common,
        heading: L.invoiceHeading,
        body,
        actions: [action({ type: 'FOCUS_FIELD', field: 'invoice' }, L.fixInvoice)],
        summary: `${L.invoiceHeading}${body}`,
      };
    }
    case 'TABLE_NOT_FOUND': {
      const body = msg('');
      return {
        ...common,
        heading: L.tableHeading,
        body,
        actions: [action({ type: 'FOCUS_FIELD', field: 'tableNo' }, L.fixTable)],
        summary: `${L.tableHeading}${body}`,
      };
    }
    default: {
      const body = msg(issue.message ?? '');
      return {
        ...common,
        heading: L.itemsHeading,
        body,
        actions: [action({ type: 'FOCUS_FIELD', field: 'items' }, t.common.edit)],
        summary: body,
      };
    }
  }
}

// ───────── 全部套用建議 ─────────

export interface ApplyAllPlan {
  fits: Array<{ lineId: string; quantity: number }>;
  /** 時段改為此時段（沒有時段類異動或沒有可改選的時段則為 null） */
  slot: Slot | null;
  removed: number;
  /** 被調整數量的行數 */
  fitted: number;
  /** 摘要：「移除 1 項、1 項改為 2 份、時段改為 17:15」 */
  summary: string;
  /** 可一次調整的項數（供通報「已調整 n 項」） */
  count: number;
}

/**
 * 一次套用所有可自動處理的建議：無法購買者移除、數量不足者改為可購買份數、時段額滿者改選最近時段。
 * 折扣 / 付款 / 發票 / 外送條件與價格更新需由顧客處理，不在其中。
 */
export function planApplyAll(
  issues: ReadonlyArray<CheckoutIssue>,
  slot: SlotContext,
): ApplyAllPlan {
  const fits = new Map<string, number>();
  const qtyCounts = new Map<number, number>();
  let removed = 0;
  for (const i of issues) {
    if (i.lineId === undefined || fits.has(i.lineId)) continue;
    if (i.kind === 'UNAVAILABLE') {
      fits.set(i.lineId, 0);
      removed += 1;
    } else if (i.kind === 'QUANTITY') {
      const q = Math.max(0, i.availableQuantity ?? 0);
      fits.set(i.lineId, q);
      if (q === 0) removed += 1;
      else qtyCounts.set(q, (qtyCounts.get(q) ?? 0) + 1);
    }
  }
  const hasSlotIssue = issues.some((i) => i.kind === 'SLOT' && i.code === 'SLOT_UNAVAILABLE');
  const slotChoice = hasSlotIssue ? slot.nearest : null;

  const parts: string[] = [];
  if (removed > 0) parts.push(tCheckout.issues.summaryRemove(removed));
  for (const [q, n] of qtyCounts) parts.push(tCheckout.issues.summaryFit(n, q));
  if (slotChoice !== null)
    parts.push(tCheckout.issues.summarySlot(formatTime(slotChoice.startAt)));

  let fitted = 0;
  for (const n of qtyCounts.values()) fitted += n;
  return {
    fits: Array.from(fits, ([lineId, quantity]) => ({ lineId, quantity })),
    slot: slotChoice,
    removed,
    fitted,
    summary: tCheckout.issues.applyAllSummary(parts),
    count: removed + fitted + (slotChoice !== null ? 1 : 0),
  };
}
