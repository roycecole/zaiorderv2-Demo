// src/features/a11y/useShortcutsDialog.ts —— 開關「快速鍵與偏好」對話框（PG-19）
import { useMemo } from 'react';
import { useHotkeyContext } from './hotkeyContext';
import type { ShortcutsOpenOptions } from './hotkeyContext';

export interface ShortcutsDialogControls {
  isOpen: boolean;
  /**
   * 開啟 PG-19：會先標記「本次載入已開啟過偏好」並清除鍵盤提醒與 ⌨ 圓點。
   * 觸控面板模式不提供（呼叫無效）；HotkeyProvider 之外為 no-op。
   */
  open(options?: ShortcutsOpenOptions): void;
  close(): void;
}

const NOOP: ShortcutsDialogControls = {
  isOpen: false,
  open: () => undefined,
  close: () => undefined,
};

/**
 * 供頁尾、結帳頁等入口使用。
 * @example const { open } = useShortcutsDialog(); <button onClick={() => open({ focus: 'preferences' })}>偏好設定</button>
 */
export function useShortcutsDialog(): ShortcutsDialogControls {
  const shortcuts = useHotkeyContext()?.shortcuts;
  return useMemo(
    () =>
      shortcuts === undefined
        ? NOOP
        : { isOpen: shortcuts.isOpen, open: shortcuts.open, close: shortcuts.close },
    [shortcuts],
  );
}
