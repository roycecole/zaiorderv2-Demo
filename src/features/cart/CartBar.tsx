// src/features/cart/CartBar.tsx —— 浮動購物車列（CMP-16）：< 1024 顯示品項數、小計與「查看購物車」；≥ 1024 改用訂單面板
import clsx from 'clsx';
import { ChevronRight, ShoppingCart } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { Link } from 'react-router';
import { ROUTES } from '@/app/routes';
import { formatTWD } from '@/domain/format';
import { useKeyShortcuts } from '@/features/a11y';
import { t } from '@/i18n/zh-TW';
import { useCartCount } from './useCartCount';

const TOAST_OFFSET_VAR = '--toast-offset-bottom';
/** Toast 與 CartBar 之間的間距（px） */
const TOAST_GAP = 12;

/**
 * 把 CartBar 目前占用的底部空間寫入 `:root` 的 `--toast-offset-bottom`，讓 Toast 浮在它上方；
 * 隱藏或卸載時還原先前的值（07 §7.5、Toast 元件說明）。
 */
function useToastOffset(elementRef: RefObject<HTMLElement | null>, active: boolean): void {
  useLayoutEffect(() => {
    const el = elementRef.current;
    if (!active || el === null) return;
    const root = document.documentElement;
    const previous = root.style.getPropertyValue(TOAST_OFFSET_VAR);
    const update = (): void => {
      const top = el.getBoundingClientRect().top;
      const occupied = Math.max(0, Math.round(window.innerHeight - top));
      root.style.setProperty(TOAST_OFFSET_VAR, `${occupied + TOAST_GAP}px`);
    };
    update();
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
      if (previous === '') root.style.removeProperty(TOAST_OFFSET_VAR);
      else root.style.setProperty(TOAST_OFFSET_VAR, previous);
    };
  }, [elementRef, active]);
}

export interface CartBarProps {
  className?: string;
}

/**
 * 無品項時不顯示（FR-CT-01）。< 768 為底部全寬浮動列，位於外殼底部 Tab 之上
 * （外殼於根元素公布 `--bottom-tab-h`，無 Tab 或鍵盤開啟時為 0）；768–1023 為置中浮動列（寬 ≤ 520）。
 */
export function CartBar({ className }: CartBarProps) {
  const { lineCount, subtotal, isEmpty } = useCartCount();
  const linkRef = useRef<HTMLAnchorElement>(null);
  const keys = useKeyShortcuts('openCart');
  useToastOffset(linkRef, !isEmpty);

  if (isEmpty) return null;

  return (
    <div
      className={clsx(
        'pointer-events-none fixed inset-x-0 z-25 px-4',
        'bottom-[calc(var(--bottom-tab-h,0px)+env(safe-area-inset-bottom,0px)+12px)]',
        'md:inset-x-auto md:bottom-6 md:left-1/2 md:w-[min(520px,calc(100%-3rem))] md:-translate-x-1/2 md:px-0',
        'lg:hidden',
        className,
      )}
    >
      <Link
        ref={linkRef}
        to={ROUTES.cart}
        aria-keyshortcuts={keys}
        className={clsx(
          'focus-ring-fill pointer-events-auto flex min-h-14 w-full items-center gap-4 rounded-lg px-4',
          'bg-brand text-base leading-6 font-semibold text-on-brand no-underline shadow-lg',
          'transition-colors duration-150 hover:bg-brand-hover',
        )}
      >
        <span className="inline-flex items-center gap-2">
          <ShoppingCart aria-hidden="true" className="size-[22px] shrink-0" />
          {t.cart.bar.count(lineCount)}
        </span>
        <span className="tabular-nums">{formatTWD(subtotal)}</span>
        <span className="ml-auto inline-flex items-center gap-1">
          {t.cart.bar.view}
          <ChevronRight aria-hidden="true" className="size-[18px] shrink-0" />
        </span>
      </Link>
    </div>
  );
}
