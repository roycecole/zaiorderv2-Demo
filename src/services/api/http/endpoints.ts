// src/services/api/http/endpoints.ts —— 路徑與查詢字串（06 §2、§5）
//
// 路徑區段一律 encodeURIComponent：ID 為不透明字串（06 §1.2），qrToken 亦可能含特殊字元。

/** 路徑區段編碼 */
export const seg = (value: string): string => encodeURIComponent(value);

export type QueryValue = string | number | boolean | null | undefined;

/** 編碼查詢字串：略過 undefined / null / 空字串；鍵依傳入順序輸出（結果可預期，便於測試與快取） */
export function toQueryString(query: Record<string, QueryValue> | undefined): string {
  if (query === undefined) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/** `baseUrl`（可含或不含結尾斜線）＋ 路徑 ＋ 查詢字串 */
export function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, QueryValue>,
): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}${toQueryString(query)}`;
}

/** 認證端點（06 §2.1）：公開，不帶 Authorization */
export const AUTH_PATHS = {
  sendOtp: '/auth/otp/send',
  verifyOtp: '/auth/otp/verify',
  refresh: '/auth/refresh',
  logout: '/auth/logout',
} as const;

/** 店家與菜單、訂單建立（以 `/stores/{storeSlug}` 為前綴；06 §2.2、§2.3） */
export function storePaths(storeSlug: string) {
  const root = `/stores/${seg(storeSlug)}`;
  return {
    info: root,
    status: `${root}/status`,
    menu: `${root}/menu`,
    product: (productId: string) => `${root}/products/${seg(productId)}`,
    banners: `${root}/banners`,
    pickupSlots: `${root}/pickup-slots`,
    deliveryZones: `${root}/delivery-zones`,
    deliveryCheck: `${root}/delivery-check`,
    table: (qrToken: string) => `${root}/tables/${seg(qrToken)}`,
    quote: `${root}/orders/quote`,
    createOrder: `${root}/orders`,
  } as const;
}

/** 訂單（不在店家前綴下；06 §2.3） */
export const ORDER_PATHS = {
  list: '/orders',
  lookup: '/orders/lookup',
  byId: (orderId: string) => `/orders/${seg(orderId)}`,
  cancel: (orderId: string) => `/orders/${seg(orderId)}/cancel`,
  payments: (orderId: string) => `/orders/${seg(orderId)}/payments`,
} as const;

/** 會員（06 §2.4） */
export const ME_PATHS = {
  root: '/me',
  addresses: '/me/addresses',
  address: (id: string) => `/me/addresses/${seg(id)}`,
  favorites: '/me/favorites',
  favorite: (productId: string) => `/me/favorites/${seg(productId)}`,
  coupons: '/me/coupons',
  frequentItems: '/me/frequent-items',
} as const;

/** 追蹤權杖標頭（06 §1.3、§1.4） */
export const TRACKING_TOKEN_HEADER = 'X-Tracking-Token';
/** 冪等鍵標頭（06 §1.4；`POST /orders` 必填） */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
