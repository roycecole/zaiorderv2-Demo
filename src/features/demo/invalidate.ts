// src/features/demo/invalidate.ts —— Demo 寫入後讓前台立即反映（FR-DM-04～06、09～12）
import type { QueryClient } from '@tanstack/react-query';
import { qk } from '@/services/api/queryKeys';

/** menu / product / pickup-slots / store status（皆在 ['store']）+ quote + orders */
export function invalidateDemoQueries(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.store.all }),
    queryClient.invalidateQueries({ queryKey: ['quote'] }),
    queryClient.invalidateQueries({ queryKey: qk.orders.all }),
  ]).then(() => undefined);
}

/** 登入狀態改變後：會員資料與訂單 */
export function invalidateAccountQueries(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.me.all }),
    queryClient.invalidateQueries({ queryKey: qk.orders.all }),
  ]).then(() => undefined);
}
