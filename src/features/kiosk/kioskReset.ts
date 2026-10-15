// src/features/kiosk/kioskReset.ts —— 觸控面板「重置」：清空個資與暫存、回到首頁（FLOW-21、BR-37）
import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ROUTES } from '@/app/routes';
import { useAnnounce } from '@/features/a11y';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useCartStore } from '@/features/cart/cartStore';
import { useGuestOrdersStore } from '@/features/orders/guestOrdersStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { useApi } from '@/hooks/useApi';
import { t } from '@/i18n/zh-TW';
import { qk } from '@/services/api/queryKeys';
import { appSessionStorage, STORAGE_KEYS } from '@/services/storage/appStorage';
import { dispatchKioskReset } from './resetEvent';

/**
 * 清空「下一位顧客不該看到」的資料（不含導覽與對話框）：
 * 購物車、偏好（含訪客資料與點餐記憶）、登入狀態、本機訂單記錄、結帳草稿
 * （含 Idempotency-Key 與記下的送出內容 unknownBodies，一併丟棄），並通知持有記憶體狀態的元件歸零。
 * 只動 app 層的儲存；不碰 Mock 的 zaiorder:v1:db / zaiorder:v1:demo / zaiorder:v1:mode。
 */
export function clearKioskSessionData(): void {
  useCartStore.getState().clear();
  usePrefsStore.getState().reset();
  useSessionStore.getState().clear();
  useGuestOrdersStore.getState().clear();
  appSessionStorage.removeItem(STORAGE_KEYS.checkoutDraft);
  dispatchKioskReset();
}

/** 查詢快取同樣在記憶體內：訂單詳情含姓名與手機，重置時一併移除 */
function purgePersonalQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: qk.orders.all });
  queryClient.removeQueries({ queryKey: qk.me.all });
}

/**
 * 關閉開啟中的對話框 / 面板（商品面板、購物車抽屜、確認對話框…）：對 document 送出 Esc。
 * 一次只會關閉最上層，因此間隔數十毫秒重複，直到沒有 modal 對話框或達上限；不直接操作任何元件的 React 狀態。
 * 非 modal 的浮動面板（`aria-modal="false"`，例：Demo 面板）不算。
 */
const OPEN_MODAL_SELECTOR = '[role="dialog"]:not([aria-modal="false"]), [role="alertdialog"]';
const CLOSE_DIALOG_ROUNDS = 4;
const CLOSE_DIALOG_INTERVAL_MS = 50;

export function closeOpenDialogs(): void {
  let round = 0;
  const step = (): void => {
    if (round >= CLOSE_DIALOG_ROUNDS) return;
    if (document.querySelector(OPEN_MODAL_SELECTOR) === null) return;
    round += 1;
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    setTimeout(step, CLOSE_DIALOG_INTERVAL_MS);
  };
  step();
}

/** 把焦點交給新頁面的標題（03 §10.2「觸控面板重置：焦點移到菜單頁標題」）；找不到就略過 */
function focusPageHeading(): void {
  const heading = document.querySelector<HTMLElement>('main h1, h1');
  if (heading === null) return;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
}

/**
 * 取得「立即重置並回到首頁」的函式（閒置 90 秒、完成畫面 30 秒歸零、按「重新開始」/「開始新訂單」共用）。
 * 每次渲染回傳新的函式（可直接當 onClick）；計時器等長生命週期的呼叫端請以 ref 保存最新者。
 */
export function useKioskReset(): () => void {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const announce = useAnnounce();
  const api = useApi();

  return (): void => {
    // Mock 的登入狀態存在其 db（同源曾以一般模式登入時，觸控面板仍會被視為已登入）：
    // 清除 sessionStore 之前取出 refreshToken，一併登出伺服器端 session；失敗（離線、注入錯誤）一律忽略
    const refreshToken = useSessionStore.getState().tokens?.refreshToken;
    try {
      void Promise.resolve(api.auth.logout(refreshToken)).catch(() => undefined);
    } catch {
      /* 同步丟錯（測試替身未提供）也不影響重置 */
    }
    clearKioskSessionData();
    purgePersonalQueries(queryClient);
    navigate(ROUTES.home, { replace: true });
    closeOpenDialogs();
    announce(t.kiosk.reset.announced, 'polite');
    // 路由與對話框收起後再移動焦點
    setTimeout(focusPageHeading, CLOSE_DIALOG_INTERVAL_MS * 2);
  };
}
