// 07 §6.2 訪客訂單追蹤記錄：最多 10 筆、同訂單以新權杖取代（BR-27 重新簽發後舊權杖失效）
import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { MemoryStorage, stubWebStorage } from '@/test/memoryStorage';
import type { StubbedStorages } from '@/test/memoryStorage';
import type * as GuestNs from '../guestOrdersStore';

const KEY = 'zaiorder:v1:guestOrders';
type GuestModule = typeof GuestNs;
let storages: StubbedStorages;

async function load(preload?: unknown): Promise<GuestModule> {
  vi.resetModules();
  const local = new MemoryStorage();
  if (preload !== undefined)
    local.setItem(KEY, typeof preload === 'string' ? preload : JSON.stringify(preload));
  storages = stubWebStorage(local);
  return import('../guestOrdersStore');
}

const ref = (n: number, o: Partial<{ trackingToken: string }> = {}) => ({
  orderId: `ord_${n}`,
  orderNo: `ZO${String(n).padStart(4, '0')}`,
  trackingToken: o.trackingToken ?? `trk_${n}`,
  placedAt: '2026-10-14T12:00:00+08:00',
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('guestOrdersStore', () => {
  it('初始為空；MAX_GUEST_ORDERS 為 10', async () => {
    const { useGuestOrdersStore, MAX_GUEST_ORDERS } = await load();
    expect(useGuestOrdersStore.getState().orders).toEqual([]);
    expect(MAX_GUEST_ORDERS).toBe(10);
  });

  it('upsert：新的在最前面', async () => {
    const { useGuestOrdersStore } = await load();
    const s = useGuestOrdersStore.getState();
    s.upsert(ref(1));
    s.upsert(ref(2));
    expect(useGuestOrdersStore.getState().orders.map((o) => o.orderId)).toEqual(['ord_2', 'ord_1']);
  });

  it('upsert：同 orderId 以新權杖取代並移到最前（不重複）', async () => {
    const { useGuestOrdersStore } = await load();
    const s = useGuestOrdersStore.getState();
    s.upsert(ref(1));
    s.upsert(ref(2));
    s.upsert(ref(1, { trackingToken: 'trk_new' }));
    const orders = useGuestOrdersStore.getState().orders;
    expect(orders.map((o) => o.orderId)).toEqual(['ord_1', 'ord_2']);
    expect(orders[0]?.trackingToken).toBe('trk_new');
    expect(s.tokenFor('ord_1')).toBe('trk_new');
  });

  it('超過 10 筆時淘汰最舊者（保留最近 10 筆）', async () => {
    const { useGuestOrdersStore } = await load();
    const s = useGuestOrdersStore.getState();
    for (let i = 1; i <= 12; i++) s.upsert(ref(i));
    const ids = useGuestOrdersStore.getState().orders.map((o) => o.orderId);
    expect(ids).toHaveLength(10);
    expect(ids[0]).toBe('ord_12');
    expect(ids[9]).toBe('ord_3');
    expect(s.tokenFor('ord_1')).toBeNull();
    expect(s.tokenFor('ord_2')).toBeNull();
  });

  it('updateToken：只換權杖，順序與其他欄位不變；不存在的訂單不影響', async () => {
    const { useGuestOrdersStore } = await load();
    const s = useGuestOrdersStore.getState();
    s.upsert(ref(1));
    s.upsert(ref(2));
    s.updateToken('ord_1', 'trk_fresh');
    s.updateToken('ghost', 'x');
    const orders = useGuestOrdersStore.getState().orders;
    expect(orders.map((o) => [o.orderId, o.trackingToken])).toEqual([
      ['ord_2', 'trk_2'],
      ['ord_1', 'trk_fresh'],
    ]);
    expect(orders[1]?.orderNo).toBe('ZO0001');
  });

  it('remove、clear、tokenFor', async () => {
    const { useGuestOrdersStore } = await load();
    const s = useGuestOrdersStore.getState();
    s.upsert(ref(1));
    s.upsert(ref(2));
    expect(s.tokenFor('ord_2')).toBe('trk_2');
    expect(s.tokenFor('nope')).toBeNull();
    s.remove('ord_1');
    expect(useGuestOrdersStore.getState().orders.map((o) => o.orderId)).toEqual(['ord_2']);
    s.clear();
    expect(useGuestOrdersStore.getState().orders).toEqual([]);
  });

  it('持久化：zaiorder:v1:guestOrders、version 1，只保存 { orders }', async () => {
    const { useGuestOrdersStore } = await load();
    useGuestOrdersStore.getState().upsert(ref(1));
    const p = JSON.parse(storages.local.getItem(KEY) as string) as {
      state: Record<string, unknown>;
      version: number;
    };
    expect(p.version).toBe(1);
    expect(Object.keys(p.state)).toEqual(['orders']);
    expect(p.state.orders).toHaveLength(1);
  });

  it('載入時還原；資料損毀時回到空清單', async () => {
    const saved = { state: { orders: [ref(7)] }, version: 1 };
    const a = await load(saved);
    expect(a.useGuestOrdersStore.getState().orders.map((o) => o.orderId)).toEqual(['ord_7']);
    const b = await load('<<broken>>');
    expect(b.useGuestOrdersStore.getState().orders).toEqual([]);
  });

  it('性質：任意 upsert 序列後 orderId 不重複、不超過 10 筆、最新的 upsert 在最前', async () => {
    const { useGuestOrdersStore } = await load();
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 1, maxLength: 40 }),
        (picks) => {
          useGuestOrdersStore.getState().clear();
          picks.forEach((n, i) =>
            useGuestOrdersStore.getState().upsert(ref(n, { trackingToken: `t${i}` })),
          );
          const orders = useGuestOrdersStore.getState().orders;
          const ids = orders.map((o) => o.orderId);
          expect(new Set(ids).size).toBe(ids.length);
          expect(orders.length).toBeLessThanOrEqual(10);
          const last = picks[picks.length - 1] as number;
          expect(orders[0]?.orderId).toBe(`ord_${last}`);
          expect(orders[0]?.trackingToken).toBe(`t${picks.length - 1}`);
        },
      ),
    );
  });
});
