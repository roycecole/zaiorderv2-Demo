// src/features/menu/useRememberedChoices.ts —— 點餐記憶（BR-35、FLOW-20）：讀取端
//
// - 訪客：`prefs.lastChoices`（僅此裝置；顯示前先排除超過 180 天者）
// - 會員：`GET /me/frequent-items`（伺服器依近 180 天非取消訂單推導，不寫入本機）與此裝置的訪客記憶在記憶體合併，較新者優先
// - 觸控面板模式與使用者關閉「記住上次點過的選項」時：不讀取、不顯示、不套用
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { mergeRemembered, pruneRemembered } from '@/domain/rememberedChoice';
import type { RememberedMap } from '@/domain/rememberedChoice';
import { selectIsLoggedIn, useSessionStore } from '@/features/auth/sessionStore';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { useClockNow } from '@/hooks/useClockNow';
import { useApi } from '@/hooks/useApi';
import { qk } from '@/services/api/queryKeys';

const EMPTY: RememberedMap = {};

export interface RememberedChoices {
  /** 目前有效的記憶（商品 ID → 最近一次的選項與備註） */
  map: RememberedMap;
  /** 點餐記憶是否生效（未關閉且非觸控面板） */
  enabled: boolean;
}

export function useRememberedChoices(): RememberedChoices {
  const api = useApi();
  const kiosk = useIsKioskUi();
  const rememberChoices = usePrefsStore((s) => s.rememberChoices);
  const lastChoices = usePrefsStore((s) => s.lastChoices);
  const isMember = useSessionStore(selectIsLoggedIn);
  // 以分鐘為單位更新「現在」：避免每次渲染都重算，又能讓過期（180 天）的記憶適時排除
  const now = useClockNow(60_000);
  const nowMs = now.getTime();

  const enabled = rememberChoices && !kiosk;
  const server = useQuery({
    queryKey: qk.me.frequentItems(),
    queryFn: () => api.me.frequentItems(100),
    enabled: enabled && isMember,
    staleTime: 60_000,
  });
  const serverItems = enabled && isMember ? server.data?.items : undefined;

  const map = useMemo<RememberedMap>(() => {
    if (!enabled) return EMPTY;
    const local = pruneRemembered(lastChoices, nowMs);
    return serverItems === undefined ? local : mergeRemembered(local, serverItems, nowMs);
  }, [enabled, lastChoices, serverItems, nowMs]);

  return { map, enabled };
}
