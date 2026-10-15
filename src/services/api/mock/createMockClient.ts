// src/services/api/mock/createMockClient.ts —— Mock Adapter 的組裝（07 §6）
// 延遲 latencyMs ± jitter、failNext 注入、Web Locks 臨界區、時鐘覆寫（clockOverride → setClock）、
// 自動模擬（讀取時惰性推進）與跨分頁 reload。僅 features/demo 與 app 可使用本模組。
import { env } from '@/config/env';
import { createOffsetClock, getClock, setClock, systemClock } from '@/services/clock';
import { createSafeStorage } from '@/services/storage/safeStorage';
import type { ApiClient } from '../ApiClient';
import { createDb, DB_STORAGE_KEY } from './db';
import type { DemoControl, DemoState } from './demoControl';
import { createDemoControl } from './demoControlImpl';
import { parseDemoParams } from './demoParams';
import { createDemoStateStore, DEMO_STORAGE_KEY } from './demoState';
import { createAuthHandlers } from './handlers/auth';
import { createMeHandlers } from './handlers/me';
import { createOrderHandlers } from './handlers/orders';
import { createStoreHandlers } from './handlers/store';
import type { LockManagerLike } from './lock';
import { createRuntime } from './runtime';
import { buildStaticSeed, createInitialDbData } from './seed';

export interface MockClientOptions {
  storeSlug: string;
  /** 以下皆為測試用的注入點；正式環境只傳 storeSlug */
  storage?: Storage;
  /** null = 強制不使用 Web Locks；省略 = navigator.locks（不支援時降級為直接執行） */
  locks?: LockManagerLike | null;
  /** 省略時取 VITE_DEMO_MODE；僅 demoMode 時才套用 demo_* 啟動參數 */
  demoMode?: boolean;
  /** 省略時取 window.location.search */
  search?: string;
  sleep?: (ms: number) => Promise<void>;
  /** 「重置 Demo 資料」清除儲存後的動作；省略時重新載入頁面 */
  reloadPage?: () => void;
  /** 是否監聽 storage 事件以重讀其他分頁的寫入（預設 true） */
  syncTabs?: boolean;
}

export type MockClient = ApiClient & { demo: DemoControl; dispose(): void };

function applyClock(override: DemoState['clockOverride']): void {
  if (override === null) {
    setClock(systemClock);
    return;
  }
  const anchor = Date.parse(override);
  setClock(Number.isFinite(anchor) ? createOffsetClock(new Date(anchor)) : systemClock);
}

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function createMockClient(options: MockClientOptions): MockClient {
  const storage = options.storage ?? createSafeStorage('local');
  const demoMode = options.demoMode ?? env.demoMode;
  const search =
    options.search ?? (typeof window !== 'undefined' ? window.location.search : '');

  const demo = createDemoStateStore(storage, DEMO_STORAGE_KEY);

  // 1) 啟動參數（僅 demoMode）：先於時鐘與播種套用，使播種日期相對於 demo_clock
  const params = demoMode ? parseDemoParams(search) : {};
  const patch: Partial<DemoState> = {};
  if (params.clock !== undefined) patch.clockOverride = params.clock;
  if (params.failNext !== undefined) patch.failNext = params.failNext;
  if (params.limitOverrides !== undefined) {
    patch.limitOverrides = { ...demo.get().limitOverrides, ...params.limitOverrides };
  }
  if (params.race !== undefined) patch.raceOnNextCreate = params.race;
  if (Object.keys(patch).length > 0) demo.set(patch);

  // 2) 種子的播種時間：demo_clock 參數 ?? 套用持久化時鐘覆寫之前的 clock.now()
  const anchorMs =
    params.clock !== undefined ? Date.parse(params.clock) : getClock().now().getTime();
  // 啟動時只在有覆寫時才換時鐘；null 代表沿用現有時鐘（宿主或測試可能已注入）
  if (demo.get().clockOverride !== null) applyClock(demo.get().clockOverride);

  const seed = buildStaticSeed(options.storeSlug, anchorMs);
  const db = createDb({ storage, createInitial: () => createInitialDbData(anchorMs) });

  const rtOptions: Parameters<typeof createRuntime>[0] = { storeSlug: options.storeSlug, seed, db, demo };
  if (options.locks !== undefined) rtOptions.locks = options.locks;
  if (options.sleep !== undefined) rtOptions.sleep = options.sleep;
  const rt = createRuntime(rtOptions);

  // 時間穿梭：clockOverride 變更（面板、其他分頁）即時套用到 getClock()
  const unsubscribe = demo.subscribe((next, prev) => {
    if (next.clockOverride !== prev.clockOverride) applyClock(next.clockOverride);
  });

  // 跨分頁：其他分頁寫入 db 或 DemoState 時重讀
  const onStorage = (e: StorageEvent): void => {
    if (e.key === null || e.key === DB_STORAGE_KEY) db.reload();
    if (e.key === null || e.key === DEMO_STORAGE_KEY) demo.reload();
  };
  const sync = options.syncTabs !== false && typeof window !== 'undefined';
  if (sync) window.addEventListener('storage', onStorage);

  const storages: Storage[] = [storage];
  const session = sessionStorageOrNull();
  if (session !== null) storages.push(session);
  const control = createDemoControl(rt, {
    storages,
    reloadPage:
      options.reloadPage ??
      ((): void => {
        if (typeof window !== 'undefined') window.location.reload();
      }),
  });

  return {
    auth: createAuthHandlers(rt),
    store: createStoreHandlers(rt),
    orders: createOrderHandlers(rt),
    me: createMeHandlers(rt),
    demo: control,
    dispose() {
      unsubscribe();
      if (sync) window.removeEventListener('storage', onStorage);
    },
  };
}
