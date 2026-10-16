import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { preloadAllOverlays } from '@/components/lazyOverlay';

// 即時通報區（視覺隱藏的 aria-live）會再寫一份和畫面上提示（Toast）相同的文字，而且是 50ms 後才寫入：
// *ByText 查詢要是兩份同時在 DOM 裡就會因「找到多個元素」失敗，快慢機器上的結果不一樣（時序測試）。
// 預設不把它列入 *ByText 的比對範圍；要驗證通報內容的測試直接查 `[data-zo-live-announcer]`。
configure({ defaultIgnore: 'script, style, [data-zo-live-announcer]' });

// Node ≥ 22 的實驗性內建 Web Storage 會遮蔽 jsdom 的 localStorage（`localStorage.setItem is not a function`）。
// 偵測到時改用 jsdom 自己的實作，讓 store / safeStorage 的測試在任何 Node 版本都可執行。
const jsdomWindow = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom?.window;
for (const name of ['localStorage', 'sessionStorage'] as const) {
  const current = (globalThis as unknown as Record<string, Storage | undefined>)[name];
  if (typeof current?.setItem !== 'function' && jsdomWindow !== undefined) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: () => jsdomWindow[name],
    });
  }
}

// 浮層（對話框、商品面板）在正式環境第一次開啟時才動態載入；測試先載入，維持與靜態匯入相同的同步渲染。
// 載入的是此測試檔已匯入的模組所登錄的浮層（登錄發生在模組評估時，早於 beforeAll）。
beforeAll(async () => {
  await preloadAllOverlays();
});

afterEach(() => {
  cleanup();
});
