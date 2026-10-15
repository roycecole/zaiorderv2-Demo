// src/features/demo/timeTravel.ts —— 時間穿梭預設（08 §5）的純函式（Asia/Taipei）
import type { HHmm, ISODate, ISODateTime } from '@/domain/types';
import { addDays, dateOfMs, MINUTE_MS, msOf, toIsoTaipei, weekdayOf } from '@/domain/taipeiTime';

export type TimePresetKey =
  'before-open' | 'lunch' | 'break' | 'last-order' | 'after-close' | 'sunday';

export const TIME_PRESETS: ReadonlyArray<{ key: TimePresetKey; hhmm: HHmm }> = [
  { key: 'before-open', hhmm: '10:30' },
  { key: 'lunch', hhmm: '12:00' },
  { key: 'break', hhmm: '14:30' },
  { key: 'last-order', hhmm: '20:40' },
  { key: 'after-close', hhmm: '21:30' },
  { key: 'sunday', hhmm: '12:00' },
];

/** 由店家資訊推導的營業日曆；未取得店家資訊時以週一至週六營業為預設 */
export interface BusinessCalendar {
  openWeekdays: ReadonlySet<number>;
  closedDates: ReadonlySet<ISODate>;
}

export const DEFAULT_CALENDAR: BusinessCalendar = {
  openWeekdays: new Set([1, 2, 3, 4, 5, 6]),
  closedDates: new Set(),
};

const SEARCH_DAYS = 21;

/** 自 `from`（含）起最近一個營業日：該週幾有營業時段，且不是特殊公休日 */
export function nearestBusinessDate(from: ISODate, calendar: BusinessCalendar): ISODate {
  for (let i = 0; i < SEARCH_DAYS; i++) {
    const date = addDays(from, i);
    if (calendar.openWeekdays.has(weekdayOf(date)) && !calendar.closedDates.has(date)) return date;
  }
  return from;
}

/** 自 `from`（含）起最近的週日 */
export function nearestSunday(from: ISODate): ISODate {
  for (let i = 0; i < 7; i++) {
    const date = addDays(from, i);
    if (weekdayOf(date) === 0) return date;
  }
  return from;
}

/** 預設時間 → 應設定的「現在」（台北時間的 ISO 8601） */
export function presetInstant(
  key: TimePresetKey,
  nowMs: number,
  calendar: BusinessCalendar = DEFAULT_CALENDAR,
): ISODateTime {
  const today = dateOfMs(nowMs);
  const preset = TIME_PRESETS.find((p) => p.key === key);
  const hhmm: HHmm = preset?.hhmm ?? '12:00';
  const date = key === 'sunday' ? nearestSunday(today) : nearestBusinessDate(today, calendar);
  return toIsoTaipei(msOf(date, hhmm));
}

/** 快轉：以目前（模擬）時間為基準加上分鐘數 */
export function shiftInstant(nowMs: number, minutes: number): ISODateTime {
  return toIsoTaipei(nowMs + minutes * MINUTE_MS);
}

/** `<input type="datetime-local">` 的值（'YYYY-MM-DDTHH:mm'，視為台北時間）→ ISO；無效回傳 null */
export function localInputToIso(value: string): ISODateTime | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  if (Number(m[2]) > 23 || Number(m[3]) > 59) return null;
  const ms = msOf(m[1], `${m[2]}:${m[3]}`);
  if (!Number.isFinite(ms)) return null;
  // 擋掉 2026-02-31 這類溢位日期
  if (dateOfMs(ms) !== m[1]) return null;
  return toIsoTaipei(ms);
}

/** epoch ms → datetime-local 的值（台北時間） */
export function toLocalInputValue(ms: number): string {
  return toIsoTaipei(ms).slice(0, 16);
}
