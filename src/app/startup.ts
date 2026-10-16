// src/app/startup.ts —— 啟動時的預取（NFR-03：首屏 LCP）
//
// 資料來源（Mock / HTTP）載入完成後，立刻預取首屏一定會用到的查詢，與「路由 chunk 下載與渲染」平行進行；
// 頁面上的 hook 以同一組查詢鍵與選項直接沿用結果，不會重複請求（選項見 features/store/queries）。
import type { QueryClient } from '@tanstack/react-query';
import { env } from '@/config/env';
import {
  bannersQuery,
  menuQuery,
  storeInfoQuery,
  storeStatusQuery,
} from '@/features/store/queries';
import type { ApiClient } from '@/services/api/ApiClient';

/** 目前網址是否為首頁（考慮子路徑部署與 hash 路由） */
export function isHomeLocation(loc: Pick<Location, 'pathname' | 'hash'> = window.location): boolean {
  if (env.routerMode === 'hash') {
    const path = loc.hash.replace(/^#/, '').split('?')[0] ?? '';
    return path === '' || path === '/';
  }
  const base = env.basePath.replace(/\/+$/, '');
  return loc.pathname.replace(/\/+$/, '') === base;
}

/**
 * 資料一回來就先請瀏覽器下載圖片：等畫面渲染出 <img> 才開始下載，會多一趟往返才完成（LCP 元素通常就是第一張 Banner）。
 * 下載後存在瀏覽器快取，之後的 <img> 直接取用；失敗不影響任何事（頁面本身有圖片載入失敗的降級）。
 */
export function preloadImage(url: string | undefined, priority: 'high' | 'low' = 'low'): void {
  if (url === undefined || url === '' || typeof Image === 'undefined') return;
  const img = new Image();
  img.decoding = 'async';
  img.fetchPriority = priority;
  img.src = url;
}

/** 預取失敗不影響啟動：查詢留在錯誤狀態，頁面上的 hook 會依原本的重試與錯誤畫面處理 */
export function prefetchStartupQueries(queryClient: QueryClient, api: ApiClient): void {
  // 每一頁的外殼都需要店家資訊與營業狀態（Logo 在頂部列）
  void queryClient.prefetchQuery(storeInfoQuery(api)).then(() => {
    preloadImage(queryClient.getQueryData(storeInfoQuery(api).queryKey)?.logoUrl);
  });
  void queryClient.prefetchQuery(storeStatusQuery(api));
  // 菜單與 Banner 只有首頁馬上需要；其他頁面不為它們多花頻寬
  if (isHomeLocation()) {
    void queryClient.prefetchQuery(menuQuery(api));
    void queryClient.prefetchQuery(bannersQuery(api)).then(() => {
      preloadImage(
        queryClient.getQueryData(bannersQuery(api).queryKey)?.items[0]?.imageUrl,
        'high',
      );
    });
  }
}
