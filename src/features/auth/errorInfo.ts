// src/features/auth/errorInfo.ts —— 由被擲出的錯誤取出 HTTP 狀態與業務欄位（features 不得 import http/request 的 ApiError）
//
// Mock 與 HTTP Adapter 擲出的 `ApiError` 皆具有 `status`、`code`、`message` 與 `body`（06 §3.1 的 error 物件）。
// 這裡只以結構辨識，讓 UI 能處理 retryAfterSeconds、remainingAttempts、details 與 404，而不依賴 Adapter 的類別。

export interface ApiErrorDetailInfo {
  field?: string;
  code?: string;
  message: string;
}

export interface ApiErrorInfo {
  /** HTTP 狀態；無回應（網路中斷、逾時）為 0；非 API 錯誤為 null */
  status: number | null;
  code: string | null;
  message: string | null;
  retryAfterSeconds: number | null;
  remainingAttempts: number | null;
  requestId: string | null;
  details: ApiErrorDetailInfo[];
}

const asString = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const asNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function readApiError(error: unknown): ApiErrorInfo {
  const rec: Record<string, unknown> =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const body: Record<string, unknown> =
    typeof rec.body === 'object' && rec.body !== null ? (rec.body as Record<string, unknown>) : {};

  const details: ApiErrorDetailInfo[] = [];
  if (Array.isArray(body.details)) {
    for (const d of body.details as unknown[]) {
      if (typeof d !== 'object' || d === null) continue;
      const item = d as Record<string, unknown>;
      const message = asString(item.message);
      if (message === null) continue;
      const out: ApiErrorDetailInfo = { message };
      const field = asString(item.field);
      const code = asString(item.code);
      if (field !== null) out.field = field;
      if (code !== null) out.code = code;
      details.push(out);
    }
  }

  return {
    status: asNumber(rec.status),
    code: asString(rec.code),
    message: asString(rec.message),
    retryAfterSeconds: asNumber(body.retryAfterSeconds),
    remainingAttempts: asNumber(body.remainingAttempts),
    requestId: asString(body.requestId),
    details,
  };
}

/** 404 / NOT_FOUND：資源不存在，或無權存取該訂單（06 §3.2：一律回 404，不洩漏是否存在） */
export function isNotFoundError(error: unknown): boolean {
  const { status, code } = readApiError(error);
  return status === 404 || code === 'NOT_FOUND';
}

/** 401 / 403：登入失效或帳號停用（已由攔截器嘗試 refresh 之後仍失敗） */
export function isAuthError(error: unknown): boolean {
  const { status, code } = readApiError(error);
  return status === 401 || status === 403 || code === 'UNAUTHORIZED' || code === 'FORBIDDEN';
}

/** 伺服器「明確拒絕」（4xx，排除 408 / 429）：與暫時性失敗（無回應、5xx、429）區分，後者不應登出使用者 */
export function isDefinitiveRejection(error: unknown): boolean {
  const { status } = readApiError(error);
  return status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429;
}
