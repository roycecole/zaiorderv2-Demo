// src/services/api/mock/handlers/auth.ts —— OTP 登入、換發與登出（06 §5.1、§5.2、§5.2a；FLOW-08）
// Demo 驗證碼固定 123456（任何手機號碼皆適用，首次登入即註冊）；錯誤 5 次鎖定 10 分鐘（EC-13、06 §1.6）。
import { normalizePhone, PHONE_RE } from '@/domain/validation';
import type { AuthTokens, UserProfile } from '@/domain/types';
import type { ApiClient } from '../../ApiClient';
import type { DbData, UserRow } from '../dbTypes';
import { apiError, unauthorized, validationFailed } from '../errors';
import { newAccessToken, newRefreshToken, newUlid } from '../ids';
import type { MockRuntime } from '../runtime';
import { toIsoTaipei } from '@/domain/taipeiTime';

export const DEMO_OTP_CODE = '123456';
export const OTP_RESEND_SECONDS = 60;
export const OTP_DAILY_LIMIT = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LOCK_MINUTES = 10;
export const ACCESS_TOKEN_TTL_SECONDS = 900;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

export function toUserProfile(u: UserRow): UserProfile {
  const out: UserProfile = {
    id: u.id,
    phone: u.phone,
    marketingOptIn: u.marketing_opt_in,
    createdAt: toIsoTaipei(u.created_at),
  };
  if (u.name !== null) out.name = u.name;
  if (u.email !== null) out.email = u.email;
  return out;
}

/** 目前登入的會員（Mock 的方法不帶權杖，由 Mock 記住「誰在用」）；未登入丟 401 */
export function requireUser(data: DbData): UserRow {
  const session = data.session;
  const user = session === null ? undefined : data.users.find((u) => u.id === session.user_id);
  if (user === undefined || user.deleted_at !== null) throw unauthorized();
  if (user.status === 'SUSPENDED') throw apiError(403, 'FORBIDDEN', '帳號已停用，請聯絡店家');
  return user;
}

function issueTokens(data: DbData, userId: string, nowMs: number): AuthTokens {
  const refreshToken = newRefreshToken();
  data.refresh_tokens.push({ token: refreshToken, user_id: userId, created_at: nowMs, revoked_at: null });
  data.session = { user_id: userId, refresh_token: refreshToken };
  return { accessToken: newAccessToken(), refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/** 供 loginAsDemoUser 與 verifyOtp 共用：登入（必要時註冊）並建立 session */
export function loginWithPhone(
  data: DbData,
  phone: string,
  nowMs: number,
): { user: UserRow; tokens: AuthTokens; isNewUser: boolean } {
  let user = data.users.find((u) => u.phone === phone && u.deleted_at === null);
  let isNewUser = false;
  if (user === undefined) {
    user = {
      id: `usr_${newUlid(nowMs).slice(-12).toLowerCase()}`,
      phone,
      name: null,
      email: null,
      status: 'ACTIVE',
      marketing_opt_in: false,
      phone_verified_at: nowMs,
      last_login_at: nowMs,
      created_at: nowMs,
      deleted_at: null,
    };
    data.users.push(user);
    isNewUser = true;
  }
  if (user.status === 'SUSPENDED') throw apiError(403, 'FORBIDDEN', '帳號已停用，請聯絡店家');
  user.phone_verified_at = nowMs;
  user.last_login_at = nowMs;
  return { user, tokens: issueTokens(data, user.id, nowMs), isNewUser };
}

const phoneDetail = [{ field: 'phone', message: '請輸入正確的手機號碼（09 開頭，共 10 碼）' }];

export function createAuthHandlers(rt: MockRuntime): ApiClient['auth'] {
  return {
    async sendOtp(phone) {
      await rt.begin('other', true);
      const normalized = normalizePhone(phone);
      if (!PHONE_RE.test(normalized)) throw validationFailed(phoneDetail);
      return rt.tx((ctx) => {
        const now = ctx.nowMs;
        const state = (ctx.data.otp_state[normalized] ??= { sent_at: [], failed: 0, locked_until: null });
        if (state.locked_until !== null && state.locked_until > now) {
          throw apiError(429, 'OTP_RATE_LIMITED', '驗證錯誤次數過多，請稍後再試', {
            retryAfterSeconds: Math.ceil((state.locked_until - now) / SECOND),
          });
        }
        state.sent_at = state.sent_at.filter((t) => now - t < DAY);
        const last = state.sent_at[state.sent_at.length - 1];
        if (last !== undefined && now - last < OTP_RESEND_SECONDS * SECOND) {
          throw apiError(429, 'OTP_RATE_LIMITED', '驗證碼發送太頻繁，請稍後再試', {
            retryAfterSeconds: Math.ceil((OTP_RESEND_SECONDS * SECOND - (now - last)) / SECOND),
          });
        }
        const first = state.sent_at[0];
        if (state.sent_at.length >= OTP_DAILY_LIMIT && first !== undefined) {
          throw apiError(429, 'OTP_RATE_LIMITED', '今日驗證碼發送次數已達上限，請明天再試', {
            retryAfterSeconds: Math.ceil((first + DAY - now) / SECOND),
          });
        }
        state.sent_at.push(now);
        return { resendAfterSeconds: OTP_RESEND_SECONDS };
      });
    },

    async verifyOtp(phone, code) {
      await rt.begin('auth.verifyOtp', true);
      const normalized = normalizePhone(phone);
      const details = [];
      if (!PHONE_RE.test(normalized)) details.push(...phoneDetail);
      if (!/^\d{6}$/.test(code)) details.push({ field: 'code', message: '驗證碼為 6 位數字' });
      if (details.length > 0) throw validationFailed(details);

      return rt.tx((ctx) => {
        const now = ctx.nowMs;
        const state = (ctx.data.otp_state[normalized] ??= { sent_at: [], failed: 0, locked_until: null });
        if (state.locked_until !== null) {
          if (state.locked_until > now) {
            throw apiError(423, 'OTP_LOCKED', '驗證錯誤次數過多，請稍後再試', {
              retryAfterSeconds: Math.ceil((state.locked_until - now) / SECOND),
            });
          }
          state.locked_until = null;
          state.failed = 0;
        }
        if (code !== DEMO_OTP_CODE) {
          state.failed += 1;
          if (state.failed >= OTP_MAX_ATTEMPTS) {
            state.failed = 0;
            state.locked_until = now + OTP_LOCK_MINUTES * MINUTE;
            throw apiError(423, 'OTP_LOCKED', '驗證錯誤次數過多，請稍後再試', {
              retryAfterSeconds: OTP_LOCK_MINUTES * 60,
            });
          }
          throw apiError(400, 'OTP_INVALID', '驗證碼錯誤或已過期', {
            remainingAttempts: OTP_MAX_ATTEMPTS - state.failed,
          });
        }
        state.failed = 0;
        state.locked_until = null;
        const { user, tokens, isNewUser } = loginWithPhone(ctx.data, normalized, now);
        return { tokens, user: toUserProfile(user), isNewUser };
      });
    },

    async refresh(refreshToken) {
      await rt.begin('other', false);
      return rt.tx((ctx) => {
        const data = ctx.data;
        // Cookie 模式（06 §1.3）不需傳入 refreshToken：以 Mock 記住的目前 Session 為準
        const token = refreshToken ?? data.session?.refresh_token;
        if (token === undefined) throw unauthorized();
        const row = data.refresh_tokens.find((t) => t.token === token);
        if (row === undefined) throw unauthorized();
        if (row.revoked_at !== null) {
          // 重複使用已失效的 Token 視為遭竊：撤銷該使用者所有 Session
          for (const t of data.refresh_tokens) {
            if (t.user_id === row.user_id && t.revoked_at === null) t.revoked_at = ctx.nowMs;
          }
          if (data.session?.user_id === row.user_id) data.session = null;
          throw unauthorized('登入已失效，請重新登入');
        }
        const user = data.users.find((u) => u.id === row.user_id && u.deleted_at === null);
        if (user === undefined) throw unauthorized();
        if (user.status === 'SUSPENDED') throw apiError(403, 'FORBIDDEN', '帳號已停用，請聯絡店家');
        row.revoked_at = ctx.nowMs; // 輪替：舊 Token 立即失效
        return { tokens: issueTokens(data, user.id, ctx.nowMs) };
      });
    },

    async logout(refreshToken) {
      await rt.begin('other', true);
      await rt.tx((ctx) => {
        const token = refreshToken ?? ctx.data.session?.refresh_token;
        const row = token === undefined ? undefined : ctx.data.refresh_tokens.find((t) => t.token === token);
        if (row !== undefined && row.revoked_at === null) row.revoked_at = ctx.nowMs;
        ctx.data.session = null; // 冪等
      });
    },
  };
}
