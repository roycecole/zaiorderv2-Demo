// src/services/api/mock/menuProfile.ts
import type { Menu, ProductDetail, ProductSummary } from '@/domain/types';

/**
 * Demo 用：把完整菜單降級，以驗證「缺圖 / 無選項」的呈現（FR-DM-09）。
 * FULL 完整；MIXED 約半數缺圖；NO_IMAGES 全無圖；MINIMAL 只剩品名與價格。
 */
export type MenuProfile = 'FULL' | 'MIXED' | 'NO_IMAGES' | 'MINIMAL';

function withoutImage<T extends ProductSummary>(p: T): T {
  const copy = { ...p };
  delete copy.imageUrl;
  return copy;
}

function minimalize<T extends ProductSummary>(p: T): T {
  const copy = withoutImage(p);
  delete copy.description;
  delete copy.remainingToday;
  return {
    ...copy,
    // 精簡菜單不顯示「剩 n 份」：先把「可購買量為 0」折進 isSoldOut，再移除 remainingToday（FR-DM-09）
    isSoldOut: p.isSoldOut || p.remainingToday === 0,
    tags: [],
    allergens: [],
    displayPrice: p.basePrice,
    isPriceFrom: false,
    hasRequiredOptions: false,
  };
}

/** 以商品 ID 決定 MIXED 是否保留圖片：同一商品在清單與詳情必定一致 */
function keepsImageInMixed(id: string): boolean {
  let sum = 0;
  for (const ch of id) sum += ch.charCodeAt(0);
  return sum % 2 === 0;
}

function applyToSummary<T extends ProductSummary>(p: T, profile: MenuProfile): T {
  switch (profile) {
    case 'FULL':
      return p;
    case 'MIXED':
      return keepsImageInMixed(p.id) ? p : withoutImage(p);
    case 'NO_IMAGES':
      return withoutImage(p);
    case 'MINIMAL':
      return minimalize(p);
  }
}

export function applyMenuProfile(menu: Menu, profile: MenuProfile): Menu {
  if (profile === 'FULL') return menu;
  return {
    ...menu,
    categories: menu.categories.map((c) => ({
      ...c,
      products: c.products.map((p) => applyToSummary(p, profile)),
    })),
  };
}

export function applyDetailProfile(detail: ProductDetail, profile: MenuProfile): ProductDetail {
  const base = applyToSummary(detail, profile);
  return profile === 'MINIMAL' ? { ...base, optionGroups: [] } : base;
}

/**
 * 供 evaluateOrder 使用的「目錄視圖」（FR-DM-09）：結構（選項群組為空、單價為 basePrice）依 profile 轉換，
 * 庫存事實（isSoldOut、remainingToday）保留原始值、不經 minimalize 折疊。applyMenuProfile / applyDetailProfile
 * 只是呈現層轉換，其結果不得直接餵給 evaluateOrder（精簡菜單已刪除 remainingToday，會讓限量檢查失效）。
 * 注意：evaluateOrder 的 ProductFacts（listed、manualSoldOut、remaining）由 loadWorld() 依取餐營業日從 db 與 DemoState 計算，
 * 不從 DTO 的合成值還原——DTO 的 isSoldOut 是「手動旗標或當前營業日可購買量為 0」，remainingToday 只代表當前營業日。
 */
export function toCatalogView(detail: ProductDetail, profile: MenuProfile): ProductDetail {
  const view: ProductDetail = { ...applyDetailProfile(detail, profile), isSoldOut: detail.isSoldOut };
  if (detail.remainingToday !== undefined) view.remainingToday = detail.remainingToday;
  return view;
}
