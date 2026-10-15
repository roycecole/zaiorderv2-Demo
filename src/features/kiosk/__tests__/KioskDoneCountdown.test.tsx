// FLOW-21 / BR-37：完成畫面 30 秒倒數，歸零回首頁並重置；任何操作視為延長
import { fireEvent, screen } from '@testing-library/react';
import { useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as A11yModule from '@/features/a11y';
import { useCartStore } from '@/features/cart/cartStore';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { appSessionStorage, STORAGE_KEYS } from '@/services/storage/appStorage';
import { renderWithProviders } from '@/test/renderWithProviders';
import { KioskDoneCountdown } from '../KioskDoneCountdown';
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

let clock: FakeMonotonic;

beforeEach(() => {
  clock = installFakeMonotonic();
  announce.mockClear();
  useInputModeStore.setState({ inputMode: 'KIOSK' });
  useCartStore.getState().clear();
});

afterEach(() => {
  clock.restore();
  useInputModeStore.setState({ inputMode: 'AUTO' });
  vi.restoreAllMocks();
});

const text = () => screen.getByTestId('kiosk-done-countdown').textContent;

describe('KioskDoneCountdown', () => {
  it('active=false 或非觸控面板模式時不渲染', () => {
    const { rerender } = renderWithProviders(<KioskDoneCountdown active={false} />);
    expect(screen.queryByTestId('kiosk-done-countdown')).toBeNull();
    useInputModeStore.setState({ inputMode: 'AUTO' });
    rerender(<KioskDoneCountdown active />);
    expect(screen.queryByTestId('kiosk-done-countdown')).toBeNull();
  });

  it('顯示「{n} 秒後自動回到首頁」並逐秒遞減；30 秒歸零時重置並導回首頁', () => {
    useCartStore.getState().addLine({
      productId: 'p',
      quantity: 1,
      optionIds: [],
      snapshot: { name: 'x', unitPrice: 1, optionLabels: [] },
    });
    appSessionStorage.setItem(STORAGE_KEYS.checkoutDraft, JSON.stringify({ unknownBodies: [] }));
    renderWithProviders(
      <>
        <KioskDoneCountdown active />
        <Where />
      </>,
      { route: '/orders/ord_1' },
    );
    expect(text()).toBe('30 秒後自動回到首頁');
    clock.advance(10);
    expect(text()).toBe('20 秒後自動回到首頁');
    clock.advance(19);
    expect(text()).toBe('1 秒後自動回到首頁');
    expect(screen.getByTestId('path')).toHaveTextContent('/orders/ord_1');
    clock.advance(1);
    expect(screen.getByTestId('path')).toHaveTextContent('/');
    expect(useCartStore.getState().lines).toEqual([]);
    expect(appSessionStorage.getItem(STORAGE_KEYS.checkoutDraft)).toBeNull();
    expect(announce).toHaveBeenCalledWith('已重新開始', 'polite');
  });

  it('任何操作（含「再看一下」）視為延長：重新計 30 秒', () => {
    renderWithProviders(
      <>
        <KioskDoneCountdown active />
        <Where />
      </>,
      { route: '/orders/ord_1' },
    );
    clock.advance(25);
    expect(text()).toBe('5 秒後自動回到首頁');
    fireEvent.click(screen.getByRole('button', { name: '再看一下' }));
    clock.advance(1);
    expect(text()).toBe('29 秒後自動回到首頁');
    clock.advance(28);
    expect(screen.getByTestId('path')).toHaveTextContent('/orders/ord_1');
  });

  it('「開始新訂單」立即重置並回到首頁（購物車與草稿清空）', () => {
    useCartStore.getState().addLine({
      productId: 'p',
      quantity: 1,
      optionIds: [],
      snapshot: { name: 'x', unitPrice: 1, optionLabels: [] },
    });
    renderWithProviders(
      <>
        <KioskDoneCountdown active />
        <Where />
      </>,
      { route: '/orders/ord_1' },
    );
    clock.advance(3);
    fireEvent.click(screen.getByRole('button', { name: '開始新訂單' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/');
    expect(useCartStore.getState().lines).toEqual([]);
    expect(announce).toHaveBeenCalledWith('已重新開始', 'polite');
  });

  it('剩 20 秒 polite、剩 10 秒 assertive 通報，不逐秒播報；延長後重新武裝', () => {
    renderWithProviders(<KioskDoneCountdown active />);
    clock.advance(9);
    expect(announce).not.toHaveBeenCalled();
    clock.advance(1); // 剩 20
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith('20 秒後自動回到首頁', 'polite');
    clock.advance(10); // 剩 10
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith('10 秒後回到首頁，按「再看一下」可延長', 'assertive');
    clock.advance(5);
    expect(announce).toHaveBeenCalledTimes(2);
    // 延長 → 重新計時並重新武裝
    fireEvent.pointerDown(document.body);
    clock.advance(10); // 剩 20
    expect(announce).toHaveBeenCalledTimes(3);
    expect(announce).toHaveBeenLastCalledWith('20 秒後自動回到首頁', 'polite');
  });
});
