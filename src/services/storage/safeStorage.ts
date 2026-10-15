// src/services/storage/safeStorage.ts
export interface SafeStorage extends Storage {
  /** 是否因環境限制而降級為記憶體儲存 */
  readonly degraded: boolean;
}

export function createSafeStorage(kind: 'local' | 'session' = 'local'): SafeStorage {
  const memory = new Map<string, string>();
  let degraded = false;

  const backend = (): Storage | null => {
    try {
      const s = kind === 'local' ? window.localStorage : window.sessionStorage;
      const probe = '__zaiorder_probe__';
      s.setItem(probe, '1');
      s.removeItem(probe);
      return s;
    } catch {
      degraded = true;
      return null;
    }
  };

  const store = backend();

  return {
    get degraded() { return degraded; },
    get length() { return store ? store.length : memory.size; },
    clear: () => { memory.clear(); store?.clear(); },
    // 寫入失敗而降級到記憶體的值優先讀取，否則剛寫入的資料會讀不回來
    getItem: (k) => memory.get(k) ?? (store ? store.getItem(k) : null),
    key: (i) => (store ? store.key(i) : Array.from(memory.keys())[i] ?? null),
    removeItem: (k) => { memory.delete(k); store?.removeItem(k); },
    setItem: (k, v) => {
      if (!store) { memory.set(k, v); return; }
      try { store.setItem(k, v); } catch { degraded = true; memory.set(k, v); }
    },
  };
}
