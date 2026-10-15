// src/services/api/mock/lock.ts
export const DB_LOCK_NAME = 'zaiorder:db';

/** navigator.locks 的最小介面；測試以假實作注入 */
export interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T> | T): Promise<T>;
}

/**
 * Mock db 的臨界區（FLOW-22）：所有會寫入 db 的路徑（建單、取消、付款、店家模擬動作、惰性推進、會員資料與 DemoControl）
 * 一律經此函式；debounce 只用於非 db 的儲存鍵（偏好、購物車等）。
 * 取得鎖後在 fn 內「先 reload、再變更、再 flush」，fn 內不得 await，使驗證與計入之間不讓出執行權。
 * 不支援 Web Locks 的環境降級為直接執行：同一分頁仍安全（JS 單執行緒），多分頁可能遺失寫入（08 §8）。
 */
export async function withDbLock<T>(
  fn: () => T,
  locks: LockManagerLike | undefined = globalThis.navigator?.locks,
): Promise<T> {
  if (locks === undefined) return fn();
  return locks.request(DB_LOCK_NAME, () => fn());
}
