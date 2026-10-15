// src/domain/storeStatus.ts —— 店家營業狀態判定（BR-07、FLOW-02）
// 純函式：不碰 I/O，時間由參數傳入；一律以店家時區 Asia/Taipei 計算（BR-24）。
import type {
  BusinessHour, ClosedReason, HHmm, ISODate, SpecialDay, StoreStatusCode,
} from './types';
import {
  DAY_MS, MINUTE_MS, addDays, dateOfMs, hhmmToMinutes, minutesToHhmm, msOf, weekdayOf,
} from './taipeiTime';

export interface HoursSource {
  businessHours: ReadonlyArray<BusinessHour>;
  specialDays: ReadonlyArray<SpecialDay>;
}

/** 某營業日的一個營業時段（絕對時間） */
export interface OperatingSpan {
  /** 歸屬的營業日（跨午夜時段歸屬開始營業的那一日，BR-23） */
  businessDate: ISODate;
  openMs: number;
  /** 跨午夜時為隔日 */
  closeMs: number;
  /** 最後點餐時間 = close − last_order_offset_minutes；預約時段的 startAt 可等於此值（BR-09） */
  lastOrderMs: number;
  overnight: boolean;
}

/**
 * 某營業日的營業時段：特殊營業日覆蓋每週時段；CLOSED 或當日無資料為空（公休）。
 * `close ≤ open` 表示跨午夜（BR-23），收店時間為隔日。
 */
export function operatingSpans(
  date: ISODate,
  src: HoursSource,
  lastOrderOffsetMinutes: number,
): OperatingSpan[] {
  const specials = src.specialDays.filter((s) => s.date === date);
  let raw: Array<{ open: HHmm; close: HHmm }>;
  if (specials.some((s) => s.type === 'CLOSED')) {
    raw = [];
  } else if (specials.length > 0) {
    raw = specials.flatMap((s) =>
      s.type === 'SPECIAL_HOURS' && s.open !== undefined && s.close !== undefined
        ? [{ open: s.open, close: s.close }]
        : [],
    );
  } else {
    const weekday = weekdayOf(date);
    raw = src.businessHours
      .filter((h) => h.weekday === weekday)
      .map((h) => ({ open: h.open, close: h.close }));
  }

  return raw
    .map((h): OperatingSpan => {
      const overnight = hhmmToMinutes(h.close) <= hhmmToMinutes(h.open);
      const openMs = msOf(date, h.open);
      const closeMs = msOf(date, h.close) + (overnight ? DAY_MS : 0);
      return {
        businessDate: date,
        openMs,
        closeMs,
        lastOrderMs: closeMs - lastOrderOffsetMinutes * MINUTE_MS,
        overnight,
      };
    })
    .sort((a, b) => a.openMs - b.openMs);
}

/** 現在所處的營業時段（含前一營業日跨午夜時段的延伸範圍）；不在任何時段回傳 null */
export function spanContaining(
  nowMs: number,
  src: HoursSource,
  lastOrderOffsetMinutes: number,
): OperatingSpan | null {
  const today = dateOfMs(nowMs);
  const candidates = [
    ...operatingSpans(addDays(today, -1), src, lastOrderOffsetMinutes),
    ...operatingSpans(today, src, lastOrderOffsetMinutes),
  ];
  return candidates.find((s) => s.openMs <= nowMs && nowMs < s.closeMs) ?? null;
}

/** 嚴格晚於 nowMs 的下一次開始營業時間；未來 `searchDays` 天內都沒有則回傳 null */
export function nextOpenAfter(
  nowMs: number,
  src: HoursSource,
  lastOrderOffsetMinutes: number,
  searchDays = 14,
): number | null {
  const today = dateOfMs(nowMs);
  for (let i = 0; i <= searchDays; i++) {
    const next = operatingSpans(addDays(today, i), src, lastOrderOffsetMinutes).find(
      (s) => s.openMs > nowMs,
    );
    if (next !== undefined) return next.openMs;
  }
  return null;
}

export interface StoreStatusInput extends HoursSource {
  nowMs: number;
  /** store_settings.last_order_offset_minutes */
  lastOrderOffsetMinutes: number;
  /** store_settings.is_accepting_orders */
  isAcceptingOrders: boolean;
  /** store_settings.paused_until（epoch ms）；null = 手動暫停需人工恢復 */
  pausedUntilMs: number | null;
}

export interface StoreStatusResult {
  status: StoreStatusCode;
  closedReason?: ClosedReason;
  nextOpenAtMs?: number;
  /** 今日營業時段（原始 HH:mm；跨午夜者 close 為隔日時間） */
  todayHours: Array<{ open: HHmm; close: HHmm }>;
  /** PAUSED 且設有預計恢復時間時 */
  pausedUntilMs?: number;
}

/**
 * FLOW-02 / BR-07：依序判斷暫停接單（paused_until 到達即自動恢復）→ 是否落在前一營業日跨午夜時段的延伸範圍
 * → 特殊公休日 / 今日無時段 → 是否在營業時段 → 是否已到最後點餐時間（now ≥ close − last_order_offset）。
 */
export function computeStoreStatus(i: StoreStatusInput): StoreStatusResult {
  const today = dateOfMs(i.nowMs);
  const todaySpans = operatingSpans(today, i, i.lastOrderOffsetMinutes);
  const todayHours = todaySpans.map((s) => ({
    open: minutesToHhmm(Math.round((s.openMs - msOf(today, '00:00')) / MINUTE_MS)),
    close: minutesToHhmm(Math.round((s.closeMs - msOf(today, '00:00')) / MINUTE_MS)),
  }));

  const paused =
    !i.isAcceptingOrders && (i.pausedUntilMs === null || i.nowMs < i.pausedUntilMs);
  if (paused) {
    const out: StoreStatusResult = { status: 'PAUSED', todayHours };
    if (i.pausedUntilMs !== null) out.pausedUntilMs = i.pausedUntilMs;
    return out;
  }

  const inSpan = spanContaining(i.nowMs, i, i.lastOrderOffsetMinutes);
  const closedWith = (reason: ClosedReason): StoreStatusResult => {
    const out: StoreStatusResult = { status: 'CLOSED', closedReason: reason, todayHours };
    const next = nextOpenAfter(i.nowMs, i, i.lastOrderOffsetMinutes);
    if (next !== null) out.nextOpenAtMs = next;
    return out;
  };

  if (inSpan !== null) {
    return i.nowMs >= inSpan.lastOrderMs
      ? closedWith('LAST_ORDER_PASSED')
      : { status: 'OPEN', todayHours };
  }
  return closedWith(todaySpans.length === 0 ? 'HOLIDAY' : 'OUT_OF_HOURS');
}
