// src/test/renderWithProviders.tsx —— 元件測試的共用外框：QueryClient + ApiProvider + ToastProvider + MemoryRouter
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/components';
import { ApiProvider } from '@/hooks/useApi';
import type { ApiClient } from '@/services/api/ApiClient';
import { createFakeApi } from './fakeApi';

export interface ProviderOptions {
  api?: ApiClient;
  /** 初始網址，例 '/checkout?product=p1' */
  route?: string;
  queryClient?: QueryClient;
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  { api = createFakeApi(), route = '/', queryClient = createTestQueryClient() }: ProviderOptions = {},
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api}>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </ToastProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}
