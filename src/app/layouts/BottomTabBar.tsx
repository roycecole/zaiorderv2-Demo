// src/app/layouts/BottomTabBar.tsx —— 手機（< 768）底部 Tab：菜單 / 訂單 / 我的（03 §3.3）
//
// 任務型頁面與觸控面板不顯示；虛擬鍵盤開啟時（visualViewport 縮小）隱藏，避免遮住輸入框（EC-16）。
// 高度以 `--bottom-tab-h` 公布於外殼根元素，讓其上方的浮動元件（CartBar、Toast）可避讓。
import clsx from 'clsx';
import { Receipt, User, UtensilsCrossed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { ROUTES } from '@/app/routes';
import { selectIsLoggedIn, useSessionStore } from '@/features/auth/sessionStore';
import { t } from '@/i18n/zh-TW';

export const BOTTOM_TAB_HEIGHT_PX = 56;

/** 虛擬鍵盤是否開啟：visualViewport 高度明顯小於視窗高度 */
export function useVirtualKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (vv === null || vv === undefined) return;
    const update = (): void => setOpen(vv.height < window.innerHeight * 0.75);
    update();
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);
  return open;
}

const ITEM =
  'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs leading-4 font-semibold';

export function BottomTabBar() {
  const isMember = useSessionStore(selectIsLoggedIn);
  const keyboardOpen = useVirtualKeyboardOpen();
  const s = t.a11y.shell.bottomTab;
  if (keyboardOpen) return null;

  const tab = ({ isActive }: { isActive: boolean }): string =>
    clsx(ITEM, isActive ? 'text-brand-text' : 'text-text-sub');

  return (
    <nav
      aria-label={t.a11y.shell.nav}
      data-zo-bottom-tab=""
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-bg pb-[env(safe-area-inset-bottom,0px)] md:hidden"
    >
      <NavLink to={ROUTES.home} end className={tab}>
        <UtensilsCrossed aria-hidden="true" className="size-5" />
        {s.menu}
      </NavLink>
      <NavLink to={isMember ? ROUTES.orders : ROUTES.orderLookup} className={tab}>
        <Receipt aria-hidden="true" className="size-5" />
        {s.orders}
      </NavLink>
      <NavLink to={isMember ? ROUTES.account : ROUTES.login} className={tab}>
        <User aria-hidden="true" className="size-5" />
        {s.account}
      </NavLink>
    </nav>
  );
}
