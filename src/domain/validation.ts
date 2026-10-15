// src/domain/validation.ts
export const PHONE_RE = /^09\d{8}$/;                  // VR-01
export const MOBILE_BARCODE_RE = /^\/[0-9A-Z.+-]{7}$/; // VR-12
export const CITIZEN_CERT_RE = /^[A-Z]{2}\d{14}$/;     // VR-13
export const DONATE_CODE_RE = /^\d{3,7}$/;             // VR-14
export const COUPON_CODE_RE = /^[A-Z0-9]{4,20}$/;      // VR-15（輸入前先轉大寫、去空白）

/** VR-01：去除空白與連字號後再驗證 */
export function normalizePhone(input: string): string {
  return input.replace(/[\s-]/g, '');
}

/** VR-11：統一編號檢查碼（2023/04/01 起除數為 5，可同時相容新舊統編） */
export function isValidTaxId(id: string): boolean {
  if (!/^\d{8}$/.test(id)) return false;
  const weights = [1, 2, 1, 2, 1, 2, 4, 1];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const p = Number(id[i]) * (weights[i] ?? 0);
    sum += Math.floor(p / 10) + (p % 10);
  }
  return sum % 5 === 0 || (id[6] === '7' && (sum + 1) % 5 === 0);
}
