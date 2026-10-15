// src/features/orders/invalidate.ts —— 訂單異動後重新載入歷史訂單清單（各分頁）
import type { QueryClient } from '@tanstack/react-query';
import { qk } from '@/services/api/queryKeys';

const TABS = ['active', 'completed', 'cancelled'] as const;

/** 取消、付款、再來一單等動作之後呼叫：三個分頁的清單都可能受影響 */
export function invalidateOrderLists(queryClient: QueryClient): void {
  for (const tab of TABS) void queryClient.invalidateQueries({ queryKey: qk.orders.list(tab) });
}
