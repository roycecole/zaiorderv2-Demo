// src/services/api/mock/errors.ts —— Mock 的錯誤建構：status 與 code 與 06 §3.2 一致，結構同 ApiErrorResponse
import type { ApiErrorDetail, ApiErrorResponse, ErrorCode } from '@/domain/types';
import { ApiError } from '../http/request';

function requestId(): string {
  const bytes = new Uint8Array(6);
  const cryptoObj = globalThis.crypto;
  if (cryptoObj !== undefined && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `req_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function apiError(
  status: number,
  code: ErrorCode,
  message: string,
  extra: Partial<Omit<ApiErrorResponse['error'], 'code' | 'message'>> = {},
): ApiError {
  const body: ApiErrorResponse['error'] = { code, message, requestId: requestId(), ...extra };
  return new ApiError(status, code, message, body);
}

export const validationFailed = (details: ApiErrorDetail[], message = '資料格式不正確，請檢查後再試'): ApiError =>
  apiError(400, 'VALIDATION_FAILED', message, { details });

export const notFound = (message = '找不到資料'): ApiError => apiError(404, 'NOT_FOUND', message);

export const unauthorized = (message = '請先登入'): ApiError => apiError(401, 'UNAUTHORIZED', message);

export const stateConflict = (message: string): ApiError => apiError(409, 'ORDER_STATE_CONFLICT', message);

/** 失敗注入（failNext）丟出的錯誤；createMockClient 以此辨識並寫入「最近送出紀錄」 */
export class InjectedFailure extends ApiError {
  constructor(
    public readonly phase: 'BEFORE' | 'AFTER_COMMIT' | 'OTHER',
    status: number,
    code: ErrorCode,
    message: string,
  ) {
    super(status, code, message);
    this.name = 'InjectedFailure';
  }
}
