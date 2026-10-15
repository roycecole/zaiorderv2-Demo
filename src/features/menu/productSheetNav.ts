// src/features/menu/productSheetNav.ts —— 商品面板的 URL 約定（07 §7.1「開啟的商品面板：URL 狀態」、FR-PD-01）
//
//   ?product=<productId>   新增（菜單頁 `/`）
//   ?edit=<lineId>         編輯購物車行（購物車頁 `/cart`；桌機的訂單面板在 `/` 上也使用）
//
// 開啟以 push 寫入歷史並標記 state，關閉時優先 `navigate(-1)`，因此實體返回鍵 / 手機返回手勢會先關閉面板而不離開頁面；
// 直接開啟的網址（沒有標記）則以 replace 移除參數。
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';

export const PRODUCT_PARAM = 'product';
export const EDIT_PARAM = 'edit';

interface SheetLocationState {
  zoSheet?: boolean;
}

export interface ProductSheetNav {
  /** 開啟新增面板 */
  openProduct: (productId: string) => void;
  /** 開啟編輯面板（帶入該購物車行） */
  openEdit: (lineId: string) => void;
  /** 關閉面板（保留其他網址參數，例如 `?q=`、`?table=`） */
  close: () => void;
}

export function useProductSheetNav(): ProductSheetNav {
  const navigate = useNavigate();
  const location = useLocation();

  const open = useCallback(
    (param: string, value: string): void => {
      const next = new URLSearchParams(location.search);
      next.delete(PRODUCT_PARAM);
      next.delete(EDIT_PARAM);
      next.set(param, value);
      const state: SheetLocationState = { zoSheet: true };
      void navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { state });
    },
    [navigate, location.pathname, location.search],
  );

  const openProduct = useCallback((productId: string) => open(PRODUCT_PARAM, productId), [open]);
  const openEdit = useCallback((lineId: string) => open(EDIT_PARAM, lineId), [open]);

  const wasPushed = (location.state as SheetLocationState | null)?.zoSheet === true;
  const close = useCallback((): void => {
    if (wasPushed) {
      void navigate(-1);
      return;
    }
    const next = new URLSearchParams(location.search);
    next.delete(PRODUCT_PARAM);
    next.delete(EDIT_PARAM);
    const search = next.toString();
    void navigate(
      { pathname: location.pathname, search: search === '' ? '' : `?${search}` },
      { replace: true },
    );
  }, [navigate, wasPushed, location.pathname, location.search]);

  return { openProduct, openEdit, close };
}
