// src/features/demo/useActiveOrders.ts —— 「我的」進行中訂單（訪客本機記錄 + 已登入會員的清單）
import { useQuery } from '@tanstack/react-query';
import { isTerminal } from '@/domain/orderStateMachine';
import type { ID, ISODateTime, Order, OrderStatus, OrderSummary, OrderType } from '@/domain/types';
import { selectIsLoggedIn, useSessionStore } from '@/features/auth/sessionStore';
import { useGuestOrdersStore } from '@/features/orders/guestOrdersStore';
import { useApi } from '@/hooks/useApi';

export interface DemoOrderRef {
  id: ID;
  /** 顯示用的取餐號碼（無則用訂單編號） */
  label: string;
  status: OrderStatus;
  orderType: OrderType;
  placedAt: ISODateTime;
}

const MAX_GUEST_LOOKUPS = 5;
const POLL_MS = 3000;

const fromOrder = (o: Order): DemoOrderRef => ({
  id: o.id,
  label: o.pickupNo !== '' ? o.pickupNo : o.orderNo,
  status: o.status,
  orderType: o.orderType,
  placedAt: o.placedAt,
});

const fromSummary = (o: OrderSummary): DemoOrderRef => ({
  id: o.id,
  label: o.pickupNo !== '' ? o.pickupNo : o.orderNo,
  status: o.status,
  orderType: o.orderType,
  placedAt: o.placedAt,
});

/** 合併、去重、僅保留進行中，最新的在前 */
export function mergeActiveOrders(
  ...lists: ReadonlyArray<ReadonlyArray<DemoOrderRef>>
): DemoOrderRef[] {
  const byId = new Map<ID, DemoOrderRef>();
  for (const list of lists) for (const o of list) if (!byId.has(o.id)) byId.set(o.id, o);
  return [...byId.values()]
    .filter((o) => !isTerminal(o.status))
    .sort((a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt));
}

/**
 * 訪客：以本機記錄的訂單編號與追蹤權杖逐筆讀取（最近 5 筆）；已登入：加上 `orders.list({ tab: 'active' })`。
 * `enabled` 為 false（面板收合或區塊收合）時不查詢也不輪詢。
 */
export function useActiveOrders(enabled: boolean) {
  const api = useApi();
  const guestOrders = useGuestOrdersStore((s) => s.orders);
  const loggedIn = useSessionStore(selectIsLoggedIn);
  const guestKey = guestOrders
    .slice(0, MAX_GUEST_LOOKUPS)
    .map((o) => o.orderId)
    .join(',');

  return useQuery({
    queryKey: ['demo', 'my-orders', guestKey, loggedIn] as const,
    enabled,
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<DemoOrderRef[]> => {
      const guest = await Promise.all(
        guestOrders.slice(0, MAX_GUEST_LOOKUPS).map(async (ref) => {
          try {
            return fromOrder(
              await api.orders.get(ref.orderId, { trackingToken: ref.trackingToken }),
            );
          } catch {
            return null;
          }
        }),
      );
      let member: DemoOrderRef[] = [];
      if (loggedIn) {
        try {
          member = (await api.orders.list({ tab: 'active', limit: 20 })).items.map(fromSummary);
        } catch {
          member = [];
        }
      }
      return mergeActiveOrders(
        guest.filter((o): o is DemoOrderRef => o !== null),
        member,
      );
    },
  });
}
