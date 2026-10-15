// src/features/account/useFavorites.ts —— 我的最愛（FR-AC-05）：供菜單的收藏心形與 PG-13 共用
//
// · 會員：`me.favorites` 查詢，收藏 / 取消收藏為樂觀更新，失敗時回復並以 Toast 說明（03 §8.1）；
// · 訪客：`isAvailable = false`，呼叫 `toggle` 只顯示可略過的 Toast「登入後可收藏喜愛的餐點」（含「登入」動作），
//   不影響加入購物車（BR-33）；`toggle` 已自行提示，呼叫端不需再顯示同一則 Toast；
// · 觸控面板模式：沒有「我的最愛」入口，`isAvailable = false` 且 `toggle` 不動作。
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useToast } from '@/components';
import type { ID } from '@/domain/types';
import { selectIsLoggedIn, useSessionStore } from '@/features/auth/sessionStore';
import { buildLoginUrl } from '@/features/auth/safeRedirect';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { useApi } from '@/hooks/useApi';
import { account as tAccount } from '@/i18n/strings/account';
import { qk } from '@/services/api/queryKeys';

export interface UseFavorites {
  /** 可以收藏（已登入且非觸控面板）；訪客為 false，菜單仍可顯示愛心，點擊時提示登入 */
  isAvailable: boolean;
  isLoading: boolean;
  isError: boolean;
  /** 已收藏的商品 ID（訪客為空集合） */
  productIds: ReadonlySet<ID>;
  isFavorite: (productId: ID) => boolean;
  /** 收藏 / 取消收藏；訪客改為顯示登入提示 */
  toggle: (productId: ID) => Promise<void>;
  refetch: () => Promise<void>;
}

interface FavoritesData {
  productIds: ID[];
}

export function useFavorites(): UseFavorites {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const isLoggedIn = useSessionStore(selectIsLoggedIn);
  const kiosk = useIsKioskUi();
  const isAvailable = isLoggedIn && !kiosk;

  const query = useQuery({
    queryKey: qk.me.favorites(),
    queryFn: () => api.me.favorites.list(),
    enabled: isAvailable,
    staleTime: 60_000,
  });

  const productIds = useMemo<ReadonlySet<ID>>(
    () => new Set(isAvailable ? (query.data?.productIds ?? []) : []),
    [isAvailable, query.data],
  );

  const toggle = useCallback(
    async (productId: ID): Promise<void> => {
      if (kiosk) return;
      if (!isLoggedIn) {
        const target = `${location.pathname}${location.search}`;
        toast({
          id: 'favorite-login',
          message: tAccount.favorites.loginToFavorite,
          tone: 'info',
          action: {
            label: tAccount.favorites.login,
            onAction: () => navigate(buildLoginUrl(target)),
          },
        });
        return;
      }

      const key = qk.me.favorites();
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<FavoritesData>(key);
      const current = previous?.productIds ?? [];
      const has = current.includes(productId);
      queryClient.setQueryData<FavoritesData>(key, {
        productIds: has ? current.filter((id) => id !== productId) : [...current, productId],
      });
      try {
        if (has) await api.me.favorites.remove(productId);
        else await api.me.favorites.add(productId);
      } catch {
        // 樂觀更新失敗：回復並說明
        if (previous !== undefined) queryClient.setQueryData<FavoritesData>(key, previous);
        toast({
          message: has ? tAccount.favorites.removeFailed : tAccount.favorites.addFailed,
          tone: 'error',
        });
      } finally {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    [api, isLoggedIn, kiosk, location.pathname, location.search, navigate, queryClient, toast],
  );

  const isFavorite = useCallback((productId: ID): boolean => productIds.has(productId), [productIds]);

  const refetch = query.refetch;
  const refresh = useCallback(async (): Promise<void> => {
    await refetch();
  }, [refetch]);

  return {
    isAvailable,
    isLoading: isAvailable && query.isPending,
    isError: isAvailable && query.isError,
    productIds,
    isFavorite,
    toggle,
    refetch: refresh,
  };
}
