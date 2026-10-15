// src/services/api/mock/seed/index.ts —— 唯讀種子（stores、store_*、categories、products、options、banners、delivery_zones、coupons）
// 每次啟動以程式產生，日期皆相對於啟動當下的 clock.now()（07 §6.1）：確保 Demo 隨時有可展示的特殊公休日與優惠期間。
import { env } from '@/config/env';
import type { BusinessHour, SpecialDay } from '@/domain/types';
import { CATEGORIES, OPTION_GROUPS, PRODUCTS } from './menu';
import type { SeedCategory, SeedOptionGroup, SeedProduct } from './menu';
import {
  BANNERS, BUSINESS_HOURS, DELIVERY_ZONES, PAYMENT_METHODS, SETTINGS_SEED, TABLES,
  buildCoupons, buildSpecialDays, buildStoreSeed,
} from './store';
import type {
  BannerSeed, CouponSeed, SettingsSeed, StoreSeed, TableSeed, ZoneSeed,
} from './store';

export interface StaticSeed {
  /** 播種時間（epoch ms）：特殊公休日、優惠期間皆相對於此 */
  anchorMs: number;
  store: StoreSeed;
  settings: SettingsSeed;
  businessHours: BusinessHour[];
  specialDays: SpecialDay[];
  zones: ZoneSeed[];
  tables: TableSeed[];
  paymentMethods: typeof PAYMENT_METHODS;
  banners: BannerSeed[];
  categories: SeedCategory[];
  optionGroups: SeedOptionGroup[];
  products: SeedProduct[];
  coupons: CouponSeed[];
}

export function buildStaticSeed(slug: string, anchorMs: number): StaticSeed {
  return {
    anchorMs,
    store: buildStoreSeed(slug),
    settings: { ...SETTINGS_SEED },
    businessHours: BUSINESS_HOURS.map((h) => ({ ...h })),
    specialDays: buildSpecialDays(anchorMs),
    zones: DELIVERY_ZONES.map((z) => ({ ...z })),
    tables: TABLES.map((t) => ({ ...t })),
    paymentMethods: [...PAYMENT_METHODS],
    banners: BANNERS.map((b) => ({ ...b })),
    categories: CATEGORIES.map((c) => ({ ...c })),
    optionGroups: OPTION_GROUPS,
    products: PRODUCTS,
    coupons: buildCoupons(anchorMs),
  };
}

/**
 * 圖片 / 靜態資源路徑：public/images 下的相對路徑 → 網站路徑（尊重 VITE_APP_BASE_PATH 的子路徑部署）。
 * 預設 base 為 "/"，結果為 "/images/products/lurou.svg"。
 */
export function imageUrl(path: string, basePath: string = env.basePath): string {
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return `${base}images/${path}`;
}

export { SEED_SOLD_OUT_IDS } from './menu';
export { DEMO_PHONE, DEMO_USER_ID, DB_SCHEMA_VERSION, createEmptyDbData, createInitialDbData } from './members';
export { STORE_ID } from './store';
