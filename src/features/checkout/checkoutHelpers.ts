// src/features/checkout/checkoutHelpers.ts —— 結帳頁的純函式輔助（時段、取餐日文案、價格基準、異動落點）
import type { CheckoutIssue, ShownTotals } from '@/domain/availability';
import { targetBusinessDate } from '@/domain/availability';
import type { BusinessCalendar } from '@/domain/availability';
import type { CartLine } from '@/domain/cart';
import { formatDate, formatMonthDayWeek } from '@/domain/format';
import { nearestAvailableSlot } from '@/domain/slots';
import { TAIPEI_OFFSET_MINUTES, addDays, dayStartMs } from '@/domain/taipeiTime';
import type { PickupSlotsResponse, QuoteResponse, Slot, StoreInfo } from '@/domain/types';
import type { SlotContext } from './issueViews';

const COUPON_CODES = new Set([
  'COUPON_NOT_FOUND',
  'COUPON_EXPIRED',
  'COUPON_NOT_APPLICABLE',
  'COUPON_MIN_NOT_MET',
  'COUPON_USED_UP',
  'LOGIN_REQUIRED',
]);

export function calendarOf(
  info: Pick<StoreInfo, 'businessHours' | 'specialDays'>,
): BusinessCalendar {
  return {
    utcOffsetMinutes: TAIPEI_OFFSET_MINUTES,
    businessHours: info.businessHours,
    specialDays: info.specialDays,
  };
}

/**
 * 異動文案的「今日」：取餐營業日與今日營業日相同為「今日」，隔日為「明天（M/D）」，更後面為「M/D」（03 §9 變體）。
 * 庫存依取餐營業日計（BR-40、EC-38）。
 */
export function dayWordFor(
  nowMs: number,
  scheduledAt: string | null,
  cal: BusinessCalendar,
): string {
  const today = targetBusinessDate(nowMs, null, cal);
  const target = targetBusinessDate(nowMs, scheduledAt, cal);
  if (target === today) return '今日';
  const noon = dayStartMs(target) + 12 * 3_600_000;
  const md = formatMonthDayWeek(noon).replace(/（.）/, '');
  return target === addDays(today, 1) ? `明天（${md}）` : md;
}

/** 目前所選時段在最新時段資料中的狀態 */
export function scheduledStatusOf(
  slots: PickupSlotsResponse | undefined,
  scheduledAt: string | null,
): SlotContext['scheduledStatus'] {
  if (scheduledAt === null) return 'UNKNOWN';
  if (slots === undefined) return 'UNKNOWN';
  const ms = Date.parse(scheduledAt);
  for (const d of slots.days) {
    for (const s of d.slots) {
      if (Date.parse(s.startAt) === ms) return s.status === 'FULL' ? 'FULL' : 'OK';
    }
  }
  return 'PASSED';
}

export function allSlots(slots: PickupSlotsResponse | undefined): Slot[] {
  return slots === undefined ? [] : slots.days.flatMap((d) => d.slots);
}

/** 異動清單的時段建議：最近可選時段、盡快是否可用、之後營業日的第一個時段 */
export function slotContextOf(
  slots: PickupSlotsResponse | undefined,
  scheduledAt: string | null,
): SlotContext {
  const nearest = nearestAvailableSlot(allSlots(slots), scheduledAt);
  const baseDate = scheduledAt !== null ? formatDate(scheduledAt) : slots?.days[0]?.date;
  let tomorrow: Slot | null = null;
  if (slots !== undefined && baseDate !== undefined) {
    const later = slots.days.find(
      (d) => d.date > baseDate && d.slots.some((s) => s.status === 'AVAILABLE'),
    );
    tomorrow = later?.slots.find((s) => s.status === 'AVAILABLE') ?? null;
  }
  return {
    nearest,
    asapAvailable: slots?.asap.available === true,
    scheduledStatus: scheduledStatusOf(slots, scheduledAt),
    tomorrow,
  };
}

// ───────── 價格基準（BR-25：總額增加須先展開差異） ─────────

/** 顧客已看見並確認的單價（展開差異清單時記下）；之後同一組價格不再重複要求確認 */
export interface PriceAck {
  total: number;
  prices: Record<string, number>;
}

export function hasCouponError(quote: QuoteResponse): boolean {
  return quote.checks.some(
    (c) => c.severity === 'ERROR' && (c.field === 'couponCode' || COUPON_CODES.has(c.code)),
  );
}

/**
 * 顧客目前據以送出的金額（ShownTotals）：以「購物車快照單價（或已確認的新單價）」依可購買份數加總，
 * 加上目前選擇的運費、減去顧客上一次看見的折扣。總額只因「店家調價」而增加時，quote.total 會大於此值，
 * 因此 decideSubmit 會先展開差異（FLOW-23）；顧客自己改變數量、取餐方式、地址、折扣碼造成的變動不算差異。
 */
export function computeShown(
  quote: QuoteResponse,
  lineIds: ReadonlyArray<string>,
  cartLines: ReadonlyArray<CartLine>,
  ack: PriceAck | null,
  seenDiscount: number | null,
): ShownTotals {
  const byId = new Map(cartLines.map((l) => [l.lineId, l]));
  let subtotal = 0;
  for (const q of quote.items) {
    const lineId = lineIds[q.index];
    const cart = lineId === undefined ? undefined : byId.get(lineId);
    const unit =
      cart !== undefined && cart.productId === q.productId
        ? (ack?.prices[cart.lineId] ?? cart.snapshot.unitPrice)
        : q.unitPrice;
    subtotal += unit * q.availableQuantity;
  }
  const discount = seenDiscount ?? quote.discount;
  return { total: Math.max(0, subtotal + quote.deliveryFee - discount), discount };
}

/** 展開差異時記下的確認內容 */
export function makeAck(quote: QuoteResponse, lineIds: ReadonlyArray<string>): PriceAck {
  const prices: Record<string, number> = {};
  for (const q of quote.items) {
    const lineId = lineIds[q.index];
    if (lineId !== undefined) prices[lineId] = q.unitPrice;
  }
  return { total: quote.total, prices };
}

// ───────── 異動項的落點 ─────────

/** 這些異動只會出現在 POST /orders 的 error.quote（QuoteRequest 不帶付款、發票、桌號），需沿用到對應欄位被修改為止 */
const STICKY_FIELDS = ['paymentMethod', 'invoice', 'dineIn.tableNo'] as const;

export function isStickyIssue(issue: CheckoutIssue): boolean {
  if (issue.kind === 'SLOT' && issue.code === 'SLOT_UNAVAILABLE') return true;
  const f = issue.field ?? '';
  return STICKY_FIELDS.some((s) => f === s || f.startsWith(`${s}.`));
}

export function issueSignature(issues: ReadonlyArray<CheckoutIssue>): string {
  return issues
    .map(
      (i) =>
        `${i.code}|${i.lineId ?? ''}|${i.field ?? ''}|${i.availableQuantity ?? ''}|${i.to ?? ''}`,
    )
    .join(';');
}

/** 手機輸入即時格式化：0912345678 → 0912-345-678（儲存與送出時移除連字號） */
export function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
}

/** 折扣碼輸入：轉大寫、去空白（VR-15） */
export function normalizeCouponInput(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}
