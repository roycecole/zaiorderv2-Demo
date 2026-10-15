// FR-SY-11：本機儲存不可用或寫入失敗時降級為記憶體
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage, ThrowingStorage, stubWebStorage } from '@/test/memoryStorage';
import { createSafeStorage } from '../safeStorage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSafeStorage（localStorage 可用）', () => {
  it('讀寫、移除、清除、length、key 皆委派給 localStorage；degraded 為 false', () => {
    const { local } = stubWebStorage();
    const s = createSafeStorage('local');
    expect(s.degraded).toBe(false);
    s.setItem('a', '1');
    s.setItem('b', '2');
    expect(local.getItem('a')).toBe('1');
    expect(s.getItem('a')).toBe('1');
    expect(s.getItem('missing')).toBeNull();
    expect(s.length).toBe(2);
    expect(s.key(0)).toBe('a');
    expect(s.key(5)).toBeNull();
    s.removeItem('a');
    expect(s.getItem('a')).toBeNull();
    s.clear();
    expect(s.length).toBe(0);
    expect(s.degraded).toBe(false);
  });

  it('啟動探測不留下殘餘鍵', () => {
    const { local } = stubWebStorage();
    createSafeStorage('local');
    expect(local.keys()).toEqual([]);
  });

  it("kind = 'session' 使用 sessionStorage，不碰 localStorage", () => {
    const { local, session } = stubWebStorage();
    const s = createSafeStorage('session');
    s.setItem('k', 'v');
    expect(session.getItem('k')).toBe('v');
    expect(local.getItem('k')).toBeNull();
  });

  it('預設 kind 為 local', () => {
    const { local } = stubWebStorage();
    createSafeStorage().setItem('k', 'v');
    expect(local.getItem('k')).toBe('v');
  });
});

describe('createSafeStorage（降級）', () => {
  it('啟動探測寫入失敗（Safari 私密模式 / 配額 0）→ degraded，之後全程使用記憶體', () => {
    const { local } = stubWebStorage(new ThrowingStorage());
    const s = createSafeStorage('local');
    expect(s.degraded).toBe(true);
    s.setItem('a', '1');
    expect(s.getItem('a')).toBe('1');
    expect(s.length).toBe(1);
    expect(s.key(0)).toBe('a');
    expect(local.length).toBe(0); // 沒有任何內容寫進真正的 localStorage
    s.removeItem('a');
    expect(s.getItem('a')).toBeNull();
    s.setItem('x', '1');
    s.clear();
    expect(s.length).toBe(0);
  });

  it('存取 window.localStorage 本身就丟錯（網站資料被封鎖）→ degraded', () => {
    stubWebStorage(); // 先記錄原始描述元，測試結束由 unstubAllGlobals 還原
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    const s = createSafeStorage('local');
    expect(s.degraded).toBe(true);
    s.setItem('a', '1');
    expect(s.getItem('a')).toBe('1');
  });

  it('降級後的記憶體彼此獨立（不同實例不共用）', () => {
    stubWebStorage(new ThrowingStorage());
    const a = createSafeStorage('local');
    const b = createSafeStorage('local');
    a.setItem('k', 'v');
    expect(b.getItem('k')).toBeNull();
  });

  it('執行中寫入失敗（配額已滿）：不丟錯並標記 degraded', () => {
    const quota = new MemoryStorage();
    stubWebStorage(quota);
    const s = createSafeStorage('local');
    expect(s.degraded).toBe(false);
    vi.spyOn(quota, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => s.setItem('a', '1')).not.toThrow();
    expect(s.degraded).toBe(true);
  });

  // 寫入失敗而降級為記憶體時，剛寫入的值必須可由 getItem 讀回（FR-SY-11）
  it('執行中寫入失敗後，剛寫入的值仍可由 getItem 讀回', () => {
    const quota = new MemoryStorage();
    stubWebStorage(quota);
    const s = createSafeStorage('local');
    vi.spyOn(quota, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    s.setItem('a', '1');
    expect(s.getItem('a')).toBe('1');
  });
});
