// src/services/api/queryKeys.ts —— TanStack Query 鍵的唯一來源（失效與預先載入皆由此取用）
import type { ID, OrderType, UserCouponStatus } from '@/domain/types';

export const qk = {
  store: {
    all: ['store'] as const,
    info: () => ['store', 'info'] as const,
    status: () => ['store', 'status'] as const,
    menu: () => ['store', 'menu'] as const,
    product: (productId: ID) => ['store', 'product', productId] as const,
    banners: () => ['store', 'banners'] as const,
    pickupSlots: (orderType: OrderType, zipCode?: string) =>
      ['store', 'pickup-slots', orderType, zipCode ?? ''] as const,
    deliveryZones: () => ['store', 'delivery-zones'] as const,
    checkDelivery: (zipCode: string) => ['store', 'check-delivery', zipCode] as const,
    table: (qrToken: string) => ['store', 'table', qrToken] as const,
  },
  /** 報價：請求內容即鍵；staleTime 為 0，鍵相同亦會重打（07 §7.1） */
  quote: (requestKey: string) => ['quote', requestKey] as const,
  orders: {
    all: ['orders'] as const,
    list: (tab: 'active' | 'completed' | 'cancelled') => ['orders', 'list', tab] as const,
    detail: (orderId: ID) => ['orders', 'detail', orderId] as const,
  },
  me: {
    all: ['me'] as const,
    profile: () => ['me', 'profile'] as const,
    addresses: () => ['me', 'addresses'] as const,
    favorites: () => ['me', 'favorites'] as const,
    coupons: (status?: UserCouponStatus) => ['me', 'coupons', status ?? 'ALL'] as const,
    frequentItems: () => ['me', 'frequent-items'] as const,
  },
} as const;
