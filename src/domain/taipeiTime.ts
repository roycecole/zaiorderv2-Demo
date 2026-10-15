// src/domain/taipeiTime.ts —— 店家時區（Asia/Taipei，UTC+8，無日光節約）的純算術
// 不使用 Date.now() 與無參數 new Date()；也不依賴執行環境的時區（BR-24）。
import type { HHmm, ISODate, ISODateTime, Weekday } from './types';

export const TAIPEI_OFFSET_MINUTES = 480;
export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;
const OFFSET_MS = TAIPEI_OFFSET_MINUTES * MINUTE_MS;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 公曆日期 → 自 1970-01-01 起的日數（days_from_civil） */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = month + (month > 2 ? -3 : 9);
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

/** 自 1970-01-01 起的日數 → 公曆日期（civil_from_days） */
function civilFromDays(days: number): { y: number; m: number; d: number } {
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
  return { y, m, d };
}

function isoOfDays(days: number): ISODate {
  const { y, m, d } = civilFromDays(days);
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

function daysOfIso(date: ISODate): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (m === null) return Number.NaN;
  return daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** 店家時區的日曆日（"YYYY-MM-DD"） */
export function dateOfMs(ms: number): ISODate {
  return isoOfDays(Math.floor((ms + OFFSET_MS) / DAY_MS));
}

/** 店家時區當日 00:00 起算的分鐘數（0–1439） */
export function minutesOfDayMs(ms: number): number {
  const local = ms + OFFSET_MS;
  return Math.floor((local - Math.floor(local / DAY_MS) * DAY_MS) / MINUTE_MS);
}

/** 該日曆日 00:00（店家時區）的 epoch ms */
export function dayStartMs(date: ISODate): number {
  return daysOfIso(date) * DAY_MS - OFFSET_MS;
}

export function addDays(date: ISODate, n: number): ISODate {
  return isoOfDays(daysOfIso(date) + n);
}

/** 兩個日曆日相差的天數（b − a） */
export function diffDays(a: ISODate, b: ISODate): number {
  return daysOfIso(b) - daysOfIso(a);
}

export function weekdayOf(date: ISODate): Weekday {
  // 1970-01-01 為週四
  return ((((daysOfIso(date) + 4) % 7) + 7) % 7) as Weekday;
}

export function hhmmToMinutes(hhmm: HHmm): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

export function minutesToHhmm(minutes: number): HHmm {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** 該日曆日的 HH:mm（店家時區）對應的 epoch ms；close 跨午夜時由呼叫端另加一日 */
export function msOf(date: ISODate, hhmm: HHmm): number {
  return dayStartMs(date) + hhmmToMinutes(hhmm) * MINUTE_MS;
}

/** epoch ms → "2026-10-14T12:30:00+08:00"（毫秒捨去） */
export function toIsoTaipei(ms: number): ISODateTime {
  const sec = Math.floor(ms / 1000);
  const local = sec * 1000 + OFFSET_MS;
  const days = Math.floor(local / DAY_MS);
  const rem = Math.floor((local - days * DAY_MS) / 1000);
  const hh = Math.floor(rem / 3600);
  const mm = Math.floor((rem % 3600) / 60);
  const ss = rem % 60;
  return `${isoOfDays(days)}T${pad2(hh)}:${pad2(mm)}:${pad2(ss)}+08:00`;
}

/** 解析 ISO 8601；格式錯誤回傳 NaN */
export function parseIsoMs(value: string): number {
  return Date.parse(value);
}
