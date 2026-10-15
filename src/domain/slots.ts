// src/domain/slots.ts —— 取餐時段（BR-08、BR-09、FLOW-05）與送出時額滿的最近時段建議（EC-07）
// 純函式：不碰 I/O，時間由參數傳入；一律以店家時區 Asia/Taipei 計算。
import { targetBusinessDate } from './availability';
import { formatMonthDayWeek } from './format';
import { operatingSpans } from './storeStatus';
import type { HoursSource } from './storeStatus';
import {
  MINUTE_MS, TAIPEI_OFFSET_MINUTES, addDays, dayStartMs, diffDays, toIsoTaipei,
} from './taipeiTime';
import type {
  ISODate, ISODateTime, PickupSlotsResponse, Slot, SlotDay, StoreStatusCode,
} from './types';

// ───────── 即時單（asap） ─────────

/** 即時單顯示的預估區間：lead ～ lead + 5 分鐘（BR-08） */
export const ASAP_ETA_SPREAD_MINUTES = 5;

export function etaRange(leadMinutes: number): { min: number; max: number } {
  return { min: leadMinutes, max: leadMinutes + ASAP_ETA_SPREAD_MINUTES };
}

export interface AsapInput {
  /** 已合成覆寫後的店家狀態（FLOW-02） */
  status: StoreStatusCode;
  nowMs: number;
  /** 前置分鐘（自取 / 內用為 pickup_lead_minutes；外送為配送區預估分鐘，缺值才用店家預設，BR-08） */
  leadMinutes: number;
  /** 現在所處營業時段的收店時間；不在任何時段（例如強制營業）為 null，此時不檢查打烊 */
  containingCloseMs: number | null;
}

/**
 * 即時單可用條件（FLOW-05）：(a) 店家狀態為 OPEN；(b) now + lead ≤ 該時段 close_time（預估完成不得晚於打烊，BR-08）。
 * 不符時 available = false，原因為 STORE_PAUSED、STORE_CLOSED 或 SLOT_UNAVAILABLE（外送來不及在打烊前送達）。
 */
export function asapAvailability(i: AsapInput): PickupSlotsResponse['asap'] {
  if (i.status === 'PAUSED') return { available: false, unavailableReason: 'STORE_PAUSED' };
  if (i.status === 'CLOSED') return { available: false, unavailableReason: 'STORE_CLOSED' };
  if (i.containingCloseMs !== null && i.nowMs + i.leadMinutes * MINUTE_MS > i.containingCloseMs) {
    return { available: false, unavailableReason: 'SLOT_UNAVAILABLE' };
  }
  return { available: true, etaMinutes: etaRange(i.leadMinutes) };
}

// ───────── 預約時段 ─────────

export interface SlotRules {
  /** store_settings.slot_interval_minutes */
  intervalMinutes: number;
  /** store_settings.max_advance_days：今日起幾天 */
  maxAdvanceDays: number;
  /** store_settings.last_order_offset_minutes */
  lastOrderOffsetMinutes: number;
  /** store_settings.max_orders_per_slot；null = 不限 */
  maxOrdersPerSlot: number | null;
}

export interface SlotGenerationInput extends HoursSource {
  nowMs: number;
  /** 前置分鐘（同 asapAvailability） */
  leadMinutes: number;
  rules: SlotRules;
  /**
   * 該時段已計入的預約單數（BR-38 計入集合，僅預約單，Q-11）；
   * 由呼叫端以 countsTowardStock 排除已取消與逾期待付款者
   */
  bookedAt(startMs: number): number;
}

function dayLabel(offsetDays: number, date: ISODate): string {
  if (offsetDays === 0) return '今天';
  if (offsetDays === 1) return '明天';
  if (offsetDays === 2) return '後天';
  return formatMonthDayWeek(dayStartMs(date) + 12 * 60 * MINUTE_MS);
}

/**
 * FLOW-05 / BR-09：以 earliest = now + lead（進位到下一個時段）為起點，每個營業時段由 max(open, earliest) 起
 * 每 slot_interval_minutes 產生一個時段，去除晚於 close − last_order_offset 者（startAt 可等於最後點餐時間）；
 * 範圍為當前營業日起 max_advance_days 天；已訂數 ≥ max_orders_per_slot 者標記 FULL。
 * 無任何時段的日子不回傳；跨午夜時段歸屬開始營業的那一日（BR-23）。
 */
export function generateSlotDays(i: SlotGenerationInput): SlotDay[] {
  const step = Math.max(1, i.rules.intervalMinutes) * MINUTE_MS;
  const earliest = i.nowMs + i.leadMinutes * MINUTE_MS;
  const base = targetBusinessDate(i.nowMs, null, {
    utcOffsetMinutes: TAIPEI_OFFSET_MINUTES,
    businessHours: i.businessHours,
    specialDays: i.specialDays,
  });

  const days: SlotDay[] = [];
  for (let k = 0; k <= i.rules.maxAdvanceDays; k++) {
    const date = addDays(base, k);
    const slots: Slot[] = [];
    for (const span of operatingSpans(date, i, i.rules.lastOrderOffsetMinutes)) {
      let start = span.openMs;
      if (earliest > start) start += Math.ceil((earliest - start) / step) * step;
      for (let t = start; t <= span.lastOrderMs; t += step) {
        const full = i.rules.maxOrdersPerSlot !== null && i.bookedAt(t) >= i.rules.maxOrdersPerSlot;
        slots.push({ startAt: toIsoTaipei(t), status: full ? 'FULL' : 'AVAILABLE' });
      }
    }
    if (slots.length > 0) days.push({ date, label: dayLabel(diffDays(base, date), date), slots });
  }
  return days;
}

/** 在已產生的時段中找出 scheduledAt 對應者；不在其中（時段已過、不在營業時間）回傳 null */
export function findSlot(days: ReadonlyArray<SlotDay>, scheduledAtMs: number): Slot | null {
  for (const d of days) {
    for (const s of d.slots) {
      if (Date.parse(s.startAt) === scheduledAtMs) return s;
    }
  }
  return null;
}

// ───────── 送出時額滿的最近時段建議 ─────────

/**
 * 送出時時段額滿的「最近可選時段」建議（EC-07、FR-CK-16）：優先選擇之後最近的可用時段，其次之前最近的，都沒有則 null。
 * selected 為 null（盡快）時回傳最早的可用時段。只作建議，不靜默改選；slots 為重新載入的 PickupSlotsResponse 時段。
 */
export function nearestAvailableSlot(
  slots: ReadonlyArray<Slot>,
  selected: ISODateTime | null,
): Slot | null {
  const open = slots
    .filter((s) => s.status === 'AVAILABLE')
    .map((s) => ({ slot: s, at: Date.parse(s.startAt) }))
    .filter((x) => Number.isFinite(x.at))
    .sort((a, b) => a.at - b.at);
  if (open.length === 0) return null;

  const target = selected === null ? Number.NaN : Date.parse(selected);
  if (!Number.isFinite(target)) return open[0]?.slot ?? null;

  const after = open.find((x) => x.at >= target);
  if (after !== undefined) return after.slot;
  return open[open.length - 1]?.slot ?? null; // 沒有之後的：排序後最後一個即之前最近者
}
