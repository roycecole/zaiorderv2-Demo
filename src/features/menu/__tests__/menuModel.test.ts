// 菜單頁純函式：分類區塊、膠囊列項目與快速鍵序號、搜尋
import { describe, expect, it } from 'vitest';
import {
  CHIP_ALL,
  CHIP_HOT,
  buildChips,
  buildSections,
  hotProducts,
  normalizeQuery,
  searchMenu,
} from '../menuModel';
import { menuOf, product } from './fixtures';

const A = product({ id: 'a', name: '招牌滷肉飯', description: '古早味滷肉燥', tags: ['HOT'] });
const B = product({ id: 'b', name: '古早味紅茶', categoryId: 'drink' });
const C = product({ id: 'c', name: '愛玉檸檬', categoryId: 'dessert', tags: ['HOT', 'NEW'] });

const MENU = menuOf(
  { id: 'rice', name: '飯類', icon: '🍚', products: [A] },
  { id: 'empty', name: '空分類', products: [] },
  { id: 'drink', name: '飲品', products: [B] },
  { id: 'dessert', name: '甜點', products: [C] },
);

describe('buildSections', () => {
  it('沒有商品的分類不顯示（不出現空標題）', () => {
    expect(buildSections(MENU).map((s) => s.id)).toEqual(['rice', 'drink', 'dessert']);
    expect(buildSections(undefined)).toEqual([]);
  });
});

describe('buildChips', () => {
  const sections = buildSections(MENU);
  const labels = { all: '全部', hot: '熱銷' };

  it('全部 →（熱銷）→ 各分類；1–9 依序（不含「全部」），0 為全部', () => {
    const chips = buildChips(sections, hotProducts(sections), labels, '🔥');
    expect(chips.map((c) => [c.id, c.hotkey])).toEqual([
      [CHIP_ALL, '0'],
      [CHIP_HOT, '1'],
      ['rice', '2'],
      ['drink', '3'],
      ['dessert', '4'],
    ]);
    expect(chips[0]?.count).toBe(3);
    expect(chips[1]?.count).toBe(2);
  });

  it('沒有 HOT 標籤的商品時不顯示「熱銷」分類（FR-MN-05）', () => {
    const plain = buildSections(menuOf({ id: 'x', name: '飯類', products: [B] }));
    const chips = buildChips(plain, hotProducts(plain), labels, '🔥');
    expect(chips.map((c) => c.id)).toEqual([CHIP_ALL, 'x']);
  });

  it('超過 9 個分類者沒有數字快速鍵', () => {
    const many = buildSections(
      menuOf(
        ...Array.from({ length: 11 }, (_, i) => ({
          id: `c${i}`,
          name: `分類${i}`,
          products: [product({ id: `p${i}`, name: `品項${i}` })],
        })),
      ),
    );
    const chips = buildChips(many, [], labels, '🔥');
    expect(chips[9]?.hotkey).toBe('9');
    expect(chips[10]?.hotkey).toBeNull();
    expect(chips[11]?.hotkey).toBeNull();
  });
});

describe('searchMenu', () => {
  const sections = buildSections(MENU);

  it('比對品名與簡述（不分大小寫、去除前後空白）並保留菜單順序與所屬分類', () => {
    const hits = searchMenu(sections, '  古早味 ');
    expect(hits.map((h) => [h.product.id, h.categoryName])).toEqual([
      ['a', '飯類'],
      ['b', '飲品'],
    ]);
  });

  it('空字串或空白不搜尋', () => {
    expect(searchMenu(sections, '   ')).toEqual([]);
    expect(normalizeQuery('  滷 ')).toBe('滷');
    expect(normalizeQuery(null)).toBe('');
  });
});
