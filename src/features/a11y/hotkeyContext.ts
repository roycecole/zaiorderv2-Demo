// src/features/a11y/hotkeyContext.ts —— HotkeyProvider 提供的 context（型別與 hook）
import { createContext, useContext } from 'react';
import type { HotkeyRuntime } from './hotkeyRuntime';
import type { KeyboardNoticeApi } from './useKeyboardNotice';

export interface ShortcutsOpenOptions {
  /** 對話框開啟後捲到哪一區：`shortcuts`（鍵盤快速鍵，預設）或 `preferences`（顯示與輸入偏好） */
  focus?: 'shortcuts' | 'preferences';
}

export interface ShortcutsControls {
  isOpen: boolean;
  /** 開啟 PG-19（觸控面板模式不提供，呼叫無效）；會先標記「本次載入已開啟過偏好」並清除提醒與圓點 */
  open(options?: ShortcutsOpenOptions): void;
  close(): void;
}

export interface HotkeyContextValue {
  runtime: HotkeyRuntime;
  notice: KeyboardNoticeApi;
  shortcuts: ShortcutsControls;
  /** 對話框要捲到的區塊（由 open(options) 設定） */
  shortcutsFocus: 'shortcuts' | 'preferences';
}

export const HotkeyContext = createContext<HotkeyContextValue | null>(null);

/** 內部使用：HotkeyProvider 之外為 null（所有公開 hooks 都以此降級為 no-op） */
export function useHotkeyContext(): HotkeyContextValue | null {
  return useContext(HotkeyContext);
}
