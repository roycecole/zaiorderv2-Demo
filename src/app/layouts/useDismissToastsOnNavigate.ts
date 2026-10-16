// src/app/layouts/useDismissToastsOnNavigate.ts —— 換頁時關閉帶 `dismissOnNavigate` 旗標的 Toast（例如「已加入購物車・復原」）
//
// 用法：在外殼（ShellFrame 的 ShellContent，AppShell 與 TaskLayout 共用）呼叫一次：
//   useDismissToastsOnNavigate(pathname);
//
// - 只看 pathname：開關商品面板的 `?product=` 等查詢字串變化不算換頁。
// - 略過首次掛載（沒有「上一個路徑」可比）。
// - 帶旗標的 Toast 只有「復原」類（加入購物車、移除品項、清空購物車）；沒有旗標的提示
//   （登入成功、下單後、再來一單導向購物車的提示、錯誤 / 警告…）換頁後照常保留到計時結束。
import { useLayoutEffect } from 'react';
import { useToast } from '@/components';
import type { ToastApi } from '@/components';

/**
 * 每個 ToastProvider 最近一次看到的路徑。
 *
 * AppShell 與 TaskLayout 是兄弟版面：在兩者之間換頁（例如菜單 → 結帳）時整個外殼會重新掛載，
 * 元件內的 ref / state 會歸零；若只記在元件裡，重新掛載的外殼會把「第一次掛載」誤判成沒有換頁，
 * 「復原」Toast 就會留在新頁面。ToastProvider 位於外殼之上、不會重新掛載，因此以它的 API 物件當鍵
 * （WeakMap：隨 Provider 一起釋放，也不會在測試之間共用狀態）。
 */
const lastPathnames = new WeakMap<ToastApi, string>();

/**
 * pathname 變更時關閉帶 `dismissOnNavigate` 的 Toast。使用 layout effect：在新頁面繪製之前就收掉，
 * 不會閃一下。
 */
export function useDismissToastsOnNavigate(pathname: string): void {
  const toast = useToast();
  useLayoutEffect(() => {
    const previous = lastPathnames.get(toast);
    lastPathnames.set(toast, pathname);
    if (previous !== undefined && previous !== pathname) toast.dismissOnNavigate();
  }, [toast, pathname]);
}
