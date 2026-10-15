// src/services/api/mock/db.ts —— Mock 資料庫：以資料表名稱為集合，持久化於 localStorage（07 §6.1、§6.2）
// 一律經 services/storage/safeStorage 的 createSafeStorage('local')：Mock 的 db 屬後端模擬，不使用 appStorage 的記憶體版（07 §6.2 末段）。
// 寫入路徑一律經 withDbLock：鎖內先 reload、再變更、再同步 flush（§6.8）；db 不使用 debounce。
import { createSafeStorage } from '@/services/storage/safeStorage';
import { STORAGE_KEYS } from '@/services/storage/appStorage';
import type { DbData } from './dbTypes';
import { DB_SCHEMA_VERSION, createInitialDbData } from './seed/members';

export const DB_STORAGE_KEY = STORAGE_KEYS.db;

export interface MockDb {
  /** 目前的資料；reload 後為新物件，呼叫端不得長期持有舊參照 */
  readonly data: DbData;
  /** 自 storage 重讀（取得其他分頁寫入的內容）；raw 沒有變動時不解析。回傳是否有變動 */
  reload(): boolean;
  /** 同步寫回 localStorage；內容沒有變動時略過 */
  flush(): void;
  /** 清空並以種子重建（不重新載入頁面） */
  reset(): void;
  /** 停止寫回（resetAll 清除儲存後、頁面重新載入前，避免背景請求把舊資料寫回） */
  suspend(): void;
  /** 啟動時是否因 schemaVersion 不符而清除了可變資料（Demo 可接受；由 UI 以 Toast 告知） */
  readonly schemaReset: boolean;
  /** 是否因環境限制降級為記憶體儲存（FR-SY-11） */
  readonly degraded: boolean;
}

export interface CreateDbOptions {
  storage?: Storage & { readonly degraded?: boolean };
  key?: string;
  /** 沒有任何持久化資料時的初始內容（播種時間由呼叫端決定） */
  createInitial?: () => DbData;
}

function isDbData(value: unknown): value is DbData {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<DbData>;
  return (
    typeof v.meta === 'object' && v.meta !== null &&
    Array.isArray(v.orders) && Array.isArray(v.users) && Array.isArray(v.order_items)
  );
}

/** 新增欄位以預設值補齊舊資料，不需升版 */
function normalize(data: DbData): DbData {
  return {
    ...data,
    users: data.users ?? [],
    user_addresses: data.user_addresses ?? [],
    favorites: data.favorites ?? [],
    user_coupons: data.user_coupons ?? [],
    order_item_options: data.order_item_options ?? [],
    order_status_logs: data.order_status_logs ?? [],
    payments: data.payments ?? [],
    order_invoices: data.order_invoices ?? [],
    coupon_usage: data.coupon_usage ?? {},
    demo_request_log: data.demo_request_log ?? [],
    refresh_tokens: data.refresh_tokens ?? [],
    otp_state: data.otp_state ?? {},
    lookup_attempts: data.lookup_attempts ?? {},
    session: data.session ?? null,
  };
}

export function createDb(options: CreateDbOptions = {}): MockDb {
  const storage = options.storage ?? createSafeStorage('local');
  const key = options.key ?? DB_STORAGE_KEY;
  const createInitial = options.createInitial ?? (() => createInitialDbData(Date.parse('1970-01-01T00:00:00Z')));

  let data: DbData = createInitial();
  /** 最近一次讀 / 寫的原始字串：用以略過沒有變動的 reload 與 flush */
  let lastRaw: string | null = null;
  let schemaReset = false;

  let suspended = false;

  const write = (): void => {
    if (suspended) return;
    const raw = JSON.stringify(data);
    if (raw !== lastRaw) {
      storage.setItem(key, raw);
      lastRaw = raw;
    }
  };

  const load = (): void => {
    const raw = storage.getItem(key);
    if (raw === null) {
      data = createInitial();
      write();
      return;
    }
    lastRaw = raw;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isDbData(parsed)) throw new Error('invalid');
      if (parsed.meta.schemaVersion !== DB_SCHEMA_VERSION) {
        schemaReset = true;
        data = createInitial();
        write();
        return;
      }
      data = normalize(parsed);
    } catch {
      data = createInitial();
      write();
    }
  };

  load();

  return {
    get data() {
      return data;
    },
    get schemaReset() {
      return schemaReset;
    },
    get degraded() {
      return storage.degraded === true;
    },
    reload() {
      const raw = storage.getItem(key);
      if (raw === lastRaw) return false;
      const before = lastRaw;
      load();
      return lastRaw !== before;
    },
    flush: write,
    suspend() {
      suspended = true;
    },
    reset() {
      data = createInitial();
      lastRaw = null;
      write();
    },
  };
}
