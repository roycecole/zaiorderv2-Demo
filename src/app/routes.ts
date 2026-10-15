// src/app/routes.ts —— 路由表（與 03 §3.2 一致）
export const ROUTES = {
  home: '/',
  cart: '/cart',
  checkout: '/checkout',
  payment: (orderId: string) => `/payment/${orderId}`,
  order: (orderId: string) => `/orders/${orderId}`,
  orders: '/orders',
  orderLookup: '/orders/lookup',
  login: '/login',
  account: '/account',
  accountProfile: '/account/profile',
  accountAddresses: '/account/addresses',
  accountFavorites: '/account/favorites',
  accountCoupons: '/account/coupons',
  store: '/store',
  privacy: '/privacy',
  terms: '/terms',
} as const;
