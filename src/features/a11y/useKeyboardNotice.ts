// src/features/a11y/useKeyboardNotice.ts —— 鍵盤偵測提醒的 React 介面（07 §7.5）
//
// 證據歷史、階段與計時器都在記憶體（NoticeMachine / noticeSession）；本檔把它接到 React：
// - useKeyboardNoticeController：由 HotkeyProvider 建立（唯一一份），並經 context 提供
// - useKeyboardNotice：KeyboardNotice、⌨ 按鈕、Demo 面板取得 `phase` 與動作
// 不監聽 keydown：證據由 HotkeyProvider 的單一處理器 feed 進來。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useToastVisible } from '@/components';
import { t } from '@/i18n/zh-TW';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { isStorageDegraded } from '@/services/storage/appStorage';
import { systemClock } from '@/services/clock';
import { useLatest } from '@/hooks/useLatest';
import type { NoticePhase } from '@/domain/kbdNotice';
import type { HotkeyRuntime } from './hotkeyRuntime';
import { announce } from './LiveAnnouncer';
import { NoticeMachine } from './noticeMachine';
import type { NoticeDeps, NoticeEnv, NoticeEvidence } from './noticeMachine';
import { noticeSession } from './noticeSession';
import { useHotkeyContext } from './hotkeyContext';

export type NoticeVariant = 'hint' | 'hit';

export interface KeyboardNoticeApi {
  phase: NoticePhase;
  /** `'hit'`：剛按到的鍵是快速鍵，文案改為「剛才按的「c」是快速鍵…」 */
  variant: NoticeVariant;
  hitKey: string | null;
  /** ⌨ 按鈕上的小圓點（≥ 768）：提醒已被收起但尚未處理（phase === 'SNOOZED'） */
  dotVisible: boolean;
  /** 遞增即請提醒卡把焦點移到「查看全部」 */
  focusViewAllSeq: number;
  /** HotkeyProvider 的 keydown 處理器（capture 階段）分類出證據後呼叫 */
  feed(evidence: NoticeEvidence): void;
  /** 焦點在提醒內按 Esc（由 HotkeyProvider 依 closeTarget 的 'NOTICE' 結果呼叫） */
  dismiss(): void;
  /** hover、焦點在卡片內：暫停計時（頁面可見性由控制器自行處理） */
  hold(source: 'HOVER' | 'FOCUS'): void;
  release(source: 'HOVER' | 'FOCUS'): void;
  /** 被浮層、Toast、Demo 面板、結帳 / 付款路由或焦點遮擋搶走 */
  seize(): void;
  /** `viaKeyboard`：由 Enter / Space 啟動時為 true，才把焦點移到「查看全部」 */
  accept(viaKeyboard: boolean): void;
  decline(): void;
  undo(): void;
  viewAll(): void;
  /** 開啟 PG-19 之前呼叫（設旗標並清除提醒 / 圓點）；通常不需直接呼叫，請用 useShortcutsDialog().open() */
  openPrefs(): void;
  /** Demo「重播鍵盤提醒」：先呼叫 usePrefsStore.getState().resetKeyboardNotice()，再呼叫 replay() */
  replay(): void;
  /**
   * Demo 面板展開 / 收合：展開期間提醒待命，收合後才顯示。
   * features/demo 已改寫 `useInputModeStore.setDemoPanelOpen`（本 hook 會讀取），通常不需另外呼叫。
   */
  setDemoPanelOpen(open: boolean): void;
  /** KeyboardNotice 註冊卡片元素（焦點判斷與還原用） */
  registerCard(el: HTMLElement | null): void;
  isFocusInsideCard(): boolean;
}

const inert = (): void => undefined;

/** 沒有 HotkeyProvider 時的惰性實作（獨立渲染的元件與測試） */
export const INERT_NOTICE: KeyboardNoticeApi = {
  phase: 'OFF',
  variant: 'hint',
  hitKey: null,
  dotVisible: false,
  focusViewAllSeq: 0,
  feed: inert,
  dismiss: inert,
  hold: inert,
  release: inert,
  seize: inert,
  accept: inert,
  decline: inert,
  undo: inert,
  viewAll: inert,
  openPrefs: inert,
  replay: inert,
  setDemoPanelOpen: inert,
  registerCard: inert,
  isFocusInsideCard: () => false,
};

/** 取得鍵盤提醒的狀態與動作；HotkeyProvider 之外回傳惰性實作（phase 恆為 'OFF'） */
export function useKeyboardNotice(): KeyboardNoticeApi {
  return useHotkeyContext()?.notice ?? INERT_NOTICE;
}

export interface NoticeControllerOptions {
  runtime: HotkeyRuntime;
  kiosk: boolean;
  /** prefs.hotkeysEnabled 或 Demo inputMode === 'KEYBOARD_HINTS' */
  hotkeysActive: boolean;
  pathname: string | undefined;
  /** 開啟 PG-19 對話框（確認狀態的「查看全部」） */
  openDialog: () => void;
}

const hasFinePointer = (): boolean =>
  typeof window.matchMedia === 'function' ? window.matchMedia('(any-pointer: fine)').matches : true;

/** 建立並驅動鍵盤提醒的狀態機（只由 HotkeyProvider 呼叫一次） */
export function useKeyboardNoticeController(options: NoticeControllerOptions): KeyboardNoticeApi {
  const { runtime, kiosk, hotkeysActive, pathname, openDialog } = options;
  const kbdNotice = usePrefsStore((s) => s.kbdNotice);
  const toastVisible = useToastVisible();
  const demoPanelOpen = useInputModeStore((s) => s.demoPanelOpen);
  const replaySeq = useInputModeStore((s) => s.keyboardNoticeReplaySeq);
  const openDialogRef = useLatest(openDialog);

  const phase = useStore(noticeSession, (s) => s.phase);
  const hitKey = useStore(noticeSession, (s) => s.hitKey);
  const focusViewAllSeq = useStore(noticeSession, (s) => s.focusViewAllSeq);

  const [machine] = useState(() => {
    const deps: NoticeDeps = {
      now: () => systemClock.now().getTime(),
      isStorageDegraded,
      isOverlayRegistered: () => runtime.getModal().open,
      hasScope: (scope) => runtime.hasScope(scope),
      isFinePointer: hasFinePointer,
      prefs: {
        recordNoticeShown: (nowMs) => usePrefsStore.getState().recordNoticeShown(nowMs),
        enableHotkeys: () => usePrefsStore.getState().enableHotkeys(),
        disableHotkeys: () => usePrefsStore.getState().disableHotkeys(),
        declineNotice: () => usePrefsStore.getState().declineNotice(),
        undoAccept: () => usePrefsStore.getState().undoAccept(),
      },
      announce: (message) => announce(message, 'polite'),
      openShortcuts: () => openDialogRef.current(),
      messages: {
        noticeShown: t.a11y.announce.noticeShown,
        hotkeysOn: t.a11y.announce.hotkeysOn,
        hotkeysOff: t.a11y.announce.hotkeysOff,
        declined: t.a11y.announce.declined,
      },
    };
    const env: NoticeEnv = {
      kiosk,
      hotkeysActive,
      pathname,
      toastVisible,
      demoPanelOpen,
      kbdNotice,
    };
    return new NoticeMachine(deps, env);
  });

  // 輸入改變：重新評估 gate 與讓位條件
  useEffect(() => {
    machine.setEnv({ kiosk, hotkeysActive, pathname, toastVisible, demoPanelOpen, kbdNotice });
  }, [machine, kiosk, hotkeysActive, pathname, toastVisible, demoPanelOpen, kbdNotice]);

  // Demo「重播鍵盤提醒」：面板先 resetKeyboardNotice() 再遞增序號（略過證據、仍遵守阻擋條件）
  const lastReplaySeq = useRef(replaySeq);
  useEffect(() => {
    if (replaySeq === lastReplaySeq.current) return;
    lastReplaySeq.current = replaySeq;
    machine.replay();
  }, [machine, replaySeq]);

  // 啟動 / 停止（StrictMode 會重複掛載一次，activate 為冪等）
  useEffect(() => {
    machine.activate();
    return machine.deactivate;
  }, [machine]);

  // 浮層或範圍變動：已顯示者重新判斷是否被搶走
  useEffect(() => runtime.subscribe(machine.recheck), [runtime, machine]);

  return useMemo<KeyboardNoticeApi>(
    () => ({
      phase,
      variant: hitKey !== null ? 'hit' : 'hint',
      hitKey,
      dotVisible: phase === 'SNOOZED',
      focusViewAllSeq,
      feed: machine.feed,
      dismiss: machine.dismiss,
      hold: machine.hold,
      release: machine.release,
      seize: machine.seize,
      accept: machine.accept,
      decline: machine.decline,
      undo: machine.undo,
      viewAll: machine.viewAll,
      openPrefs: machine.openPrefs,
      replay: machine.replay,
      setDemoPanelOpen: machine.setDemoPanelOpen,
      registerCard: machine.registerCard,
      isFocusInsideCard: machine.isFocusInsideCard,
    }),
    [machine, phase, hitKey, focusViewAllSeq],
  );
}
