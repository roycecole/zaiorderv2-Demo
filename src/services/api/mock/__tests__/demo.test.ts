// DemoControl、DemoState 持久化、demo_* 啟動參數、時鐘覆寫、多分頁與 db 版本（07 §6.1～§6.5、08 §4）
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClock, setClock, systemClock } from '@/services/clock';
import { DEFAULT_DEMO_STATE } from '../demoControl';
import { parseDemoParams } from '../demoParams';
import { normalizeDemoState } from '../demoState';
import { createMockClient } from '../createMockClient';
import type { LockManagerLike } from '../lock';
import { COMBO, LUROU, T0, TEA, createReq, memoryStorage, newKey, quoteReq, rejection, setup } from './harness';
import type { Harness } from './harness';

let h: Harness;
afterEach(() => {
  h?.cleanup();
  setClock(systemClock);
});

describe('DemoState', () => {
  it('初始狀態：預設值 + 種子的手動售完旗標（控肉飯）；可恢復上架', async () => {
    h = setup();
    const s = h.client.demo.getState();
    expect(s).toEqual({ ...DEFAULT_DEMO_STATE, latencyMs: 0, soldOutProductIds: ['prd_kong_rou'] });
    const kong = async () =>
      (await h.client.store.getMenu()).categories.flatMap((c) => c.products).find((p) => p.id === 'prd_kong_rou');
    expect((await kong())?.isSoldOut).toBe(true);
    h.client.demo.setState({ soldOutProductIds: [] });
    expect((await kong())?.isSoldOut).toBe(false);
  });

  it('持久化於 zaiorder:v1:demo；重新建立 client 後保留；新增欄位以預設值合併舊資料', async () => {
    h = setup();
    h.client.demo.setState({ speed: 5, menuProfile: 'MIXED', themeOverride: '#00AA55' });
    const raw = JSON.parse(h.storage.getItem('zaiorder:v1:demo') ?? '{}');
    expect(raw).toMatchObject({ speed: 5, menuProfile: 'MIXED', themeOverride: '#00AA55' });
    const other = h.openTab();
    expect(other.demo.getState()).toMatchObject({ speed: 5, menuProfile: 'MIXED' });

    // 舊資料缺欄位 / 含未知值：以預設合併
    const merged = normalizeDemoState({ speed: 3, latencyMs: 300, extra: 1, autoSimulate: false });
    expect(merged).toMatchObject({ speed: 1, latencyMs: 300, autoSimulate: false, menuProfile: 'FULL' });
  });

  it('getState 回傳拷貝，不會被外部修改影響內部', () => {
    h = setup();
    const s = h.client.demo.getState();
    s.soldOutProductIds.push('x');
    expect(h.client.demo.getState().soldOutProductIds).not.toContain('x');
  });
});

describe('庫存與時段情境（FR-DM-12）', () => {
  it('getStock / setLimit / setRemaining：每日限量 = 已售 + 保留 + n', async () => {
    h = setup();
    await h.client.orders.create(createReq([COMBO(1)], 299), newKey());
    await h.client.orders.create(createReq([COMBO(1)], 299, { paymentMethod: 'LINE_PAY' }), newKey());
    expect(h.client.demo.getStock('prd_combo_share')).toEqual({ dailyLimit: 5, sold: 1, held: 1, remaining: 3 });
    h.client.demo.setRemaining('prd_combo_share', 2);
    expect(h.client.demo.getStock('prd_combo_share')).toEqual({ dailyLimit: 4, sold: 1, held: 1, remaining: 2 });
    h.client.demo.setLimit('prd_combo_share', null);
    expect(h.client.demo.getStock('prd_combo_share')).toEqual({ dailyLimit: null, sold: 1, held: 1, remaining: null });
    // 「恢復預設」：移除覆寫即回到種子的每日限量 5
    h.client.demo.setState({ limitOverrides: {} });
    expect(h.client.demo.getStock('prd_combo_share').dailyLimit).toBe(5);
    expect(() => h.client.demo.getStock('prd_ghost')).toThrow();
  });

  it('getStock 可指定取餐營業日：隔日的限量由其自己的訂單計算', async () => {
    h = setup();
    await h.client.orders.create(
      createReq([COMBO(2)], 598, { scheduledAt: '2026-10-15T11:00:00+08:00' }),
      newKey(),
    );
    expect(h.client.demo.getStock('prd_combo_share')).toMatchObject({ sold: 0, remaining: 5 });
    expect(h.client.demo.getStock('prd_combo_share', '2026-10-15')).toMatchObject({ sold: 2, remaining: 3 });
  });

  it('庫存-19：店家調降限量低於已售 → 剩餘為 0，既有訂單不受影響', async () => {
    h = setup();
    await h.client.orders.create(createReq([COMBO(3)], 897), newKey());
    h.client.demo.setLimit('prd_combo_share', 1);
    expect(h.client.demo.getStock('prd_combo_share')).toMatchObject({ sold: 3, remaining: 0 });
  });

  it('injectOtherOrder：份數夾在剩餘內；PENDING_PAYMENT 保留；回傳實際注入份數', async () => {
    h = setup();
    expect(await h.client.demo.injectOtherOrder({ productId: 'prd_combo_share', quantity: 3 })).toEqual({ added: 3 });
    expect(await h.client.demo.injectOtherOrder({ productId: 'prd_combo_share', quantity: 9, status: 'PENDING_PAYMENT' }))
      .toEqual({ added: 2 });
    expect(h.client.demo.getStock('prd_combo_share')).toMatchObject({ sold: 3, held: 2, remaining: 0 });
    expect(await h.client.demo.injectOtherOrder({ productId: 'prd_combo_share', quantity: 1 })).toEqual({ added: 0 });
    // 菜單：他人待付款占用造成的暫時額滿，維持顯示「今日售完」（remainingToday = 0）
    const combo = (await h.client.store.getMenu()).categories.flatMap((c) => c.products).find((p) => p.id === 'prd_combo_share');
    expect(combo).toMatchObject({ isSoldOut: true, remainingToday: 0 });
  });

  it('clearOtherOrders：清除 X 前綴訂單並釋放份數與時段；回傳筆數；不動自己的訂單', async () => {
    h = setup();
    await h.client.orders.create(createReq([COMBO(1)], 299), newKey());
    await h.client.demo.injectOtherOrder({ productId: 'prd_combo_share', quantity: 2 });
    await h.client.demo.fillSlot('2026-10-14T12:30:00+08:00', 0);
    expect(h.client.demo.clearOtherOrders()).toBe(1 + 8);
    expect(h.client.demo.getStock('prd_combo_share')).toMatchObject({ sold: 1, remaining: 4 });
    const slots = await h.client.store.getPickupSlots({ orderType: 'PICKUP' });
    expect(slots.days[0]?.slots.find((s) => s.startAt === '2026-10-14T12:30:00+08:00')?.status).toBe('AVAILABLE');
    expect(h.client.demo.clearOtherOrders()).toBe(0);
  });

  it('fillSlot：已訂數不足時補單；已額滿不再補；他人訂單不出現在 getCreateLog', async () => {
    h = setup();
    const t = '2026-10-14T13:00:00+08:00';
    expect(await h.client.demo.fillSlot(t, 1)).toEqual({ added: 7 });
    expect(await h.client.demo.fillSlot(t, 1)).toEqual({ added: 0 });
    expect(await h.client.demo.fillSlot(t, 0)).toEqual({ added: 1 });
    expect(h.client.demo.getCreateLog()).toEqual([]);
  });

  it('getCreateLog：最新在前、最多 20 筆、可取前 N 筆', async () => {
    h = setup({ demo: { soldOutProductIds: ['prd_black_tea'] } });
    for (let i = 0; i < 22; i++) {
      await rejection(h.client.orders.create(createReq([TEA()], 25), newKey()));
    }
    expect(h.client.demo.getCreateLog(100)).toHaveLength(20);
    expect(h.client.demo.getCreateLog()).toHaveLength(5);
    expect(h.client.demo.getCreateLog(1)[0]).toMatchObject({
      outcome: 'REJECTED', code: 'ITEM_SOLD_OUT', summary: '古早味紅茶今日售完',
    });
  });

  it('被拒摘要的取餐日改寫：預約明天 → 「明天（10/15）」（03 §9）', async () => {
    h = setup();
    h.client.demo.setLimit('prd_combo_share', 0);
    await rejection(
      h.client.orders.create(createReq([COMBO(1)], 299, { scheduledAt: '2026-10-15T11:00:00+08:00' }), newKey()),
    );
    expect(h.client.demo.getCreateLog(1)[0]?.summary).toBe('雙人分享餐明天（10/15）售完');
  });
});

describe('demo_* 啟動參數（07 §6.3、08 §4）', () => {
  it('parseDemoParams：clock（保留 +08:00）、fail（階段與次數順序不拘）、limit、race、fullslot', () => {
    const p = parseDemoParams(
      '?demo_clock=2026-10-14T12:00:00+08:00&demo_fail=orders.create:AFTER_COMMIT:1' +
        '&demo_limit=prd_combo_share:2&demo_race=prd_combo_share:5&demo_fullslot=2026-10-14T12:30:00%2B08:00',
    );
    expect(p.clock).toBe('2026-10-14T12:00:00+08:00');
    expect(p.failNext).toEqual({ target: 'orders.create', phase: 'AFTER_COMMIT', remaining: 1 });
    expect(p.limitOverrides).toEqual({ prd_combo_share: 2 });
    expect(p.race).toEqual({
      buy: [{ productId: 'prd_combo_share', quantity: 5 }],
      fillSlots: [{ startAt: '2026-10-14T12:30:00+08:00', leave: 0 }],
    });
  });

  it('demo_fail：省略階段與次數為持續失敗；次數可在階段之前；未知端點與無效值忽略', () => {
    expect(parseDemoParams('?demo_fail=orders.create').failNext).toEqual({
      target: 'orders.create', remaining: Number.MAX_SAFE_INTEGER,
    });
    expect(parseDemoParams('?demo_fail=orders.create:3').failNext).toEqual({ target: 'orders.create', remaining: 3 });
    expect(parseDemoParams('?demo_fail=orders.quote:3').failNext).toEqual({ target: 'orders.quote', remaining: 3 });
    expect(parseDemoParams('?demo_fail=orders.create:2:BEFORE').failNext).toEqual({
      target: 'orders.create', phase: 'BEFORE', remaining: 2,
    });
    expect(parseDemoParams('?demo_fail=nope:1').failNext).toBeUndefined();
    expect(parseDemoParams('?demo_clock=garbage&demo_limit=x').clock).toBeUndefined();
    expect(parseDemoParams('?demo_limit=prd_combo_share:none').limitOverrides).toEqual({ prd_combo_share: null });
    expect(parseDemoParams('?mode=kiosk&demo_fail=orders.create:AFTER_COMMIT:1').failNext?.phase).toBe('AFTER_COMMIT');
  });

  it('demoMode 開啟：套用時鐘（繼續走時）、限量覆寫、失敗注入與預備情境；種子相對於 demo_clock', async () => {
    setClock(systemClock);
    const storage = memoryStorage();
    const client = createMockClient({
      storeSlug: 'demo-snack',
      storage,
      locks: null,
      demoMode: true,
      syncTabs: false,
      search: '?demo_clock=2026-10-14T12:00:00+08:00&demo_limit=prd_combo_share:2&demo_race=prd_combo_share:1',
    });
    try {
      const now = getClock().now().getTime();
      expect(Math.abs(now - T0)).toBeLessThan(5_000);
      expect(client.demo.getState()).toMatchObject({
        clockOverride: '2026-10-14T12:00:00+08:00',
        limitOverrides: { prd_combo_share: 2 },
        raceOnNextCreate: { buy: [{ productId: 'prd_combo_share', quantity: 1 }] },
      });
      client.demo.setState({ latencyMs: 0 });
      expect(client.demo.getStock('prd_combo_share').remaining).toBe(2);
      const info = await client.store.getInfo();
      expect(info.specialDays[0]?.date).toBe('2026-10-17');
    } finally {
      client.dispose();
    }
  });

  it('demoMode 關閉：demo_* 參數不生效', () => {
    setClock(systemClock);
    const client = createMockClient({
      storeSlug: 'demo-snack',
      storage: memoryStorage(),
      locks: null,
      demoMode: false,
      syncTabs: false,
      search: '?demo_clock=2026-10-14T12:00:00+08:00&demo_limit=prd_combo_share:2',
    });
    try {
      expect(client.demo.getState().clockOverride).toBeNull();
      expect(client.demo.getState().limitOverrides).toEqual({});
    } finally {
      client.dispose();
    }
  });
});

describe('時間穿梭（clockOverride）', () => {
  it('設定後 getClock() 以該時間為起點；回到 null 還原為實際時間', () => {
    h = setup();
    h.client.demo.setState({ clockOverride: '2026-10-14T20:40:00+08:00' });
    expect(Math.abs(getClock().now().getTime() - Date.parse('2026-10-14T20:40:00+08:00'))).toBeLessThan(2000);
    h.client.demo.setState({ clockOverride: null });
    expect(getClock()).toBe(systemClock);
  });

  it('營業狀態隨時鐘變化：20:40 營業中，20:45 起 LAST_ORDER_PASSED（FR-ST-08）', async () => {
    h = setup();
    h.setNow(Date.parse('2026-10-14T20:44:59+08:00'));
    expect((await h.client.store.getStatus()).status).toBe('OPEN');
    h.setNow(Date.parse('2026-10-14T20:45:00+08:00'));
    const s = await h.client.store.getStatus();
    expect(s).toMatchObject({ status: 'CLOSED', closedReason: 'LAST_ORDER_PASSED' });
    expect(s.nextOpenAt).toBe('2026-10-15T11:00:00+08:00');
  });

  it('S23：快轉 +15 分鐘後，待付款保留釋放；快轉 +24 小時換營業日，昨日訂單不計入新營業日', async () => {
    h = setup();
    await h.client.orders.create(createReq([COMBO(3)], 897, { paymentMethod: 'LINE_PAY' }), newKey());
    await h.client.orders.create(createReq([COMBO(1)], 299), newKey());
    expect(h.client.demo.getStock('prd_combo_share')).toMatchObject({ sold: 1, held: 3, remaining: 1 });
    h.advance(15 * 60_000);
    expect(h.client.demo.getStock('prd_combo_share')).toMatchObject({ sold: 1, held: 0, remaining: 4 });
    h.advance(24 * 3_600_000);
    expect(h.client.demo.getStock('prd_combo_share')).toMatchObject({ sold: 0, remaining: 5 });
    // 手動售完與限量覆寫不會自動重置（Q-12 不模擬）
    expect(h.client.demo.getState().soldOutProductIds).toContain('prd_kong_rou');
  });
});

describe('重置與多分頁', () => {
  it('resetAll：清除所有 zaiorder:v1:*（含 localStorage 與 sessionStorage）並重新載入；時鐘還原', async () => {
    const reloadPage = vi.fn();
    h = setup({ client: { reloadPage } });
    window.sessionStorage.setItem('zaiorder:v1:checkoutDraft', '{}');
    window.sessionStorage.setItem('unrelated', 'keep');
    h.storage.setItem('zaiorder:v1:cart', '{}');
    h.storage.setItem('other:key', 'keep');
    h.client.demo.setState({ clockOverride: '2026-10-14T20:40:00+08:00' });
    await h.client.orders.create(createReq([TEA()], 25), newKey());

    h.client.demo.resetAll();
    expect(reloadPage).toHaveBeenCalledTimes(1);
    const keys = Array.from({ length: h.storage.length }, (_, i) => h.storage.key(i));
    expect(keys.filter((k) => k?.startsWith('zaiorder:v1:'))).toEqual([]);
    expect(h.storage.getItem('other:key')).toBe('keep');
    expect(window.sessionStorage.getItem('zaiorder:v1:checkoutDraft')).toBeNull();
    expect(window.sessionStorage.getItem('unrelated')).toBe('keep');
    expect(getClock()).toBe(systemClock);

    // 重新載入前的背景請求不會把舊資料寫回
    await h.client.store.getMenu();
    await h.client.orders.create(createReq([TEA()], 25), newKey()).catch(() => undefined);
    expect(h.storage.getItem('zaiorder:v1:db')).toBeNull();
    window.sessionStorage.removeItem('unrelated');
  });

  it('兩個分頁共用 storage：交錯建單不遺失、不超賣（最後 1 份只成功 1 筆）', async () => {
    h = setup();
    const tabB = h.openTab();
    tabB.demo.setState({ latencyMs: 0 });
    h.client.demo.setRemaining('prd_combo_share', 1);
    const [a, b] = await Promise.allSettled([
      h.client.orders.create(createReq([COMBO(1)], 299), newKey()),
      tabB.orders.create(createReq([COMBO(1)], 299), newKey()),
    ]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(tabB.demo.getStock('prd_combo_share')).toMatchObject({ sold: 1, remaining: 0 });
    expect(h.client.demo.getStock('prd_combo_share')).toMatchObject({ sold: 1, remaining: 0 });
  });

  it('分頁 B 看得到分頁 A 的訂單與取餐號碼不重號；DemoState 變更由 reload 取得', async () => {
    h = setup();
    const tabB = h.openTab();
    const first = await h.client.orders.create(createReq([TEA()], 25), newKey());
    const second = await tabB.orders.create(createReq([TEA()], 25), newKey());
    expect([first.order.pickupNo, second.order.pickupNo]).toEqual(['A001', 'A002']);
    h.client.demo.setState({ storeOverride: 'PAUSED' });
    expect((await tabB.store.getStatus()).status).toBe('PAUSED');
  });

  it('Web Locks：所有寫入經同一把鎖（鎖名 zaiorder:db），且回呼序列執行', async () => {
    const calls: string[] = [];
    let active = 0;
    let maxActive = 0;
    const locks: LockManagerLike = {
      async request(name, cb) {
        calls.push(name);
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          return await cb();
        } finally {
          active -= 1;
        }
      },
    };
    h = setup({ client: { locks } });
    await h.client.orders.create(createReq([TEA()], 25), newKey());
    await h.client.demo.injectOtherOrder({ productId: 'prd_combo_share', quantity: 1 });
    await h.client.demo.fillSlot('2026-10-14T12:30:00+08:00', 1);
    await h.client.demo.loginAsDemoUser();
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(new Set(calls)).toEqual(new Set(['zaiorder:db']));
    expect(maxActive).toBe(1);
  });

  it('不支援 Web Locks（jsdom 無 navigator.locks）時降級為直接執行', async () => {
    h = setup({ client: { locks: undefined } });
    expect(globalThis.navigator.locks).toBeUndefined();
    const ok = await h.client.orders.create(createReq([TEA()], 25), newKey());
    expect(ok.order.status).toBe('PENDING');
  });

  it('db 持久化於 zaiorder:v1:db，含集合與 schemaVersion；版本不符時重建（schemaReset）', async () => {
    h = setup();
    await h.client.orders.create(createReq([TEA()], 25), newKey());
    const db = JSON.parse(h.storage.getItem('zaiorder:v1:db') ?? '{}');
    expect(db.meta.schemaVersion).toBe(1);
    expect(db.orders).toHaveLength(4); // 3 筆歷史訂單 + 1
    expect(Object.keys(db)).toEqual(
      expect.arrayContaining(['users', 'user_addresses', 'favorites', 'user_coupons', 'orders', 'order_items',
        'order_item_options', 'order_status_logs', 'payments', 'order_invoices']),
    );

    db.meta.schemaVersion = 0;
    h.storage.setItem('zaiorder:v1:db', JSON.stringify(db));
    const fresh = h.openTab();
    fresh.demo.setState({ latencyMs: 0 });
    const res = await fresh.orders.create(createReq([TEA()], 25), newKey());
    expect(res.order.pickupNo).toBe('A001'); // 可變資料已清除
  });

  it('損毀的 db 內容：重建而不丟錯', async () => {
    h = setup();
    h.storage.setItem('zaiorder:v1:db', '{not json');
    const tab = h.openTab();
    tab.demo.setState({ latencyMs: 0 });
    expect((await tab.store.getInfo()).slug).toBe('demo-snack');
  });
});

describe('延遲（FR-DM-06）', () => {
  it('latencyMs ± 100ms jitter；0 不延遲', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    h = setup({ client: { sleep }, demo: { latencyMs: 300 } });
    await h.client.store.getStatus();
    expect(sleep).toHaveBeenCalledTimes(1);
    const ms = (sleep.mock.calls[0] as unknown as [number])[0];
    expect(ms).toBeGreaterThanOrEqual(200);
    expect(ms).toBeLessThanOrEqual(400);

    h.client.demo.setState({ latencyMs: 0 });
    sleep.mockClear();
    await h.client.store.getStatus();
    expect(sleep).not.toHaveBeenCalled();

    h.client.demo.setState({ latencyMs: 1500 });
    await h.client.store.getStatus();
    expect((sleep.mock.calls[0] as unknown as [number])[0]).toBeGreaterThanOrEqual(1400);
  });

  it('create 的延遲在臨界區之外（先延遲再進入鎖）', async () => {
    const order: string[] = [];
    const locks: LockManagerLike = {
      async request(_name, cb) {
        order.push('lock');
        return cb();
      },
    };
    const sleep = vi.fn(() => {
      order.push('sleep');
      return Promise.resolve();
    });
    h = setup({ client: { locks, sleep }, demo: { latencyMs: 300 } });
    order.length = 0;
    await h.client.orders.create(createReq([LUROU()], 67), newKey());
    expect(order[0]).toBe('sleep');
    expect(order.indexOf('lock')).toBeGreaterThan(0);
    // quote 不進臨界區
    order.length = 0;
    await h.client.orders.quote(quoteReq([LUROU()]));
    expect(order).toEqual(['sleep']);
  });
});
