// 07 §7.3 購物車 Store：合併鍵（BR-13）、數量 / 行數上限、24 小時過期（FR-CT-04）、剩餘份數上限（FR-PD-04）、
// 異動清單的「改為 n 份」與復原（FLOW-23）、持久化與多分頁同步
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { CART_TTL_MS, MAX_LINES, MAX_QTY_PER_LINE } from '@/domain/cart';
import type { CartLine } from '@/domain/cart';
import { MemoryStorage, stubWebStorage } from '@/test/memoryStorage';
import type { StubbedStorages } from '@/test/memoryStorage';
import type * as CartNs from '../cartStore';

const KEY = 'zaiorder:v1:cart';
const T0 = Date.parse('2026-10-14T12:00:00+08:00');

type CartModule = typeof CartNs;
type NewLine = Omit<CartLine, 'lineId'>;

const line = (o: Partial<NewLine> = {}): NewLine => ({
  productId: 'prd_lurou',
  quantity: 1,
  optionIds: [],
  snapshot: { name: '招牌滷肉飯', unitPrice: 35, optionLabels: [] },
  ...o,
});

let storages: StubbedStorages;

/** 每次載入全新的模組實例（含 persist 水合）；preload 為預先放進 localStorage 的內容 */
async function load(preload?: unknown): Promise<CartModule & { storages: StubbedStorages }> {
  vi.resetModules();
  const local = new MemoryStorage();
  if (preload !== undefined)
    local.setItem(KEY, typeof preload === 'string' ? preload : JSON.stringify(preload));
  storages = stubWebStorage(local);
  const mod = await import('../cartStore');
  return { ...mod, storages };
}
const persisted = (): { state: Record<string, unknown>; version: number } =>
  JSON.parse(storages.local.getItem(KEY) as string) as {
    state: Record<string, unknown>;
    version: number;
  };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('初始狀態', () => {
  it('空購物車、預設自取、updatedAt 取自 getClock()', async () => {
    const { useCartStore } = await load();
    const s = useCartStore.getState();
    expect(s.lines).toEqual([]);
    expect(s.orderType).toBe('PICKUP');
    expect(s.updatedAt).toBe(T0);
  });
});

describe('addLine（BR-13）', () => {
  it('新增一行：產生 lineId、保留內容、更新 updatedAt', async () => {
    const { useCartStore } = await load();
    vi.setSystemTime(T0 + 5000);
    const ok = useCartStore
      .getState()
      .addLine(line({ quantity: 2, optionIds: ['a'], note: '不要蔥' }));
    expect(ok).toBe(true);
    const { lines, updatedAt } = useCartStore.getState();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      productId: 'prd_lurou',
      quantity: 2,
      optionIds: ['a'],
      note: '不要蔥',
    });
    expect(typeof lines[0]?.lineId).toBe('string');
    expect(lines[0]?.lineId.length).toBeGreaterThan(0);
    expect(updatedAt).toBe(T0 + 5000);
  });

  it('合併鍵相同（商品 + 排序後選項 + 去空白備註）→ 合併份數，不新增行', async () => {
    const { useCartStore } = await load();
    const { addLine } = useCartStore.getState();
    addLine(line({ optionIds: ['b', 'a'], note: ' 不要蔥 ', quantity: 1 }));
    addLine(line({ optionIds: ['a', 'b'], note: '不要蔥', quantity: 2 }));
    const { lines } = useCartStore.getState();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(3);
  });

  it('備註不同 → 不同行；選項不同 → 不同行；商品不同 → 不同行', async () => {
    const { useCartStore } = await load();
    const { addLine } = useCartStore.getState();
    addLine(line());
    addLine(line({ note: '加辣' }));
    addLine(line({ optionIds: ['x'] }));
    addLine(line({ productId: 'prd_tea' }));
    expect(useCartStore.getState().lines).toHaveLength(4);
  });

  it('單行數量上限 20：新增與合併都夾在 20', async () => {
    const { useCartStore } = await load();
    const { addLine } = useCartStore.getState();
    addLine(line({ quantity: 99 }));
    expect(useCartStore.getState().lines[0]?.quantity).toBe(MAX_QTY_PER_LINE);
    addLine(line({ productId: 'p2', quantity: 15 }));
    addLine(line({ productId: 'p2', quantity: 15 }));
    expect(useCartStore.getState().lines[1]?.quantity).toBe(MAX_QTY_PER_LINE);
  });

  it('品項行數上限 30：第 31 個不同的行回傳 false 且不加入；已存在的行仍可合併', async () => {
    const { useCartStore } = await load();
    const { addLine } = useCartStore.getState();
    for (let i = 0; i < MAX_LINES; i++) expect(addLine(line({ productId: `p${i}` }))).toBe(true);
    const before = useCartStore.getState().updatedAt;
    vi.setSystemTime(T0 + 1000);
    expect(addLine(line({ productId: 'overflow' }))).toBe(false);
    expect(useCartStore.getState().lines).toHaveLength(MAX_LINES);
    expect(useCartStore.getState().updatedAt).toBe(before); // 未加入不更新時間
    expect(addLine(line({ productId: 'p0', quantity: 2 }))).toBe(true); // 合併不受行數限制
    expect(useCartStore.getState().lines).toHaveLength(MAX_LINES);
    expect(useCartStore.getState().lines[0]?.quantity).toBe(3);
  });

  it('lineId 彼此不重複', async () => {
    const { useCartStore } = await load();
    const { addLine } = useCartStore.getState();
    for (let i = 0; i < 10; i++) addLine(line({ productId: `p${i}` }));
    const ids = useCartStore.getState().lines.map((l) => l.lineId);
    expect(new Set(ids).size).toBe(10);
  });
});

describe('replaceLine（編輯品項）', () => {
  it('替換內容並保留 lineId 與位置', async () => {
    const { useCartStore } = await load();
    const s = useCartStore.getState();
    s.addLine(line({ productId: 'a' }));
    s.addLine(line({ productId: 'b' }));
    const target = useCartStore.getState().lines[0] as CartLine;
    s.replaceLine(target.lineId, line({ productId: 'a', quantity: 4, optionIds: ['big'] }));
    const lines = useCartStore.getState().lines;
    expect(lines.map((l) => l.productId)).toEqual(['a', 'b']);
    expect(lines[0]).toMatchObject({ lineId: target.lineId, quantity: 4, optionIds: ['big'] });
  });

  it('改成與另一行相同的合併鍵 → 併入該行（份數相加、夾 20），被編輯的行消失', async () => {
    const { useCartStore } = await load();
    const s = useCartStore.getState();
    s.addLine(line({ optionIds: ['small'], quantity: 3 }));
    s.addLine(line({ optionIds: ['big'], quantity: 2 }));
    const [first, second] = useCartStore.getState().lines as [CartLine, CartLine];
    s.replaceLine(second.lineId, line({ optionIds: ['small'], quantity: 2 }));
    const lines = useCartStore.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ lineId: first.lineId, quantity: 5 });
    // 夾在 20
    s.replaceLine(first.lineId, line({ optionIds: ['small'], quantity: 20 }));
    expect(useCartStore.getState().lines[0]?.quantity).toBe(20);
  });

  it('編輯後仍與原本相同的鍵（自己）不視為重複', async () => {
    const { useCartStore } = await load();
    const s = useCartStore.getState();
    s.addLine(line({ quantity: 2 }));
    const target = useCartStore.getState().lines[0] as CartLine;
    s.replaceLine(target.lineId, line({ quantity: 7 }));
    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(useCartStore.getState().lines[0]?.quantity).toBe(7);
  });
});

describe('setQuantity / removeLine / clear / setOrderType', () => {
  it('setQuantity 夾在 1～20 並無條件捨去小數', async () => {
    const { useCartStore } = await load();
    useCartStore.getState().addLine(line());
    const id = (useCartStore.getState().lines[0] as CartLine).lineId;
    const set = (q: number) => {
      useCartStore.getState().setQuantity(id, q);
      return useCartStore.getState().lines[0]?.quantity;
    };
    expect(set(5)).toBe(5);
    expect(set(0)).toBe(1);
    expect(set(-3)).toBe(1);
    expect(set(25)).toBe(20);
    expect(set(3.9)).toBe(3);
  });

  it('性質：任何有限數量輸入都得到 1～20 的整數', async () => {
    const { useCartStore } = await load();
    useCartStore.getState().addLine(line());
    const id = (useCartStore.getState().lines[0] as CartLine).lineId;
    fc.assert(
      fc.property(fc.double({ noNaN: true, min: -1e6, max: 1e6 }), (q) => {
        useCartStore.getState().setQuantity(id, q);
        const v = useCartStore.getState().lines[0]?.quantity as number;
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(20);
      }),
    );
  });

  it('removeLine 只移除指定行；不存在的 lineId 不影響', async () => {
    const { useCartStore } = await load();
    const s = useCartStore.getState();
    s.addLine(line({ productId: 'a' }));
    s.addLine(line({ productId: 'b' }));
    const [a] = useCartStore.getState().lines as [CartLine, CartLine];
    s.removeLine(a.lineId);
    expect(useCartStore.getState().lines.map((l) => l.productId)).toEqual(['b']);
    s.removeLine('nope');
    expect(useCartStore.getState().lines).toHaveLength(1);
  });

  it('clear 清空品項但保留取餐方式', async () => {
    const { useCartStore } = await load();
    const s = useCartStore.getState();
    s.setOrderType('DELIVERY');
    s.addLine(line());
    s.clear();
    expect(useCartStore.getState().lines).toEqual([]);
    expect(useCartStore.getState().orderType).toBe('DELIVERY');
  });

  it('setOrderType 更新取餐方式與時間', async () => {
    const { useCartStore } = await load();
    vi.setSystemTime(T0 + 42);
    useCartStore.getState().setOrderType('DINE_IN');
    expect(useCartStore.getState().orderType).toBe('DINE_IN');
    expect(useCartStore.getState().updatedAt).toBe(T0 + 42);
  });
});

describe('purgeIfExpired（FR-CT-04：24 小時）', () => {
  it('未滿 24 小時：不清空；恰滿 24 小時：不清空；多 1 ms：清空', async () => {
    const { useCartStore } = await load();
    useCartStore.getState().addLine(line());
    const stamped = useCartStore.getState().updatedAt;
    vi.setSystemTime(stamped + CART_TTL_MS);
    useCartStore.getState().purgeIfExpired();
    expect(useCartStore.getState().lines).toHaveLength(1);
    vi.setSystemTime(stamped + CART_TTL_MS + 1);
    useCartStore.getState().purgeIfExpired();
    expect(useCartStore.getState().lines).toEqual([]);
    expect(useCartStore.getState().updatedAt).toBe(stamped + CART_TTL_MS + 1);
  });

  it('購物車本來就是空的：不更新時間（避免無謂寫入）', async () => {
    const { useCartStore } = await load();
    vi.setSystemTime(T0 + 3 * CART_TTL_MS);
    useCartStore.getState().purgeIfExpired();
    expect(useCartStore.getState().updatedAt).toBe(T0);
  });

  it('使用 getClock()（Demo 時間穿梭）而非系統時間', async () => {
    const { useCartStore } = await load();
    const { setClock } = await import('@/services/clock');
    useCartStore.getState().addLine(line());
    setClock({ now: () => new Date(T0 + 2 * CART_TTL_MS) });
    useCartStore.getState().purgeIfExpired();
    expect(useCartStore.getState().lines).toEqual([]);
  });
});

describe('quantityOfProduct / maxAddableFor（FR-PD-04）', () => {
  it('同商品多行份數加總；可排除某一行（編輯該行時）', async () => {
    const { useCartStore } = await load();
    const s = useCartStore.getState();
    s.addLine(line({ productId: 'combo', optionIds: ['a'], quantity: 2 }));
    s.addLine(line({ productId: 'combo', optionIds: ['b'], quantity: 3 }));
    s.addLine(line({ productId: 'tea', quantity: 4 }));
    const [first] = useCartStore.getState().lines as [CartLine];
    expect(s.quantityOfProduct('combo')).toBe(5);
    expect(s.quantityOfProduct('combo', first.lineId)).toBe(3);
    expect(s.quantityOfProduct('tea')).toBe(4);
    expect(s.quantityOfProduct('nothing')).toBe(0);
  });

  it('maxAddableFor：剩 5、其他行已有 3 → 2；排除自己；不限量（null / 省略）→ 20；剩 0 → 0', async () => {
    const { useCartStore } = await load();
    const s = useCartStore.getState();
    s.addLine(line({ productId: 'combo', optionIds: ['a'], quantity: 2 }));
    s.addLine(line({ productId: 'combo', optionIds: ['b'], quantity: 3 }));
    const [first] = useCartStore.getState().lines as [CartLine];
    expect(s.maxAddableFor('combo', 5)).toBe(0);
    expect(s.maxAddableFor('combo', 5, first.lineId)).toBe(2);
    expect(s.maxAddableFor('combo', 8)).toBe(3);
    expect(s.maxAddableFor('combo', null)).toBe(20);
    expect(s.maxAddableFor('combo', undefined)).toBe(20);
    expect(s.maxAddableFor('combo', 0)).toBe(0);
    expect(s.maxAddableFor('other', 50)).toBe(20); // 單行上限優先
  });
});

describe('fitLinesToAvailable / restoreLines（FLOW-23）', () => {
  it('依 { lineId, quantity } 調整；quantity 為 0 者移除；未列出的行不變；夾在 20；小數捨去', async () => {
    const { useCartStore } = await load();
    const s = useCartStore.getState();
    s.addLine(line({ productId: 'a', quantity: 4 }));
    s.addLine(line({ productId: 'b', quantity: 3 }));
    s.addLine(line({ productId: 'c', quantity: 2 }));
    s.addLine(line({ productId: 'd', quantity: 1 }));
    const [a, b, c] = useCartStore.getState().lines as [CartLine, CartLine, CartLine, CartLine];
    s.fitLinesToAvailable([
      { lineId: a.lineId, quantity: 2 },
      { lineId: b.lineId, quantity: 0 },
      { lineId: c.lineId, quantity: 99 },
      { lineId: 'ghost', quantity: 1 },
    ]);
    const lines = useCartStore.getState().lines;
    expect(lines.map((l) => [l.productId, l.quantity])).toEqual([
      ['a', 2],
      ['c', 20],
      ['d', 1],
    ]);
    s.fitLinesToAvailable([{ lineId: a.lineId, quantity: 1.9 }]);
    expect(useCartStore.getState().lines[0]?.quantity).toBe(1);
    s.fitLinesToAvailable([{ lineId: a.lineId, quantity: 0.5 }]); // 無條件捨去為 0 → 移除
    expect(useCartStore.getState().lines.map((l) => l.productId)).toEqual(['c', 'd']);
  });

  it('restoreLines：以先前快照整批還原（復原），且不與快照共用陣列', async () => {
    const { useCartStore } = await load();
    const s = useCartStore.getState();
    s.addLine(line({ productId: 'a', quantity: 3 }));
    s.addLine(line({ productId: 'b', quantity: 2 }));
    const snapshot = [...useCartStore.getState().lines];
    s.fitLinesToAvailable(snapshot.map((l) => ({ lineId: l.lineId, quantity: 0 })));
    expect(useCartStore.getState().lines).toEqual([]);
    s.restoreLines(snapshot);
    expect(useCartStore.getState().lines).toEqual(snapshot);
    expect(useCartStore.getState().lines).not.toBe(snapshot);
  });
});

describe('持久化（zaiorder:v1:cart，version 1）', () => {
  it('每次變更同步寫入；只保存 { lines, orderType, updatedAt }（不含函式）', async () => {
    const { useCartStore } = await load();
    useCartStore.getState().addLine(line({ quantity: 2 }));
    const p = persisted();
    expect(p.version).toBe(1);
    expect(Object.keys(p.state).sort()).toEqual(['lines', 'orderType', 'updatedAt']);
    expect((p.state.lines as CartLine[])[0]?.quantity).toBe(2);
  });

  it('載入時還原 24 小時內的購物車', async () => {
    const saved: CartLine = {
      lineId: 'ln_1',
      productId: 'prd_lurou',
      quantity: 3,
      optionIds: ['a'],
      snapshot: { name: '滷肉飯', unitPrice: 35, optionLabels: [] },
    };
    const { useCartStore } = await load({
      state: { lines: [saved], orderType: 'DELIVERY', updatedAt: T0 - CART_TTL_MS + 1000 },
      version: 1,
    });
    const s = useCartStore.getState();
    expect(s.lines).toEqual([saved]);
    expect(s.orderType).toBe('DELIVERY');
    expect(s.updatedAt).toBe(T0 - CART_TTL_MS + 1000);
  });

  it('載入時已超過 24 小時 → 視為過期，回到預設空購物車', async () => {
    const saved: CartLine = {
      lineId: 'ln_1',
      productId: 'prd_lurou',
      quantity: 3,
      optionIds: [],
      snapshot: { name: '滷肉飯', unitPrice: 35, optionLabels: [] },
    };
    const { useCartStore } = await load({
      state: { lines: [saved], orderType: 'DELIVERY', updatedAt: T0 - CART_TTL_MS - 1 },
      version: 1,
    });
    expect(useCartStore.getState().lines).toEqual([]);
    expect(useCartStore.getState().orderType).toBe('PICKUP');
  });

  it('載入時資料格式不完整（無 updatedAt）→ 退回預設，不丟錯', async () => {
    const { useCartStore } = await load({ state: { lines: [{ lineId: 'x' }] }, version: 1 });
    expect(useCartStore.getState().lines).toEqual([]);
  });

  it('載入時資料損毀（非 JSON）→ 退回預設，不丟錯', async () => {
    const { useCartStore } = await load('{not json');
    expect(useCartStore.getState().lines).toEqual([]);
    expect(useCartStore.getState().orderType).toBe('PICKUP');
  });
});

describe('多分頁同步（storage 事件）', () => {
  it('其他分頁寫入 zaiorder:v1:cart 時重新水合；其他鍵不觸發', async () => {
    const { useCartStore, storages: st } = await load();
    useCartStore.getState().addLine(line({ productId: 'mine' }));
    const other = {
      state: {
        lines: [
          {
            lineId: 'ln_9',
            productId: 'theirs',
            quantity: 4,
            optionIds: [],
            snapshot: { name: 'x', unitPrice: 1, optionLabels: [] },
          },
        ],
        orderType: 'DINE_IN',
        updatedAt: T0,
      },
      version: 1,
    };
    st.local.setItem(KEY, JSON.stringify(other));
    window.dispatchEvent(new StorageEvent('storage', { key: 'zaiorder:v1:prefs' }));
    await Promise.resolve();
    expect(useCartStore.getState().lines[0]?.productId).toBe('mine');
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    await vi.waitFor(() => {
      expect(useCartStore.getState().lines.map((l) => l.productId)).toEqual(['theirs']);
    });
    expect(useCartStore.getState().orderType).toBe('DINE_IN');
  });
});
