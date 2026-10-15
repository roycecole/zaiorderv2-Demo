// src/features/a11y/SkipLinks.tsx —— 跳過連結（CMP-38、03 §10.2）
//
// 頁面最前面最多三個：「跳到主要內容」「跳到購物車」「鍵盤快速鍵與偏好」，取得焦點才顯示。
// 「跳到購物車」只在有常駐訂單面板（≥ 1024 的菜單頁）時出現；任務型頁面省略它，其餘相對順序不變（WCAG 3.2.6）。
// 以 onClick 處理而不依賴 hash 導覽，避免 HashRouter 把 `#main` 當成路由。
import clsx from 'clsx';
import type { MouseEvent } from 'react';
import { t } from '@/i18n/zh-TW';
import { useHotkeyContext } from './hotkeyContext';

export interface SkipLinksProps {
  /** 主要內容的元素 id，預設 `main` */
  mainId?: string;
  /** 「跳到購物車」的目標元素 id（常駐訂單面板），預設 `orderpanel`；連結需指向真實存在的元素（axe skip-link） */
  cartId?: string;
  /** 「鍵盤快速鍵與偏好」的目標元素 id（頁尾的「鍵盤快速鍵」按鈕），預設 `shortcuts` */
  shortcutsId?: string;
  /** 顯示「跳到購物車」：有常駐訂單面板（≥ 1024 的菜單頁）時為 true */
  showCart?: boolean;
  /** 觸發「跳到購物車」：通常是執行 `openCart` 動作（桌機將焦點移到訂單面板） */
  onJumpToCart?: () => void;
  /** 顯示「鍵盤快速鍵與偏好」；觸控面板模式不提供，預設 true */
  showShortcuts?: boolean;
}

/** 平常移出視窗外（仍在 Tab 順序與可存取性樹中），取得焦點才滑入（同原型的 translateY(-300%)） */
const LINK_CLASS = clsx(
  'fixed top-2 left-4 z-[100] -translate-y-[300%] rounded-md bg-text px-4 py-3',
  'text-sm leading-5 font-semibold text-bg no-underline focus:translate-y-0',
  'focus:outline-2 focus:outline-offset-2 focus:outline-brand-text',
  'kiosk:min-h-(--hit-size)',
);

export function SkipLinks({
  mainId = 'main',
  cartId = 'orderpanel',
  shortcutsId = 'shortcuts',
  showCart = false,
  onJumpToCart,
  showShortcuts = true,
}: SkipLinksProps) {
  const shortcuts = useHotkeyContext()?.shortcuts;

  const jumpToMain = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    const main = document.getElementById(mainId);
    if (main === null) return;
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    main.focus();
    if (typeof main.scrollIntoView === 'function') main.scrollIntoView({ block: 'start' });
  };

  return (
    <div data-zo-skip-links="">
      <a href={`#${mainId}`} onClick={jumpToMain} className={LINK_CLASS}>
        {t.a11y.skipLinks.main}
      </a>
      {showCart ? (
        <a
          href={`#${cartId}`}
          onClick={(event) => {
            event.preventDefault();
            onJumpToCart?.();
          }}
          className={LINK_CLASS}
        >
          {t.a11y.skipLinks.cart}
        </a>
      ) : null}
      {showShortcuts ? (
        <a
          href={`#${shortcutsId}`}
          onClick={(event) => {
            event.preventDefault();
            shortcuts?.open();
          }}
          className={LINK_CLASS}
        >
          {t.a11y.skipLinks.shortcuts}
        </a>
      ) : null}
    </div>
  );
}
