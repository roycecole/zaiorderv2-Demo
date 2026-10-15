// UAT-19 / BR-37 / FLOW-21：觸控面板閒置 60 秒警示、90 秒重置；任何操作重新計時；重置只清該清的
import { act, fireEvent, screen } from '@testing-library/react';
import { useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as A11yModule from '@/features/a11y';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useCartStore } from '@/features/cart/cartStore';
import { useGuestOrdersStore } from '@/features/orders/guestOrdersStore';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { appSessionStorage, STORAGE_KEYS } from '@/services/storage/appStorage';
import { renderWithProviders } from '@/test/renderWithProviders';
import { IdleGuard } from '../IdleGuard';
import { KIOSK_RESET_EVENT } from '../resetEvent';
import { installFakeMonotonic } from './kioskTestUtils';
import type { FakeMonotonic } from './kioskTestUtils';

const announce = vi.fn();
vi.mock('@/features/a11y', async (importOriginal) => ({
  ...(await importOriginal<typeof A11yModule>()),
  useAnnounce: () => announce,
}));

function Where() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function seedCustomerData(): void {
  useCartStore.getState().addLine({
    productId: 'prd_lurou',
    quantity: 2,
    optionIds: [],
    snapshot: { name: '招牌滷肉飯', unitPrice: 35, optionLabels: [] },
  });
  usePrefsStore.getState().patch({
    guestProfile: { name: '王小明', phone: '0912345678' },
    largeText: true,
    demoBannerDismissed: true,
  });
  useSessionStore
    .getState()
    .setSession(
      { accessToken: 'a', refreshToken: 'r', expiresIn: 900 },
      {
        id: 'usr_1',
        phone: '0912345678',
        marketingOptIn: false,
        createdAt: '2026-10-01T00:00:00+08:00',
      },
    );
  useGuestOrdersStore.getState().upsert({
    orderId: 'ord_1',
    orderNo: 'ZO1',
    trackingToken: 'trk',
    placedAt: '2026-10-14T12:00:00+08:00',
  });
  appSessionStorage.setItem(
    STORAGE_KEYS.checkoutDraft,
    JSON.stringify({ idempotencyKey: 'key-1', unknownBodies: [] }),
  );
}

let clock: FakeMonotonic;

beforeEach(() => {
  clock = installFakeMonotonic();
  announce.mockClear();
  useInputModeStore.setState({ inputMode: 'KIOSK' });
  useCartStore.getState().clear();
  usePrefsStore.getState().reset();
  useSessionStore.getState().clear();
  useGuestOrdersStore.getState().clear();
  appSessionStorage.removeItem(STORAGE_KEYS.checkoutDraft);
});

afterEach(() => {
  clock.restore();
  useInputModeStore.setState({ inputMode: 'AUTO' });
  vi.restoreAllMocks();
});

const warning = () => screen.queryByRole('alertdialog');

describe('非觸控面板模式', () => {
  it('不渲染任何東西，也不掛全域監聽', () => {
    useInputModeStore.setState({ inputMode: 'AUTO' });
    const add = vi.spyOn(window, 'addEventListener');
    const { container } = renderWithProviders(<IdleGuard />);
    expect(container.querySelector('[role="alertdialog"], [role="dialog"]')).toBeNull();
    expect(add.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(0);
    clock.advance(120);
    expect(warning()).toBeNull();
  });
});

describe('閒置警示（60 秒）與重置（90 秒）', () => {
  it('59 秒沒有警示；60 秒出現「還在嗎？」alertdialog，倒數 30 秒並逐秒遞減', () => {
    renderWithProviders(<IdleGuard />);
    clock.advance(59);
    expect(warning()).toBeNull();
    clock.advance(1);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('還在嗎？');
    expect(dialog).toHaveTextContent('30');
    expect(dialog).toHaveTextContent('秒後將重新開始，購物車會清空');
    clock.advance(5);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('25');
  });

  it('警示開啟時焦點在「繼續點餐」；按下後警示消失並重新計時', () => {
    renderWithProviders(<IdleGuard />);
    clock.advance(60);
    const continueBtn = screen.getByRole('button', { name: '繼續點餐' });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(continueBtn).toHaveFocus();
    fireEvent.click(continueBtn);
    expect(warning()).toBeNull();
    clock.advance(59);
    expect(warning()).toBeNull();
    clock.advance(1);
    expect(warning()).not.toBeNull();
  });

  it('Esc 等同繼續點餐（安全的預設動作）', () => {
    renderWithProviders(<IdleGuard />);
    clock.advance(60);
    expect(warning()).not.toBeNull();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(warning()).toBeNull();
  });

  it.each([
    ['pointerdown', (t: Element) => fireEvent.pointerDown(t)],
    ['touchstart', (t: Element) => fireEvent.touchStart(t)],
    ['keydown', (t: Element) => fireEvent.keyDown(t, { key: 'a' })],
    ['wheel', (t: Element) => fireEvent.wheel(t)],
    ['scroll', (t: Element) => fireEvent.scroll(t)],
  ])('操作（%s）重新計時，不會在原本的 60 秒警示', (_name, fire) => {
    renderWithProviders(<IdleGuard />);
    clock.advance(50);
    fire(document.body);
    clock.advance(59);
    expect(warning()).toBeNull();
    clock.advance(1);
    expect(warning()).not.toBeNull();
  });

  it('警示中任何操作視為延長（回到 ACTIVE）', () => {
    renderWithProviders(<IdleGuard />);
    clock.advance(70);
    expect(warning()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    clock.advance(1);
    expect(warning()).toBeNull();
  });

  it('90 秒重置：清空購物車 / 偏好 / 登入 / 本機訂單 / 結帳草稿，通知持有記憶體狀態的元件，導回首頁', () => {
    seedCustomerData();
    const resetListener = vi.fn();
    window.addEventListener(KIOSK_RESET_EVENT, resetListener);
    renderWithProviders(
      <>
        <IdleGuard />
        <Where />
      </>,
      { route: '/checkout' },
    );
    expect(screen.getByTestId('path')).toHaveTextContent('/checkout');
    clock.advance(89);
    expect(resetListener).not.toHaveBeenCalled();
    expect(useCartStore.getState().lines).toHaveLength(1);

    clock.advance(1);
    expect(resetListener).toHaveBeenCalledTimes(1);
    expect(useCartStore.getState().lines).toEqual([]);
    expect(usePrefsStore.getState().guestProfile).toBeNull();
    expect(usePrefsStore.getState().largeText).toBe(false);
    expect(useSessionStore.getState().user).toBeNull();
    expect(useSessionStore.getState().tokens).toBeNull();
    expect(useGuestOrdersStore.getState().orders).toEqual([]);
    expect(appSessionStorage.getItem(STORAGE_KEYS.checkoutDraft)).toBeNull();
    expect(screen.getByTestId('path')).toHaveTextContent('/');
    // 通報（polite）
    expect(announce).toHaveBeenCalledWith('已重新開始', 'polite');
    // 重置後回到 ACTIVE：警示已關閉，之後再放著不動仍會重新警示
    expect(warning()).toBeNull();
    clock.advance(60);
    expect(warning()).not.toBeNull();
    window.removeEventListener(KIOSK_RESET_EVENT, resetListener);
  });

  it('重置不碰 Mock 的 db / demo 鍵與分頁模式旗標', () => {
    const keys = ['zaiorder:v1:db', 'zaiorder:v1:demo'];
    for (const k of keys) window.localStorage.setItem(k, `seed-${k}`);
    window.sessionStorage.setItem(STORAGE_KEYS.mode, 'kiosk');
    renderWithProviders(<IdleGuard />);
    seedCustomerData();
    clock.advance(90);
    for (const k of keys) expect(window.localStorage.getItem(k)).toBe(`seed-${k}`);
    expect(window.sessionStorage.getItem(STORAGE_KEYS.mode)).toBe('kiosk');
    for (const k of keys) window.localStorage.removeItem(k);
    window.sessionStorage.removeItem(STORAGE_KEYS.mode);
  });

  it('重置會一併登出 Mock session（忽略錯誤）', () => {
    // fakeApi 預設的 auth.logout 為「未提供」→ rejected promise；重置不得因此失敗
    renderWithProviders(
      <>
        <IdleGuard />
        <Where />
      </>,
      { route: '/cart' },
    );
    clock.advance(90);
    expect(screen.getByTestId('path')).toHaveTextContent('/');
  });

  it('按「重新開始」立即重置', () => {
    seedCustomerData();
    renderWithProviders(
      <>
        <IdleGuard />
        <Where />
      </>,
      { route: '/cart' },
    );
    clock.advance(60);
    fireEvent.click(screen.getByRole('button', { name: '重新開始' }));
    expect(useCartStore.getState().lines).toEqual([]);
    expect(screen.getByTestId('path')).toHaveTextContent('/');
    expect(warning()).toBeNull();
  });
});

describe('送出結果未知（FLOW-24、BR-41）', () => {
  it('草稿內有 unknownBodies 時警示多一行「上一筆訂單結果尚未確認，請洽櫃檯確認」；重置時一併丟棄', () => {
    appSessionStorage.setItem(
      STORAGE_KEYS.checkoutDraft,
      JSON.stringify({ idempotencyKey: 'k', unknownBodies: [{ orderType: 'DINE_IN', items: [] }] }),
    );
    renderWithProviders(<IdleGuard />);
    clock.advance(60);
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      '上一筆訂單結果尚未確認，請洽櫃檯確認',
    );
    // 警示照常出現、不延後重置
    clock.advance(30);
    expect(warning()).toBeNull();
    expect(appSessionStorage.getItem(STORAGE_KEYS.checkoutDraft)).toBeNull();
  });

  it('沒有 unknownBodies（或為空陣列）時不顯示該行', () => {
    appSessionStorage.setItem(
      STORAGE_KEYS.checkoutDraft,
      JSON.stringify({ idempotencyKey: 'k', unknownBodies: [] }),
    );
    renderWithProviders(<IdleGuard />);
    clock.advance(60);
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent('尚未確認');
  });
});

describe('螢幕閱讀器通報', () => {
  it('倒數不逐秒播報：只在剩 20 秒與 10 秒以 assertive 通報；進入警示由 alertdialog 本身朗讀', () => {
    renderWithProviders(<IdleGuard />);
    clock.advance(60); // 剩 30
    expect(announce).not.toHaveBeenCalled();
    clock.advance(9); // 剩 21
    expect(announce).not.toHaveBeenCalled();
    clock.advance(1); // 剩 20
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith(
      '20 秒後將重新開始，按「繼續點餐」可延長',
      'assertive',
    );
    clock.advance(10); // 剩 10
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith(
      '10 秒後將重新開始，按「繼續點餐」可延長',
      'assertive',
    );
    clock.advance(9); // 剩 1
    expect(announce).toHaveBeenCalledTimes(2);
  });
});

describe('單調時鐘', () => {
  it('不使用 Date / Clock：改變系統時間不影響警示時點', () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    vi.setSystemTime(new Date('2026-10-14T12:00:00+08:00'));
    renderWithProviders(<IdleGuard />);
    clock.advance(30);
    vi.setSystemTime(new Date('2030-01-01T00:00:00+08:00')); // 時間穿梭 / 系統時間調整
    clock.advance(29);
    expect(warning()).toBeNull();
    clock.advance(1);
    expect(warning()).not.toBeNull();
  });
});
