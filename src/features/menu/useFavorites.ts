// src/features/menu/useFavorites.ts —— 收藏（我的最愛；僅會員，FR-AC-05）
// 樂觀更新，失敗時回復並以 Toast 說明（03 §8.1）；訪客只顯示可略過的登入提示（BR-33），不阻擋任何點餐動作。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useToast } from '@/components';
import type { ID } from '@/domain/types';
import { useAnnounce } from '@/features/a11y';
import { selectIsLoggedIn, useSessionStore } from '@/features/auth/sessionStore';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { useApi } from '@/hooks/useApi';
import { t } from '@/i18n/zh-TW';
import { qk } from '@/services/api/queryKeys';

export interface Favorites {
  /** 會員才有實際的收藏清單；觸控面板模式不提供收藏 */
  isMember: boolean;
  /** 是否提供收藏功能（非觸控面板） */
  available: boolean;
  isFavorite: (productId: ID) => boolean;
  /** 切換收藏；訪客改為顯示「登入後可收藏喜愛的餐點」 */
  toggle: (product: { id: ID; name: string }) => void;
}

interface FavoritesData {
  productIds: ID[];
}

export function useFavorites(): Favorites {
  const api = useApi();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const announce = useAnnounce();
  const kiosk = useIsKioskUi();
  const isMember = useSessionStore(selectIsLoggedIn);
  const key = qk.me.favorites();

  const list = useQuery({
    queryKey: key,
    queryFn: (): Promise<FavoritesData> => api.me.favorites.list(),
    enabled: isMember && !kiosk,
    staleTime: 5 * 60_000,
  });
  const ids = useMemo(() => new Set<ID>(list.data?.productIds ?? []), [list.data]);

  const mutation = useMutation({
    mutationFn: async ({ id, next }: { id: ID; name: string; next: boolean }): Promise<void> => {
      if (next) await api.me.favorites.add(id);
      else await api.me.favorites.remove(id);
    },
    onMutate: async ({ id, next }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<FavoritesData>(key);
      const base = previous?.productIds ?? [];
      const productIds = next
        ? base.includes(id)
          ? base
          : [...base, id]
        : base.filter((x) => x !== id);
      queryClient.setQueryData<FavoritesData>(key, { productIds });
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
      toast({ message: t.menu.favorite.failed, tone: 'error' });
      announce(t.menu.favorite.failed, 'assertive');
    },
    onSuccess: (_data, vars) => {
      announce(vars.next ? t.menu.favorite.added(vars.name) : t.menu.favorite.removed(vars.name));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const toggle = useCallback(
    (product: { id: ID; name: string }): void => {
      if (kiosk) return;
      if (!isMember) {
        toast({ message: t.menu.favorite.loginHint, tone: 'info' });
        announce(t.menu.favorite.loginHint);
        return;
      }
      mutation.mutate({ id: product.id, name: product.name, next: !ids.has(product.id) });
    },
    [kiosk, isMember, ids, mutation, toast, announce],
  );

  const isFavorite = useCallback((productId: ID): boolean => ids.has(productId), [ids]);

  return { isMember, available: !kiosk, isFavorite, toggle };
}
