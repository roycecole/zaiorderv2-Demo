// src/app/layouts/ShellHeader.tsx —— 一般頁面的頂部列（手機 AppBar / 平板與桌機 TopBar；03 §3.3）
//
// < 768：品牌（logo + 店名，點擊進店家資訊）、購物車圖示（底部 Tab 另有 菜單 / 訂單 / 我的）
// ≥ 768：品牌 + 營業狀態、插槽（菜單頁的搜尋）、購物車圖示（768–1023；≥ 1024 為右側訂單面板）、
//        查詢訂單 / 我的訂單、登入 / 我的（皆 ghost，不自動彈出，BR-33）、⌨
// 觸控面板模式：品牌 + 營業狀態 + 「大字」切換；不顯示登入、查詢訂單與鍵盤入口（03 §5.6）。
import clsx from 'clsx';
import { ShoppingCart, Type } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { IconButton, buttonClassName } from '@/components';
import { KeyHint, useKeyShortcuts, useRunHotkeyAction } from '@/features/a11y';
import { selectIsLoggedIn, useSessionStore } from '@/features/auth/sessionStore';
import { useCartStore } from '@/features/cart/cartStore';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { StoreBrand } from '@/features/store/StoreBrand';
import { useStoreInfo, useStoreStatus } from '@/features/store/queries';
import { StoreStatusBadge } from '@/features/store/StoreStatusBadge';
import { t } from '@/i18n/zh-TW';
import { ROUTES } from '@/app/routes';
import { HelpButton } from './HelpButton';

export interface ShellHeaderProps {
  /** 頂部列插槽的容器（TopbarSlot 傳送目標）；由外殼提供 */
  slotRef: (el: HTMLElement | null) => void;
}

export function ShellHeader({ slotRef }: ShellHeaderProps) {
  const kiosk = useIsKioskUi();
  const { pathname } = useLocation();
  const info = useStoreInfo();
  const status = useStoreStatus();
  const isMember = useSessionStore(selectIsLoggedIn);
  const userName = useSessionStore((s) => s.user?.name);
  const lineCount = useCartStore((s) => s.lines.length);
  const largeText = usePrefsStore((s) => s.largeText);
  const patchPrefs = usePrefsStore((s) => s.patch);
  const run = useRunHotkeyAction();
  const cartKeys = useKeyShortcuts('openCart');
  const storeKeys = useKeyShortcuts('goStore');
  const ordersKeys = useKeyShortcuts('goOrders');
  const loginKeys = useKeyShortcuts('goLogin');

  const name = info.data?.name ?? '';
  const brand = (
    <KeyHint action="goStore" className="min-w-0">
      <Link
        to={ROUTES.store}
        aria-label={name.length > 0 ? t.a11y.shell.brandOf(name) : t.store.page.title}
        aria-keyshortcuts={storeKeys}
        className="flex min-h-(--hit-size) min-w-0 items-center rounded-md py-1"
      >
        <StoreBrand name={name} logoUrl={info.data?.logoUrl} size="md" />
      </Link>
    </KeyHint>
  );

  // 觸控面板：品牌 + 營業狀態 + 大字切換
  if (kiosk) {
    return (
      <header className="sticky top-0 z-30 border-b border-border bg-bg">
        <div className="mx-auto flex h-(--topbar-h) max-w-[1440px] items-center gap-6 px-8">
          <StoreBrand name={name} logoUrl={info.data?.logoUrl} size="md" className="mr-auto" />
          {status.data !== undefined ? (
            <StoreStatusBadge status={status.data} variant="compact" announce />
          ) : null}
          <button
            type="button"
            aria-pressed={largeText}
            onClick={() => patchPrefs({ largeText: !largeText })}
            className={clsx(
              buttonClassName({ variant: largeText ? 'primary' : 'secondary', size: 'md' }),
              'select-none',
            )}
          >
            <Type aria-hidden="true" className="size-(--icon-size)" />
            {t.a11y.shell.largeText}
          </button>
        </div>
      </header>
    );
  }

  const cartLabel = t.a11y.shell.cart(lineCount);
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg">
      <div className="mx-auto flex h-(--appbar-h) max-w-[1440px] items-center gap-2 pr-2 pl-4 md:h-(--topbar-h) md:gap-4 md:px-6 lg:gap-6 lg:px-8">
        {brand}
        {status.data !== undefined && pathname !== ROUTES.home ? (
          // 菜單頁（首頁）由頁內的 StoreHeader 呈現營業狀態，頂部列不重複。
          // 以外層控制顯示：元件內建的 display utility 會蓋過傳入的 `hidden`（Tailwind 無 merge）
          <span className="hidden shrink-0 md:inline-flex">
            <StoreStatusBadge status={status.data} variant="compact" announce />
          </span>
        ) : null}
        <div ref={slotRef} data-zo-topbar-slot="" className="min-w-0 flex-1" />
        <div className="flex shrink-0 items-center gap-1">
          <span className="inline-flex lg:hidden">
            <KeyHint action="openCart">
              <IconButton
                label={cartLabel}
                aria-keyshortcuts={cartKeys}
                icon={<ShoppingCart />}
                badge={lineCount > 0 ? lineCount : undefined}
                onClick={() => run('openCart')}
              />
            </KeyHint>
          </span>
          <span className="hidden md:inline-flex">
            <KeyHint action="goOrders">
              <Link
                to={isMember ? ROUTES.orders : ROUTES.orderLookup}
                aria-keyshortcuts={ordersKeys}
                className={buttonClassName({ variant: 'ghost', size: 'md' })}
              >
                {isMember ? t.a11y.shell.myOrders : t.a11y.shell.lookupOrders}
              </Link>
            </KeyHint>
          </span>
          <span className="hidden md:inline-flex">
            <KeyHint action="goLogin">
              <Link
                to={isMember ? ROUTES.account : ROUTES.login}
                aria-keyshortcuts={loginKeys}
                className={buttonClassName({ variant: 'ghost', size: 'md' })}
              >
                {isMember ? (userName ? userName : t.a11y.shell.account) : t.a11y.shell.login}
              </Link>
            </KeyHint>
          </span>
          <HelpButton />
        </div>
      </div>
    </header>
  );
}
