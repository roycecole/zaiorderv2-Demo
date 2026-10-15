// src/features/a11y/index.ts —— 無障礙與快速鍵的對外介面（07 §7.5、03 §10）
//
// 契約（簽名不變，其他功能依此使用）：
//   useHotkeyAction、useHotkeyScope、useOverlayScope、useHotkeysEnabled、useKeyShortcuts、KeyHint、useAnnounce
// 外殼與其他功能另可使用：
//   HotkeyProvider（內含 ShortcutsDialog，首次開啟時才載入）、KeyboardNotice、useKeyboardNotice、useShortcutsDialog、SkipLinks、
//   LiveAnnouncer、ClearMyDataLink
export {
  useHotkeyAction,
  useHotkeyScope,
  useOverlayScope,
  useHotkeysEnabled,
  useKeyShortcuts,
} from './hotkeyHooks';
export { KeyHint } from './KeyHint';
export type { KeyHintProps } from './KeyHint';
export { announce, useAnnounce, LiveAnnouncer, resetAnnouncer } from './LiveAnnouncer';
export type { LiveAnnouncerProps, Politeness } from './LiveAnnouncer';

export { HotkeyProvider } from './HotkeyProvider';
export type { HotkeyProviderProps } from './HotkeyProvider';
export { KeyboardNotice } from './KeyboardNotice';
export { useKeyboardNotice } from './useKeyboardNotice';
export type { KeyboardNoticeApi, NoticeVariant } from './useKeyboardNotice';
export type { NoticeEvidence } from './noticeMachine';
export { resetNoticeSession } from './noticeSession';
export { useShortcutsDialog } from './useShortcutsDialog';
export type { ShortcutsOpenOptions } from './hotkeyContext';
export { SkipLinks } from './SkipLinks';
export type { SkipLinksProps } from './SkipLinks';
export { ClearMyDataLink, ClearMyDataDialog, clearMyData } from './ClearMyData';
// 外殼專用（app/layouts）：程式化觸發動作與後備處理器
export { useFallbackHotkeyAction, useRunHotkeyAction } from './hotkeyHooks';
