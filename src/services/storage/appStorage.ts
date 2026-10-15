// src/services/storage/appStorage.ts
// 應用程式的本機儲存入口：一般模式用 localStorage / sessionStorage（失敗降級為記憶體），
// 觸控面板（Kiosk）模式一律僅存記憶體（BR-36、BR-37；07 §6.2）。
import { env } from '@/config/env';
import { createSafeStorage } from './safeStorage';
import type { SafeStorage } from './safeStorage';

/** 儲存鍵（07 §6.2）；Mock 的 db / demo 鍵由 mock 自行管理 */
export const STORAGE_KEYS = {
  cart: 'zaiorder:v1:cart',
  session: 'zaiorder:v1:session',
  prefs: 'zaiorder:v1:prefs',
  guestOrders: 'zaiorder:v1:guestOrders',
  db: 'zaiorder:v1:db',
  demo: 'zaiorder:v1:demo',
  checkoutDraft: 'zaiorder:v1:checkoutDraft',
  mode: 'zaiorder:v1:mode',
  /** 此分頁由 QR（`?table=`）帶入的桌位權杖（sessionStorage；站內導覽不遺失，FR-CK-05） */
  table: 'zaiorder:v1:table',
} as const;

/** 僅存記憶體的 Storage（觸控面板模式；不讀寫任何 localStorage 鍵） */
export function createMemoryStorage(): SafeStorage {
  const memory = new Map<string, string>();
  return {
    degraded: false,
    get length() {
      return memory.size;
    },
    clear: () => memory.clear(),
    getItem: (k) => memory.get(k) ?? null,
    key: (i) => Array.from(memory.keys())[i] ?? null,
    removeItem: (k) => {
      memory.delete(k);
    },
    setItem: (k, v) => {
      memory.set(k, v);
    },
  };
}

/**
 * 此分頁是否為觸控面板模式：`VITE_KIOSK_MODE=true`，或 `VITE_DEMO_MODE=true` 時網址帶 `?mode=kiosk`
 * （寫入 sessionStorage 旗標，站內導覽不遺失；`?mode=normal` 清除旗標）。旗標不含個資。
 */
function detectKioskMode(): boolean {
  if (env.kiosk) return true;
  if (!env.demoMode || typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('mode');
    if (q === 'kiosk') window.sessionStorage.setItem(STORAGE_KEYS.mode, 'kiosk');
    else if (q === 'normal') window.sessionStorage.removeItem(STORAGE_KEYS.mode);
    return window.sessionStorage.getItem(STORAGE_KEYS.mode) === 'kiosk';
  } catch {
    return false;
  }
}

/** 模組載入時決定一次；各 store 於 import 時即依此選擇儲存 */
export const isKioskMode: boolean = detectKioskMode();

export const appLocalStorage: SafeStorage = isKioskMode
  ? createMemoryStorage()
  : createSafeStorage('local');

export const appSessionStorage: SafeStorage = isKioskMode
  ? createMemoryStorage()
  : createSafeStorage('session');

/** 本機儲存是否因環境限制降級為記憶體（FR-SY-11）；觸控面板為預期行為，不算降級 */
export function isStorageDegraded(): boolean {
  return !isKioskMode && (appLocalStorage.degraded || appSessionStorage.degraded);
}
