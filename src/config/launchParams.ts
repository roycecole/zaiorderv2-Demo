// src/config/launchParams.ts —— 啟動參數（`?mode=`、`?demo_*`）的讀取位置
//
// browser 路由：查詢字串在 `location.search`。
// hash 路由（`VITE_ROUTER_MODE=hash`，無法設定 SPA fallback 的主機）：使用者自然會寫成 `/#/?mode=kiosk`，
// 查詢字串落在 `location.hash` 內；寫在 `#` 之前（`/?mode=kiosk#/`）也一樣有效。
// 兩處都要讀，且 `location.search` 優先。
//
// 注意：`?table=` 與 `?product=` 等頁面層參數仍由路由器讀取（hash 模式下在 `#/` 之後），不在此處理。

type LocationLike = Pick<Location, 'search' | 'hash'>;

const currentLocation = (): LocationLike =>
  typeof window === 'undefined' ? { search: '', hash: '' } : window.location;

/** 取出 hash 內的查詢字串（不含 `?`）；沒有則為空字串 */
function hashQuery(hash: string): string {
  const i = hash.indexOf('?');
  return i < 0 ? '' : hash.slice(i + 1);
}

/** 單一啟動參數的值：`location.search` 優先，其次 hash 內的查詢字串；沒有則 null */
export function launchParam(name: string, loc: LocationLike = currentLocation()): string | null {
  const fromSearch = new URLSearchParams(loc.search).get(name);
  if (fromSearch !== null) return fromSearch;
  return new URLSearchParams(hashQuery(loc.hash)).get(name);
}

/**
 * 合併後的原始查詢字串（含開頭的 `?`；沒有參數時為空字串），供自行解析的程式使用
 * （例如 demo_clock 的 `+08:00` 不能被 URLSearchParams 當成空白）。
 * hash 內的參數排在前面、`location.search` 排在後面：以「後者覆蓋前者」解析時，search 優先。
 */
export function launchSearch(loc: LocationLike = currentLocation()): string {
  const fromSearch = loc.search.startsWith('?') ? loc.search.slice(1) : loc.search;
  const merged = [hashQuery(loc.hash), fromSearch].filter((part) => part !== '').join('&');
  return merged === '' ? '' : `?${merged}`;
}
