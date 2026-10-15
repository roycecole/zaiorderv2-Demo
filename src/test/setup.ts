import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { preloadAllOverlays } from '@/components/lazyOverlay';

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
