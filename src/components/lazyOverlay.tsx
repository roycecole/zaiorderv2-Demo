// src/components/lazyOverlay.tsx —— 浮層（對話框、商品面板…）的延後載入（NFR-03：首次載入 JS ≤ 200 kB gzip）
//
// 浮層只在開啟時才需要，而 Radix Dialog 與其相依套件（remove-scroll、focus-scope、dismissable-layer…）
// 約占首屏 JS 的十分之一。做法：元件關閉且從未開啟過時不載入實作；`active` 變為 true 時才動態載入，
// 載入完成後常駐（關閉動畫、焦點還原與再次開啟都與一般元件相同）。
//
// 不使用 React.lazy + Suspense：載入前直接不渲染（關閉中的浮層本來就沒有內容），
// 且實作載入後以同步方式渲染，行為與先前的靜態匯入一致。
import { useEffect, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';

export interface OverlayLoader<P> {
  /** 已載入的元件；尚未載入為 null */
  current(): ComponentType<P> | null;
  /** 開始載入；重複呼叫共用同一個 Promise，失敗後下次呼叫會重試 */
  load(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

const registry = new Set<OverlayLoader<never>>();

/** `importer` 回傳實作元件（例：`() => import('./DialogImpl').then((m) => m.Dialog)`） */
export function createOverlayLoader<P>(
  importer: () => Promise<ComponentType<P>>,
): OverlayLoader<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const loader: OverlayLoader<P> = {
    current: () => loaded,
    load() {
      if (loaded !== null) return Promise.resolve();
      pending ??= importer().then(
        (component) => {
          loaded = component;
          listeners.forEach((listener) => listener());
        },
        (error: unknown) => {
          pending = null;
          throw error;
        },
      );
      return pending;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  registry.add(loader as OverlayLoader<never>);
  return loader;
}

export interface LazyOverlayProps<P> {
  loader: OverlayLoader<P>;
  /** 為 true 時開始載入（例如對話框的 `open`）；載入完成後即使變回 false 也維持掛載 */
  active: boolean;
  /** 傳給實作元件的 props */
  props: P;
}

/**
 * 渲染延後載入的浮層：尚未載入時不輸出任何內容；載入完成後以同步方式渲染實作（之後常駐）。
 * 實作元件是 `loader` 持有的模組層級常數，身分穩定，不屬於「在渲染中建立元件」。
 */
export function LazyOverlay<P extends object>({ loader, active, props }: LazyOverlayProps<P>) {
  const Impl = useSyncExternalStore(loader.subscribe, loader.current, loader.current);
  useEffect(() => {
    if (active && Impl === null) loader.load().catch(() => undefined);
  }, [active, Impl, loader]);
  // eslint-disable-next-line react-hooks/static-components -- 見上方說明：身分穩定的模組層級元件
  return Impl === null ? null : <Impl {...props} />;
}

/** 載入所有已登錄的浮層實作（單元測試的 setup 使用，讓元件測試維持同步渲染） */
export async function preloadAllOverlays(): Promise<void> {
  await Promise.all([...registry].map((loader) => loader.load()));
}
