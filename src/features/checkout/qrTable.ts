// src/features/checkout/qrTable.ts —— QR 桌號（`?table=`）的分頁內保存（FR-CK-05、BR-22、UAT-10）
//
// 顧客掃描桌上的 QR 進入 `/?table=A3`，之後的站內導覽（菜單 → 購物車 → 結帳）不會帶著查詢字串，
// 因此在外殼讀到 `?table=` 時記在 sessionStorage（觸控面板為記憶體版），結帳頁再取用。
// 內容只有權杖本身（Demo 為桌號），不含個資；訂單成立（或草稿被丟棄）時一併清除。
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { appSessionStorage, STORAGE_KEYS } from '@/services/storage/appStorage';

export const QR_TABLE_PARAM = 'table';

// 變更通知：菜單 / 購物車以 useSyncExternalStore 訂閱，記下或清除權杖時畫面即時一致
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((listener) => listener());

export function subscribeQrTable(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 由查詢字串取出桌位權杖；空白視為沒有 */
export function qrTokenFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get(QR_TABLE_PARAM)?.trim() ?? '';
  return raw !== '' ? raw : null;
}

export function rememberQrTable(token: string): void {
  try {
    appSessionStorage.setItem(STORAGE_KEYS.table, token);
  } catch {
    /* 儲存不可用時降級為只在結帳頁網址帶桌號時有效，不影響點餐 */
  }
  notify();
}

export function recalledQrTable(): string | null {
  try {
    const value = appSessionStorage.getItem(STORAGE_KEYS.table)?.trim() ?? '';
    return value !== '' ? value : null;
  } catch {
    return null;
  }
}

export function forgetQrTable(): void {
  try {
    appSessionStorage.removeItem(STORAGE_KEYS.table);
  } catch {
    /* 同上 */
  }
  notify();
}

/** 外殼層使用：任何頁面的網址帶 `?table=` 時記下桌位權杖 */
export function useRememberQrTable(): void {
  const { search } = useLocation();
  useEffect(() => {
    const token = qrTokenFromSearch(search);
    if (token !== null) rememberQrTable(token);
  }, [search]);
}
