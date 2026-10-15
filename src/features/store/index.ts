// src/features/store/index.ts —— 店家功能的對外介面
// 注意：外殼（app/layouts）請直接引用各檔案，避免把 StorePage 一併打進主 chunk（頁面由路由器 lazy 載入）。
export { announcementId, AnnouncementBanner } from './AnnouncementBanner';
export { applyTheme } from './applyTheme';
export {
  useBanners,
  useDeliveryZones,
  useMenu,
  useProduct,
  useStoreInfo,
  useStoreStatus,
} from './queries';
export { StoreBrand } from './StoreBrand';
export type { StoreBrandProps } from './StoreBrand';
export { StoreHeader } from './StoreHeader';
export type { StoreHeaderProps } from './StoreHeader';
export { StorePage } from './StorePage';
export { StoreStatusBadge } from './StoreStatusBadge';
export type { StoreStatusBadgeProps } from './StoreStatusBadge';
export { describeNextOpen, describeStoreStatus, formatHoursSpan } from './storeStatusText';
export type { StoreStatusView } from './storeStatusText';
export { ThemeProvider } from './ThemeProvider';
export type { ThemeProviderProps } from './ThemeProvider';
