// src/hooks/useApi.tsx —— ApiClient 的 React Context（由 app/providers 注入）
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { ApiClient } from '@/services/api/ApiClient';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (client === null) throw new Error('useApi 必須在 <ApiProvider> 內使用');
  return client;
}
