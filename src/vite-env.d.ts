/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: 'mock' | 'http';
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_STORE_SLUG?: string;
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_APP_BASE_PATH?: string;
  readonly VITE_ROUTER_MODE?: 'browser' | 'hash';
  readonly VITE_KIOSK_MODE?: string;
  readonly VITE_GA_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
