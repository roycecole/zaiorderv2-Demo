// src/features/kiosk/unknownResult.ts —— 「上一筆訂單結果尚未確認」的判斷（FLOW-21、FLOW-24、BR-41）
//
// 結帳在送出結果未知時，把 Idempotency-Key 與記下的送出內容（unknownBodies）存進
// appSessionStorage 的 checkoutDraft（觸控面板僅存記憶體）。閒置警示據此多顯示一行，
// 不依賴結帳功能的內部型別：在 JSON 內尋找非空的 unknownBodies 陣列即可。
import { appSessionStorage, STORAGE_KEYS } from '@/services/storage/appStorage';

const MAX_DEPTH = 3;

function hasNonEmptyUnknownBodies(value: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH || typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const bodies = record['unknownBodies'];
  if (Array.isArray(bodies) && bodies.length > 0) return true;
  return Object.values(record).some((v) => hasNonEmptyUnknownBodies(v, depth + 1));
}

/** 結帳草稿內是否記有「結果未知」的送出內容；讀取或解析失敗一律視為沒有 */
export function hasUnknownOrderResult(): boolean {
  try {
    const raw = appSessionStorage.getItem(STORAGE_KEYS.checkoutDraft);
    if (raw === null || raw === '') return false;
    return hasNonEmptyUnknownBodies(JSON.parse(raw) as unknown, 0);
  } catch {
    return false;
  }
}
