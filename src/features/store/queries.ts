// src/features/store/queries.ts —— 店家 / 菜單 / 商品的共用查詢 hooks（07 §7.1 更新策略）
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ID } from '@/domain/types';
import { useApi } from '@/hooks/useApi';
import { qk } from '@/services/api/queryKeys';

const MINUTE = 60_000;

/** 店家資訊：staleTime 5 分 */
export function useStoreInfo() {
  const api = useApi();
  return useQuery({
    queryKey: qk.store.info(),
    queryFn: () => api.store.getInfo(),
    staleTime: 5 * MINUTE,
  });
}

/** 營業狀態：每 60 秒更新並於視窗取得焦點時重抓（FR-ST-08） */
export function useStoreStatus() {
  const api = useApi();
  return useQuery({
    queryKey: qk.store.status(),
    queryFn: () => api.store.getStatus(),
    staleTime: 30_000,
    refetchInterval: MINUTE,
    refetchOnWindowFocus: true,
  });
}

/** 菜單：staleTime 60 秒；換版期間保留舊資料避免畫面閃爍 */
export function useMenu() {
  const api = useApi();
  return useQuery({
    queryKey: qk.store.menu(),
    queryFn: () => api.store.getMenu(),
    staleTime: MINUTE,
    placeholderData: keepPreviousData,
  });
}

/** 商品詳情（含選項群組）；`productId` 為 null 時不查詢 */
export function useProduct(productId: ID | null) {
  const api = useApi();
  return useQuery({
    queryKey: qk.store.product(productId ?? ''),
    queryFn: () => api.store.getProduct(productId as ID),
    enabled: productId !== null,
    staleTime: MINUTE,
  });
}

export function useBanners() {
  const api = useApi();
  return useQuery({
    queryKey: qk.store.banners(),
    queryFn: () => api.store.getBanners(),
    staleTime: 5 * MINUTE,
  });
}

/** 外送範圍（PG-15）：staleTime 5 分；`enabled` 為 false（店家未開放外送）時不查詢 */
export function useDeliveryZones(enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: qk.store.deliveryZones(),
    queryFn: () => api.store.getDeliveryZones(),
    enabled,
    staleTime: 5 * MINUTE,
  });
}
