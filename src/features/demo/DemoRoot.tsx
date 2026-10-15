// src/features/demo/DemoRoot.tsx —— Demo 工具的根元件（07 §6.5、03 PG-18；僅 env.demoMode 時由 AppShell 動態載入）
//
// 負責：Demo 橫幅、浮動入口鈕、工具面板；把 DemoState 的前端相關欄位（inputMode、themeOverride）
// 同步到 useInputModeStore；寫入後 invalidate 查詢讓前台立即反映。HTTP 模式（沒有 DemoControl）整個不渲染。
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { DEMO_POLL_MS } from './constants';
import { DemoBanner } from './DemoBanner';
import { DemoContext } from './DemoContext';
import type { DemoContextValue } from './DemoContext';
import { DemoFab } from './DemoFab';
import type { DemoPanelShellProps } from './DemoPanel';
import { invalidateDemoQueries } from './invalidate';
import { armedItemCount } from './scenario';

// 工具面板（含各區塊與 Sheet）第一次開啟時才載入；首屏只需要橫幅與浮動入口鈕
const panelLoader = createOverlayLoader<Omit<DemoPanelShellProps, 'children'>>(() =>
  import('./DemoPanel').then((m) => m.DemoPanel),
);

/** 浮動按鈕與面板在 :root 上公布的避讓高度（px）：Toast / 鍵盤提醒的浮動槽在 Demo 模式下需上移這麼多（03 §10.3） */
const FAB_CLEARANCE_VAR = '--demo-fab-clearance';
const FAB_CLEARANCE_PX = 64;

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
  const [open, setOpen] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
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

  // 面板展開旗標：鍵盤提醒的讓位條件；展開期間背景範圍的快速鍵失效
  useEffect(() => {
    useInputModeStore.getState().setDemoPanelOpen(open);
    return () => useInputModeStore.getState().setDemoPanelOpen(false);
  }, [open]);
  useOverlayScope(open);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(FAB_CLEARANCE_VAR, `${FAB_CLEARANCE_PX}px`);
    return () => {
      root.style.removeProperty(FAB_CLEARANCE_VAR);
    };
  }, []);

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
      void invalidateDemoQueries(queryClient);
    },
    [demo, queryClient],
  );

  const context = useMemo<DemoContextValue>(
    () => ({ demo, state, revision, kiosk, patchState, afterWrite }),
    [demo, state, revision, kiosk, patchState, afterWrite],
  );

  const closePanel = useCallback((): void => {
    setOpen(false);
  }, []);

  const showBanner = !bannerDismissed && !kiosk && !open;

  return (
    <DemoContext.Provider value={context}>
      {showBanner ? (
        <DemoBanner
          onOpenTools={() => setOpen(true)}
          onDismiss={() => usePrefsStore.getState().patch({ demoBannerDismissed: true })}
        />
      ) : null}
      <DemoFab
        open={open}
        armedCount={armedItemCount(state)}
        onToggle={() => setOpen((v) => !v)}
        buttonRef={fabRef}
      />
      <LazyOverlay
        loader={panelLoader}
        active={open}
        props={{
          open,
          onOpenChange: (next) => (next ? setOpen(true) : closePanel()),
          returnFocusRef: fabRef,
        }}
      />
    </DemoContext.Provider>
  );
}
