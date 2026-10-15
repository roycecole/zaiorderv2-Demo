// src/services/api/http/sessionPort.ts —— HTTP Adapter 與會員 Session 之間的接點
// services 層不得 import features（07 §4），因此由 app 層以此介面把 sessionStore 接進來。
import type { AuthTokens } from '@/domain/types';

/**
 * Session 存取埠。HTTP Adapter 只透過它讀寫權杖，不知道 Zustand 的存在。
 *
 * app 層接線範例（`useSessionStore` 位於 features/auth）：
 * ```ts
 * const session: SessionPort = {
 *   getTokens: () => useSessionStore.getState().tokens,
 *   setTokens: (tokens) => useSessionStore.getState().setTokens(tokens),
 *   clearSession: () => useSessionStore.getState().clear(),
 * };
 * ```
 */
export interface SessionPort {
  /**
   * 目前的權杖：
   * - Body 模式：`accessToken` 與 `refreshToken` 皆有；
   * - Cookie 模式（06 §1.3）：只有 `accessToken`（Refresh Token 在 HttpOnly Cookie 內）；
   * - 未登入（或 Cookie 模式重新整理後記憶體已空）：`null`。
   */
  getTokens(): AuthTokens | null;
  /** refresh 成功後寫回新權杖（Refresh Token 每次輪替；Cookie 模式的 `refreshToken` 為 undefined） */
  setTokens(tokens: AuthTokens): void;
  /**
   * 權杖確定失效（refresh 被拒、或換發後重送仍為 401）：清除 Session。
   * 此函式應冪等；app 層的路由守衛據此導向登入並保留 redirect（FLOW-15）。
   */
  clearSession(): void;
}
