// src/features/a11y/keyLabels.ts —— HOTKEYS 登錄表 → 鍵帽顯示與 aria-keyshortcuts（單一事實來源：domain/hotkeys）
import { HOTKEYS } from '@/domain/hotkeys';
import type { HotkeyAction, HotkeyDef } from '@/domain/hotkeys';

export function findHotkeyDef(action: HotkeyAction): HotkeyDef | undefined {
  return HOTKEYS.find((h) => h.action === action);
}

/** 僅用於「顯示」（⌘ 與 Ctrl）；比對快速鍵時兩者等價（resolveHotkey） */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

/** 單一鍵位字串 → 鍵帽文字陣列（組合鍵為多個元素，由 KeyHintBadge 以「+」串接） */
export function displayKeyParts(key: string, mac: boolean = isMacPlatform()): string[] {
  if (key === 'Escape') return ['Esc'];
  if (key === 'Ctrl+Enter') return [mac ? '⌘' : 'Ctrl', 'Enter'];
  return [key];
}

/** 徽章要顯示的鍵：同一動作有多個鍵時取第一個；jumpCategory 以 arg（數字）顯示 */
export function hintKeyParts(action: HotkeyAction, arg?: string): string[] | null {
  const def = findHotkeyDef(action);
  if (def === undefined) return null;
  if (action === 'jumpCategory') {
    const digit = arg ?? def.keys[0];
    return digit === undefined ? null : [digit];
  }
  const first = def.keys[0];
  return first === undefined ? null : displayKeyParts(first);
}

/** aria-keyshortcuts 的單一鍵名（ARIA 1.2：修飾鍵以 + 串接；「+」本身寫成 Plus） */
function ariaKey(key: string): string {
  if (key === '+') return 'Plus';
  if (key === 'Ctrl+Enter') return 'Control+Enter Meta+Enter';
  return key;
}

/** aria-keyshortcuts 值：同一動作的全部鍵（例：search → `s /`；submitOrder → `Control+Enter Meta+Enter`） */
export function ariaKeyshortcuts(def: HotkeyDef, arg?: string): string | undefined {
  if (def.action === 'jumpCategory') return arg;
  return def.keys.map(ariaKey).join(' ');
}
