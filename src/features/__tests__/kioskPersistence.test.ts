// UAT-19 / BR-36 / BR-37：觸控面板（Kiosk）模式下 cart / session / prefs / guestOrders 僅存記憶體，
// 不讀取也不寫入 localStorage 的 zaiorder:v1:{cart,session,prefs,guestOrders}。
// 模式在模組載入時決定，因此以 vi.resetModules() + vi.stubEnv() 動態載入。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthTokens, UserProfile } from '@/domain/types';
import { MemoryStorage, stubWebStorage } from '@/test/memoryStorage';
import type { StubbedStorages } from '@/test/memoryStorage';

const APP_KEYS = [
  'zaiorder:v1:cart',
  'zaiorder:v1:session',
  'zaiorder:v1:prefs',
  'zaiorder:v1:guestOrders',
] as const;

const T0 = Date.parse('2026-10-14T12:00:00+08:00');
const tokens: AuthTokens = { accessToken: 'acc', refreshToken: 'ref', expiresIn: 900 };
const user: UserProfile = {
  id: 'usr_1',
  phone: '0912345678',
  name: '王小明',
  marketingOptIn: false,
  createdAt: '2026-10-01T00:00:00+08:00',
};

let storages: StubbedStorages;

async function loadAll(env: Record<string, string>, url = '/', seed: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  window.history.replaceState({}, '', url);
  const local = new MemoryStorage();
  for (const [k, v] of Object.entries(seed)) local.setItem(k, v);
  storages = stubWebStorage(local);
  // 播種不算「被測程式」的寫入
  local.writes.length = 0;
  const [cart, prefs, session, guest, app] = await Promise.all([
    import('../cart/cartStore'),
    import('../prefs/prefsStore'),
    import('../auth/sessionStore'),
    import('../orders/guestOrdersStore'),
    import('@/services/storage/appStorage'),
  ]);
  return { cart, prefs, session, guest, app };
}

/** 對四個 store 做一輪「會寫入」的變更 */
function exercise(m: Awaited<ReturnType<typeof loadAll>>): void {
  m.cart.useCartStore.getState().addLine({
    productId: 'prd_lurou',
    quantity: 2,
    optionIds: ['a'],
    note: '不要蔥',
    snapshot: { name: '招牌滷肉飯', unitPrice: 55, optionLabels: ['大碗'] },
  });
  m.cart.useCartStore.getState().setOrderType('DELIVERY');
  m.session.useSessionStore.getState().setSession(tokens, user);
  const prefs = m.prefs.usePrefsStore.getState();
  prefs.patch({ guestProfile: { name: '王小明', phone: '0912345678' }, largeText: true });
  prefs.enableHotkeys();
  prefs.recordNoticeShown(T0);
  prefs.rememberOrder(
    [{ productId: 'prd_lurou', optionIds: ['a'], labels: ['大碗'], note: '少飯' }],
    T0,
  );
  m.guest.useGuestOrdersStore.getState().upsert({
    orderId: 'ord_1',
    orderNo: 'ZO0001',
    trackingToken: 'trk_1',
    placedAt: '2026-10-14T12:00:00+08:00',
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('一般模式（對照組：確認測試不是空轉）', () => {
  it('四個 store 的變更會寫入各自的 localStorage 鍵', async () => {
    const m = await loadAll({});
    expect(m.app.isKioskMode).toBe(false);
    exercise(m);
    for (const key of APP_KEYS) expect(storages.local.getItem(key), key).not.toBeNull();
  });
});

describe('觸控面板模式（VITE_KIOSK_MODE=true）', () => {
  it('變更後 localStorage 沒有任何 zaiorder:v1:{cart,session,prefs,guestOrders} 寫入，也沒有任何寫入動作', async () => {
    const m = await loadAll({ VITE_KIOSK_MODE: 'true' });
    expect(m.app.isKioskMode).toBe(true);
    exercise(m);
    for (const key of APP_KEYS) expect(storages.local.getItem(key), key).toBeNull();
    expect(storages.local.writes).toEqual([]);
    expect(storages.session.writes).toEqual([]);
    // 狀態本身仍正常運作（只存記憶體）
    expect(m.cart.useCartStore.getState().lines).toHaveLength(1);
    expect(m.session.useSessionStore.getState().user?.id).toBe('usr_1');
    expect(m.prefs.usePrefsStore.getState().guestProfile?.name).toBe('王小明');
    expect(m.guest.useGuestOrdersStore.getState().orders).toHaveLength(1);
  });

  it('重置（閒置重置 / 登出 / 清除）同樣不寫入 localStorage', async () => {
    const m = await loadAll({ VITE_KIOSK_MODE: 'true' });
    exercise(m);
    m.cart.useCartStore.getState().clear();
    m.session.useSessionStore.getState().clear();
    m.prefs.usePrefsStore.getState().reset();
    m.guest.useGuestOrdersStore.getState().clear();
    expect(storages.local.writes).toEqual([]);
    expect(m.cart.useCartStore.getState().lines).toEqual([]);
    expect(m.session.useSessionStore.getState().user).toBeNull();
    expect(m.prefs.usePrefsStore.getState().guestProfile).toBeNull();
    expect(m.guest.useGuestOrdersStore.getState().orders).toEqual([]);
  });

  it('不讀取 localStorage：先前一般模式留下的購物車、登入與偏好不會出現在觸控面板', async () => {
    const seed = {
      'zaiorder:v1:cart': JSON.stringify({
        state: {
          lines: [
            {
              lineId: 'ln',
              productId: 'p',
              quantity: 1,
              optionIds: [],
              snapshot: { name: 'x', unitPrice: 1, optionLabels: [] },
            },
          ],
          orderType: 'DELIVERY',
          updatedAt: T0,
        },
        version: 1,
      }),
      'zaiorder:v1:session': JSON.stringify({ state: { tokens, user }, version: 1 }),
      'zaiorder:v1:prefs': JSON.stringify({
        state: { hotkeysEnabled: true, guestProfile: { name: '別人' } },
        version: 2,
      }),
      'zaiorder:v1:guestOrders': JSON.stringify({
        state: {
          orders: [
            {
              orderId: 'o',
              orderNo: 'N',
              trackingToken: 't',
              placedAt: '2026-10-14T12:00:00+08:00',
            },
          ],
        },
        version: 1,
      }),
    };
    const m = await loadAll({ VITE_KIOSK_MODE: 'true' }, '/', seed);
    expect(m.cart.useCartStore.getState().lines).toEqual([]);
    expect(m.cart.useCartStore.getState().orderType).toBe('PICKUP');
    expect(m.session.useSessionStore.getState().user).toBeNull();
    expect(m.prefs.usePrefsStore.getState().hotkeysEnabled).toBe(false);
    expect(m.prefs.usePrefsStore.getState().guestProfile).toBeNull();
    expect(m.guest.useGuestOrdersStore.getState().orders).toEqual([]);
    // 且不去動既有的資料
    for (const key of APP_KEYS) expect(storages.local.getItem(key), key).toBe(seed[key]);
  });

  it('其他分頁的 storage 事件不會讓觸控面板水合到 localStorage 的內容', async () => {
    const m = await loadAll({ VITE_KIOSK_MODE: 'true' });
    storages.local.setItem(
      'zaiorder:v1:session',
      JSON.stringify({ state: { tokens, user }, version: 1 }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'zaiorder:v1:session' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(m.session.useSessionStore.getState().user).toBeNull();
  });
});

describe('Demo 模式 ?mode=kiosk', () => {
  it('同樣不寫入 localStorage 的四個鍵（旗標只寫在 sessionStorage 的 zaiorder:v1:mode）', async () => {
    const m = await loadAll({ VITE_DEMO_MODE: 'true' }, '/?mode=kiosk');
    expect(m.app.isKioskMode).toBe(true);
    exercise(m);
    for (const key of APP_KEYS) expect(storages.local.getItem(key), key).toBeNull();
    expect(storages.local.writes).toEqual([]);
    expect(storages.session.keys()).toEqual(['zaiorder:v1:mode']);
    expect(storages.session.getItem('zaiorder:v1:mode')).toBe('kiosk');
  });
});
