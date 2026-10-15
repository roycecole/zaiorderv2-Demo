// src/domain/menuLayout.ts
export type MenuLayout = 'AUTO' | 'GRID' | 'LIST';
export type ResolvedLayout = 'GRID' | 'LIST';
export type CardMedia = 'PHOTO' | 'PLACEHOLDER' | 'THUMB' | 'NONE';

/** AUTO 模式下，有圖商品佔比達此門檻才採用圖卡版面 */
export const IMAGE_RATIO_THRESHOLD = 0.5;

export function imageRatio(products: ReadonlyArray<{ imageUrl?: string | null }>): number {
  if (products.length === 0) return 0;
  const withImage = products.filter((p) => !!p.imageUrl).length;
  return withImage / products.length;
}

/** 使用者手動切換（userOverride）優先，其次店家設定，AUTO 依有圖比例決定 */
export function resolveMenuLayout(
  setting: MenuLayout,
  products: ReadonlyArray<{ imageUrl?: string | null }>,
  userOverride: ResolvedLayout | null = null,
): ResolvedLayout {
  if (userOverride) return userOverride;
  if (setting === 'GRID' || setting === 'LIST') return setting;
  return imageRatio(products) >= IMAGE_RATIO_THRESHOLD ? 'GRID' : 'LIST';
}

/** 單一商品卡的圖片區呈現：圖卡缺圖用佔位圖塊維持版面節奏；清單缺圖則整個不顯示 */
export function cardMedia(layout: ResolvedLayout, hasImage: boolean): CardMedia {
  if (layout === 'GRID') return hasImage ? 'PHOTO' : 'PLACEHOLDER';
  return hasImage ? 'THUMB' : 'NONE';
}
