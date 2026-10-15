// src/features/orders/useOrderPolling.ts —— 訂單詳情查詢與輪詢（07 §7.1、§8；FLOW-16）
//
// · 存取：會員本人，或 `guestOrders` 內有此訂單的追蹤權杖；兩者皆無 → 直接判定「找不到訂單」（不打 API）。
// · 輪詢：非終態，或終態但退款進行中（payment.status = REFUNDING），且頁面可見時每 5 秒；
//   頁面隱藏即暫停，回到前景立即更新（視窗取得焦點時重抓）。
// · 404 取回（BR-27、EC-36）：以權杖存取回 404（權杖已被較晚簽發者取代）時，先以記下的訂單編號與手機
//   呼叫 `orders.lookup` 換新權杖並重試一次，期間維持原畫面、不閃現錯誤；仍失敗才回報 notFound、停止輪詢。
//   手機取自同一次載入內已取得的 `order.customer.phone`（Query 快取），取不到時改取已勾選「記住我的資料」的
//   `prefs.guestProfile.phone`。
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ID, Order } from '@/domain/types';
import { isNotFoundError, readApiError } from '@/features/auth/errorInfo';
import { selectIsLoggedIn, useSessionStore } from '@/features/auth/sessionStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { useApi } from '@/hooks/useApi';
import { usePageVisibility } from '@/hooks/usePageVisibility';
import type { ApiClient } from '@/services/api/ApiClient';
import { qk } from '@/services/api/queryKeys';
import { useGuestOrdersStore } from './guestOrdersStore';
import { shouldPoll } from './orderView';

export const ORDER_POLL_INTERVAL_MS = 5000;

/** 取得訂單；以權杖存取遇到 404 時換發新權杖並重試一次（FLOW-16） */
export async function fetchOrderWithRecovery(
  api: ApiClient,
  queryClient: QueryClient,
  orderId: ID,
): Promise<Order> {
  const guests = useGuestOrdersStore.getState();
  const token = guests.tokenFor(orderId);
  try {
    return await api.orders.get(orderId, token !== null ? { trackingToken: token } : undefined);
  } catch (error) {
    if (token === null || !isNotFoundError(error)) throw error;

    const ref = guests.orders.find((o) => o.orderId === orderId);
    const cached = queryClient.getQueryData<Order>(qk.orders.detail(orderId));
    const phone = cached?.customer?.phone ?? usePrefsStore.getState().guestProfile?.phone ?? null;
    if (ref === undefined || phone === null || phone === '') throw error;

    let fresh: { orderId: ID; trackingToken: string };
    try {
      fresh = await api.orders.lookup(ref.orderNo, phone);
    } catch (lookupError) {
      // 查無資料 → 維持原本的「找不到訂單」；限流等暫時性錯誤原樣回報，頁面可重試
      throw isNotFoundError(lookupError) ? error : lookupError;
    }
    useGuestOrdersStore.getState().updateToken(orderId, fresh.trackingToken);
    // 只重試一次；失敗直接丟出，不無限重試
    return api.orders.get(orderId, { trackingToken: fresh.trackingToken });
  }
}

export interface UseOrderPollingOptions {
  /** 輪詢間隔（毫秒），預設 5000 */
  intervalMs?: number;
}

export interface UseOrderPolling {
  order: Order | undefined;
  /** 尚無資料且載入中 */
  isLoading: boolean;
  /** 手動或輪詢更新進行中 */
  isRefreshing: boolean;
  /** 確認找不到（無權存取、換發權杖後仍 404） */
  notFound: boolean;
  /** 其他錯誤；已有資料時代表背景更新失敗（畫面保留舊資料） */
  error: unknown;
  /** 目前是否正在輪詢（頁面可見且訂單尚未結束） */
  polling: boolean;
  /** 立即更新（「立即更新」按鈕、快速鍵 u、重試） */
  refresh: () => Promise<void>;
}

export function useOrderPolling(
  orderId: ID,
  { intervalMs = ORDER_POLL_INTERVAL_MS }: UseOrderPollingOptions = {},
): UseOrderPolling {
  const api = useApi();
  const queryClient = useQueryClient();
  const visible = usePageVisibility();
  const isLoggedIn = useSessionStore(selectIsLoggedIn);
  const hasToken = useGuestOrdersStore((s) => s.orders.some((o) => o.orderId === orderId));
  const canAccess = isLoggedIn || hasToken;

  const query = useQuery<Order>({
    queryKey: qk.orders.detail(orderId),
    enabled: canAccess,
    // GET 的網路 / 5xx 重試已由 Adapter 處理（FLOW-15），這裡不再疊加
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: () => fetchOrderWithRecovery(api, queryClient, orderId),
    refetchInterval: (q) => {
      if (!visible) return false;
      if (q.state.error !== null && isNotFoundError(q.state.error)) return false;
      return shouldPoll(q.state.data) ? intervalMs : false;
    },
  });

  const refetch = query.refetch;
  const refresh = useCallback(async (): Promise<void> => {
    await refetch();
  }, [refetch]);

  const notFound = !canAccess || (query.isError && isNotFoundError(query.error));
  const order = canAccess ? query.data : undefined;
  const polling = visible && !notFound && shouldPoll(order);

  return {
    order,
    isLoading: canAccess && query.isPending && !notFound,
    isRefreshing: query.isFetching,
    notFound,
    error: query.isError && !isNotFoundError(query.error) ? query.error : null,
    polling,
    refresh,
  };
}

/** 供錯誤訊息使用：取出 requestId */
export function requestIdOf(error: unknown): string | null {
  return readApiError(error).requestId;
}
