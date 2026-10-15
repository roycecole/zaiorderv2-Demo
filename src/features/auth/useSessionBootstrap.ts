// src/features/auth/useSessionBootstrap.ts —— 啟動時還原 Session（07 §7.1、FLOW-15）
//
// 持久化的 Session 在重新整理後仍在，但 Access Token 可能已過期、Refresh Token 可能已被撤銷。
// 啟動時若已有登入的會員，就以 Refresh Token（Cookie 模式則不帶）換發一次：
//   · 成功：寫回新權杖，並重新取得個人資料；
//   · 伺服器明確拒絕（401 / 403 等）：清除 Session，使用者回到訪客狀態；
//   · 暫時性失敗（無回應、5xx、429）：保留 Session，稍後的請求再由攔截器處理。
// Refresh Token 每次換發即輪替（06 §5.2a），重複使用舊 Token 會被視為遭竊而撤銷所有 Session，
// 因此同一時間只能有一個換發在飛（React StrictMode 會重複執行 effect）。
import { useEffect, useState } from 'react';
import { env } from '@/config/env';
import type { ApiClient } from '@/services/api/ApiClient';
import { useApi } from '@/hooks/useApi';
import { isDefinitiveRejection } from './errorInfo';
import { useSessionStore } from './sessionStore';

export type SessionBootstrapStatus = 'refreshing' | 'ready';

let inflight: Promise<void> | null = null;

async function run(api: ApiClient): Promise<void> {
  const { user, tokens } = useSessionStore.getState();
  if (user === null) return; // 訪客：沒有東西要還原

  try {
    // Mock 以自己記住的 session 換發（模擬 Cookie 模式）：多個分頁同時啟動時不會因重複使用舊 Token 被視為遭竊；
    // HTTP 的 Body 模式帶上持久化的 Refresh Token，Cookie 模式則因 refreshToken 省略而不帶 body。
    const refreshToken = env.dataSource === 'mock' ? undefined : tokens?.refreshToken;
    const res = await api.auth.refresh(refreshToken);
    useSessionStore.getState().setTokens(res.tokens);
  } catch (e) {
    if (isDefinitiveRejection(e)) useSessionStore.getState().clear();
    return;
  }

  try {
    const profile = await api.me.get();
    useSessionStore.getState().setUser(profile);
  } catch (e) {
    if (isDefinitiveRejection(e)) useSessionStore.getState().clear();
  }
}

/** 還原 Session（併發共用同一個 Promise）。可單獨呼叫，供測試與 app 層使用。 */
export function bootstrapSession(api: ApiClient): Promise<void> {
  if (inflight !== null) return inflight;
  const promise: Promise<void> = run(api).finally(() => {
    if (inflight === promise) inflight = null;
  });
  inflight = promise;
  return promise;
}

/** 在 app 根部呼叫一次。回傳目前階段，需要等待還原完成的畫面可據此顯示載入狀態。 */
export function useSessionBootstrap(): { status: SessionBootstrapStatus } {
  const api = useApi();
  // 訪客沒有東西要還原，直接視為完成；會員在換發完成前為 refreshing
  const [status, setStatus] = useState<SessionBootstrapStatus>(() =>
    useSessionStore.getState().user === null ? 'ready' : 'refreshing',
  );

  useEffect(() => {
    let cancelled = false;
    void bootstrapSession(api).finally(() => {
      if (!cancelled) setStatus('ready');
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return { status };
}
