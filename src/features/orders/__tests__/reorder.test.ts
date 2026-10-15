// FLOW-13 再來一單：下架 / 售完略過、數量調整為可購買份數、選項名稱比對與失效處理
import { describe, expect, it } from 'vitest';
import type { CartLine } from '@/domain/cart';
import type { ProductDetail } from '@/domain/types';
import { isCleanPlan, planReorder } from '../reorder';
import { item, lurouDetail, teaDetail } from './fixtures';

const detailsOf = (...ds: Array<ProductDetail | null>) =>
  new Map<string, ProductDetail | null>(
    ds.map((d, i) => [d?.id ?? ['prd_lurou', 'prd_tea', 'prd_gone'][i] ?? `p${i}`, d]),
  );

const lurouItem = (over: Partial<Parameters<typeof item>[0]> = {}) =>
  item({
    name: '招牌滷肉飯',
    productId: 'prd_lurou',
    quantity: 1,
    options: [
      { groupName: '份量', name: '大碗', priceDelta: 10 },
      { groupName: '加料', name: '滷蛋', priceDelta: 10 },
    ],
    ...over,
  });

describe('planReorder', () => {
  it('全部可用：原樣加入，選項以名稱對應回目前的選項 ID，價格快照取目前價格', () => {
    const plan = planReorder(
      [lurouItem({ quantity: 2, note: ' 不要蔥 ' }), item({ name: '古早味紅茶', productId: 'prd_tea' })],
      detailsOf(lurouDetail(), teaDetail()),
      [],
    );
    expect(plan.skipped).toEqual([]);
    expect(plan.adjusted).toEqual([]);
    expect(plan.lines).toHaveLength(2);
    const first = plan.lines[0];
    expect(first?.productId).toBe('prd_lurou');
    expect(first?.quantity).toBe(2);
    expect([...(first?.optionIds ?? [])].sort()).toEqual(['o_egg', 'o_large']);
    expect(first?.note).toBe('不要蔥');
    expect(first?.snapshot.unitPrice).toBe(35 + 10 + 10);
    expect(first?.snapshot.optionLabels).toEqual(['大碗', '滷蛋']);
    expect(isCleanPlan(plan)).toBe(true);
  });

  it('商品已下架（查無）或 productId 為空：略過並說明', () => {
    const plan = planReorder(
      [item({ name: '蚵仔煎', productId: 'prd_gone' }), item({ name: '舊品項', productId: null })],
      detailsOf(null),
      [],
    );
    expect(plan.lines).toEqual([]);
    expect(plan.skipped).toEqual([
      { name: '蚵仔煎', reason: 'UNLISTED' },
      { name: '舊品項', reason: 'UNLISTED' },
    ]);
  });

  it('商品售完：略過', () => {
    const plan = planReorder(
      [item({ name: '控肉飯', productId: 'prd_tea' })],
      detailsOf(teaDetail({ isSoldOut: true })),
      [],
    );
    expect(plan.skipped).toEqual([{ name: '控肉飯', reason: 'SOLD_OUT' }]);
  });

  it('數量超過可購買份數：調整為可購買份數（扣除購物車內同商品）並說明', () => {
    const cart = [{ productId: 'prd_tea', quantity: 1, optionIds: [], note: undefined }];
    const plan = planReorder(
      [item({ name: '雙人分享餐', productId: 'prd_tea', quantity: 3 })],
      detailsOf(teaDetail({ remainingToday: 3 })),
      cart,
    );
    expect(plan.lines[0]?.quantity).toBe(2);
    expect(plan.adjusted).toEqual([{ name: '雙人分享餐', from: 3, to: 2, reason: 'LIMITED' }]);
    expect(isCleanPlan(plan)).toBe(false);
  });

  it('可購買量為 0 視同售完', () => {
    const plan = planReorder(
      [item({ name: '雙人分享餐', productId: 'prd_tea', quantity: 1 })],
      detailsOf(teaDetail({ remainingToday: 0 })),
      [],
    );
    expect(plan.skipped).toEqual([{ name: '雙人分享餐', reason: 'SOLD_OUT' }]);
  });

  it('同訂單內同商品多行依序配置，後面的行先被縮減', () => {
    const plan = planReorder(
      [
        item({ id: 'a', name: '雙人分享餐', productId: 'prd_tea', quantity: 2 }),
        item({ id: 'b', name: '雙人分享餐', productId: 'prd_tea', quantity: 2, note: '少冰' }),
      ],
      detailsOf(teaDetail({ remainingToday: 3 })),
      [],
    );
    expect(plan.lines.map((l) => l.quantity)).toEqual([2, 1]);
    expect(plan.adjusted).toEqual([{ name: '雙人分享餐', from: 2, to: 1, reason: 'LIMITED' }]);
  });

  it('選項部分失效：移除失效選項後加入，必選群組改用預設，並標記異動', () => {
    const detail = lurouDetail();
    // 「大碗」已下架、「滷蛋」仍在
    const groups = detail.optionGroups.map((g) =>
      g.id === 'g_size'
        ? { ...g, options: g.options.map((o) => (o.id === 'o_large' ? { ...o, isAvailable: false } : o)) }
        : g,
    );
    const plan = planReorder([lurouItem()], detailsOf({ ...detail, optionGroups: groups }), []);
    expect(plan.lines).toHaveLength(1);
    expect([...(plan.lines[0]?.optionIds ?? [])].sort()).toEqual(['o_egg', 'o_small']);
    expect(plan.optionsDropped).toEqual(['招牌滷肉飯']);
    expect(isCleanPlan(plan)).toBe(false);
  });

  it('選項改名而對不上：視為失效並以預設補足必選群組', () => {
    const plan = planReorder(
      [lurouItem({ options: [{ groupName: '份量', name: '特大碗', priceDelta: 20 }] })],
      detailsOf(lurouDetail()),
      [],
    );
    expect(plan.lines[0]?.optionIds).toEqual(['o_small']);
    expect(plan.optionsDropped).toEqual(['招牌滷肉飯']);
  });

  it('必選群組全部失效且沒有預設選項：整個品項略過', () => {
    const detail = lurouDetail();
    const groups = detail.optionGroups.map((g) =>
      g.id === 'g_size'
        ? { ...g, options: g.options.map((o) => ({ ...o, isAvailable: false })) }
        : g,
    );
    const plan = planReorder([lurouItem()], detailsOf({ ...detail, optionGroups: groups }), []);
    expect(plan.lines).toEqual([]);
    expect(plan.skipped).toEqual([{ name: '招牌滷肉飯', reason: 'OPTIONS' }]);
  });

  it('購物車已有相同品項行：合併後不超過單行上限 20，超出時調整', () => {
    const cart: Array<Pick<CartLine, 'productId' | 'quantity' | 'optionIds' | 'note'>> = [
      { productId: 'prd_tea', quantity: 19, optionIds: [], note: undefined },
    ];
    const plan = planReorder(
      [item({ name: '古早味紅茶', productId: 'prd_tea', quantity: 5 })],
      detailsOf(teaDetail()),
      cart,
    );
    expect(plan.lines[0]?.quantity).toBe(1);
    expect(plan.adjusted).toEqual([{ name: '古早味紅茶', from: 5, to: 1, reason: 'MAX_LINE' }]);
  });

  it('購物車已達單行上限：略過', () => {
    const cart = [{ productId: 'prd_tea', quantity: 20, optionIds: [], note: undefined }];
    const plan = planReorder(
      [item({ name: '古早味紅茶', productId: 'prd_tea', quantity: 1 })],
      detailsOf(teaDetail()),
      cart,
    );
    expect(plan.skipped).toEqual([{ name: '古早味紅茶', reason: 'CART_LIMIT' }]);
  });

  it('品項行數達上限（30）：新增的行略過，合併到既有行不受影響', () => {
    const cart = Array.from({ length: 30 }, (_, i) => ({
      productId: `p${i}`,
      quantity: 1,
      optionIds: [],
      note: undefined,
    }));
    const plan = planReorder(
      [
        item({ name: '新品項', productId: 'prd_tea', quantity: 1 }),
        item({ name: '既有品項', productId: 'p3', quantity: 1 }),
      ],
      new Map([
        ['prd_tea', teaDetail()],
        ['p3', teaDetail({ id: 'p3', name: '既有品項' })],
      ]),
      cart,
    );
    expect(plan.skipped).toEqual([{ name: '新品項', reason: 'LINE_LIMIT' }]);
    expect(plan.lines.map((l) => l.productId)).toEqual(['p3']);
  });
});
