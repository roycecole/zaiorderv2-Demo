// src/features/a11y/HotkeyProvider.tsx —— 全站唯一的 keydown 處理器（FLOW-19、FLOW-25、07 §7.5）
//
// - 掛在 document 的 capture 階段，先於所有元件處理器；先分類鍵盤偵測證據（不 preventDefault、不吞事件），
//   再依 domain/hotkeys.resolveHotkey 解析 HOTKEYS 並呼叫已登錄的處理器
// - Esc 的順序依 closeTarget：浮層（由 Radix 自行關閉）→ 鍵盤提醒（焦點在其中）→ 搜尋框
// - 觸控面板模式一律停用單鍵（僅保留 Esc / Ctrl⌘+Enter）、不偵測、不提醒
// - 建立 useKeyboardNotice（狀態機）與 PG-19 對話框，並以 context 提供
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { LazyOverlay, createOverlayLoader } from '@/components';
import { classifyKeyboardEvidence, isNoticeShown } from '@/domain/kbdNotice';
import { closeTarget, isEditableTarget, normalizeKey, resolveHotkey } from '@/domain/hotkeys';
import type { EditableProbe, HotkeyContext as HotkeyResolveContext } from '@/domain/hotkeys';
import { useLatest } from '@/hooks/useLatest';
import { useInputModeStore, useIsKioskUi } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { HotkeyContext } from './hotkeyContext';
import type { HotkeyContextValue, ShortcutsOpenOptions } from './hotkeyContext';
import { createHotkeyRuntime } from './hotkeyRuntime';
import { useKeyboardNoticeController } from './useKeyboardNotice';

// PG-19 只在開啟時才需要：第一次開啟才載入（連同 Radix Dialog 與鍵位表），首屏不含
const shortcutsDialogLoader = createOverlayLoader<Record<string, never>>(() =>
  import('./ShortcutsDialog').then((m) => m.ShortcutsDialog),
);

export interface HotkeyProviderProps {
  children: ReactNode;
  /** 目前路由路徑（結帳 / 付款路由不顯示鍵盤提醒）；省略時只以 `useHotkeyScope('checkout')` 判斷 */
  pathname?: string;
  /**
   * 測試用：把合成事件（isTrusted = false）也當成可信的實體鍵盤證據。
   * jsdom 與 user-event 產生的事件一律不可信，正式環境不要傳入。
   */
  trustSyntheticEvents?: boolean;
}

/** 搜尋框是否有字（`input[type=search]` 或 role=searchbox） */
function findSearchInputWithText(): HTMLInputElement | null {
  const nodes = document.querySelectorAll<HTMLInputElement>(
    'input[type="search"], input[role="searchbox"], [role="search"] input',
  );
  for (const node of nodes) {
    if (node.value.length > 0) return node;
  }
  return null;
}

/** 清除受控的 React 輸入框：以原生 setter 寫入並送出 input 事件 */
function clearInputValue(input: HTMLInputElement): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.blur();
}

function hasOpenDialogInDom(): boolean {
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ) !== null
  );
}

export function HotkeyProvider({
  children,
  pathname,
  trustSyntheticEvents = false,
}: HotkeyProviderProps) {
  const [runtime] = useState(createHotkeyRuntime);
  const kiosk = useIsKioskUi();
  const hotkeysEnabledPref = usePrefsStore((s) => s.hotkeysEnabled);
  const forcedHints = useInputModeStore((s) => s.inputMode === 'KEYBOARD_HINTS');
  const hotkeysActive = hotkeysEnabledPref || forcedHints;
  // 觸控面板模式一律停用單鍵快速鍵（BR-36）
  const enabled = !kiosk && hotkeysActive;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogFocus, setDialogFocus] = useState<'shortcuts' | 'preferences'>('shortcuts');

  const notice = useKeyboardNoticeController({
    runtime,
    kiosk,
    hotkeysActive,
    pathname,
    openDialog: () => {
      setDialogFocus('shortcuts');
      setDialogOpen(true);
    },
  });

  // 觸控面板模式不提供 PG-19：開啟中切入觸控面板時關閉（於渲染中同步衍生狀態）
  const [prevKiosk, setPrevKiosk] = useState(kiosk);
  if (prevKiosk !== kiosk) {
    setPrevKiosk(kiosk);
    if (kiosk) setDialogOpen(false);
  }

  const { openPrefs } = notice;
  const open = useCallback(
    (options?: ShortcutsOpenOptions) => {
      if (kiosk) return;
      openPrefs();
      setDialogFocus(options?.focus ?? 'shortcuts');
      setDialogOpen(true);
    },
    [kiosk, openPrefs],
  );
  const close = useCallback(() => setDialogOpen(false), []);

  const value = useMemo<HotkeyContextValue>(
    () => ({
      runtime,
      notice,
      shortcuts: { isOpen: dialogOpen && !kiosk, open, close },
      shortcutsFocus: dialogFocus,
    }),
    [runtime, notice, dialogOpen, kiosk, open, close, dialogFocus],
  );

  const latest = useLatest({
    enabled,
    kiosk,
    notice,
    shortcuts: value.shortcuts,
    trustSyntheticEvents,
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const L = latest.current;
      const active = document.activeElement;
      const targetIsEditable = isEditableTarget(active as EditableProbe | null);
      const modal = runtime.getModal();
      const modalOpen = modal.open || hasOpenDialogInDom();

      const ctx: HotkeyResolveContext = {
        enabled: L.enabled,
        scopes: runtime.getScopes(),
        targetIsEditable,
        modalOpen,
        modalScope: modal.scope,
      };

      // 1. 鍵盤偵測證據（觸控面板不偵測；不 preventDefault、不吞事件）
      if (!L.kiosk) {
        const kind = classifyKeyboardEvidence(
          {
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
            shiftKey: e.shiftKey,
            repeat: e.repeat,
            isComposing: e.isComposing,
            isTrusted: e.isTrusted || L.trustSyntheticEvents,
            defaultPrevented: e.defaultPrevented,
            keyCode: e.keyCode,
          },
          {
            targetIsEditable,
            focusOnBody:
              active === null || active === document.body || active === document.documentElement,
            finePointer:
              typeof window.matchMedia === 'function'
                ? window.matchMedia('(any-pointer: fine)').matches
                : true,
          },
        );
        if (kind !== 'NONE') {
          // 乾跑：若已啟用，這個鍵會不會命中快速鍵（HIT 變體：剛才按的 c 是快速鍵）
          const dry = resolveHotkey(e, { ...ctx, enabled: true });
          const hitKey = dry.type === 'action' ? (normalizeKey(e) ?? undefined) : undefined;
          L.notice.feed({ kind, code: e.code, hitKey, targetIsEditable });
        }
      }

      // 2. 解析 HOTKEYS（未啟用時單鍵一律不觸發，也不 preventDefault）
      const res = resolveHotkey(e, ctx);
      if (res.type === 'none') return;

      switch (res.action) {
        case 'help': {
          e.preventDefault();
          if (L.shortcuts.isOpen) L.shortcuts.close();
          else L.shortcuts.open();
          return;
        }
        case 'close': {
          const hasCloseHandler = runtime.hasHandler('close');
          const searchInput = hasCloseHandler ? null : findSearchInputWithText();
          const target = closeTarget({
            overlayOpen: modalOpen,
            noticeVisible: isNoticeShown(L.notice.phase),
            focusInNotice: L.notice.isFocusInsideCard(),
            searchHasText: hasCloseHandler || searchInput !== null,
          });
          if (target === 'NOTICE') {
            e.preventDefault();
            L.notice.dismiss();
          } else if (target === 'SEARCH') {
            e.preventDefault();
            if (searchInput !== null) clearInputValue(searchInput);
            else runtime.run('close');
          }
          // 'OVERLAY'：由浮層元件（Radix Dialog / Sheet）自行關閉並還原焦點，這裡不重複處理
          return;
        }
        default: {
          if (runtime.run(res.action, res.arg)) e.preventDefault();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [runtime, latest]);

  return (
    <HotkeyContext.Provider value={value}>
      {children}
      <LazyOverlay loader={shortcutsDialogLoader} active={value.shortcuts.isOpen} props={{}} />
    </HotkeyContext.Provider>
  );
}
