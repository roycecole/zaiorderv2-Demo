// src/features/demo/DemoRoot.tsx —— Demo 工具的根元件（07 §6.5、03 PG-18；僅 env.demoMode 時由 AppShell 動態載入）
//
// 負責：Demo 橫幅、工具面板；把 DemoState 的前端相關欄位（inputMode、themeOverride）
// 同步到 useInputModeStore；寫入後 invalidate 查詢讓前台立即反映。HTTP 模式（沒有 DemoControl）整個不渲染。
// 入口鈕在頂部列（DemoTrigger，屬於主 bundle）；面板開關的單一事實來源是 useInputModeStore.demoPanelOpen，
// 本元件由它推導 `open`——入口在本元件（延後載入）就緒前被點了，載入後仍會正確開啟。
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useLocation } from 'react-router';
import { LazyOverlay, createOverlayLoader } from '@/components';
import { useOverlayScope } from '@/features/a11y';
import { useCartStore } from '@/features/cart/cartStore';
import { useInputModeStore, useIsKioskUi } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { applyTheme } from '@/features/store/applyTheme';
import { useStoreInfo } from '@/features/store/queries';
import { useDemoControl } from '@/hooks/useDemoControl';
import { useLatest } from '@/hooks/useLatest';
import type { DemoControl, DemoState } from '@/services/api/mock/demoControl';
import { DEMO_POLL_MS, DEMO_TRIGGER_SELECTOR } from './constants';
import { DemoBanner } from './DemoBanner';
import { DemoContext } from './DemoContext';
import type { DemoContextValue } from './DemoContext';
import type { DemoPanelShellProps } from './DemoPanel';
import { invalidateDemoQueries } from './invalidate';

// 工具面板（含各區塊與 Sheet）第一次開啟時才載入；首屏只需要橫幅（入口鈕在頂部列，屬於主 bundle）
const panelLoader = createOverlayLoader<Omit<DemoPanelShellProps, 'children'>>(() =>
  import('./DemoPanel').then((m) => m.DemoPanel),
);

/**
 * 面板關閉後的焦點還原目標：頂部列「目前」的 Demo 入口。頂部列會隨版面切換重新掛載
 * （一般頁與任務型頁面各有頂部列），因此每次讀取時才查詢，不持有可能已被卸載的元素。
 */
const triggerFocusRef: RefObject<HTMLElement | null> = {
  get current() {
    return document.querySelector<HTMLElement>(DEMO_TRIGGER_SELECTOR);
  },
};

/** 任務型頁面（結帳、付款、訂單詳情）：頁底有 sticky 送出列與主要操作，不顯示 Demo 橫幅，避免蓋住它們 */
function isTaskPath(pathname: string): boolean {
  const path = pathname.toLowerCase().replace(/\/+$/, '');
  if (path === '/checkout' || path.startsWith('/payment/')) return true;
  return path.startsWith('/orders/') && path !== '/orders/lookup';
}

const sameState = (a: DemoState, b: DemoState): boolean => JSON.stringify(a) === JSON.stringify(b);

/** 把 DemoState 中屬於前端的欄位寫入 runtime store（只在值不同時寫入） */
function syncRuntimeStores(state: DemoState): void {
  const s = useInputModeStore.getState();
  if (s.inputMode !== state.inputMode) s.setInputMode(state.inputMode);
  if (s.themeOverride !== state.themeOverride) s.setThemeOverride(state.themeOverride);
}

export default function DemoRoot() {
  const demo = useDemoControl();
  if (demo === null) return null;
  return <DemoRootInner demo={demo} />;
}

function DemoRootInner({ demo }: { demo: DemoControl }) {
  const queryClient = useQueryClient();
  const kiosk = useIsKioskUi();
  const [state, setState] = useState<DemoState>(() => demo.getState());
  const [revision, setRevision] = useState(0);
  // 面板開關的單一事實來源（入口鈕、橫幅與面板的關閉鈕都操作它；鍵盤提醒也讀它）
  const open = useInputModeStore((s) => s.demoPanelOpen);
  const setOpen = useInputModeStore((s) => s.setDemoPanelOpen);
  const taskPage = isTaskPath(useLocation().pathname);
  const bannerDismissed = usePrefsStore((s) => s.demoBannerDismissed);
  const openRef = useLatest(open);

  // 掛載時以 DemoState 初始化 runtime store（inputMode / themeOverride 由持久化的 DemoState 還原）
  useEffect(() => {
    syncRuntimeStores(demo.getState());
  }, [demo]);

  // DemoControl 沒有訂閱機制：每秒輪詢外部變更（失敗注入被消耗、付款結果用畢、預備情境生效、其他分頁）
  useEffect(() => {
    const timer = setInterval(() => {
      const next = demo.getState();
      setState((prev) => (sameState(prev, next) ? prev : next));
      syncRuntimeStores(next);
      if (openRef.current) setRevision((r) => r + 1);
    }, DEMO_POLL_MS);
    return () => clearInterval(timer);
  }, [demo, openRef]);

  // 展開期間背景範圍的快速鍵失效（展開旗標本身就是 store：鍵盤提醒以它判斷讓位）
  useOverlayScope(open);

  // 預覽主題色：ThemeProvider 以 themeOverride 為準；此處同步套用，讓面板操作立即生效（兩邊寫入相同值）
  const storeInfo = useStoreInfo();
  const storeBrand = storeInfo.data?.display.brandColor ?? null;
  const previousOverride = useRef<string | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    if (state.themeOverride !== null) applyTheme(root, state.themeOverride);
    else if (previousOverride.current !== null) applyTheme(root, storeBrand);
    previousOverride.current = state.themeOverride;
  }, [state.themeOverride, storeBrand]);

  const afterWrite = useCallback((): void => {
    setState(demo.getState());
    setRevision((r) => r + 1);
    useInputModeStore.getState().notifyDemoStateChanged();
    void invalidateDemoQueries(queryClient);
  }, [demo, queryClient]);

  const patchState = useCallback(
    (patch: Partial<DemoState>): void => {
      demo.setState(patch);
      const next = demo.getState();
      syncRuntimeStores(next);
      // 時間穿梭：購物車 24 小時未更新即清空（FR-CT-04）；Mock 已同步套用時鐘覆寫
      if ('clockOverride' in patch) useCartStore.getState().purgeIfExpired();
      setState(next);
      setRevision((r) => r + 1);
      useInputModeStore.getState().notifyDemoStateChanged();
      void invalidateDemoQueries(queryClient);
    },
    [demo, queryClient],
  );

  const context = useMemo<DemoContextValue>(
    () => ({ demo, state, revision, kiosk, patchState, afterWrite }),
    [demo, state, revision, kiosk, patchState, afterWrite],
  );

  const showBanner = !bannerDismissed && !kiosk && !open && !taskPage;

  return (
    <DemoContext.Provider value={context}>
      {/* 就緒標記：頂部列的入口（主 bundle）早於本元件（延後載入）出現，E2E 以它確認橫幅與面板已可用 */}
      <span hidden data-zo-demo-root="" />
      {showBanner ? (
        <DemoBanner
          onOpenTools={() => setOpen(true)}
          onDismiss={() => usePrefsStore.getState().patch({ demoBannerDismissed: true })}
        />
      ) : null}
      <LazyOverlay
        loader={panelLoader}
        active={open}
        props={{
          open,
          onOpenChange: setOpen,
          returnFocusRef: triggerFocusRef,
        }}
      />
    </DemoContext.Provider>
  );
}
