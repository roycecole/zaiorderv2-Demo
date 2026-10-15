// 測試輔助：記憶體版 Web Storage。
// Node 25 內建的實驗性 localStorage 會遮蔽 jsdom 的實作（無 --localstorage-file 時缺少 setItem 等方法），
// 因此需要儲存的測試一律改用此替身，並於載入被測模組「之前」安裝（模組載入時即決定儲存）。
import { vi } from 'vitest';

export interface StorageWrite {
  op: 'set' | 'remove' | 'clear';
  key?: string;
  value?: string;
}

export class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  /** 所有寫入動作的紀錄（含 clear）；供「不得寫入」類斷言使用 */
  readonly writes: StorageWrite[] = [];

  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.writes.push({ op: 'clear' });
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.writes.push({ op: 'remove', key });
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.writes.push({ op: 'set', key, value: String(value) });
    this.map.set(key, String(value));
  }
  keys(): string[] {
    return Array.from(this.map.keys());
  }
}

/** setItem 一律丟錯的 Storage（模擬 Safari 私密瀏覽 / 配額已滿） */
export class ThrowingStorage extends MemoryStorage {
  override setItem(): void {
    throw new DOMException('QuotaExceededError', 'QuotaExceededError');
  }
}

export interface StubbedStorages {
  local: MemoryStorage;
  session: MemoryStorage;
}

/** 以記憶體版 localStorage / sessionStorage 取代全域（`window` 即 globalThis）；測試結束請呼叫 vi.unstubAllGlobals() */
export function stubWebStorage(
  local: MemoryStorage = new MemoryStorage(),
  session: MemoryStorage = new MemoryStorage(),
): StubbedStorages {
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  return { local, session };
}
