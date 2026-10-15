// src/features/menu/LazyProductSheet.tsx —— 商品面板（PG-02）的延後載入（NFR-03：首次載入 JS ≤ 200 kB gzip）
//
// 面板的程式（選項群組、點餐記憶、Radix Sheet…）只在網址帶 `?product=` / `?edit=` 時才需要：
// 第一次需要時動態載入，之後常駐（關閉動畫、焦點還原與一般元件相同）。
// 為了讓第一次點開不必等載入：指標移入 / 觸控 / 焦點進入菜單或購物車內容時就先載入（意圖預載）。
import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useSearchParams } from 'react-router';
import { LazyOverlay, createOverlayLoader } from '@/components';
import { EDIT_PARAM, PRODUCT_PARAM } from './productSheetNav';
import type { ProductSheetProps } from './ProductSheet';

const sheetLoader = createOverlayLoader<ProductSheetProps>(() =>
  import('./ProductSheet').then((m) => m.ProductSheet),
);

/** 預先載入商品面板（可重複呼叫） */
export const preloadProductSheet = (): void => {
  sheetLoader.load().catch(() => undefined);
};

/** 使用者的指標、觸控或鍵盤焦點第一次進入 `ref` 的範圍時，先載入商品面板 */
export function usePreloadProductSheetOnIntent(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (el === null || sheetLoader.current() !== null) return;
    const events = ['pointerover', 'touchstart', 'focusin'] as const;
    const stop = (): void => events.forEach((name) => el.removeEventListener(name, onIntent));
    function onIntent(): void {
      stop();
      preloadProductSheet();
    }
    events.forEach((name) => el.addEventListener(name, onIntent, { passive: true }));
    return stop;
  }, [ref]);
}

export function LazyProductSheet(props: ProductSheetProps) {
  const [params] = useSearchParams();
  const active = params.has(PRODUCT_PARAM) || params.has(EDIT_PARAM);
  return <LazyOverlay loader={sheetLoader} active={active} props={props} />;
}
