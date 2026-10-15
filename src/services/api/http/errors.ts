// src/services/api/http/errors.ts —— 錯誤正規化與分類（07 §5.4、FLOW-15）
//
// request.ts 已把非 2xx 轉為 ApiError；這裡補強「回應沒有 JSON 錯誤本文」的情況（閘道 / CDN 的 HTML 錯誤頁等），
// 並提供攔截器共用的判斷。不改 request.ts 的對外行為。
import type { ErrorCode } from '@/domain/types';
import { ApiError } from './request';

/** 伺服器沒有提供 `error.code` 時，依 HTTP 狀態碼推得的錯誤碼（對照 06 §3.2） */
const CODE_BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
  502: 'SERVICE_UNAVAILABLE',
  503: 'SERVICE_UNAVAILABLE',
  504: 'SERVICE_UNAVAILABLE',
};

/**
 * 回應若帶有伺服器的 `error.code` 一律原樣保留（含 `body.retryAfterSeconds`、`body.quote`）；
 * 沒有時才依狀態碼補上對應錯誤碼，讓 UI 只需處理 `error.code`。
 */
export function normalizeError(err: ApiError): ApiError {
  if (err.body?.code !== undefined) return err;
  const code = CODE_BY_STATUS[err.status];
  if (code === undefined || code === err.code) return err;
  return new ApiError(err.status, code, err.message, err.body);
}

/** 登入已失效（refresh 被拒，或換發後重送仍為 401） */
export function unauthorizedError(cause?: ApiError): ApiError {
  if (cause?.status === 401 && cause.code === 'UNAUTHORIZED') return cause;
  return new ApiError(401, 'UNAUTHORIZED', '登入已過期，請重新登入', cause?.body);
}

/** 2xx 但本文不是預期的 JSON（例如 API 網址設錯、被 SPA fallback 回了 HTML）：視為伺服器端問題，結果未知 */
export function invalidResponseError(): ApiError {
  return new ApiError(502, 'INTERNAL_ERROR', '伺服器回應格式不正確，請稍後再試');
}

/**
 * GET 可自動重試的失敗：無回應（網路中斷 / 逾時 / CORS，status 0）或 5xx。
 * 例外：503 附 `retryAfterSeconds` 代表伺服器要求「等一下再來」，立即重試只會加重負載，交由 UI 倒數後重試。
 */
export function isTransientFailure(err: ApiError): boolean {
  if (err.status === 0) return true;
  if (err.status < 500) return false;
  return err.body?.retryAfterSeconds === undefined;
}

/** refresh 被伺服器明確拒絕（Token 失效 / 被撤銷 / 帳號停用）；逾時、5xx、429 屬暫時性，不應登出使用者 */
export function isDefinitiveRejection(err: ApiError): boolean {
  return err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429;
}
