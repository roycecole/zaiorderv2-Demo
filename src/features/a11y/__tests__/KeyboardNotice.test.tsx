import { act, fireEvent, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToast } from '@/components';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { renderWithProviders } from '@/test/renderWithProviders';
import { HotkeyProvider } from '../HotkeyProvider';
import { useHotkeyScope } from '../hotkeyHooks';
import { KeyboardNotice } from '../KeyboardNotice';
import { LiveAnnouncer } from '../LiveAnnouncer';
import { noticeSession, resetNoticeSession } from '../noticeSession';
import { useKeyboardNotice } from '../useKeyboardNotice';
import type { KeyboardNoticeApi } from '../useKeyboardNotice';
import { resetA11yState, stubMatchMedia } from './helpers';

/** 測試用的外部把手：由 Probe 在 effect 中寫入最新的 API */
const handles: { notice?: KeyboardNoticeApi; toast?: ReturnType<typeof useToast> } = {};
const toastApi = {
  toast: (...args: Parameters<ReturnType<typeof useToast>['toast']>) =>
    handles.toast?.toast(...args),
  dismiss: (...args: Parameters<ReturnType<typeof useToast>['dismiss']>) =>
    handles.toast?.dismiss(...args),
};

function Probe() {
  const notice = useKeyboardNotice();
  const toast = useToast();
  useEffect(() => {
    handles.notice = notice;
    handles.toast = toast;
  });
  return <p data-testid="phase" data-phase={notice.phase} data-dot={String(notice.dotVisible)} />;
}

interface AppProps {
  pathname?: string;
  trust?: boolean;
}

function App({ pathname, trust = true }: AppProps) {
  return (
    <HotkeyProvider pathname={pathname} trustSyntheticEvents={trust}>
      <KeyboardNotice />
      <header>
        <button type="button">頂部按鈕</button>
      </header>
      <main data-testid="main">
        <input type="search" aria-label="搜尋菜單" />
        <button type="button">購物車</button>
      </main>
      <Probe />
      <LiveAnnouncer />
    </HotkeyProvider>
  );
}

const tab = (): boolean => fireEvent.keyDown(document.body, { key: 'Tab', code: 'Tab' });
const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
/** LiveAnnouncer 的 polite 區（Toast 也有 role=status，故以容器限定） */
const live = (): string =>
  document.querySelector('[data-zo-live-announcer] [role="status"]')?.textContent ?? '';
const group = (): HTMLElement | null => screen.queryByRole('group', { name: '鍵盤快速鍵提醒' });
const phase = (): string | undefined => screen.getByTestId('phase').dataset.phase;

let restoreMedia: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  restoreMedia = stubMatchMedia();
  resetA11yState();
});
afterEach(() => {
  restoreMedia();
  vi.useRealTimers();
});

describe('KeyboardNotice：偵測與顯示（FLOW-25）', () => {
  it('預設只待命，沒有任何 UI；Tab 後才顯示提醒並寫入次數、通報一次', () => {
    renderWithProviders(<App />);
    expect(group()).not.toBeInTheDocument();
    expect(phase()).toBe('WATCHING');

    const focusBefore = document.activeElement;
    tab();
    const card = group();
    expect(card).toBeInTheDocument();
    expect(screen.getByText('偵測到實體鍵盤')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '開啟' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '不用了' })).toBeInTheDocument();
    // 不搶焦點（CLS = 0、NFR-18）
    expect(document.activeElement).toBe(focusBefore);

    const prefs = usePrefsStore.getState();
    expect(prefs.kbdNotice.shownCount).toBe(1);
    expect(prefs.kbdNotice.lastShownAt).not.toBeNull();

    advance(60);
    expect(live()).toBe('偵測到實體鍵盤，可以開啟單鍵快速鍵。');
  });

  it('不位移版面：卡片為 position: fixed、在 main 之外，顯示前後主要內容不變', () => {
    renderWithProviders(<App />);
    const before = screen.getByTestId('main').innerHTML;
    tab();
    const card = group();
    expect(card).toHaveClass('fixed');
    expect(screen.getByTestId('main')).not.toContainElement(card);
    expect(screen.getByTestId('main').innerHTML).toBe(before);
    advance(12_000);
    expect(screen.getByTestId('main').innerHTML).toBe(before);
  });

  it.each([
    ['純修飾鍵 Shift', { key: 'Shift', code: 'ShiftLeft' }],
    ['Esc', { key: 'Escape', code: 'Escape' }],
    ['Space', { key: ' ', code: 'Space' }],
    ['長按重複的 Tab', { key: 'Tab', code: 'Tab', repeat: true }],
    ['輸入法組字中', { key: 'c', code: 'KeyC', isComposing: true }],
    ['含 Ctrl 的組合', { key: 'c', code: 'KeyC', ctrlKey: true }],
  ])('不是證據：%s', (_name, init) => {
    renderWithProviders(<App />);
    fireEvent.keyDown(document.body, init);
    advance(500);
    expect(group()).not.toBeInTheDocument();
    expect(phase()).toBe('WATCHING');
  });

  it('不可信事件（自動填入、腳本合成）不算證據', () => {
    renderWithProviders(<App trust={false} />);
    tab();
    advance(500);
    expect(group()).not.toBeInTheDocument();
  });

  it('剛好按到快速鍵（c）：改用「剛才按的「c」是快速鍵」文案，且按鍵本身未啟用不觸發', () => {
    renderWithProviders(<App />);
    fireEvent.keyDown(document.body, { key: 'c', code: 'KeyC' });
    expect(
      screen.getByText('剛才按的「c」是快速鍵，目前尚未開啟。要開啟單鍵快速鍵嗎？'),
    ).toBeInTheDocument();
  });

  it('純觸控裝置：單次 Enter 不夠，Tab 才達標', () => {
    restoreMedia();
    restoreMedia = stubMatchMedia(() => false);
    renderWithProviders(<App />);
    const btn = screen.getByRole('button', { name: '購物車' });
    btn.focus();
    fireEvent.keyDown(btn, { key: 'Enter', code: 'Enter' });
    advance(500);
    expect(group()).not.toBeInTheDocument();
    tab();
    expect(group()).toBeInTheDocument();
  });
});

describe('KeyboardNotice：計時、暫停與收起', () => {
  it('12 秒逾時後收起，轉為 ⌨ 上的小圓點狀態（SNOOZED），同次載入不再出現', () => {
    renderWithProviders(<App />);
    tab();
    advance(11_900);
    expect(group()).toBeInTheDocument();
    advance(200);
    expect(group()).not.toBeInTheDocument();
    expect(phase()).toBe('SNOOZED');
    expect(screen.getByTestId('phase').dataset.dot).toBe('true');
    tab();
    advance(500);
    expect(group()).not.toBeInTheDocument();
  });

  it('hover 暫停並保留剩餘時間，移出後從剩餘時間繼續', () => {
    renderWithProviders(<App />);
    tab();
    advance(5_000);
    fireEvent.mouseEnter(group()!);
    expect(phase()).toBe('PAUSED');
    advance(30_000);
    expect(group()).toBeInTheDocument();
    fireEvent.mouseLeave(group()!);
    expect(phase()).toBe('VISIBLE');
    advance(6_000);
    expect(group()).toBeInTheDocument();
    advance(1_100);
    expect(group()).not.toBeInTheDocument();
  });

  it('頁面隱藏暫停計時，回到可見後繼續', () => {
    renderWithProviders(<App />);
    tab();
    advance(4_000);
    const setVisibility = (state: DocumentVisibilityState): void => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    };
    setVisibility('hidden');
    expect(phase()).toBe('PAUSED');
    advance(60_000);
    expect(group()).toBeInTheDocument();
    setVisibility('visible');
    advance(8_100);
    expect(group()).not.toBeInTheDocument();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('焦點在卡片內時 Esc 由 HotkeyProvider 收起並還原先前焦點；焦點不在卡片內的 Esc 不被劫持', () => {
    renderWithProviders(<App />);
    const outside = screen.getByRole('button', { name: '購物車' });
    outside.focus();
    tab();
    // 焦點不在卡片內：Esc 不收起提醒
    fireEvent.keyDown(outside, { key: 'Escape' });
    expect(group()).toBeInTheDocument();

    const decline = screen.getByRole('button', { name: '不用了' });
    act(() => decline.focus());
    expect(phase()).toBe('PAUSED');
    fireEvent.keyDown(decline, { key: 'Escape' });
    expect(group()).not.toBeInTheDocument();
    expect(phase()).toBe('SNOOZED');
    expect(outside).toHaveFocus();
  });
});

describe('KeyboardNotice：動作', () => {
  it('「開啟」：寫入偏好、轉為確認狀態、通報；6 秒後收起且不留圓點', () => {
    renderWithProviders(<App />);
    tab();
    fireEvent.click(screen.getByRole('button', { name: '開啟' }), { detail: 1 });
    const prefs = usePrefsStore.getState();
    expect(prefs.hotkeysEnabled).toBe(true);
    expect(prefs.kbdNotice.outcome).toBe('ACCEPTED');
    expect(screen.getByText('已開啟單鍵快速鍵。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看全部' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '復原' })).toBeInTheDocument();
    // 滑鼠點擊不移動焦點
    expect(screen.getByRole('button', { name: '查看全部' })).not.toHaveFocus();
    advance(60);
    expect(live()).toContain('單鍵快速鍵已開啟，按問號查看全部。');

    advance(6_100);
    expect(group()).not.toBeInTheDocument();
    expect(phase()).toBe('OFF');
    expect(screen.getByTestId('phase').dataset.dot).toBe('false');
  });

  it('僅由鍵盤（Enter / Space）啟動「開啟」時，焦點移到「查看全部」', () => {
    renderWithProviders(<App />);
    tab();
    const open = screen.getByRole('button', { name: '開啟' });
    open.focus();
    fireEvent.click(open, { detail: 0 });
    expect(screen.getByRole('button', { name: '查看全部' })).toHaveFocus();
    // 焦點在卡內：確認狀態暫停計時，不會因逾時而遺失焦點
    advance(30_000);
    expect(group()).toBeInTheDocument();
  });

  it('「不用了」：不再自動提醒，不改變單鍵開關', () => {
    renderWithProviders(<App />);
    tab();
    fireEvent.click(screen.getByRole('button', { name: '不用了' }), { detail: 1 });
    expect(usePrefsStore.getState().kbdNotice.outcome).toBe('DECLINED');
    expect(usePrefsStore.getState().hotkeysEnabled).toBe(false);
    expect(group()).not.toBeInTheDocument();
    advance(60);
    expect(live()).toContain('已不再提醒。可在偏好設定開啟單鍵快速鍵。');
  });

  it('「復原」：關閉單鍵並視為「不用了」，只通報已關閉', () => {
    renderWithProviders(<App />);
    tab();
    fireEvent.click(screen.getByRole('button', { name: '開啟' }), { detail: 1 });
    advance(60);
    fireEvent.click(screen.getByRole('button', { name: '復原' }), { detail: 1 });
    const prefs = usePrefsStore.getState();
    expect(prefs.hotkeysEnabled).toBe(false);
    expect(prefs.kbdNotice.outcome).toBe('DECLINED');
    advance(60);
    expect(live()).toBe('單鍵快速鍵已關閉。');
  });

  it('「查看全部」：開啟 PG-19 並收起提醒', () => {
    renderWithProviders(<App />);
    tab();
    fireEvent.click(screen.getByRole('button', { name: '開啟' }), { detail: 1 });
    fireEvent.click(screen.getByRole('button', { name: '查看全部' }), { detail: 1 });
    expect(group()).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '鍵盤快速鍵與偏好' })).toBeInTheDocument();
    expect(noticeSession.getState().prefsOpenedThisLoad).toBe(true);
  });

  it('單鍵快速鍵被其他途徑（其他分頁）啟用：提醒立即收起', () => {
    renderWithProviders(<App />);
    tab();
    expect(group()).toBeInTheDocument();
    act(() => usePrefsStore.getState().enableHotkeys());
    expect(group()).not.toBeInTheDocument();
    expect(phase()).toBe('OFF');
  });

  it('開啟 PG-19（openPrefs）：提醒與圓點清除，本次載入不再提醒', () => {
    renderWithProviders(<App />);
    tab();
    advance(12_100);
    expect(phase()).toBe('SNOOZED');
    act(() => handles.notice?.openPrefs());
    expect(phase()).toBe('OFF');
    tab();
    advance(500);
    expect(group()).not.toBeInTheDocument();
  });
});

describe('KeyboardNotice：阻擋與讓位', () => {
  it('焦點在輸入元件時待命；離開輸入框並經 300 ms 確認後才顯示', () => {
    renderWithProviders(<App />);
    const input = screen.getByLabelText('搜尋菜單');
    input.focus();
    fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' });
    expect(phase()).toBe('PENDING');
    expect(group()).not.toBeInTheDocument();
    // 待命時不計入顯示次數
    expect(usePrefsStore.getState().kbdNotice.shownCount).toBe(0);

    input.blur();
    advance(200);
    expect(group()).not.toBeInTheDocument();
    advance(300);
    expect(group()).toBeInTheDocument();
    expect(usePrefsStore.getState().kbdNotice.shownCount).toBe(1);
  });

  it('待命的證據保留 60 秒，逾時回到 WATCHING', () => {
    renderWithProviders(<App />);
    const input = screen.getByLabelText('搜尋菜單');
    input.focus();
    fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' });
    expect(phase()).toBe('PENDING');
    advance(61_000);
    expect(phase()).toBe('WATCHING');
    input.blur();
    advance(1_000);
    expect(group()).not.toBeInTheDocument();
  });

  it('Toast 顯示中讓位，消失後再等 400 ms 才顯示', () => {
    renderWithProviders(<App />);
    act(() => {
      toastApi.toast({ message: '已加入購物車', durationMs: 0, id: 't1' });
    });
    tab();
    expect(phase()).toBe('PENDING');
    expect(group()).not.toBeInTheDocument();

    act(() => toastApi.dismiss('t1'));
    advance(300);
    expect(group()).not.toBeInTheDocument();
    advance(300);
    expect(group()).toBeInTheDocument();
  });

  it('提醒顯示中 Toast 出現：被搶走轉為「稍後」，不再出現', () => {
    renderWithProviders(<App />);
    tab();
    expect(group()).toBeInTheDocument();
    act(() => {
      toastApi.toast({ message: '已加入購物車', durationMs: 0, id: 't2' });
    });
    advance(300);
    expect(group()).not.toBeInTheDocument();
    expect(phase()).toBe('SNOOZED');
  });

  it('Demo 面板展開時待命，收合後才顯示', () => {
    renderWithProviders(<App />);
    act(() => useInputModeStore.getState().setDemoPanelOpen(true));
    tab();
    advance(1_000);
    expect(group()).not.toBeInTheDocument();
    act(() => useInputModeStore.getState().setDemoPanelOpen(false));
    advance(500);
    expect(group()).toBeInTheDocument();
  });

  it('結帳與付款路由不提醒；其他任務型頁面（訂單詳情）可提醒', () => {
    const { unmount } = renderWithProviders(<App pathname="/checkout" />);
    tab();
    advance(500);
    expect(group()).not.toBeInTheDocument();
    unmount();
    resetNoticeSession();

    const second = renderWithProviders(<App pathname="/payment/ord-1" />);
    tab();
    advance(500);
    expect(group()).not.toBeInTheDocument();
    second.unmount();
    resetNoticeSession();

    renderWithProviders(<App pathname="/orders/ord-1" />);
    tab();
    expect(group()).toBeInTheDocument();
  });

  it('頁面宣告 checkout 範圍時同樣不提醒（不依賴路由）', () => {
    function CheckoutScope() {
      useHotkeyScope('checkout');
      return null;
    }
    renderWithProviders(
      <HotkeyProvider trustSyntheticEvents>
        <CheckoutScope />
        <KeyboardNotice />
        <Probe />
      </HotkeyProvider>,
    );
    tab();
    advance(500);
    expect(group()).not.toBeInTheDocument();
    expect(phase()).toBe('PENDING');
  });

  it('顯示中進入結帳路由：直接轉為「稍後」', () => {
    const { rerender } = renderWithProviders(<App pathname="/" />);
    tab();
    expect(group()).toBeInTheDocument();
    rerender(<App pathname="/checkout" />);
    advance(300);
    expect(group()).not.toBeInTheDocument();
    expect(phase()).toBe('SNOOZED');
  });

  it('視窗高度 < 480 px 時待命不顯示', () => {
    const original = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 });
    renderWithProviders(<App />);
    tab();
    advance(1_000);
    expect(group()).not.toBeInTheDocument();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: original });
    advance(500);
    expect(group()).toBeInTheDocument();
  });

  describe('焦點遮擋（FOCUS_COVERED）', () => {
    // jsdom 沒有版面：以 getBoundingClientRect 模擬與卡片預期位置（≥ 768 的右上角）重疊
    const overlapCard = (el: HTMLElement): void => {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(600, 60, 200, 40));
    };

    it('焦點在互動元件且會被卡片遮住時待命；焦點離開後才顯示', () => {
      renderWithProviders(<App />);
      const btn = screen.getByRole('button', { name: '購物車' });
      overlapCard(btn);
      btn.focus();
      fireEvent.keyDown(btn, { key: 'c', code: 'KeyC' });
      advance(1_000);
      expect(group()).not.toBeInTheDocument();
      expect(phase()).toBe('PENDING');
      screen.getByRole('button', { name: '頂部按鈕' }).focus();
      advance(500);
      expect(group()).toBeInTheDocument();
    });

    it('焦點在 <main tabindex="-1">（點擊頁面空白處）時不算被遮住，按下快速鍵即顯示提醒', () => {
      renderWithProviders(<App />);
      const main = screen.getByTestId('main');
      main.setAttribute('tabindex', '-1');
      overlapCard(main);
      main.focus();
      expect(document.activeElement).toBe(main);
      fireEvent.keyDown(main, { key: 'c', code: 'KeyC' });
      expect(group()).toBeInTheDocument();
    });

    it('焦點在標題（路由切換後的 h1）時同樣可被卡片暫時覆蓋，不阻擋提醒', () => {
      renderWithProviders(<App />);
      const heading = document.createElement('h1');
      heading.tabIndex = -1;
      heading.textContent = '菜單';
      document.body.append(heading);
      overlapCard(heading);
      heading.focus();
      fireEvent.keyDown(heading, { key: 'c', code: 'KeyC' });
      expect(group()).toBeInTheDocument();
      heading.remove();
    });
  });
});

describe('KeyboardNotice：gate', () => {
  it('觸控面板模式：不偵測、不提醒、不寫入旗標', () => {
    act(() => useInputModeStore.getState().setInputMode('KIOSK'));
    renderWithProviders(<App />);
    expect(phase()).toBe('OFF');
    tab();
    fireEvent.keyDown(document.body, { key: 'c', code: 'KeyC' });
    advance(1_000);
    expect(group()).not.toBeInTheDocument();
    expect(usePrefsStore.getState().kbdNotice).toEqual({
      outcome: 'NONE',
      shownCount: 0,
      lastShownAt: null,
    });
  });

  it('顯示中切入觸控面板模式：立即收起', () => {
    renderWithProviders(<App />);
    tab();
    expect(group()).toBeInTheDocument();
    act(() => useInputModeStore.getState().setInputMode('KIOSK'));
    expect(group()).not.toBeInTheDocument();
    expect(phase()).toBe('OFF');
  });

  it.each([
    ['已啟用單鍵快速鍵', () => usePrefsStore.getState().enableHotkeys()],
    ['已選「不用了」', () => usePrefsStore.getState().declineNotice()],
    [
      '已提醒 2 次',
      () =>
        usePrefsStore.setState({
          kbdNotice: { outcome: 'NONE', shownCount: 2, lastShownAt: 1 },
        }),
    ],
    [
      '24 小時內提醒過',
      () =>
        usePrefsStore.setState({
          kbdNotice: { outcome: 'NONE', shownCount: 1, lastShownAt: Date.now() - 3_600_000 },
        }),
    ],
  ])('不提醒：%s', (_name, arrange) => {
    arrange();
    renderWithProviders(<App />);
    tab();
    advance(500);
    expect(group()).not.toBeInTheDocument();
  });

  it('第 2 次提醒需距上次顯示滿 24 小時', () => {
    usePrefsStore.setState({
      kbdNotice: { outcome: 'NONE', shownCount: 1, lastShownAt: Date.now() - 25 * 3_600_000 },
    });
    renderWithProviders(<App />);
    tab();
    expect(group()).toBeInTheDocument();
    expect(usePrefsStore.getState().kbdNotice.shownCount).toBe(2);
  });
});

describe('KeyboardNotice：兄弟外殼切換（重新掛載）', () => {
  it('「稍後」的 ⌨ 圓點狀態與已顯示旗標延續，不會重複提醒', () => {
    const first = renderWithProviders(<App />);
    tab();
    advance(12_100);
    expect(phase()).toBe('SNOOZED');
    first.unmount();

    renderWithProviders(<App />);
    expect(phase()).toBe('SNOOZED');
    expect(screen.getByTestId('phase').dataset.dot).toBe('true');
    tab();
    advance(500);
    expect(group()).not.toBeInTheDocument();
  });
});

describe('KeyboardNotice：Demo 重播', () => {
  it('重置旗標後遞增序號：略過證據顯示提醒（仍遵守阻擋條件）', () => {
    usePrefsStore.getState().declineNotice();
    renderWithProviders(<App />);
    tab();
    advance(500);
    expect(group()).not.toBeInTheDocument();

    act(() => {
      useInputModeStore.getState().setDemoPanelOpen(true);
      usePrefsStore.getState().resetKeyboardNotice();
      useInputModeStore.getState().requestKeyboardNoticeReplay();
    });
    expect(phase()).toBe('PENDING');
    // 重播產生的待命不受 60 秒證據逾時限制
    advance(120_000);
    expect(phase()).toBe('PENDING');
    act(() => useInputModeStore.getState().setDemoPanelOpen(false));
    advance(500);
    expect(group()).toBeInTheDocument();
  });
});
