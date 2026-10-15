// src/services/api/createApiClient.ts
import { env } from '@/config/env';
import type { ApiClient } from './ApiClient';
import type { SessionPort } from './http/sessionPort';
import type { DemoControl } from './mock/demoControl';

/**
 * 依 VITE_DATA_SOURCE 建立 ApiClient。
 * 使用動態 import：http 建置不會把 Mock（含種子資料）打包進來，反之亦然。
 */
export async function createApiClient(opts: { session?: SessionPort } = {}): Promise<ApiClient> {
  if (env.dataSource === 'http') {
    const { createHttpClient } = await import('./http/createHttpClient');
    return createHttpClient({ baseUrl: env.apiBaseUrl, storeSlug: env.storeSlug, session: opts.session });
  }
  const { createMockClient } = await import('./mock/createMockClient');
  return createMockClient({ storeSlug: env.storeSlug });
}

/** Mock 模式的 ApiClient 另帶 DemoControl（07 §6.5）；HTTP 模式為 null。僅 app / features/demo 使用 */
export function getDemoControl(client: ApiClient): DemoControl | null {
  const demo = (client as ApiClient & { demo?: DemoControl }).demo;
  return demo ?? null;
}
