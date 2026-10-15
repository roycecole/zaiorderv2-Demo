// src/features/a11y/noticeMachine.ts —— 鍵盤偵測提醒（FLOW-25）的執行期狀態機
//
// 純函式（證據分類、門檻、gate、阻擋條件、狀態轉換）都在 domain/kbdNotice.ts；這裡只負責
// 「事件 → 純函式 → 效果」的接線與計時：證據歷史、暫停旗標、計時器皆在記憶體，階段與「本次載入」旗標
// 放在 noticeSession（兄弟外殼切換時延續）。不監聽 keydown（證據由 HotkeyProvider 的單一處理器 feed 進來）。
import { isEditableTarget } from '@/domain/hotkeys';
import type { EditableProbe } from '@/domain/hotkeys';
import {
  NOTICE_CONFIRMED_MS,
  NOTICE_EVIDENCE_TTL_MS,
  NOTICE_SETTLE_MS,
  NOTICE_TOAST_SETTLE_MS,
  NOTICE_VISIBLE_MS,
  NO_HOLDS,
  activeBlockers,
  applyHold,
  evidenceReached,
  gateOffReason,
  isHeld,
  isNoticeShown,
  nextNoticeState,
  recordEvidence,
  seizesVisibleNotice,
} from '@/domain/kbdNotice';
import type {
  EvidenceEvent,
  HoldFlags,
  HoldSource,
  KbdNoticePrefs,
  NoticeBlocker,
  NoticeEffect,
  NoticeEvent,
  NoticePhase,
} from '@/domain/kbdNotice';
import { noticeSession } from './noticeSession';
import type { NoticeSessionState } from './noticeSession';

/** 結帳（PG-04）與付款（PG-05）路由：填表與金流流程不打擾 */
export function isCheckoutOrPaymentPath(pathname: string | undefined): boolean {
  if (pathname === undefined) return false;
  return (
    pathname === '/checkout' ||
    pathname.startsWith('/checkout/') ||
    pathname.startsWith('/payment/')
  );
}

/** 一則證據（由 HotkeyProvider 的 keydown 處理器分類後 feed 進來） */
export interface NoticeEvidence {
  kind: 'NAV' | 'CHAR' | 'EDIT_TYPING';
  /** 實體鍵碼（event.code） */
  code: string;
  /** 該按鍵在啟用後會對應快速鍵時的顯示字元（HIT 變體文案「剛才按的 c 是快速鍵」） */
  hitKey?: string | undefined;
  /** 事件當下焦點是否在輸入元件（EDIT_TYPING 離開輸入框後才達標） */
  targetIsEditable?: boolean | undefined;
}

/** 由 React 層持續更新的輸入 */
export interface NoticeEnv {
  /** env.kiosk 或 inputMode === 'KIOSK' */
  kiosk: boolean;
  /** prefs.hotkeysEnabled 或 inputMode === 'KEYBOARD_HINTS' */
  hotkeysActive: boolean;
  pathname: string | undefined;
  toastVisible: boolean;
  /** Demo 面板是否展開（useInputModeStore.demoPanelOpen）；與 setDemoPanelOpen 的記憶體旗標取聯集 */
  demoPanelOpen: boolean;
  kbdNotice: KbdNoticePrefs;
}

/** 與外界互動的埠（測試可替換） */
export interface NoticeDeps {
  /** systemClock.now().getTime()（真實時間，不受 Demo 時間穿梭影響） */
  now(): number;
  isStorageDegraded(): boolean;
  /** 是否有已登錄的浮層（useOverlayScope）；DOM 中的開啟中對話框另行偵測 */
  isOverlayRegistered(): boolean;
  /** 頁面是否宣告了某個快速鍵範圍（結帳頁以 'checkout' 範圍判斷） */
  hasScope(scope: 'checkout'): boolean;
  isFinePointer(): boolean;
  prefs: {
    recordNoticeShown(nowMs: number): void;
    enableHotkeys(): void;
    disableHotkeys(): void;
    declineNotice(): void;
    undoAccept(): void;
  };
  announce(message: string): void;
  /** 實際開啟 PG-19 對話框（旗標與事件由本機器處理） */
  openShortcuts(): void;
  messages: {
    noticeShown: string;
    hotkeysOn: string;
    hotkeysOff: string;
    declined: string;
  };
}

type Timer = ReturnType<typeof setTimeout>;

const POLL_PENDING_MS = 100;
const POLL_SHOWN_MS = 250;
/** 提醒卡的預期尺寸（待命時以此推算「焦點是否被卡片遮住」） */
const CARD_HEIGHT_ESTIMATE = 120;
const CARD_MAX_WIDTH = 360;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** 提醒卡的位置（與 KeyboardNotice 的 CSS 一致）：≥ 768 錨定頂部 ⌨ 下方；< 768 在底部浮動槽 */
function expectedCardRect(): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_MAX_WIDTH, vw - 32);
  if (vw >= 768) {
    const right = vw >= 1024 ? 32 : 24;
    const top = 56;
    return { left: vw - right - width, top, right: vw - right, bottom: top + CARD_HEIGHT_ESTIMATE };
  }
  const bottom = vh - 156;
  const left = (vw - width) / 2;
  return { left, top: bottom - CARD_HEIGHT_ESTIMATE, right: left + width, bottom };
}

const CONTAINER_OR_HEADING = 'main, [role="main"], h1, h2, h3, h4, h5, h6';
const INTERACTIVE =
  'a[href], button, input, select, textarea, summary, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), ' +
  '[role="button"], [role="link"], [role="radio"], [role="checkbox"], [role="switch"], [role="tab"], ' +
  '[role="menuitem"], [role="option"], [role="spinbutton"], [role="slider"], [role="combobox"], ' +
  '[role="textbox"], [role="searchbox"]';

/**
 * 取得焦點但不是互動元件的容器或標題（`main`、標題、僅供程式移焦的 `tabindex="-1"` 區塊）：
 * 不計入「焦點被卡片遮住」；真正的控制項（連結、按鈕、輸入元件、ARIA 控制項、tabindex ≥ 0）仍會比對。
 */
function isNonInteractiveFocusTarget(el: HTMLElement): boolean {
  if (el.matches(CONTAINER_OR_HEADING)) return true;
  return el.getAttribute('tabindex') === '-1' && !el.matches(INTERACTIVE);
}

function hasOpenDialogInDom(): boolean {
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ) !== null
  );
}

export class NoticeMachine {
  private env: NoticeEnv;
  private holds: HoldFlags = NO_HOLDS;
  private remaining = NOTICE_VISIBLE_MS;
  private countdown: Timer | null = null;
  private countdownStartedAt = 0;
  private poller: ReturnType<typeof setInterval> | null = null;
  private pollerMs = 0;
  private evidence: EvidenceEvent[] = [];
  private clearSince: number | null = null;
  private lastBlockedByToast = false;
  private outsideFocus: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private active = false;

  constructor(
    private readonly deps: NoticeDeps,
    env: NoticeEnv,
    private readonly session = noticeSession,
  ) {
    this.env = env;
  }

  // ───────── 生命週期 ─────────

  activate = (): void => {
    if (this.active) return;
    this.active = true;
    document.addEventListener('focusin', this.onFocusIn);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (document.visibilityState === 'hidden') this.changeHold('HIDDEN', true);
    this.evaluateGate();
    this.syncTimers();
  };

  deactivate = (): void => {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener('focusin', this.onFocusIn);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.stopCountdown(true);
    this.stopPoller();
  };

  setEnv = (env: NoticeEnv): void => {
    this.env = env;
    if (!this.active) return;
    this.evaluateGate();
    this.recheck();
  };

  registerCard = (el: HTMLElement | null): void => {
    this.card = el;
  };

  // ───────── 讀取 ─────────

  get phase(): NoticePhase {
    return this.session.getState().phase;
  }

  isFocusInsideCard = (): boolean =>
    this.card !== null && this.card.contains(document.activeElement);

  // ───────── 事件入口 ─────────

  /** HotkeyProvider 的 keydown 處理器於分類出證據後呼叫（不 preventDefault、不吞事件） */
  feed = (ev: NoticeEvidence): void => {
    if (this.env.kiosk) return;
    const phase = this.phase;
    if (phase !== 'WATCHING' && phase !== 'PENDING') return;
    const at = this.deps.now();
    this.evidence = recordEvidence(this.evidence, { at, kind: ev.kind, code: ev.code });
    this.session.setState({
      evidenceAt: at,
      ...(ev.hitKey !== undefined ? { hitKey: ev.hitKey } : {}),
    });
    const reached = evidenceReached(this.evidence, at, {
      finePointer: this.deps.isFinePointer(),
      editableLeft: ev.targetIsEditable !== true,
    });
    if (!reached) return;
    this.dispatch({ type: 'EVIDENCE', blocked: this.blockers().length > 0 });
  };

  dismiss = (): void => this.dispatch({ type: 'ESC' });
  seize = (): void => this.dispatch({ type: 'SEIZED' });
  accept = (viaKeyboard: boolean): void => this.dispatch({ type: 'ACCEPT', viaKeyboard });
  decline = (): void => this.dispatch({ type: 'DECLINE' });
  undo = (): void => this.dispatch({ type: 'UNDO' });
  viewAll = (): void => this.dispatch({ type: 'VIEW_ALL' });

  hold = (source: HoldSource): void => this.changeHold(source, true);
  release = (source: HoldSource): void => this.changeHold(source, false);

  /** 使用者以任何入口開啟 PG-19（於對話框開啟前呼叫）：本次載入不再提醒、清除圓點 */
  openPrefs = (): void => {
    this.session.setState({ prefsOpenedThisLoad: true });
    this.dispatch({ type: 'PREFS_OPENED' });
  };

  /** Demo「重播鍵盤提醒」：略過證據、仍遵守阻擋條件；同時歸零「本次載入」旗標（prefs 由呼叫端先 resetKeyboardNotice） */
  replay = (): void => {
    if (this.env.kiosk) return;
    this.evidence = [];
    this.session.setState({
      shownThisLoad: false,
      prefsOpenedThisLoad: false,
      replayPending: true,
      evidenceAt: null,
    });
    this.dispatch({ type: 'REPLAY', blocked: this.blockers().length > 0 });
  };

  setDemoPanelOpen = (open: boolean): void => {
    this.session.setState({ demoPanelOpen: open });
    this.recheck();
  };

  /** 讓位條件可能改變（浮層、Toast、路由、Demo 面板）：已顯示者重新判斷是否被搶走 */
  recheck = (): void => {
    if (!this.active) return;
    this.checkSeized();
    this.syncTimers();
  };

  // ───────── 狀態轉換 ─────────

  private dispatch(event: NoticeEvent): void {
    const cur = this.phase;
    const inside = this.isFocusInsideCard();
    const { phase: next, effects } = nextNoticeState(cur, event, inside);

    if (next !== cur) {
      const patch: Partial<NoticeSessionState> = { phase: next };
      if (next === 'VISIBLE' && cur !== 'PAUSED') {
        this.stopCountdown(false);
        this.remaining = NOTICE_VISIBLE_MS;
        patch.replayPending = false;
      }
      if (next === 'CONFIRMED') {
        this.stopCountdown(false);
        this.remaining = NOTICE_CONFIRMED_MS;
      }
      if (next === 'OFF' || next === 'WATCHING') {
        patch.hitKey = null;
        patch.replayPending = false;
        patch.evidenceAt = null;
        this.evidence = [];
      }
      if (next === 'PENDING') {
        this.clearSince = null;
        this.lastBlockedByToast = false;
      }
      this.session.setState(patch);
    }

    for (const effect of effects) this.runEffect(effect, effects);

    // 進入 VISIBLE 時若已有暫停來源（例如頁面隱藏），立刻轉 PAUSED
    if (next === 'VISIBLE' && cur !== 'VISIBLE' && isHeld(this.holds)) {
      this.dispatch({ type: 'HOLD' });
      return;
    }
    this.syncTimers();
  }

  private runEffect(effect: NoticeEffect, all: ReadonlyArray<NoticeEffect>): void {
    const { prefs, messages } = this.deps;
    switch (effect) {
      case 'RECORD_SHOWN':
        prefs.recordNoticeShown(this.deps.now());
        this.session.setState({ shownThisLoad: true });
        this.deps.announce(messages.noticeShown);
        break;
      case 'ENABLE_HOTKEYS':
        prefs.enableHotkeys();
        this.deps.announce(messages.hotkeysOn);
        break;
      case 'DISABLE_HOTKEYS':
        // 復原 = 關閉單鍵快速鍵並視為「不用了」：一次寫入，通報只念「已關閉」
        if (all.includes('MARK_DECLINED')) prefs.undoAccept();
        else prefs.disableHotkeys();
        this.deps.announce(messages.hotkeysOff);
        break;
      case 'MARK_DECLINED':
        if (!all.includes('DISABLE_HOTKEYS')) {
          prefs.declineNotice();
          this.deps.announce(messages.declined);
        }
        break;
      case 'OPEN_SHORTCUTS':
        this.session.setState({ prefsOpenedThisLoad: true });
        this.deps.openShortcuts();
        break;
      case 'RESTORE_FOCUS': {
        const target = this.outsideFocus;
        if (target !== null && target.isConnected && !(this.card?.contains(target) ?? false)) {
          target.focus({ preventScroll: true });
        }
        break;
      }
      case 'FOCUS_VIEW_ALL':
        this.session.setState((s) => ({ focusViewAllSeq: s.focusViewAllSeq + 1 }));
        break;
    }
  }

  private changeHold(source: HoldSource, active: boolean): void {
    const { flags, event } = applyHold(this.holds, source, active);
    this.holds = flags;
    if (event !== null) this.dispatch({ type: event });
    else this.syncTimers();
  }

  // ───────── gate ─────────

  private evaluateGate(): void {
    const e = this.env;
    const s = this.session.getState();
    const reason = gateOffReason({
      kiosk: e.kiosk,
      hotkeysActive: e.hotkeysActive,
      storageDegraded: this.deps.isStorageDegraded(),
      shownThisLoad: s.shownThisLoad,
      prefsOpenedThisLoad: s.prefsOpenedThisLoad,
      notice: e.kbdNotice,
      nowMs: this.deps.now(),
    });
    if (reason === null) this.dispatch({ type: 'GATE_OPEN' });
    else if (reason === 'KIOSK') this.dispatch({ type: 'ENTER_KIOSK' });
    else if (reason === 'ENABLED' || reason === 'DECIDED')
      this.dispatch({ type: 'EXTERNAL_CHANGE' });
    else this.dispatch({ type: 'GATE_CLOSED' });
  }

  // ───────── 阻擋與讓位 ─────────

  private blockers(): NoticeBlocker[] {
    return activeBlockers({
      targetIsEditable: isEditableTarget(document.activeElement as EditableProbe | null),
      overlayOpen: this.deps.isOverlayRegistered() || hasOpenDialogInDom(),
      toastVisible: this.env.toastVisible,
      demoPanelOpen: this.env.demoPanelOpen || this.session.getState().demoPanelOpen,
      onCheckoutOrPayment:
        isCheckoutOrPaymentPath(this.env.pathname) || this.deps.hasScope('checkout'),
      pageVisible: document.visibilityState === 'visible',
      viewportHeight: window.innerHeight,
      focusCovered: this.isFocusCovered(),
    });
  }

  /** 取得焦點的元件（不在提醒卡內）與卡片矩形重疊：提醒不得遮蔽焦點（WCAG 2.4.11） */
  private isFocusCovered(): boolean {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body || el === document.documentElement) {
      return false;
    }
    if (this.card !== null && this.card.contains(el)) return false;
    // 容器與標題（例：點擊頁面空白處而取得焦點的 <main tabindex="-1">）不是「互動元件」：
    // 可被卡片暫時覆蓋（NFR-18），否則點過空白處後的第一個快速鍵永遠停在待命
    if (isNonInteractiveFocusTarget(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const card =
      this.card !== null && isNoticeShown(this.phase)
        ? this.card.getBoundingClientRect()
        : expectedCardRect();
    return overlaps(
      { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      { left: card.left, top: card.top, right: card.right, bottom: card.bottom },
    );
  }

  private checkSeized(): void {
    if (!isNoticeShown(this.phase)) return;
    if (seizesVisibleNotice(this.blockers())) this.dispatch({ type: 'SEIZED' });
  }

  // ───────── 計時 ─────────

  private startCountdown(): void {
    if (this.countdown !== null) return;
    this.countdownStartedAt = this.deps.now();
    this.countdown = setTimeout(
      () => {
        this.countdown = null;
        this.remaining = 0;
        this.dispatch({ type: 'TIMEOUT' });
      },
      Math.max(0, this.remaining),
    );
  }

  private stopCountdown(record: boolean): void {
    if (this.countdown === null) return;
    clearTimeout(this.countdown);
    this.countdown = null;
    if (record) {
      this.remaining = Math.max(0, this.remaining - (this.deps.now() - this.countdownStartedAt));
    }
  }

  private stopPoller(): void {
    if (this.poller !== null) clearInterval(this.poller);
    this.poller = null;
    this.pollerMs = 0;
  }

  private syncTimers(): void {
    if (!this.active) return;
    const phase = this.phase;
    const shown = isNoticeShown(phase);
    if (shown && !isHeld(this.holds)) this.startCountdown();
    else this.stopCountdown(true);

    const wantPollMs = phase === 'PENDING' ? POLL_PENDING_MS : shown ? POLL_SHOWN_MS : 0;
    if (wantPollMs === 0) {
      this.stopPoller();
    } else if (this.pollerMs !== wantPollMs) {
      this.stopPoller();
      this.pollerMs = wantPollMs;
      this.poller = setInterval(() => this.tick(), wantPollMs);
    }
  }

  private tick(): void {
    const phase = this.phase;
    if (phase === 'PENDING') {
      const now = this.deps.now();
      const { replayPending, evidenceAt } = this.session.getState();
      if (!replayPending && evidenceAt !== null && now - evidenceAt > NOTICE_EVIDENCE_TTL_MS) {
        this.evidence = [];
        this.session.setState({ evidenceAt: null });
        this.dispatch({ type: 'EVIDENCE_EXPIRED' });
        return;
      }
      const blockers = this.blockers();
      if (blockers.length > 0) {
        this.clearSince = null;
        this.lastBlockedByToast = blockers.includes('TOAST');
        return;
      }
      this.clearSince ??= now;
      const settle = this.lastBlockedByToast ? NOTICE_TOAST_SETTLE_MS : NOTICE_SETTLE_MS;
      if (now - this.clearSince >= settle) this.dispatch({ type: 'UNBLOCKED' });
      return;
    }
    this.checkSeized();
  }

  // ───────── DOM 事件 ─────────

  private readonly onFocusIn = (e: FocusEvent): void => {
    const target = e.target;
    if (target instanceof HTMLElement && !(this.card?.contains(target) ?? false)) {
      this.outsideFocus = target;
    }
    if (isNoticeShown(this.phase)) this.checkSeized();
  };

  private readonly onVisibility = (): void => {
    this.changeHold('HIDDEN', document.visibilityState !== 'visible');
  };
}
