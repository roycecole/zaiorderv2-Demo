// src/config/env.ts
export type DataSource = 'mock' | 'http';

export const env = {
  dataSource: (import.meta.env.VITE_DATA_SOURCE ?? 'mock') as DataSource,
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  storeSlug: import.meta.env.VITE_STORE_SLUG ?? 'demo-snack',
  demoMode: import.meta.env.VITE_DEMO_MODE === 'true',
  basePath: import.meta.env.VITE_APP_BASE_PATH ?? '/',
  routerMode: (import.meta.env.VITE_ROUTER_MODE ?? 'browser') as 'browser' | 'hash',
  kiosk: import.meta.env.VITE_KIOSK_MODE === 'true',
} as const;
