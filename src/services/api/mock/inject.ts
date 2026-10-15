// src/services/api/mock/inject.ts
/** 他人訂單（Demo 注入）的取餐號碼前綴；正式環境沒有這個概念 */
export const OTHER_ORDER_PREFIX = 'X';

/** 注入份數夾在目前剩餘內：Demo 動作本身不得造成超賣（FR-DM-12）；remaining 為 null 代表不限量 */
export function clampInjection(quantity: number, remaining: number | null): number {
  const q = Math.max(0, Math.floor(quantity));
  return remaining === null ? q : Math.min(q, Math.max(0, remaining));
}

/** 讓時段額滿（leave = 0）或只剩 1 個名額（leave = 1）所需補入的單數；不限量的時段回傳 0 */
export function slotFillCount(maxOrdersPerSlot: number | null, booked: number, leave: 0 | 1): number {
  if (maxOrdersPerSlot === null) return 0;
  return Math.max(0, maxOrdersPerSlot - leave - booked);
}

export interface PickupNoRow {
  /** orders.business_date（取餐營業日） */
  businessDate: string;
  pickupNo: string;
}

/**
 * 下一個取餐號碼：前綴 + 3 碼序號。序號以 (營業日, 前綴) 為鍵取 MAX + 1（05 §5.4）：
 * 今日下的隔日預約單取得隔日的序號（可為隔日 A001），不佔用今日的；隔日第一張即時單因此為 A002 且不重號；
 * 他人訂單的 X 前綴自成一組，不影響 A / D / T。
 */
export function nextPickupNo(
  rows: ReadonlyArray<PickupNoRow>,
  businessDate: string,
  prefix: string,
): string {
  let max = 0;
  for (const r of rows) {
    if (r.businessDate !== businessDate || !r.pickupNo.startsWith(prefix)) continue;
    const n = Number(r.pickupNo.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}
