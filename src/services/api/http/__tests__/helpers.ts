// HTTP Adapter 測試用的假 fetch 與記憶體 Session（非測試檔：不以 .test 結尾，不會被 vitest 當成測試執行）
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { AuthTokens } from '@/domain/types';
import type { SessionPort } from '../sessionPort';

export const BASE_URL = '/api/v1';
export const STORE_SLUG = 'demo-snack';

export interface RecordedCall {
  url: string;
  method: string;
  /** 標頭名稱一律小寫 */
  headers: Record<string, string>;
  /** 已 JSON.parse；沒有 body 為 undefined */
  body: unknown;
  signal: AbortSignal | null | undefined;
  credentials: RequestCredentials | undefined;
}

export type Handler = (call: RecordedCall, index: number) => Response | Promise<Response>;

export interface FetchStub {
  calls: RecordedCall[];
  fetchMock: Mock;
}

export function jsonResponse(status: number, body?: unknown): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 06 §3.1 的錯誤回應 */
export function errorResponse(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse(status, { error: { code, message: `${code} 訊息`, ...extra } });
}

/** 閘道 / CDN 的 HTML 錯誤頁：沒有 JSON 錯誤本文 */
export function htmlResponse(status: number): Response {
  return new Response('<html><body>Bad Gateway</body></html>', {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
}

/** 永不回應（逾時 / 取消測試）：只有 abort 才會結束 */
export const never = (): Promise<Response> => new Promise<Response>(() => undefined);

/** 以 `TypeError`（fetch 在網路中斷 / CORS 時的行為）拒絕 */
export function networkFailure(): never {
  throw new TypeError('Failed to fetch');
}

function recordHeaders(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** 安裝假 `fetch`（需搭配 `vi.unstubAllGlobals()` 還原）。尊重 `signal`：被取消時以 AbortError 拒絕 */
export function stubFetch(handler: Handler): FetchStub {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const index = calls.length;
    const call: RecordedCall = {
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? 'GET',
      headers: recordHeaders(init),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      signal: init?.signal,
      credentials: init?.credentials,
    };
    calls.push(call);

    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      const onAbort = (): void =>
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      if (signal?.aborted === true) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      Promise.resolve()
        .then(() => handler(call, index))
        .then(resolve, reject);
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export const OLD_TOKENS: AuthTokens = {
  accessToken: 'at-old',
  refreshToken: 'rt-old',
  expiresIn: 900,
};
export const NEW_TOKENS: AuthTokens = {
  accessToken: 'at-new',
  refreshToken: 'rt-new',
  expiresIn: 900,
};

export interface MemorySession extends SessionPort {
  readonly tokens: AuthTokens | null;
  setTokens: Mock<(tokens: AuthTokens) => void>;
  clearSession: Mock<() => void>;
}

/** 以記憶體實作的 SessionPort（行為等同把 sessionStore 接進來） */
export function memorySession(initial: AuthTokens | null = OLD_TOKENS): MemorySession {
  let tokens = initial;
  return {
    get tokens() {
      return tokens;
    },
    getTokens: () => tokens,
    setTokens: vi.fn((next: AuthTokens) => {
      tokens = next;
    }),
    clearSession: vi.fn(() => {
      tokens = null;
    }),
  };
}

/** 手動開關：讓某個回應停在半途，以重現競態 */
export function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 讓出事件迴圈，讓已排入的微任務 / 計時為 0 的任務跑完 */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
