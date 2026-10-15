import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { HotkeyProvider } from '../HotkeyProvider';
import {
  useFallbackHotkeyAction,
  useHotkeyAction,
  useHotkeyScope,
  useHotkeysEnabled,
  useKeyShortcuts,
  useOverlayScope,
} from '../index';
import { resetA11yState, spy } from './helpers';

beforeEach(() => {
  resetA11yState();
});

interface HarnessProps {
  handlers?: Partial<Record<Parameters<typeof useHotkeyAction>[0], (arg?: string) => void>>;
  scopes?: Array<'menu' | 'cart' | 'checkout' | 'order'>;
  overlay?: { open: boolean; scope?: 'sheet' | 'cart' };
}

function Registered({
  action,
  fn,
}: {
  action: Parameters<typeof useHotkeyAction>[0];
  fn: (a?: string) => void;
}) {
  useHotkeyAction(action, fn);
  return null;
}
function Scope({ scope }: { scope: 'menu' | 'cart' | 'checkout' | 'order' }) {
  useHotkeyScope(scope);
  return null;
}
function Overlay({ open, scope }: { open: boolean; scope?: 'sheet' | 'cart' | undefined }) {
  useOverlayScope(open, scope);
  return null;
}

function Page({ handlers = {}, scopes = ['menu'], overlay }: HarnessProps) {
  return (
    <>
      {scopes.map((s) => (
        <Scope key={s} scope={s} />
      ))}
      {Object.entries(handlers).map(([action, fn]) => (
        <Registered key={action} action={action as Parameters<typeof useHotkeyAction>[0]} fn={fn} />
      ))}
      {overlay !== undefined ? <Overlay open={overlay.open} scope={overlay.scope} /> : null}
      <input type="search" aria-label="搜尋菜單" />
      <input type="radio" aria-label="選項" />
      <button type="button">按鈕</button>
    </>
  );
}

function renderPage(props: HarnessProps = {}, providerProps: { pathname?: string } = {}) {
  return renderWithProviders(
    <HotkeyProvider {...providerProps}>
      <Page {...props} />
    </HotkeyProvider>,
  );
}

const press = (key: string, init: KeyboardEventInit = {}): void => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
};

describe('HotkeyProvider：單鍵快速鍵（FLOW-19、BR-34）', () => {
  it('預設關閉：按 c 不觸發；啟用後觸發，且命中時 preventDefault', () => {
    const openCart = spy();
    renderPage({ handlers: { openCart } });
    press('c');
    expect(openCart).not.toHaveBeenCalled();

    act(() => usePrefsStore.getState().enableHotkeys());
    const notPrevented = fireEvent.keyDown(document.body, { key: 'c' });
    expect(openCart).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false); // preventDefault 已呼叫
  });

  it('未命中的鍵不 preventDefault', () => {
    act(() => usePrefsStore.getState().enableHotkeys());
    renderPage({ handlers: { openCart: spy() } });
    expect(fireEvent.keyDown(document.body, { key: 'z' })).toBe(true);
  });

  it('焦點在輸入框內不觸發；radio 等非文字輸入元件仍會觸發', () => {
    act(() => usePrefsStore.getState().enableHotkeys());
    const openCart = spy();
    renderPage({ handlers: { openCart } });

    screen.getByLabelText('搜尋菜單').focus();
    press('c');
    expect(openCart).not.toHaveBeenCalled();

    screen.getByLabelText('選項').focus();
    press('c');
    expect(openCart).toHaveBeenCalledTimes(1);
  });

  it('輸入法組字中、長按重複、含 Alt / Ctrl / ⌘ 時不觸發；Shift + 字母不觸發', () => {
    act(() => usePrefsStore.getState().enableHotkeys());
    const openCart = spy();
    renderPage({ handlers: { openCart } });
    press('c', { isComposing: true });
    press('c', { repeat: true });
    press('c', { altKey: true });
    press('c', { ctrlKey: true });
    press('c', { metaKey: true });
    press('C', { shiftKey: true });
    expect(openCart).not.toHaveBeenCalled();
  });

  it('輸入法佔位值（Process）改以實體按鍵 code 比對', () => {
    act(() => usePrefsStore.getState().enableHotkeys());
    const openCart = spy();
    renderPage({ handlers: { openCart } });
    press('Process', { code: 'KeyC' });
    expect(openCart).toHaveBeenCalledTimes(1);
  });

  it('jumpCategory 帶入數字參數', () => {
    act(() => usePrefsStore.getState().enableHotkeys());
    const jump = spy();
    renderPage({ handlers: { jumpCategory: jump } });
    press('3');
    expect(jump).toHaveBeenCalledWith('3');
  });

  it('Ctrl / ⌘ + Enter 不受單鍵開關影響（預設關閉仍可送出）', () => {
    const submit = spy();
    renderPage({ scopes: ['checkout'], handlers: { submitOrder: submit } });
    press('Enter', { ctrlKey: true });
    press('Enter', { metaKey: true });
    expect(submit).toHaveBeenCalledTimes(2);
  });
});

describe('HotkeyProvider：浮層範圍', () => {
  it('商品面板開啟：只剩 sheet 與全域；背景範圍（含 Ctrl+Enter）失效', () => {
    act(() => usePrefsStore.getState().enableHotkeys());
    const addFocused = spy();
    const confirmAdd = spy();
    const submit = spy();
    renderPage({
      scopes: ['menu', 'checkout'],
      handlers: { addFocused, confirmAdd, submitOrder: submit },
      overlay: { open: true, scope: 'sheet' },
    });
    press('a');
    expect(confirmAdd).toHaveBeenCalledTimes(1);
    expect(addFocused).not.toHaveBeenCalled();
    press('Enter', { ctrlKey: true });
    expect(submit).not.toHaveBeenCalled();
  });

  it('浮層關閉後背景範圍恢復', () => {
    act(() => usePrefsStore.getState().enableHotkeys());
    const addFocused = spy();
    function Toggle() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>
            關閉浮層
          </button>
          <Page scopes={['menu']} handlers={{ addFocused }} overlay={{ open, scope: 'sheet' }} />
        </>
      );
    }
    renderWithProviders(
      <HotkeyProvider>
        <Toggle />
      </HotkeyProvider>,
    );
    press('a');
    expect(addFocused).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '關閉浮層' }));
    press('a');
    expect(addFocused).toHaveBeenCalledTimes(1);
  });

  it('純對話框（無 modalScope）：只剩 ? 與 Esc', () => {
    act(() => usePrefsStore.getState().enableHotkeys());
    const openCart = spy();
    renderPage({ handlers: { openCart }, overlay: { open: true } });
    press('c');
    expect(openCart).not.toHaveBeenCalled();
  });
});

describe('HotkeyProvider：Esc 順序（closeTarget）', () => {
  it('有浮層時 Esc 不呼叫 close 處理器（由 Radix 浮層自行關閉）', () => {
    const close = spy();
    renderPage({ handlers: { close }, overlay: { open: true } });
    press('Escape');
    expect(close).not.toHaveBeenCalled();
  });

  it('沒有浮層與提醒：呼叫已註冊的 close 處理器（清除搜尋）', () => {
    const close = spy();
    renderPage({ handlers: { close } });
    screen.getByLabelText('搜尋菜單').focus();
    press('Escape');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('沒有 close 處理器：搜尋框有字則清除並失焦；沒有字則不動作', () => {
    renderPage();
    const input = screen.getByLabelText<HTMLInputElement>('搜尋菜單');
    input.focus();
    fireEvent.change(input, { target: { value: '滷肉' } });
    expect(input.value).toBe('滷肉');
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(false);
    expect(input.value).toBe('');
    expect(input).not.toHaveFocus();

    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(true);
  });
});

describe('HotkeyProvider：觸控面板模式', () => {
  it('停用單鍵（即使 prefs 已啟用），仍保留 Esc 與 Ctrl/⌘ + Enter', () => {
    act(() => {
      usePrefsStore.getState().enableHotkeys();
      useInputModeStore.getState().setInputMode('KIOSK');
    });
    const openCart = spy();
    const submit = spy();
    const close = spy();
    renderPage({
      scopes: ['menu', 'checkout'],
      handlers: { openCart, submitOrder: submit, close },
    });
    press('c');
    expect(openCart).not.toHaveBeenCalled();
    press('Enter', { ctrlKey: true });
    expect(submit).toHaveBeenCalledTimes(1);
    press('Escape');
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('HotkeyProvider：? 與說明對話框', () => {
  it('未啟用時 ? 不生效；啟用後開啟並停在鍵盤快速鍵；Esc 關閉', async () => {
    renderPage();
    press('?', { shiftKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => usePrefsStore.getState().enableHotkeys());
    press('?', { shiftKey: true });
    expect(await screen.findByRole('dialog', { name: '鍵盤快速鍵與偏好' })).toBeInTheDocument();

    press('Escape');
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('? 在對話框開啟時為切換（再按一次關閉）', async () => {
    act(() => usePrefsStore.getState().enableHotkeys());
    renderPage();
    press('?', { shiftKey: true });
    await screen.findByRole('dialog');
    press('?', { shiftKey: true });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('後備處理器與 hooks', () => {
  it('頁面沒有註冊時才執行後備處理器；頁面註冊後以頁面為準', () => {
    act(() => usePrefsStore.getState().enableHotkeys());
    const fallback = spy();
    const page = spy();
    function Fallback() {
      useFallbackHotkeyAction('goMenu', fallback);
      return null;
    }
    const ui = (withPage: boolean) => (
      <HotkeyProvider>
        <Fallback />
        {withPage ? <Registered action="goMenu" fn={page} /> : null}
      </HotkeyProvider>
    );
    const { rerender } = renderWithProviders(ui(false));
    press('m');
    expect(fallback).toHaveBeenCalledTimes(1);
    rerender(ui(true));
    press('m');
    expect(page).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('enabled: false 時視為未註冊', () => {
    act(() => usePrefsStore.getState().enableHotkeys());
    const openCart = spy();
    function Disabled() {
      useHotkeyAction('openCart', openCart, { enabled: false });
      return null;
    }
    renderWithProviders(
      <HotkeyProvider>
        <Disabled />
      </HotkeyProvider>,
    );
    press('c');
    expect(openCart).not.toHaveBeenCalled();
  });

  it('useHotkeysEnabled / useKeyShortcuts：預設不輸出單鍵，Esc 與 Ctrl+Enter 不跟隨開關', () => {
    function Probe() {
      const on = useHotkeysEnabled();
      return (
        <p
          data-testid="probe"
          data-on={String(on)}
          data-cart={useKeyShortcuts('openCart') ?? ''}
          data-close={useKeyShortcuts('close') ?? ''}
          data-submit={useKeyShortcuts('submitOrder') ?? ''}
          data-jump={useKeyShortcuts('jumpCategory', '2') ?? ''}
        />
      );
    }
    renderWithProviders(<Probe />);
    const el = screen.getByTestId('probe');
    expect(el).toHaveAttribute('data-on', 'false');
    expect(el).toHaveAttribute('data-cart', '');
    expect(el).toHaveAttribute('data-close', 'Escape');
    expect(el).toHaveAttribute('data-submit', 'Control+Enter Meta+Enter');
    expect(el).toHaveAttribute('data-jump', '');

    act(() => usePrefsStore.getState().enableHotkeys());
    expect(el).toHaveAttribute('data-on', 'true');
    expect(el).toHaveAttribute('data-cart', 'c');
    expect(el).toHaveAttribute('data-jump', '2');
  });

  it('Demo inputMode = KEYBOARD_HINTS 視同啟用（不寫入偏好）', () => {
    act(() => useInputModeStore.getState().setInputMode('KEYBOARD_HINTS'));
    const openCart = spy();
    renderPage({ handlers: { openCart } });
    press('c');
    expect(openCart).toHaveBeenCalledTimes(1);
    expect(usePrefsStore.getState().hotkeysEnabled).toBe(false);
  });

  it('HotkeyProvider 之外：hooks 為 no-op，不擲錯', () => {
    function Alone() {
      useHotkeyScope('menu');
      useHotkeyAction('openCart', () => undefined);
      useOverlayScope(true, 'sheet');
      return <p>ok</p>;
    }
    renderWithProviders(<Alone />);
    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});
