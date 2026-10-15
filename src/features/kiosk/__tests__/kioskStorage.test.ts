// UAT-19 / BR-36 / BR-37：真正的觸控面板模式（VITE_KIOSK_MODE=true）下，閒置重置不讀寫 localStorage 的個資鍵。
// 模式在模組載入時決定，因此以 vi.resetModules() + vi.stubEnv() 動態載入（含 React 與渲染器，確保同一份 registry）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage, stubWebStorage } from '@/test/memoryStorage';
import type { StubbedStorages } from '@/test/memoryStorage';

const KEYS = [
  'zaiorder:v1:cart',
  'zaiorder:v1:session',
  'zaiorder:v1:prefs',
  'zaiorder:v1:guestOrders',
  'zaiorder:v1:db',
  'zaiorder:v1:demo',
] as const;

let storages: StubbedStorages;
let advance: (seconds: number) => void;
let unmount: () => void;

async function mountKioskIdleGuard() {
  vi.resetModules();
  vi.stubEnv('VITE_KIOSK_MODE', 'true');
  window.history.replaceState({}, '', '/');
  const local = new MemoryStorage();
  // 一般模式留下的資料與 Mock 的 db / demo
  for (const key of KEYS) local.setItem(key, JSON.stringify({ seed: key }));
  storages = stubWebStorage(local);
  local.writes.length = 0;

  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { MemoryRouter } = await import('react-router');
  const { ApiProvider } = await import('@/hooks/useApi');
  const { createFakeApi } = await import('@/test/fakeApi');
  const { IdleGuard } = await import('../IdleGuard');
  const cart = await import('@/features/cart/cartStore');
  const prefs = await import('@/features/prefs/prefsStore');
  const app = await import('@/services/storage/appStorage');

  // 單調時鐘須在掛載前取代（掛載時記下起算點）
  let nowMs = 50_000;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);

  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const { createElement: h, act } = React;
  React.act(() => {
    root.render(
      h(
        QueryClientProvider,
        { client: new QueryClient() },
        h(ApiProvider, { client: createFakeApi(), children: h(MemoryRouter, null, h(IdleGuard)) }),
      ),
    );
  });

  advance = (seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      nowMs += 1000;
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
  };
  unmount = () => {
    act(() => root.unmount());
    container.remove();
  };
  // 警示對話框的實作是延後載入的（IdleGuard 掛載時開始載入）：等它載入完成，才能在 60 秒時立刻看到警示
  const { preloadDialog } = await import('@/components');
  await act(async () => {
    await preloadDialog();
  });
  return { cart, prefs, app, container };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('觸控面板模式的閒置重置', () => {
  it('60 秒警示、90 秒重置期間，localStorage 沒有任何寫入或刪除，既有鍵維持原樣', async () => {
    const m = await mountKioskIdleGuard();
    expect(m.app.isKioskMode).toBe(true);
    // 本次使用者操作（只存記憶體）
    m.cart.useCartStore.getState().addLine({
      productId: 'prd_lurou',
      quantity: 1,
      optionIds: [],
      snapshot: { name: '招牌滷肉飯', unitPrice: 35, optionLabels: [] },
    });
    m.prefs.usePrefsStore.getState().patch({ guestProfile: { name: '王小明' } });
    expect(m.cart.useCartStore.getState().lines).toHaveLength(1);

    advance(60);
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    advance(30);

    // 重置：記憶體清空、回到初始
    expect(m.cart.useCartStore.getState().lines).toEqual([]);
    expect(m.prefs.usePrefsStore.getState().guestProfile).toBeNull();
    // 本機儲存：不新增、不變更、不刪除
    expect(storages.local.writes).toEqual([]);
    expect(storages.session.writes).toEqual([]);
    for (const key of KEYS) expect(storages.local.getItem(key)).toBe(JSON.stringify({ seed: key }));
  });
});
