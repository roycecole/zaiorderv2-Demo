// src/services/api/http/request.ts
import type { ApiErrorResponse, ErrorCode } from '@/domain/types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly body?: ApiErrorResponse['error'],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 非同步請求的逾時（NFR-06、FLOW-15）：逾時與網路中斷同為「無回應」（status 0） */
export const REQUEST_TIMEOUT_MS = 10_000;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** 呼叫端的取消訊號（例如 quote 被新請求取代、離開頁面）；與逾時訊號合併，任一觸發即中止 */
  signal?: AbortSignal;
}

/** 網路中斷、逾時（10 秒）或 CORS：視為可重試的服務不可用；POST /orders 因此為結果未知（FLOW-24） */
const unreachable = (): ApiError => new ApiError(0, 'SERVICE_UNAVAILABLE', '網路好像不太穩，請稍後再試');

async function send<T>(url: string, opts: RequestOptions, signal: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal,
      credentials: 'include', // Cookie 模式需要（06 §1.3）；需後端設定 CORS 白名單與 Allow-Credentials
    });
  } catch (e) {
    // 呼叫端主動取消不是錯誤：原樣丟出（AbortError），由 TanStack Query 忽略
    if (opts.signal?.aborted === true) throw e;
    throw unreachable();
  }
  if (res.status === 204) return undefined as T;

  const payload: unknown = await res.json().catch(() => undefined);
  // 讀取回應本文途中逾時：同樣是「無回應」，不可把截斷的本文當成功回傳
  if (signal.aborted && opts.signal?.aborted !== true) throw unreachable();
  if (res.ok) return payload as T;

  const err = (payload as ApiErrorResponse | undefined)?.error;
  throw new ApiError(
    res.status,
    err?.code ?? 'INTERNAL_ERROR',
    err?.message ?? '發生了一點問題，請稍後再試',
    err,
  );
}

export async function request<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  // 逾時與呼叫端取消合併為同一個 AbortController（不依賴較新的 AbortSignal.any，內建瀏覽器亦可用）
  const controller = new AbortController();
  const caller = opts.signal;
  const abort = (): void => controller.abort();
  if (caller?.aborted === true) abort();
  caller?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
  try {
    return await send<T>(url, opts, controller.signal);
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener('abort', abort);
  }
}
