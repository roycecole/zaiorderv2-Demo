// src/features/a11y/noticeSession.ts —— 鍵盤偵測提醒的「本次載入」狀態（只在記憶體，不持久化）
//
// 階段與「本次載入」旗標放在模組層級而非 React state，是因為外殼（AppShell / TaskLayout）是兄弟版面：
// 兩者之間切換時 HotkeyProvider 會重新掛載，但「本次載入已顯示 / 已開啟過 PG-19」與
// ⌨ 上的小圓點（SNOOZED）必須延續（FLOW-25：路由切換不清除圓點）。
// 證據歷史、計時器與暫停旗標則在 useKeyboardNotice 內（重新掛載歸零，60 秒內的證據不影響結果）。
import { createStore } from 'zustand/vanilla';
import type { NoticePhase } from '@/domain/kbdNotice';

export interface NoticeSessionState {
  phase: NoticePhase;
  /** 最近一次「剛好是快速鍵」的按鍵（HIT 變體文案） */
  hitKey: string | null;
  /** 本次載入已顯示過提醒（gate：SHOWN_THIS_LOAD） */
  shownThisLoad: boolean;
  /** 本次載入已開啟過 PG-19（gate：PREFS_OPENED_THIS_LOAD；不寫入儲存） */
  prefsOpenedThisLoad: boolean;
  /** Demo 面板是否展開（阻擋條件 DEMO_PANEL）；由 features/demo 經 useKeyboardNotice().setDemoPanelOpen 設定 */
  demoPanelOpen: boolean;
  /** Demo 重播產生的待命：沒有證據，不受 60 秒證據逾時限制 */
  replayPending: boolean;
  /** 最近一次達標證據的時間（systemClock epoch ms）；用於 60 秒證據逾時，兄弟外殼切換後仍有效 */
  evidenceAt: number | null;
  /** 遞增即請 KeyboardNotice 把焦點移到「查看全部」（FOCUS_VIEW_ALL 效果） */
  focusViewAllSeq: number;
}

const initialState = (): NoticeSessionState => ({
  phase: 'OFF',
  hitKey: null,
  shownThisLoad: false,
  prefsOpenedThisLoad: false,
  demoPanelOpen: false,
  replayPending: false,
  evidenceAt: null,
  focusViewAllSeq: 0,
});

/** 建立一份獨立的 session（測試用；app 內只使用下方的 `noticeSession`） */
export function createNoticeSession() {
  return createStore<NoticeSessionState>(initialState);
}

export const noticeSession = createNoticeSession();

/** 歸零「本次載入」狀態（測試、Demo「重置 Demo 資料」） */
export function resetNoticeSession(): void {
  noticeSession.setState(initialState(), true);
}
