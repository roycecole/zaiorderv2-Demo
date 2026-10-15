// src/features/a11y/hotkeyHooks.ts —— 快速鍵 hooks（對外契約見 index.ts）
//
// 所有 hooks 在 HotkeyProvider 之外都降級為 no-op / 預設值，讓功能元件可獨立渲染與測試。
import { useEffect } from 'react';
import type { HotkeyAction, HotkeyScope } from '@/domain/hotkeys';
import { useLatest } from '@/hooks/useLatest';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useInputModeStore, useIsKioskUi } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { useHotkeyContext } from './hotkeyContext';
import type { HotkeyHandler } from './hotkeyRuntime';
import { ariaKeyshortcuts, findHotkeyDef } from './keyLabels';

/**
 * 註冊某個快速鍵動作的處理函式（元件掛載期間有效）。
 * 是否真的觸發由 HotkeyProvider 依 prefs.hotkeysEnabled、焦點是否在輸入元件、浮層與範圍解析（domain/hotkeys.resolveHotkey）。
 * `enabled: false` 時視為未註冊（例如按鈕已停用）。handler 以最新閉包呼叫，呼叫端不需 useCallback。
 * 同一動作有多個處理器時，最後登錄（最近掛載或啟用）者優先。
 */
export function useHotkeyAction(
  action: HotkeyAction,
  handler: (arg?: string) => void,
  options?: { enabled?: boolean },
): void {
  const runtime = useHotkeyContext()?.runtime;
  const ref = useLatest<HotkeyHandler>(handler);
  const enabled = options?.enabled !== false;
  useEffect(() => {
    if (runtime === undefined || !enabled) return;
    return runtime.registerAction(action, ref);
  }, [runtime, action, enabled, ref]);
}

/**
 * 外殼專用：登錄「後備」處理器。只有頁面沒有註冊同一動作時才會執行（例如在店家頁按 `m` 回菜單）。
 * 不對外匯出於 index.ts（app/layouts 以深層路徑引用）。
 */
export function useFallbackHotkeyAction(
  action: HotkeyAction,
  handler: (arg?: string) => void,
  options?: { enabled?: boolean },
): void {
  const runtime = useHotkeyContext()?.runtime;
  const ref = useLatest<HotkeyHandler>(handler);
  const enabled = options?.enabled !== false;
  useEffect(() => {
    if (runtime === undefined || !enabled) return;
    return runtime.registerFallback(action, ref);
  }, [runtime, action, enabled, ref]);
}

/** 以程式觸發某個快速鍵動作（例：頂部購物車圖示 = `c`）；沒有處理器時回傳 false */
export function useRunHotkeyAction(): (action: HotkeyAction, arg?: string) => boolean {
  const runtime = useHotkeyContext()?.runtime;
  return (action, arg) => runtime?.run(action, arg) ?? false;
}

/**
 * 頁面宣告自己的快速鍵範圍（'menu' | 'cart' | 'checkout' | 'order'；'global' 永遠有效）。
 * 例：菜單頁 `useHotkeyScope('menu')`；離開頁面即移除。
 */
export function useHotkeyScope(scope: HotkeyScope): void {
  const runtime = useHotkeyContext()?.runtime;
  useEffect(() => {
    if (runtime === undefined) return;
    return runtime.addScope(scope);
  }, [runtime, scope]);
}

/**
 * 浮層（商品面板、購物車抽屜、確認對話框）開啟期間呼叫：背景頁面的範圍失效，只保留 `modalScope`（例：商品面板為 'sheet'）與全域的 ? / Esc。
 * 純對話框不帶 modalScope。`open=false` 時不生效。
 * 浮層本身的 Esc 關閉由 Radix（Dialog / Sheet）處理；此 hook 只負責範圍與讓位。
 */
export function useOverlayScope(open: boolean, modalScope?: HotkeyScope): void {
  const runtime = useHotkeyContext()?.runtime;
  useEffect(() => {
    if (runtime === undefined || !open) return;
    return runtime.addOverlay(modalScope);
  }, [runtime, open, modalScope]);
}

/** 單鍵快速鍵目前是否啟用（prefs.hotkeysEnabled 或 Demo inputMode=KEYBOARD_HINTS，且非觸控面板） */
export function useHotkeysEnabled(): boolean {
  const hotkeysEnabled = usePrefsStore((s) => s.hotkeysEnabled);
  const inputMode = useInputModeStore((s) => s.inputMode);
  const kiosk = useIsKioskUi();
  return !kiosk && (hotkeysEnabled || inputMode === 'KEYBOARD_HINTS');
}

/**
 * aria-keyshortcuts 的值（僅單鍵快速鍵啟用時回傳，否則 undefined；Esc / Ctrl+Enter 不受單鍵開關影響，觸控面板除外）。
 * `arg`：jumpCategory 等帶參數的動作，傳入該控制項的數字鍵。
 */
export function useKeyShortcuts(action: HotkeyAction, arg?: string): string | undefined {
  const enabled = useHotkeysEnabled();
  const kiosk = useIsKioskUi();
  const def = findHotkeyDef(action);
  if (def === undefined || kiosk) return undefined;
  if (def.alwaysOn !== true && !enabled) return undefined;
  return ariaKeyshortcuts(def, arg);
}

/**
 * 該動作的鍵帽徽章是否該顯示（KeyHint 使用）：
 * - 單鍵動作：跟隨單鍵快速鍵開關（預設隱藏；觸控面板永不顯示）
 * - Esc / Ctrl+Enter（alwaysOn）：不跟隨開關，僅桌機（hover 且 fine pointer）顯示，觸控面板除外
 */
export function useKeyHintVisible(action: HotkeyAction): boolean {
  const enabled = useHotkeysEnabled();
  const kiosk = useIsKioskUi();
  const desktopPointer = useMediaQuery('(hover: hover) and (pointer: fine)');
  const def = findHotkeyDef(action);
  if (def === undefined || kiosk) return false;
  return def.alwaysOn === true ? desktopPointer : enabled;
}
