// 加入購物車核心：合併鍵（BR-13）、單行 20 份 / 30 行上限、剩餘份數上限（FR-PD-04）與復原（FLOW-03）
import { beforeEach, describe, expect, it } from 'vitest';
import { addToCart, undoAdd } from '../addToCart';
import type { AddRequest } from '../addToCart';
import { useCartStore } from '../cartStore';

const base = (overrides: Partial<AddRequest> = {}): AddRequest => ({
  productId: 'prd_lurou',
  name: '招牌滷肉飯',
  remaining: null,
  optionIds: [],
  optionLabels: [],
  unitPrice: 35,
  quantity: 1,
  ...overrides,
});

const reset = (): void => {
  useCartStore.setState({ lines: [], orderType: 'PICKUP', updatedAt: Date.now() });
};

beforeEach(reset);

describe('addToCart', () => {
  it('新增一行：保存顯示用快照，備註去除前後空白', () => {
    const result = addToCart(
      base({
        optionIds: ['a', 'b'],
        optionLabels: ['大碗', '滷蛋'],
        unitPrice: 67,
        note: '  不要蔥 ',
      }),
    );
    expect(result).toMatchObject({ ok: true, added: 1, lineCount: 1, subtotal: 67 });
    const [line] = useCartStore.getState().lines;
    expect(line).toMatchObject({
      productId: 'prd_lurou',
      quantity: 1,
      optionIds: ['a', 'b'],
      note: '不要蔥',
    });
    expect(line?.snapshot).toEqual({
      name: '招牌滷肉飯',
      unitPrice: 67,
      optionLabels: ['大碗', '滷蛋'],
    });
  });

  it('空白備註不寫入；圖片網址存在時才進快照', () => {
    addToCart(base({ note: '   ', imageUrl: '/a.svg' }));
    const [line] = useCartStore.getState().lines;
    expect(line?.note).toBeUndefined();
    expect(line?.snapshot.imageUrl).toBe('/a.svg');
  });

  it('合併鍵 = 商品 + 排序後選項 + 備註：選項順序不同仍合併', () => {
    addToCart(base({ optionIds: ['b', 'a'], note: '少飯' }));
    const second = addToCart(base({ optionIds: ['a', 'b'], note: '少飯', quantity: 2 }));
    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(useCartStore.getState().lines[0]?.quantity).toBe(3);
    expect(second).toMatchObject({ ok: true, added: 2 });
  });

  it('備註不同為不同行', () => {
    addToCart(base({ note: 'A' }));
    addToCart(base({ note: 'B' }));
    expect(useCartStore.getState().lines).toHaveLength(2);
  });

  it('合併後超過單行 20 份：只加入剩餘空間並回報實際份數', () => {
    addToCart(base({ quantity: 18 }));
    const result = addToCart(base({ quantity: 5 }));
    expect(result).toMatchObject({ ok: true, added: 2, requested: 5 });
    expect(useCartStore.getState().lines[0]?.quantity).toBe(20);
  });

  it('該行已達 20 份：QUANTITY_LIMIT', () => {
    addToCart(base({ quantity: 20 }));
    expect(addToCart(base())).toEqual({ ok: false, reason: 'QUANTITY_LIMIT' });
  });

  it('剩餘份數上限（扣除購物車內同商品所有行）：夾到可加入量，已占滿時 STOCK_LIMIT', () => {
    addToCart(base({ optionIds: ['x'], quantity: 2, remaining: 3 }));
    const partial = addToCart(base({ quantity: 5, remaining: 3 }));
    expect(partial).toMatchObject({ ok: true, added: 1, requested: 5 });
    expect(addToCart(base({ optionIds: ['y'], remaining: 3 }))).toEqual({
      ok: false,
      reason: 'STOCK_LIMIT',
      remaining: 3,
    });
  });

  it('剩餘份數省略（未提供）不預先限制', () => {
    expect(addToCart(base({ remaining: undefined, quantity: 20 }))).toMatchObject({
      ok: true,
      added: 20,
    });
  });

  it('品項行數已達 30 行：LINE_LIMIT，但合併既有行不受影響', () => {
    for (let i = 0; i < 30; i += 1) addToCart(base({ productId: `p${i}`, name: `品項${i}` }));
    expect(addToCart(base({ productId: 'new' }))).toEqual({ ok: false, reason: 'LINE_LIMIT' });
    expect(addToCart(base({ productId: 'p3' }))).toMatchObject({ ok: true, added: 1 });
    expect(useCartStore.getState().lines).toHaveLength(30);
  });
});

describe('undoAdd', () => {
  it('把本次加入的數量扣回；歸零則移除該行', () => {
    const first = addToCart(base({ quantity: 2 }));
    const second = addToCart(base({ quantity: 3 }));
    if (!first.ok || !second.ok) throw new Error('unexpected');
    expect(undoAdd(second)).toBe(true);
    expect(useCartStore.getState().lines[0]?.quantity).toBe(2);
    expect(undoAdd(first)).toBe(true);
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it('該行已不存在時回傳 false', () => {
    const added = addToCart(base());
    if (!added.ok) throw new Error('unexpected');
    useCartStore.getState().clear();
    expect(undoAdd(added)).toBe(false);
  });
});
