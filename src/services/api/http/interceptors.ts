// src/services/api/http/interceptors.ts —— 請求管線：Bearer、401 換發重送、GET 重試、錯誤正規化（FLOW-15）
//
// 以 request.ts 的 `request<T>` 為單次請求原語（10 秒逾時、與呼叫端 signal 合併、ApiError）；
// 這裡在其外層加上「跨請求」的行為。
import type { RefreshCoordinator } from './auth';
import {
  invalidResponseError,
  isTransientFailure,
  normalizeError,
  unauthorizedError,
} from './errors';
import { ApiError, request } from './request';
import type { RequestOptions } from './request';
import type { SessionPort } from './sessionPort';

/** GET 自動重試（07 §10）：最多 2 次，指數退避（baseDelayMs × 2^n：預設 300ms、600ms） */
export interface RetryPolicy {
  retries: number;
  baseDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { retries: 2, baseDelayMs: 300 };

/**
 * - `none`：公開端點（店家、菜單、時段、OTP、refresh…）。不帶 Authorization，401 也不觸發換發、不動 Session。
 * - `bearer`：會員 / 擁有者 / 與登入狀態有關的公開端點（報價、建立訂單）。有權杖就附 `Authorization: Bearer`，
 *   401 時換發一次並重送。
 */
export type AuthMode = 'none' | 'bearer';

export interface CallSpec {
  method: NonNullable<RequestOptions['method']>;
  url: string;
  /** 函式形式於每次（含重送）送出前重新取值，供 logout 在換發後改帶新的 Refresh Token */
  body?: unknown;
  headers?: Record<string, string>;
  /** 呼叫端取消訊號：取消不是錯誤，原樣丟出 AbortError，且不重試 */
  signal?: AbortSignal;
  auth: AuthMode;
}

export interface Transport {
  /** 預期 JSON 物件本文（含 `{ items: [] }`）；2xx 但本文缺漏 / 非 JSON 視為伺服器端錯誤 */
  json<T>(spec: CallSpec): Promise<T>;
  /** 預期無本文（204）；若伺服器回 200 與本文則忽略 */
  none(spec: CallSpec): Promise<void>;
}

function abortError(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error
    ? reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

/** 可被取消的等待：退避期間呼叫端取消即刻以 AbortError 結束 */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(abortError(signal));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function createTransport(options: {
  session: SessionPort | undefined;
  refresh: RefreshCoordinator;
  retry?: Partial<RetryPolicy>;
}): Transport {
  const { session, refresh } = options;
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retry };

  async function execute(spec: CallSpec): Promise<unknown> {
    let authRetried = false;
    let transientRetries = 0;

    for (;;) {
      // 每次迴圈重新取權杖：換發後重送要帶新的
      const token = spec.auth === 'bearer' ? (session?.getTokens()?.accessToken ?? null) : null;
      const headers: Record<string, string> = { ...spec.headers };
      if (token !== null) headers.Authorization = `Bearer ${token}`;

      try {
        return await request<unknown>(spec.url, {
          method: spec.method,
          body: typeof spec.body === 'function' ? (spec.body as () => unknown)() : spec.body,
          headers,
          signal: spec.signal,
        });
      } catch (raw) {
        // AbortError 等非 ApiError：呼叫端主動取消，原樣丟出
        if (!(raw instanceof ApiError)) throw raw;
        const err = normalizeError(raw);

        if (err.status === 401 && spec.auth === 'bearer') {
          // 沒有 session 埠（例如單元測試、未接線）：無從換發，直接丟出
          if (session === undefined) throw err;
          // 換發後重送仍是 401：權杖確定無法使用，清除 Session（只重送一次，FLOW-15）
          if (authRetried) {
            session.clearSession();
            throw unauthorizedError(err);
          }
          authRetried = true;
          await refresh.recover(token, err);
          continue;
        }

        // 只有 GET 自動重試；POST（含 POST /orders：結果未知須原樣丟出，FLOW-24）與其他方法一律不重試
        if (spec.method === 'GET' && isTransientFailure(err) && transientRetries < policy.retries) {
          await sleep(policy.baseDelayMs * 2 ** transientRetries, spec.signal);
          transientRetries += 1;
          continue;
        }
        throw err;
      }
    }
  }

  return {
    async json<T>(spec: CallSpec): Promise<T> {
      const result = await execute(spec);
      if (typeof result !== 'object' || result === null) throw invalidResponseError();
      return result as T;
    },
    async none(spec: CallSpec): Promise<void> {
      await execute(spec);
    },
  };
}
