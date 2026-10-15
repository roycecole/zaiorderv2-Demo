// src/features/demo/accountActions.ts —— 快速登入與重置（FR-DM-02、FR-DM-08）
import type { AuthTokens, UserProfile } from '@/domain/types';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useCartStore } from '@/features/cart/cartStore';
import { useGuestOrdersStore } from '@/features/orders/guestOrdersStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import type { ApiClient } from '@/services/api/ApiClient';
import type { DemoControl } from '@/services/api/mock/demoControl';
import { appSessionStorage, STORAGE_KEYS } from '@/services/storage/appStorage';
import { DEMO_OTP, DEMO_PHONE } from './constants';

/**
 * 快速登入示範會員：Mock 自己記住登入狀態（存於其 db），因此先 `demo.loginAsDemoUser()` 建立 session，
 * 再取得 tokens 與 user 寫入 sessionStore（`refresh()` 不帶參數 = Cookie 模式；失敗時改走 Demo 驗證碼）。
 */
export async function quickLoginDemoUser(api: ApiClient, demo: DemoControl): Promise<UserProfile> {
  await demo.loginAsDemoUser();
  let tokens: AuthTokens;
  try {
    tokens = (await api.auth.refresh()).tokens;
  } catch {
    tokens = (await api.auth.verifyOtp(DEMO_PHONE, DEMO_OTP)).tokens;
  }
  const user = await api.me.get();
  useSessionStore.getState().setSession(tokens, user);
  return user;
}

/**
 * 重置所有 Demo 資料：先把記憶體中的 store 歸零（避免持久化的 store 在重新載入前把舊資料寫回），
 * 再呼叫 `resetAll()`——它會清除 `zaiorder:v1:*`、還原系統時鐘並重新載入頁面。
 */
export function resetDemoData(demo: DemoControl): void {
  useCartStore.getState().clear();
  usePrefsStore.getState().reset();
  useSessionStore.getState().clear();
  useGuestOrdersStore.getState().clear();
  appSessionStorage.removeItem(STORAGE_KEYS.checkoutDraft);
  demo.resetAll();
}
