// src/domain/format.ts —— 顯示格式與個資遮罩（純函式）
import type { TWD } from './types';

/** NT$ 1,234；負數（折扣）顯示為 −NT$ 30 */
export function formatTWD(amount: TWD): string {
  const n = Math.round(amount);
  const abs = Math.abs(n).toLocaleString('en-US');
  return n < 0 ? `−NT$ ${abs}` : `NT$ ${abs}`;
}

/** 僅數字與千分位，不含幣別（空間有限的表格與徽章） */
export function formatAmount(amount: TWD): string {
  return Math.round(amount).toLocaleString('en-US');
}

const TAIPEI_OFFSET_MIN = 8 * 60;

/** 以 Asia/Taipei（UTC+8，無日光節約）取得「牆上時間」各欄位；不依賴執行環境時區 */
export function taipeiParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const shifted = new Date(date.getTime() + TAIPEI_OFFSET_MIN * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "HH:mm"（店家時區） */
export function formatTime(input: Date | string | number): string {
  const p = taipeiParts(new Date(input));
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "YYYY-MM-DD"（店家時區的營業日曆日） */
export function formatDate(input: Date | string | number): string {
  const p = taipeiParts(new Date(input));
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'] as const;

/** "10/14（三）" */
export function formatMonthDayWeek(input: Date | string | number): string {
  const p = taipeiParts(new Date(input));
  return `${p.month}/${p.day}（${WEEKDAY_ZH[p.weekday]}）`;
}

/** "10/14（三） 12:30"（日期與時間之間有一個空白） */
export function formatDateTime(input: Date | string | number): string {
  return `${formatMonthDayWeek(input)} ${formatTime(input)}`;
}

/** 手機遮罩：0912345678 → 0912***678 */
export function maskPhone(phone: string): string {
  return /^\d{10}$/.test(phone) ? `${phone.slice(0, 4)}***${phone.slice(7)}` : phone;
}

/** 手機分組顯示：0912345678 → 0912 345 678 */
export function formatPhone(phone: string): string {
  return /^\d{10}$/.test(phone) ? `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}` : phone;
}
