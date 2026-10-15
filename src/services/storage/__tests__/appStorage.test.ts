// BR-36 / BR-37 / 07 §6.2：應用程式儲存入口與觸控面板模式的隔離（UAT-19）
// 觸控面板模式在「模組載入時」決定，因此每個案例都重設模組並動態 import。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage, ThrowingStorage, stubWebStorage } from '@/test/memoryStorage';
import type { StubbedStorages } from '@/test/memoryStorage';
import type * as AppStorageNs from '../appStorage';

type AppStorageModule = typeof AppStorageNs;

async function load(env: Record<string, string> = {}, url = '/'): Promise<AppStorageModule> {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  window.history.replaceState({}, '', url);
  return import('../appStorage');
}

let storages: StubbedStorages;
beforeEach(() => {
  storages = stubWebStorage();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('STORAGE_KEYS（07 §6.2）', () => {
  it('鍵名與版本前綴', async () => {
    const { STORAGE_KEYS } = await load();
    expect(STORAGE_KEYS).toEqual({
      cart: 'zaiorder:v1:cart',
      session: 'zaiorder:v1:session',
      prefs: 'zaiorder:v1:prefs',
      guestOrders: 'zaiorder:v1:guestOrders',
      db: 'zaiorder:v1:db',
      demo: 'zaiorder:v1:demo',
      checkoutDraft: 'zaiorder:v1:checkoutDraft',
      mode: 'zaiorder:v1:mode',
      table: 'zaiorder:v1:table',
    });
  });
});

describe('createMemoryStorage', () => {
  it('完整的 Storage 行為，且不讀寫任何 localStorage 鍵', async () => {
    // 以觸控面板模式載入：一般模式載入時 safeStorage 會對 localStorage 做一次探測寫入
    const { createMemoryStorage } = await load({ VITE_KIOSK_MODE: 'true' });
    const m = createMemoryStorage();
    expect(m.degraded).toBe(false);
    m.setItem('a', '1');
    m.setItem('b', '2');
    expect(m.getItem('a')).toBe('1');
    expect(m.getItem('zzz')).toBeNull();
    expect(m.length).toBe(2);
    expect(m.key(1)).toBe('b');
    expect(m.key(9)).toBeNull();
    m.removeItem('a');
    expect(m.getItem('a')).toBeNull();
    m.clear();
    expect(m.length).toBe(0);
    expect(storages.local.writes).toEqual([]);
    expect(storages.session.writes).toEqual([]);
  });

  it('各實例互相獨立', async () => {
    const { createMemoryStorage } = await load();
    const a = createMemoryStorage();
    const b = createMemoryStorage();
    a.setItem('k', 'v');
    expect(b.getItem('k')).toBeNull();
  });
});

describe('一般模式', () => {
  it('isKioskMode = false；appLocalStorage / appSessionStorage 使用真正的 localStorage / sessionStorage', async () => {
    const m = await load();
    expect(m.isKioskMode).toBe(false);
    m.appLocalStorage.setItem('zaiorder:v1:cart', 'x');
    m.appSessionStorage.setItem('zaiorder:v1:checkoutDraft', 'y');
    expect(storages.local.getItem('zaiorder:v1:cart')).toBe('x');
    expect(storages.session.getItem('zaiorder:v1:checkoutDraft')).toBe('y');
    expect(m.isStorageDegraded()).toBe(false);
  });

  it('VITE_KIOSK_MODE=false 與未設定相同', async () => {
    const m = await load({ VITE_KIOSK_MODE: 'false' });
    expect(m.isKioskMode).toBe(false);
  });

  it('未開 Demo 模式時，網址的 ?mode=kiosk 被忽略（不寫入旗標）', async () => {
    const m = await load({ VITE_DEMO_MODE: 'false' }, '/?mode=kiosk');
    expect(m.isKioskMode).toBe(false);
    expect(storages.session.getItem('zaiorder:v1:mode')).toBeNull();
  });
});

describe('觸控面板模式（VITE_KIOSK_MODE=true）', () => {
  it('isKioskMode = true；所有 app 儲存僅存記憶體，不寫入也不讀取 localStorage / sessionStorage', async () => {
    storages.local.setItem('zaiorder:v1:cart', 'leftover');
    const writesBefore = storages.local.writes.length;
    const m = await load({ VITE_KIOSK_MODE: 'true' });
    expect(m.isKioskMode).toBe(true);
    // 不讀取：看不到舊內容
    expect(m.appLocalStorage.getItem('zaiorder:v1:cart')).toBeNull();
    m.appLocalStorage.setItem('zaiorder:v1:cart', 'new');
    m.appSessionStorage.setItem('zaiorder:v1:checkoutDraft', 'draft');
    expect(m.appLocalStorage.getItem('zaiorder:v1:cart')).toBe('new');
    // 不寫入
    expect(storages.local.writes).toHaveLength(writesBefore);
    expect(storages.local.getItem('zaiorder:v1:cart')).toBe('leftover');
    expect(storages.session.writes).toEqual([]);
  });

  it('觸控面板的記憶體儲存不算降級：isStorageDegraded() 為 false', async () => {
    const m = await load({ VITE_KIOSK_MODE: 'true' });
    expect(m.appLocalStorage.degraded).toBe(false);
    expect(m.isStorageDegraded()).toBe(false);
  });

  it('VITE_KIOSK_MODE=true 時不需要 Demo 模式，也不寫入 mode 旗標', async () => {
    await load({ VITE_KIOSK_MODE: 'true', VITE_DEMO_MODE: 'false' });
    expect(storages.session.writes).toEqual([]);
  });
});

describe('Demo 模式的 ?mode=kiosk（旗標存於 sessionStorage，站內導覽不遺失）', () => {
  it('?mode=kiosk 寫入旗標並進入觸控面板模式', async () => {
    const m = await load({ VITE_DEMO_MODE: 'true' }, '/?mode=kiosk');
    expect(m.isKioskMode).toBe(true);
    expect(storages.session.getItem('zaiorder:v1:mode')).toBe('kiosk');
    expect(m.appLocalStorage.degraded).toBe(false);
  });

  it('之後的載入即使網址不再帶 query，仍為觸控面板模式', async () => {
    await load({ VITE_DEMO_MODE: 'true' }, '/?mode=kiosk');
    const m = await load({ VITE_DEMO_MODE: 'true' }, '/menu');
    expect(m.isKioskMode).toBe(true);
  });

  it('?mode=normal 清除旗標並回到一般模式', async () => {
    await load({ VITE_DEMO_MODE: 'true' }, '/?mode=kiosk');
    const m = await load({ VITE_DEMO_MODE: 'true' }, '/?mode=normal');
    expect(m.isKioskMode).toBe(false);
    expect(storages.session.getItem('zaiorder:v1:mode')).toBeNull();
  });

  it('其他 mode 值或無 query：維持目前旗標（無旗標為一般模式）', async () => {
    const m = await load({ VITE_DEMO_MODE: 'true' }, '/?mode=weird');
    expect(m.isKioskMode).toBe(false);
  });

  it('sessionStorage 不可用（丟錯）時安全回到一般模式', async () => {
    stubWebStorage(new MemoryStorage(), new ThrowingStorage());
    const m = await load({ VITE_DEMO_MODE: 'true' }, '/?mode=kiosk');
    expect(m.isKioskMode).toBe(false);
  });
});

describe('isStorageDegraded（FR-SY-11）', () => {
  it('一般模式下 localStorage 探測失敗 → 降級', async () => {
    stubWebStorage(new ThrowingStorage(), new MemoryStorage());
    const m = await load();
    expect(m.appLocalStorage.degraded).toBe(true);
    expect(m.isStorageDegraded()).toBe(true);
  });

  it('僅 sessionStorage 不可用也算降級', async () => {
    stubWebStorage(new MemoryStorage(), new ThrowingStorage());
    const m = await load();
    expect(m.isStorageDegraded()).toBe(true);
  });

  it('降級時仍可讀寫（記憶體）', async () => {
    stubWebStorage(new ThrowingStorage(), new ThrowingStorage());
    const m = await load();
    m.appLocalStorage.setItem('zaiorder:v1:cart', 'x');
    expect(m.appLocalStorage.getItem('zaiorder:v1:cart')).toBe('x');
  });
});
