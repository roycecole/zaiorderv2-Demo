// src/app/layouts/useRouteFocus.ts —— 路由切換：更新標題、移動焦點、播報頁名（03 §10.2、§10.4）
//
// - document.title = 「頁名｜店名」（頁名來自各頁 usePageTitle，店名來自店家資訊）
// - 切換路徑後焦點移到新頁面的 h1（tabindex=-1）；頁面尚在載入（lazy / 資料）時先到 <main>，
//   h1 出現且焦點仍在 main 或 body 時再移過去；首次載入與僅變更查詢參數時不搶焦點
// - 以 polite 播報「已前往：頁名」
import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { announce } from '@/features/a11y';
import { t } from '@/i18n/zh-TW';
import { composeDocumentTitle, pageTitleStore } from './pageTitle';

const HEADING_WAIT_MS = 3000;

/** 訂閱頁名與店名，維持 document.title；`storeName` 為 undefined 表示店家資訊尚未載入 */
export function useDocumentTitle(storeName: string | undefined): void {
  const title = useStore(pageTitleStore, (s) => s.title);
  useEffect(() => {
    if (storeName !== undefined) pageTitleStore.setState({ storeName });
  }, [storeName]);
  useEffect(() => {
    document.title = composeDocumentTitle(title, storeName ?? null);
  }, [title, storeName]);
}

function focusElement(el: HTMLElement): void {
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus();
}

export function useRouteFocus(pathname: string, mainId = 'main'): void {
  const previous = useRef(pathname);

  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;

    const main = document.getElementById(mainId);
    if (main === null) return;

    const pageName = (): string =>
      pageTitleStore.getState().title ??
      main.querySelector('h1')?.textContent?.trim() ??
      pageTitleStore.getState().storeName ??
      '';

    const heading = main.querySelector<HTMLElement>('h1');
    if (heading !== null) {
      focusElement(heading);
      announce(t.a11y.announce.page(pageName()));
      return;
    }

    // h1 尚未出現：先把焦點放到 main，並等待 h1
    focusElement(main);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      const h = main.querySelector<HTMLElement>('h1');
      if (h === null) return;
      stop();
      const active = document.activeElement;
      if (active === main || active === document.body || active === null) focusElement(h);
      announce(t.a11y.announce.page(pageName()));
    });
    const stop = (): void => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    observer.observe(main, { childList: true, subtree: true });
    timer = setTimeout(stop, HEADING_WAIT_MS);
    return stop;
  }, [pathname, mainId]);
}
