// src/features/menu/menuModel.ts —— 菜單頁的純函式模型：分類區塊、膠囊列項目、搜尋、卡片資料降級（03 §6.7、FLOW-17）
import type { ID, Menu, ProductSummary } from '@/domain/types';

export interface MenuSection {
  id: ID;
  name: string;
  /** 分類圖示（emoji 或短文字）；缺漏時商品的佔位圖塊改用品名首字（§6.7） */
  icon?: string | undefined;
  products: ProductSummary[];
}

/** 沒有商品的分類不顯示（不出現空標題） */
export function buildSections(menu: Menu | undefined): MenuSection[] {
  if (menu === undefined) return [];
  return menu.categories
    .filter((c) => c.products.length > 0)
    .map((c) => ({ id: c.id, name: c.name, icon: c.icon, products: c.products }));
}

export function allProducts(sections: ReadonlyArray<MenuSection>): ProductSummary[] {
  return sections.flatMap((s) => s.products);
}

/** 「熱銷」虛擬分類（FR-MN-05）：tags 含 HOT 的商品；沒有標籤時不顯示此分類 */
export function hotProducts(sections: ReadonlyArray<MenuSection>): ProductSummary[] {
  return allProducts(sections).filter((p) => p.tags.includes('HOT'));
}

export const CHIP_ALL = 'all';
export const CHIP_HOT = 'hot';

export interface ChipItem {
  id: string;
  /** 顯示名稱（不含圖示） */
  name: string;
  icon?: string | undefined;
  count: number;
  /** 快速鍵序號：1–9（不含「全部」；「0」為全部）；超過 9 個分類者為 null（§10.3 快速鍵地圖） */
  hotkey: string | null;
}

/** 膠囊列項目：全部 →（熱銷）→ 各分類；`jumpCategory` 的 1–9 依此順序（不含「全部」） */
export function buildChips(
  sections: ReadonlyArray<MenuSection>,
  hot: ReadonlyArray<ProductSummary>,
  labels: { all: string; hot: string },
  hotIcon: string,
): ChipItem[] {
  const total = allProducts(sections).length;
  const chips: ChipItem[] = [{ id: CHIP_ALL, name: labels.all, count: total, hotkey: '0' }];
  const rest: Array<Omit<ChipItem, 'hotkey'>> = [];
  if (hot.length > 0)
    rest.push({ id: CHIP_HOT, name: labels.hot, icon: hotIcon, count: hot.length });
  for (const s of sections)
    rest.push({ id: s.id, name: s.name, icon: s.icon, count: s.products.length });
  rest.forEach((c, i) => chips.push({ ...c, hotkey: i < 9 ? String(i + 1) : null }));
  return chips;
}

export interface SearchHit {
  product: ProductSummary;
  categoryName: string;
}

/** 搜尋字串正規化：去除前後空白（FR-MN-03）；空字串表示不搜尋 */
export function normalizeQuery(raw: string | null | undefined): string {
  return (raw ?? '').trim();
}

/** 以品名 / 簡述搜尋（不分大小寫）；保留菜單順序，並標示所屬分類（扁平清單，PG-01） */
export function searchMenu(sections: ReadonlyArray<MenuSection>, rawQuery: string): SearchHit[] {
  const q = normalizeQuery(rawQuery).toLocaleLowerCase();
  if (q === '') return [];
  const hits: SearchHit[] = [];
  for (const s of sections) {
    for (const product of s.products) {
      const haystack = `${product.name}\n${product.description ?? ''}`.toLocaleLowerCase();
      if (haystack.includes(q)) hits.push({ product, categoryName: s.name });
    }
  }
  return hits;
}
