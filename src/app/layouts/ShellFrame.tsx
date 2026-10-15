// src/app/layouts/ShellFrame.tsx —— AppShell 與 TaskLayout 共用的外殼骨架（內部元件）
//
// 順序（03 §10.2）：跳過連結 → 鍵盤提醒 → 頂部列 → 公告 → <main id="main"> → 頁尾 → 底部 Tab。
// Provider 堆疊：ThemeProvider（品牌色）→ HotkeyProvider（單一 keydown 處理器、PG-19、鍵盤提醒狀態機）
// ；LiveAnnouncer、Demo 工具（env.demoMode 動態載入）與閒置守衛（觸控面板）在其內。
// ToastProvider 不在這裡（由 app/providers 提供，位於外殼之上）。
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Spinner } from '@/components';
import {
  HotkeyProvider,
  KeyboardNotice,
  LiveAnnouncer,
  SkipLinks,
  useFallbackHotkeyAction,
  useRunHotkeyAction,
} from '@/features/a11y';
import { selectIsLoggedIn, useSessionStore } from '@/features/auth/sessionStore';
import { useRememberQrTable } from '@/features/checkout/qrTable';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { AnnouncementBanner } from '@/features/store/AnnouncementBanner';
import { useStoreInfo } from '@/features/store/queries';
import { ThemeProvider } from '@/features/store/ThemeProvider';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { env } from '@/config/env';
import { t } from '@/i18n/zh-TW';
import { ROUTES } from '@/app/routes';
import { BOTTOM_TAB_HEIGHT_PX, BottomTabBar, useVirtualKeyboardOpen } from './BottomTabBar';
import { focusSearchWhenReady } from './focusSearch';
import { ShellFooter } from './ShellFooter';
import { ShellHeader } from './ShellHeader';
import { TaskHeader } from './TaskHeader';
import { TopbarSlotContext } from './TopbarSlot';
import { useDocumentAttributes } from './useDocumentAttributes';
import { useDocumentTitle, useRouteFocus } from './useRouteFocus';

// Demo 工具：僅 env.demoMode 時才會載入此 chunk（mock 於 http 建置不打包）
const DemoRoot = lazy(() => import('@/features/demo/DemoRoot'));
// 閒置守衛（含閒置警示對話框）只有觸控面板模式需要：一般瀏覽不載入
const IdleGuard = lazy(() =>
  import('@/features/kiosk/IdleGuard').then((m) => ({ default: m.IdleGuard })),
);

export interface ShellFrameProps {
  variant: 'app' | 'task';
  /** task 變體：沒有站內歷史時返回的路徑 */
  backTo?: string | undefined;
  backLabel?: string | undefined;
}

export function ShellFrame(props: ShellFrameProps) {
  const location = useLocation();
  return (
    <ThemeProvider>
      <HotkeyProvider pathname={location.pathname}>
        <ShellContent {...props} pathname={location.pathname} />
        <LiveAnnouncer />
        {env.demoMode ? (
          <Suspense fallback={null}>
            <DemoRoot />
          </Suspense>
        ) : null}
      </HotkeyProvider>
    </ThemeProvider>
  );
}

function ShellContent({
  variant,
  backTo,
  backLabel,
  pathname,
}: ShellFrameProps & { pathname: string }) {
  const navigate = useNavigate();
  const kiosk = useIsKioskUi();
  const breakpoint = useBreakpoint();
  const isMember = useSessionStore(selectIsLoggedIn);
  const info = useStoreInfo();
  const run = useRunHotkeyAction();
  const keyboardOpen = useVirtualKeyboardOpen();
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);

  useDocumentAttributes();
  useRememberQrTable();
  useDocumentTitle(info.data?.name);
  useRouteFocus(pathname);

  // 外殼的導覽後備：頁面沒有註冊同一動作時才執行（例如在店家頁按 m 回菜單）
  useFallbackHotkeyAction('goMenu', () => void navigate(ROUTES.home));
  useFallbackHotkeyAction(
    'goOrders',
    () => void navigate(isMember ? ROUTES.orders : ROUTES.orderLookup),
  );
  useFallbackHotkeyAction('goStore', () => void navigate(ROUTES.store));
  useFallbackHotkeyAction('goLogin', () => void navigate(isMember ? ROUTES.account : ROUTES.login));
  useFallbackHotkeyAction('openCart', () => void navigate(ROUTES.cart));
  useFallbackHotkeyAction('search', () => {
    if (pathname !== ROUTES.home) void navigate(ROUTES.home);
    focusSearchWhenReady();
  });

  const isTask = variant === 'task';
  // 常駐訂單面板（≥ 1024 的菜單頁）才提供「跳到購物車」
  const showCartLink = !isTask && !kiosk && breakpoint === 'lg' && pathname === ROUTES.home;
  const showTabBar = !isTask && !kiosk;
  const tabHeight = showTabBar && !keyboardOpen ? BOTTOM_TAB_HEIGHT_PX : 0;

  // Toast 與 Provider 在外殼之外：把底部 Tab 高度同步寫到 :root，讓 --toast-offset-bottom 的預設值能避讓
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--bottom-tab-h', `${tabHeight}px`);
    return () => {
      root.style.removeProperty('--bottom-tab-h');
    };
  }, [tabHeight]);

  const setSlot = useCallback((el: HTMLElement | null) => setSlotEl(el), []);

  return (
    <div
      data-zo-shell={variant}
      className="flex min-h-dvh flex-col bg-bg text-text"
      style={{ '--bottom-tab-h': `${tabHeight}px` } as CSSProperties}
    >
      <SkipLinks
        showCart={showCartLink}
        onJumpToCart={() => run('openCart')}
        showShortcuts={!kiosk}
      />
      {kiosk ? null : <KeyboardNotice />}
      {isTask ? (
        <TaskHeader backTo={backTo} backLabel={backLabel} />
      ) : (
        <ShellHeader slotRef={setSlot} />
      )}
      {isTask ? null : (
        <AnnouncementBanner className="mx-auto w-full max-w-[1440px] px-4 pt-3 md:px-6 lg:px-8" />
      )}
      <TopbarSlotContext.Provider value={slotEl}>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1440px] min-w-0 flex-1 outline-none"
        >
          <Suspense
            fallback={
              <div className="grid min-h-64 place-items-center">
                <Spinner label={t.a11y.shell.routeLoading} />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </TopbarSlotContext.Provider>
      <ShellFooter variant={variant} />
      {showTabBar ? <BottomTabBar /> : null}
      {kiosk ? (
        <Suspense fallback={null}>
          <IdleGuard />
        </Suspense>
      ) : null}
    </div>
  );
}
