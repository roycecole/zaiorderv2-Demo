// src/app/layouts/focusSearch.ts —— 在非菜單頁按 `s` 時：回到菜單並把焦點移到搜尋框（頁面載入後才有輸入框）
const SEARCH_SELECTOR = 'input[type="search"], input[role="searchbox"], [role="searchbox"]';
const WAIT_MS = 2000;

/** 輪詢直到搜尋框出現並聚焦（最多 2 秒）；回傳取消函式 */
export function focusSearchWhenReady(): () => void {
  let cancelled = false;
  const startedAt = performance.now();
  const tryFocus = (): void => {
    if (cancelled) return;
    const el = document.querySelector<HTMLElement>(SEARCH_SELECTOR);
    if (el !== null && el.getClientRects().length > 0) {
      el.focus();
      return;
    }
    if (performance.now() - startedAt < WAIT_MS) setTimeout(tryFocus, 50);
  };
  setTimeout(tryFocus, 0);
  return () => {
    cancelled = true;
  };
}
