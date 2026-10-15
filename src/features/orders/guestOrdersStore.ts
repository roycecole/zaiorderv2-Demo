// src/features/orders/guestOrdersStore.ts —— 訪客訂單追蹤記錄（最多 10 筆；07 §6.2）
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ID, ISODateTime } from '@/domain/types';
import { appLocalStorage, STORAGE_KEYS } from '@/services/storage/appStorage';

export interface GuestOrderRef {
  orderId: ID;
  orderNo: string;
  trackingToken: string;
  placedAt: ISODateTime;
}

export const MAX_GUEST_ORDERS = 10;

interface GuestOrdersData {
  orders: GuestOrderRef[];
}

interface GuestOrdersActions {
  /** 新增或更新（同 orderId 以新權杖取代：BR-27 重新簽發後舊權杖失效）；超過 10 筆時淘汰最舊者 */
  upsert(ref: GuestOrderRef): void;
  updateToken(orderId: ID, trackingToken: string): void;
  remove(orderId: ID): void;
  tokenFor(orderId: ID): string | null;
  clear(): void;
}

export const useGuestOrdersStore = create<GuestOrdersData & GuestOrdersActions>()(
  persist(
    (set, get) => ({
      orders: [],
      upsert: (ref) => {
        const others = get().orders.filter((o) => o.orderId !== ref.orderId);
        set({ orders: [ref, ...others].slice(0, MAX_GUEST_ORDERS) });
      },
      updateToken: (orderId, trackingToken) =>
        set({ orders: get().orders.map((o) => (o.orderId === orderId ? { ...o, trackingToken } : o)) }),
      remove: (orderId) => set({ orders: get().orders.filter((o) => o.orderId !== orderId) }),
      tokenFor: (orderId) => get().orders.find((o) => o.orderId === orderId)?.trackingToken ?? null,
      clear: () => set({ orders: [] }),
    }),
    {
      name: STORAGE_KEYS.guestOrders,
      version: 1,
      storage: createJSONStorage(() => appLocalStorage),
      partialize: (s) => ({ orders: s.orders }),
    },
  ),
);
