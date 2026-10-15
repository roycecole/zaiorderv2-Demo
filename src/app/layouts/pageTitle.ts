// src/app/layouts/pageTitle.ts —— 頁面標題（document.title、任務型頁面頂部列標題、路由切換的頁名通報）
//
// 各頁以 `usePageTitle('結帳')` 宣告自己的標題；外殼（AppShell / TaskLayout）訂閱 `pageTitleStore`，
// 組成 `document.title = 「頁名｜店名」`。獨立於 AppShell 的葉模組：features 的頁面元件可直接
// `import { usePageTitle } from '@/app/layouts'`，不會與外殼形成循環匯入。
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

interface PageTitleState {
  /** 目前頁面宣告的標題；null = 未宣告（只顯示店名） */
  title: string | null;
  /** 店名（外殼載入店家資訊後寫入） */
  storeName: string | null;
}

export const pageTitleStore = createStore<PageTitleState>(() => ({ title: null, storeName: null }));

/** 組合 document.title：「頁名｜店名」；缺任一者只顯示另一個，皆無則用預設標題 */
export function composeDocumentTitle(title: string | null, storeName: string | null): string {
  if (title !== null && title.length > 0 && storeName !== null && storeName.length > 0) {
    return `${title}｜${storeName}`;
  }
  return title ?? storeName ?? 'ZaiOrder · 線上點餐';
}

/**
 * 宣告目前頁面的標題（離開頁面即還原）。同一時間只有一個頁面掛載，後掛載者覆寫。
 * 傳 `null` / `undefined` 表示尚無標題（例如資料載入中）。
 * @example usePageTitle(t.store.page.title);
 */
export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (title === null || title === undefined) return;
    pageTitleStore.setState({ title });
    return () => {
      // 只在仍是自己的標題時還原，避免新頁面先掛載、舊頁面後卸載時蓋掉新標題
      if (pageTitleStore.getState().title === title) pageTitleStore.setState({ title: null });
    };
  }, [title]);
}

/** 訂閱目前頁面標題（外殼與任務型頁面頂部列使用） */
export function usePageTitleValue(): string | null {
  return useStore(pageTitleStore, (s) => s.title);
}
