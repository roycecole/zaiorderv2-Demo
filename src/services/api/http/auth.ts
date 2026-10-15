// src/services/api/http/auth.ts —— Refresh Token 換發協調（06 §1.3、§5.2a；FLOW-15）
//
// Refresh Token 每次換發即輪替，重複使用已失效的 Token 會被後端視為遭竊並撤銷所有 Session（§5.2a）。
// 因此同一時間只能有一個 refresh 在飛：併發的 401 與明確呼叫 `auth.refresh()` 一律共用同一個 Promise。
import type { AuthTokens } from '@/domain/types';
import { AUTH_PATHS } from './endpoints';
import {
  invalidResponseError,
  isDefinitiveRejection,
  normalizeError,
  unauthorizedError,
} from './errors';
import { ApiError, request } from './request';
import type { SessionPort } from './sessionPort';

export interface RefreshResult {
  tokens: AuthTokens;
}

export interface RefreshCoordinator {
  /**
   * 換發權杖（併發共用同一個 in-flight Promise）。
   * @param refreshToken Body 模式的 Refresh Token；省略時取 Session 內的值，兩者皆無即為 Cookie 模式（不帶 body）。
   * @throws ApiError(401, UNAUTHORIZED) 伺服器明確拒絕：已清除 Session
   * @throws ApiError 暫時性失敗（status 0 / 5xx / 429）：Session 保留，使用者稍後可再試
   */
  refresh(refreshToken?: string): Promise<RefreshResult>;
  /**
   * 某個請求以 `tokenUsed` 打出後收到 401，確保接下來重送時帶的是有效權杖：
   * - Session 內的權杖已被別的請求換新：直接返回（呼叫端以新權杖重送，不再換發）；
   * - Session 已被清除（別的請求 refresh 失敗）：丟出 `original`；
   * - 否則發起（或加入）refresh。
   */
  recover(tokenUsed: string | null, original: ApiError): Promise<void>;
}

export function createRefreshCoordinator(options: {
  baseUrl: string;
  session: SessionPort | undefined;
}): RefreshCoordinator {
  const { baseUrl, session } = options;
  const url = `${baseUrl.replace(/\/+$/, '')}${AUTH_PATHS.refresh}`;
  let inFlight: Promise<RefreshResult> | null = null;

  async function perform(explicitToken: string | undefined): Promise<RefreshResult> {
    const refreshToken = explicitToken ?? session?.getTokens()?.refreshToken;
    try {
      // 不帶 Authorization、不帶呼叫端的 signal（共用的 refresh 不應因單一呼叫端取消而中斷）
      const res = await request<RefreshResult | undefined>(url, {
        method: 'POST',
        body: refreshToken === undefined ? undefined : { refreshToken },
      });
      if (typeof res?.tokens?.accessToken !== 'string') throw invalidResponseError();
      session?.setTokens(res.tokens);
      return res;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      const err = normalizeError(e);
      if (isDefinitiveRejection(err)) {
        session?.clearSession();
        throw unauthorizedError(err);
      }
      throw err;
    }
  }

  function refresh(refreshToken?: string): Promise<RefreshResult> {
    if (inFlight !== null) return inFlight;
    const promise: Promise<RefreshResult> = perform(refreshToken).finally(() => {
      if (inFlight === promise) inFlight = null;
    });
    inFlight = promise;
    return promise;
  }

  async function recover(tokenUsed: string | null, original: ApiError): Promise<void> {
    const current = session?.getTokens()?.accessToken ?? null;
    if (current !== tokenUsed) {
      if (current === null) throw unauthorizedError(original);
      return;
    }
    await refresh();
  }

  return { refresh, recover };
}
