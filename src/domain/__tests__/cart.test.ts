// BR-13：購物車合併鍵與限制；FR-CT-04：24 小時過期
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CART_TTL_MS, MAX_LINES, MAX_QTY_PER_LINE, cartLineKey, isCartExpired } from '../cart';

describe('常數（BR-13）', () => {
  it('單行 ≤ 20 份、品項行數 ≤ 30、24 小時過期', () => {
    expect(MAX_QTY_PER_LINE).toBe(20);
    expect(MAX_LINES).toBe(30);
    expect(CART_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('cartLineKey（合併鍵 = 商品 + 排序後選項 + 備註）', () => {
  it('選項順序無關、備註去前後空白', () => {
    const a = cartLineKey({ productId: 'p', optionIds: ['b', 'a'], note: ' 不要蔥 ' });
    const b = cartLineKey({ productId: 'p', optionIds: ['a', 'b'], note: '不要蔥' });
    expect(a).toBe(b);
  });

  it('備註省略與空字串、純空白視為相同', () => {
    const none = cartLineKey({ productId: 'p', optionIds: ['a'] });
    expect(cartLineKey({ productId: 'p', optionIds: ['a'], note: '' })).toBe(none);
    expect(cartLineKey({ productId: 'p', optionIds: ['a'], note: '   ' })).toBe(none);
  });

  it('有備註與無備註不同；商品、選項、備註任一不同則鍵不同', () => {
    const base = cartLineKey({ productId: 'p', optionIds: ['a', 'b'], note: '不要蔥' });
    expect(cartLineKey({ productId: 'p', optionIds: ['a', 'b'] })).not.toBe(base);
    expect(cartLineKey({ productId: 'q', optionIds: ['a', 'b'], note: '不要蔥' })).not.toBe(base);
    expect(cartLineKey({ productId: 'p', optionIds: ['a'], note: '不要蔥' })).not.toBe(base);
    expect(cartLineKey({ productId: 'p', optionIds: ['a', 'b'], note: '少蔥' })).not.toBe(base);
  });

  it('備註中間的空白保留（只去前後）', () => {
    expect(cartLineKey({ productId: 'p', optionIds: [], note: '少 冰' })).not.toBe(
      cartLineKey({ productId: 'p', optionIds: [], note: '少冰' }),
    );
  });

  it('不改動輸入的 optionIds 順序', () => {
    const optionIds = ['z', 'a', 'm'];
    cartLineKey({ productId: 'p', optionIds });
    expect(optionIds).toEqual(['z', 'a', 'm']);
  });

  describe('性質測試', () => {
    const idArb = fc.stringMatching(/^[a-z0-9_]{1,10}$/);
    const noteArb = fc.option(fc.string({ maxLength: 12 }), { nil: undefined });

    it('任意排列的選項得到相同的鍵', () => {
      fc.assert(
        fc.property(
          idArb,
          fc.uniqueArray(idArb, { maxLength: 6 }),
          noteArb,
          fc.nat(),
          (productId, optionIds, note, seed) => {
            const shuffled = [...optionIds];
            // 以 seed 做確定性的洗牌
            let s = seed + 1;
            for (let i = shuffled.length - 1; i > 0; i--) {
              s = (s * 1103515245 + 12345) % 2147483648;
              const j = s % (i + 1);
              const tmp = shuffled[i] as string;
              shuffled[i] = shuffled[j] as string;
              shuffled[j] = tmp;
            }
            expect(cartLineKey({ productId, optionIds: shuffled, note })).toBe(
              cartLineKey({ productId, optionIds, note }),
            );
          },
        ),
      );
    });

    it('備註前後加空白不改變鍵', () => {
      fc.assert(
        fc.property(
          idArb,
          fc.array(idArb, { maxLength: 4 }),
          fc.string({ maxLength: 10 }),
          (productId, optionIds, note) => {
            expect(cartLineKey({ productId, optionIds, note: `  ${note}\t ` })).toBe(
              cartLineKey({ productId, optionIds, note }),
            );
          },
        ),
      );
    });

    it('不同的（商品、選項集合、去空白備註）得到不同的鍵', () => {
      fc.assert(
        fc.property(
          idArb,
          fc.uniqueArray(idArb, { maxLength: 4 }),
          noteArb,
          idArb,
          fc.uniqueArray(idArb, { maxLength: 4 }),
          noteArb,
          (p1, o1, n1, p2, o2, n2) => {
            const same =
              p1 === p2 &&
              [...o1].sort().join(',') === [...o2].sort().join(',') &&
              (n1 ?? '').trim() === (n2 ?? '').trim();
            const k1 = cartLineKey({ productId: p1, optionIds: o1, note: n1 });
            const k2 = cartLineKey({ productId: p2, optionIds: o2, note: n2 });
            expect(k1 === k2).toBe(same);
          },
        ),
      );
    });
  });
});

describe('isCartExpired（FR-CT-04）', () => {
  it('恰滿 24 小時尚未過期，多 1 ms 即過期', () => {
    expect(isCartExpired({ updatedAt: 0 }, CART_TTL_MS)).toBe(false);
    expect(isCartExpired({ updatedAt: 0 }, CART_TTL_MS + 1)).toBe(true);
  });

  it('剛更新、時鐘落後（updatedAt 在未來）皆未過期', () => {
    expect(isCartExpired({ updatedAt: 1000 }, 1000)).toBe(false);
    expect(isCartExpired({ updatedAt: 5000 }, 1000)).toBe(false);
  });

  it('以傳入的 nowMs 為準，不讀系統時鐘', () => {
    const updatedAt = Date.parse('2026-10-14T12:00:00+08:00');
    expect(isCartExpired({ updatedAt }, updatedAt + 23 * 3_600_000)).toBe(false);
    expect(isCartExpired({ updatedAt }, updatedAt + 25 * 3_600_000)).toBe(true);
  });
});
