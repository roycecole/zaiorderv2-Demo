// src/test/fakeApi.ts —— 測試用 ApiClient：未覆寫的方法一律丟錯，避免測試悄悄打到不存在的資料
import type { ApiClient } from '@/services/api/ApiClient';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends (...a: never[]) => unknown ? T[K] : DeepPartial<T[K]> };

/** 既可當命名空間（繼續取屬性）、也可當函式呼叫（未覆寫時回傳 rejected promise）的代理 */
function node(path: string, overrides: Record<string, unknown> | undefined): unknown {
  return new Proxy(function unimplemented() {}, {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined;
      const value = overrides?.[prop];
      if (typeof value === 'function') return value;
      const next = path === '' ? prop : `${path}.${prop}`;
      return node(next, value as Record<string, unknown> | undefined);
    },
    apply() {
      return Promise.reject(new Error(`fakeApi: ${path} 未提供`));
    },
  });
}

export function createFakeApi(overrides: DeepPartial<ApiClient> = {}): ApiClient {
  return node('', overrides as Record<string, unknown>) as ApiClient;
}
