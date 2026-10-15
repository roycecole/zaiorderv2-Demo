import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { KeyHint } from '../KeyHint';
import { resetA11yState, stubMatchMedia } from './helpers';

let restore: () => void;
beforeEach(() => {
  resetA11yState();
  restore = stubMatchMedia((q) => q.includes('hover: hover') || q.includes('any-pointer'));
});
afterEach(() => restore());

const hint = (container: HTMLElement): Element | null => container.querySelector('kbd');

describe('KeyHint', () => {
  it('預設隱藏（單鍵快速鍵關閉）；包住的元素不受影響', () => {
    const { container } = render(
      <KeyHint action="openCart">
        <button type="button">購物車</button>
      </KeyHint>,
    );
    expect(screen.getByRole('button', { name: '購物車' })).toBeInTheDocument();
    expect(hint(container)).toBeNull();
  });

  it('啟用後顯示小寫鍵帽徽章：aria-hidden、不佔版面（絕對定位於包覆元素）、不改變按鈕名稱', () => {
    act(() => usePrefsStore.getState().enableHotkeys());
    const { container } = render(
      <KeyHint action="openCart">
        <button type="button">購物車</button>
      </KeyHint>,
    );
    const kbd = hint(container);
    expect(kbd).toHaveTextContent('c');
    const badge = kbd?.parentElement?.parentElement;
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(badge).toHaveClass('absolute');
    expect(screen.getByRole('button', { name: '購物車' })).toBeInTheDocument();
  });

  it('jumpCategory 以 arg 顯示對應數字', () => {
    act(() => usePrefsStore.getState().enableHotkeys());
    const { container } = render(
      <KeyHint action="jumpCategory" arg="4">
        <button type="button">飯類</button>
      </KeyHint>,
    );
    expect(hint(container)).toHaveTextContent('4');
  });

  it('inline 位置：行內顯示在標籤之後', () => {
    act(() => usePrefsStore.getState().enableHotkeys());
    const { container } = render(
      <KeyHint action="help" placement="inline">
        鍵盤快速鍵
      </KeyHint>,
    );
    const badge = hint(container)?.parentElement?.parentElement;
    expect(badge).not.toHaveClass('absolute');
    expect(hint(container)).toHaveTextContent('?');
  });

  it('觸控面板模式永不顯示（含 Ctrl+Enter 這類常駐說明）', () => {
    act(() => {
      usePrefsStore.getState().enableHotkeys();
      useInputModeStore.getState().setInputMode('KIOSK');
    });
    const { container } = render(
      <>
        <KeyHint action="openCart">
          <button type="button">購物車</button>
        </KeyHint>
        <KeyHint action="submitOrder">
          <button type="button">送出訂單</button>
        </KeyHint>
      </>,
    );
    expect(hint(container)).toBeNull();
  });

  it('Ctrl+Enter 不跟隨單鍵開關：桌機（hover + fine pointer）常駐', () => {
    const { container } = render(
      <KeyHint action="submitOrder">
        <button type="button">送出訂單</button>
      </KeyHint>,
    );
    expect(container.textContent).toMatch(/(Ctrl|⌘)\s*\+\s*Enter/);
  });
});
