// BR-31 菜單版面：優先序（使用者 > 店家 > AUTO）、AUTO 50% 門檻、圖片區呈現（03 §6.7）
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { IMAGE_RATIO_THRESHOLD, cardMedia, imageRatio, resolveMenuLayout } from '../menuLayout';

const products = (n: number, withImage: number) =>
  Array.from({ length: n }, (_, i) => ({ imageUrl: i < withImage ? '/x.jpg' : undefined }));

describe('imageRatio', () => {
  it('空菜單為 0；null / 空字串 / undefined 視為無圖', () => {
    expect(imageRatio([])).toBe(0);
    expect(imageRatio([{ imageUrl: null }, { imageUrl: '' }, {}, { imageUrl: '/a.jpg' }])).toBe(
      0.25,
    );
  });
  it('全部有圖為 1', () => {
    expect(imageRatio(products(4, 4))).toBe(1);
  });
});

describe('resolveMenuLayout', () => {
  it('門檻為 50%', () => {
    expect(IMAGE_RATIO_THRESHOLD).toBe(0.5);
  });

  it('AUTO：有圖比例剛好 50% → GRID；不足 → LIST；空菜單 → LIST', () => {
    expect(resolveMenuLayout('AUTO', products(10, 5))).toBe('GRID');
    expect(resolveMenuLayout('AUTO', products(10, 4))).toBe('LIST');
    expect(resolveMenuLayout('AUTO', products(10, 10))).toBe('GRID');
    expect(resolveMenuLayout('AUTO', products(10, 0))).toBe('LIST');
    expect(resolveMenuLayout('AUTO', [])).toBe('LIST');
  });

  it('店家設定 GRID / LIST 優先於有圖比例', () => {
    expect(resolveMenuLayout('GRID', products(10, 0))).toBe('GRID');
    expect(resolveMenuLayout('LIST', products(10, 10))).toBe('LIST');
  });

  it('使用者手動選擇優先於店家設定與 AUTO', () => {
    expect(resolveMenuLayout('GRID', products(10, 10), 'LIST')).toBe('LIST');
    expect(resolveMenuLayout('LIST', products(10, 0), 'GRID')).toBe('GRID');
    expect(resolveMenuLayout('AUTO', products(10, 0), 'GRID')).toBe('GRID');
  });

  it('userOverride 為 null 時不覆寫', () => {
    expect(resolveMenuLayout('AUTO', products(10, 10), null)).toBe('GRID');
  });

  it('08 種子資料：34 項中 17 項有圖（MIXED）恰為 50% → GRID', () => {
    expect(resolveMenuLayout('AUTO', products(34, 17))).toBe('GRID');
    expect(resolveMenuLayout('AUTO', products(34, 16))).toBe('LIST');
  });

  it('性質：AUTO 的結果等價於「有圖比例 ≥ 0.5」', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 60 }), (n, k) => {
        const withImage = Math.min(n, k);
        const layout = resolveMenuLayout('AUTO', products(n, withImage));
        expect(layout).toBe(n > 0 && withImage / n >= 0.5 ? 'GRID' : 'LIST');
      }),
    );
  });
});

describe('cardMedia', () => {
  it('圖卡缺圖 → 佔位圖塊；清單缺圖 → 不顯示', () => {
    expect(cardMedia('GRID', true)).toBe('PHOTO');
    expect(cardMedia('GRID', false)).toBe('PLACEHOLDER');
    expect(cardMedia('LIST', true)).toBe('THUMB');
    expect(cardMedia('LIST', false)).toBe('NONE');
  });
});
