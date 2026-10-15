// src/features/kiosk/resetEvent.ts —— 觸控面板「重置」事件（07 §6.2、FLOW-21）
//
// IdleGuard 重置時：清空 cart / prefs / session / guestOrders / checkoutDraft 的儲存並 dispatch 此事件；
// 持有記憶體內狀態的元件（結帳表單、Idempotency-Key…）監聽後自行歸零並回到首頁。
export const KIOSK_RESET_EVENT = 'zaiorder:kiosk-reset';

export function dispatchKioskReset(): void {
  window.dispatchEvent(new Event(KIOSK_RESET_EVENT));
}

/** 訂閱重置事件；回傳取消訂閱函式（供 useEffect cleanup） */
export function onKioskReset(listener: () => void): () => void {
  window.addEventListener(KIOSK_RESET_EVENT, listener);
  return () => window.removeEventListener(KIOSK_RESET_EVENT, listener);
}
