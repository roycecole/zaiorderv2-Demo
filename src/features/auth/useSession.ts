// src/features/auth/useSession.ts —— 會員 Session 的讀取與登出（07 §7.1）
import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { UserProfile } from '@/domain/types';
import { useApi } from '@/hooks/useApi';
import { qk } from '@/services/api/queryKeys';
import { useSessionStore } from './sessionStore';

/**
 * 清除「屬於會員」的伺服器狀態快取：個人資料、地址、最愛、優惠券、常點（常點只存記憶體，登出即清除；BR-35）與訂單查詢。
 * 登出與刪除帳號共用；不動購物車與訪客的本機記憶（FR-AC-02：登出後購物車保留）。
 */
export async function clearMemberQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: qk.me.all }),
    queryClient.cancelQueries({ queryKey: qk.orders.all }),
  ]);
  queryClient.removeQueries({ queryKey: qk.me.all });
  queryClient.removeQueries({ queryKey: qk.orders.all });
}

export interface UseSession {
  user: UserProfile | null;
  isLoggedIn: boolean;
  /**
   * 登出：呼叫 `auth.logout`（失敗不阻擋，以本機清除為準）→ 清除 Session → 清除會員的 Query 快取。
   * 購物車、訪客本機訂單記錄與偏好保留（FR-AC-02）。
   */
  logout: () => Promise<void>;
  /** 清除本機 Session 與會員快取，不呼叫 API（刪除帳號後、Session 已被伺服器撤銷時使用） */
  clearLocal: () => Promise<void>;
}

export function useSession(): UseSession {
  const api = useApi();
  const queryClient = useQueryClient();
  const user = useSessionStore((s) => s.user);

  const clearLocal = useCallback(async (): Promise<void> => {
    useSessionStore.getState().clear();
    await clearMemberQueries(queryClient);
  }, [queryClient]);

  const logout = useCallback(async (): Promise<void> => {
    const refreshToken = useSessionStore.getState().tokens?.refreshToken;
    try {
      await api.auth.logout(refreshToken);
    } catch {
      // 網路或伺服器失敗不應讓使用者卡在登入狀態：權杖會隨 Session 清除而作廢（Refresh Token 逾期亦失效）
    }
    await clearLocal();
  }, [api, clearLocal]);

  return { user, isLoggedIn: user !== null, logout, clearLocal };
}
