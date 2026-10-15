// src/app/providers.tsx —— 應用程式的 Provider 組合與啟動（07 §3）
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useCartStore } from '@/features/cart/cartStore';
import { ApiProvider } from '@/hooks/useApi';
import type { ApiClient } from '@/services/api/ApiClient';
import { createApiClient } from '@/services/api/createApiClient';
import type { SessionPort } from '@/services/api/http/sessionPort';

/** HTTP 模式的權杖來源（Mock 模式不使用）：與 sessionStore 同形狀 */
const sessionPort: SessionPort = {
  getTokens: () => useSessionStore.getState().tokens,
  setTokens: (tokens) => useSessionStore.getState().setTokens(tokens),
  clearSession: () => useSessionStore.getState().clear(),
};

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: true,
        // 各查詢自行設定 staleTime（07 §7.1）；此處的預設只作保底
        staleTime: 30_000,
      },
    },
  });
}

type BootState =
  | { status: 'loading' }
  | { status: 'ready'; client: ApiClient }
  | { status: 'error'; error: unknown };

/** 動態載入資料來源（Mock 或 HTTP，見 createApiClient）後才渲染 App */
export function useApiBootstrap(): BootState {
  const [state, setState] = useState<BootState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    createApiClient({ session: sessionPort }).then(
      (client) => {
        // 時鐘（Demo 時間穿梭 / 伺服器時差校正）此時才就緒：購物車的 24 小時過期要在這之後判斷（FR-CT-04）
        useCartStore.getState().purgeIfExpired();
        if (!cancelled) setState({ status: 'ready', client });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: 'error', error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

const queryClient = createAppQueryClient();

export function AppProviders({ client, children }: { client: ApiClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}
