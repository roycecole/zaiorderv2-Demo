// src/domain/kbdNotice.ts
// 實體鍵盤偵測與開啟提醒（FR-SY-18、BR-42、FLOW-25）：證據分類、門檻、gate、阻擋條件與狀態轉換。
// 全部為純函式；時間一律由呼叫端傳入 systemClock.now().getTime()（真實時間，不受 Demo 時間穿梭影響）。

export const NOTICE_VISIBLE_MS = 12_000;          // 提示狀態停留；hover / 焦點進入即暫停
export const NOTICE_CONFIRMED_MS = 6_000;         // 確認狀態停留
export const NOTICE_EVIDENCE_TTL_MS = 60_000;     // 達標但被阻擋時，證據保留時間
export const NOTICE_SETTLE_MS = 300;              // 阻擋條件解除後的確認期
export const NOTICE_TOAST_SETTLE_MS = 400;        // Toast 消失後再多等
export const NOTICE_MIN_VIEWPORT_HEIGHT = 480;    // 視窗高度低於此值不顯示
export const NOTICE_MAX_SHOWN = 2;                // 每裝置最多提醒次數（Q-16）
export const NOTICE_REPEAT_AFTER_MS = 24 * 60 * 60 * 1000;
export const TOUCH_EVIDENCE_WINDOW_MS = 10_000;   // 純觸控裝置：證據計算視窗
export const TOUCH_EVIDENCE_COUNT = 3;
export const EDIT_TYPING_COUNT = 3;
/** P2 選配，預設關閉：輸入元件內的打字不算證據（BR-42、EC-39）；開啟後才會產生 EDIT_TYPING */
export const ENABLE_EDIT_TYPING = false;

// ───────── 證據分類 ─────────

export interface KeyboardEvidenceInput {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  /** 瀏覽器自動填入、密碼管理員、擴充功能與腳本合成的事件為 false */
  isTrusted: boolean;
  /** 他人（擴充功能如 Vimium、瀏覽器）已消費；HotkeyProvider 於 capture 階段先於元件處理器執行，自家元件的 preventDefault 不會被算進來 */
  defaultPrevented: boolean;
  keyCode?: number;
}

export interface EvidenceContext {
  /** 焦點是否在會接收文字輸入的元件（isEditableTarget） */
  targetIsEditable: boolean;
  /** document.activeElement 為 body、html 或沒有焦點元素 */
  focusOnBody: boolean;
  /** matchMedia('(any-pointer: fine)') */
  finePointer: boolean;
  /** 覆寫 ENABLE_EDIT_TYPING（測試與 P2 實驗用）；省略時採預設（關閉） */
  editTyping?: boolean;
}

export type EvidenceKind = 'NAV' | 'CHAR' | 'EDIT_TYPING' | 'NONE';

// 實體鍵碼白名單：以 code 而非 key 判斷，AZERTY、Dvorak、注音等配置結果一致
const TEXT_CODE = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|NumpadAdd|NumpadSubtract|Slash|Equal|Minus)$/;
const ALNUM_CODE = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9])$/;
const ENTER_CODES: ReadonlySet<string> = new Set(['Enter', 'NumpadEnter']);
const ARROW_CODES: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * 一個 keydown 是否構成「這個裝置有實體鍵盤在用」的證據。
 * - NAV：Tab / Shift + Tab（不論焦點位置，含輸入元件內）；或 Enter、方向鍵，且目標不是可編輯元件、焦點不在 body（BR-42）
 * - CHAR：字母、數字、/ = - ?，且焦點不在輸入元件（涵蓋「按 c 卻沒反應」的時刻）
 * - EDIT_TYPING（P2 選配，預設關閉：ENABLE_EDIT_TYPING）：輸入元件內的實體字母 / 數字鍵，僅有 fine pointer 的裝置計入
 * 修飾鍵、Esc、Space、PageUp / PageDown、Home / End 與無實體 code 的事件（軟鍵盤、輸入法合成）一律為 NONE。
 */
export function classifyKeyboardEvidence(e: KeyboardEvidenceInput, ctx: EvidenceContext): EvidenceKind {
  if (!e.isTrusted || e.defaultPrevented || e.repeat || e.isComposing) return 'NONE';
  if (e.altKey || e.ctrlKey || e.metaKey) return 'NONE';
  const code = typeof e.code === 'string' ? e.code : '';
  if (code === 'Tab') return 'NAV';
  if (ctx.targetIsEditable && e.keyCode === 229) return 'NONE'; // 輸入元件內的輸入法組字
  if (ENTER_CODES.has(code) || ARROW_CODES.has(code)) {
    return !ctx.targetIsEditable && !ctx.focusOnBody ? 'NAV' : 'NONE';
  }
  if (!TEXT_CODE.test(code)) return 'NONE';
  if (!ctx.targetIsEditable) return 'CHAR';
  const editTyping = ctx.editTyping ?? ENABLE_EDIT_TYPING;
  return editTyping && ctx.finePointer && ALNUM_CODE.test(code) ? 'EDIT_TYPING' : 'NONE';
}

// ───────── 門檻 ─────────

export interface EvidenceEvent {
  at: number;
  kind: 'NAV' | 'CHAR' | 'EDIT_TYPING';
  code: string;
}

/** 記下一筆證據，並丟棄超過保留期限者（只存在記憶體，不持久化） */
export function recordEvidence(history: ReadonlyArray<EvidenceEvent>, e: EvidenceEvent): EvidenceEvent[] {
  return [...history.filter((h) => e.at - h.at <= NOTICE_EVIDENCE_TTL_MS), e];
}

/**
 * 證據是否達標：
 * - 有 fine pointer（桌機、筆電、接了觸控板或滑鼠的平板）：1 次 NAV 或 CHAR 即達標；
 *   EDIT_TYPING（P2 選配，預設不會產生）須累積 ≥ 3 次且焦點已離開輸入框（editableLeft）
 * - 純觸控裝置（外接鍵盤的平板、手機）：證據含 Tab，或 10 秒內 ≥ 3 次且至少一次非 Enter 鍵；EDIT_TYPING 不計
 */
export function evidenceReached(
  history: ReadonlyArray<EvidenceEvent>,
  nowMs: number,
  opts: { finePointer: boolean; editableLeft: boolean },
): boolean {
  const live = history.filter((h) => nowMs - h.at <= NOTICE_EVIDENCE_TTL_MS);
  const direct = live.filter((h) => h.kind !== 'EDIT_TYPING');
  if (opts.finePointer) {
    if (direct.length >= 1) return true;
    const typing = live.filter((h) => h.kind === 'EDIT_TYPING').length;
    return typing >= EDIT_TYPING_COUNT && opts.editableLeft;
  }
  if (direct.some((h) => h.code === 'Tab')) return true;
  const recent = direct.filter((h) => nowMs - h.at <= TOUCH_EVIDENCE_WINDOW_MS);
  return recent.length >= TOUCH_EVIDENCE_COUNT && recent.some((h) => !ENTER_CODES.has(h.code));
}

// ───────── 偏好與 gate ─────────

export type NoticeOutcome = 'NONE' | 'ACCEPTED' | 'DECLINED';

/** prefs.kbdNotice：只存布林、計數與時間戳，不含個資 */
export interface KbdNoticePrefs {
  outcome: NoticeOutcome;
  /** 0..2；提醒轉為 VISIBLE 的當下 +1 */
  shownCount: number;
  /** epoch ms，取自 systemClock（真實時間） */
  lastShownAt: number | null;
}

export const DEFAULT_KBD_NOTICE: KbdNoticePrefs = { outcome: 'NONE', shownCount: 0, lastShownAt: null };

export interface GateInput {
  /** env.kiosk 或 inputMode === 'KIOSK' */
  kiosk: boolean;
  /** prefs.hotkeysEnabled 或 inputMode === 'KEYBOARD_HINTS' */
  hotkeysActive: boolean;
  /** 本機儲存降級為記憶體（FR-SY-11）：不主動提醒，入口仍在 */
  storageDegraded: boolean;
  /** 本次載入是否已顯示過（記憶體旗標） */
  shownThisLoad: boolean;
  /**
   * 本次載入是否已開啟過偏好設定 PG-19（記憶體旗標：PREFS_OPENED 時設為 true，不寫入儲存）：
   * 使用者已看過開關，之後即使只切換其他偏好（大字、減少動態）而重新評估 gate 也不再提醒（R-AB(2)）
   */
  prefsOpenedThisLoad: boolean;
  notice: KbdNoticePrefs;
  nowMs: number;
}

export type GateOffReason =
  | 'KIOSK' | 'ENABLED' | 'DECIDED' | 'MAX_SHOWN' | 'TOO_SOON' | 'SHOWN_THIS_LOAD' | 'PREFS_OPENED_THIS_LOAD'
  | 'STORAGE_DEGRADED';

/** gate 關閉的原因（依序判斷）；null 代表可進入 WATCHING 累積證據 */
export function gateOffReason(g: GateInput): GateOffReason | null {
  if (g.kiosk) return 'KIOSK';
  if (g.hotkeysActive) return 'ENABLED';
  if (g.notice.outcome !== 'NONE') return 'DECIDED';
  if (g.notice.shownCount >= NOTICE_MAX_SHOWN) return 'MAX_SHOWN';
  if (g.notice.lastShownAt !== null && g.nowMs - g.notice.lastShownAt < NOTICE_REPEAT_AFTER_MS) {
    return 'TOO_SOON';
  }
  if (g.shownThisLoad) return 'SHOWN_THIS_LOAD';
  if (g.prefsOpenedThisLoad) return 'PREFS_OPENED_THIS_LOAD';
  if (g.storageDegraded) return 'STORAGE_DEGRADED';
  return null;
}

/** 鍵盤相關偏好切片：與 prefs 同一份 persist 資料（zaiorder:v1:prefs） */
export interface KeyboardPrefs {
  /** 單一開關：徽章與 aria-keyshortcuts 跟隨；預設 false（WCAG 2.1.4） */
  hotkeysEnabled: boolean;
  kbdNotice: KbdNoticePrefs;
}

export const DEFAULT_KEYBOARD_PREFS: KeyboardPrefs = {
  hotkeysEnabled: false,
  kbdNotice: DEFAULT_KBD_NOTICE,
};

/** prefs 的 persist 版本：v1 → v2 重設單鍵快速鍵預設並補 kbdNotice */
export const PREFS_VERSION = 2;

/** 啟用單鍵快速鍵（提醒的「開啟」或 PG-19 開關）：outcome 由 NONE 轉為 ACCEPTED，之後不再自動提醒 */
export function enableHotkeys(p: KeyboardPrefs): KeyboardPrefs {
  const outcome: NoticeOutcome = p.kbdNotice.outcome === 'NONE' ? 'ACCEPTED' : p.kbdNotice.outcome;
  return { hotkeysEnabled: true, kbdNotice: { ...p.kbdNotice, outcome } };
}

/** 於 PG-19 關閉單鍵快速鍵：outcome 不變（已 ACCEPTED 或 DECLINED 者不再自動提醒） */
export function disableHotkeys(p: KeyboardPrefs): KeyboardPrefs {
  return { ...p, hotkeysEnabled: false };
}

/** 提醒轉為 VISIBLE 的當下寫入（不是關閉時），因此顯示中關分頁也算一次 */
export function recordNoticeShown(p: KeyboardPrefs, nowMs: number): KeyboardPrefs {
  const shownCount = Math.min(NOTICE_MAX_SHOWN, p.kbdNotice.shownCount + 1);
  return { ...p, kbdNotice: { ...p.kbdNotice, shownCount, lastShownAt: nowMs } };
}

/** 「不用了」：不再自動提醒；不改變 hotkeysEnabled */
export function declineNotice(p: KeyboardPrefs): KeyboardPrefs {
  return { ...p, kbdNotice: { ...p.kbdNotice, outcome: 'DECLINED' } };
}

/** 確認狀態的「復原」：關閉單鍵快速鍵並視為「不用了」 */
export function undoAccept(p: KeyboardPrefs): KeyboardPrefs {
  return declineNotice(disableHotkeys(p));
}

/** Demo「重播鍵盤提醒」：旗標歸零並把單鍵快速鍵設回關閉 */
export function resetKeyboardNotice(p: KeyboardPrefs): KeyboardPrefs {
  return { ...p, hotkeysEnabled: false, kbdNotice: { ...DEFAULT_KBD_NOTICE } };
}

/**
 * persist 遷移：v1 的 hotkeysEnabled: true 無法分辨是預設還是使用者的選擇，一律重設為預設關閉並補 kbdNotice。
 * 其餘欄位原樣保留；無法辨識的資料不處理（交由 persist 回到預設）。
 */
export function migratePrefs(persisted: unknown, fromVersion: number): unknown {
  if (typeof persisted !== 'object' || persisted === null) return persisted;
  if (fromVersion >= PREFS_VERSION) return persisted;
  return { ...(persisted as Record<string, unknown>), ...DEFAULT_KEYBOARD_PREFS, kbdNotice: { ...DEFAULT_KBD_NOTICE } };
}

// ───────── 阻擋條件（讓位） ─────────

export type NoticeBlocker =
  | 'EDITABLE_FOCUS' | 'OVERLAY' | 'TOAST' | 'DEMO_PANEL' | 'ROUTE' | 'PAGE_HIDDEN' | 'SHORT_VIEWPORT'
  | 'FOCUS_COVERED';

export interface BlockerInput {
  /** 焦點在輸入元件（isEditableTarget） */
  targetIsEditable: boolean;
  /** 商品面板、購物車抽屜、對話框、閒置警示 */
  overlayOpen: boolean;
  toastVisible: boolean;
  demoPanelOpen: boolean;
  /** 路由為結帳（PG-04）或付款（PG-05） */
  onCheckoutOrPayment: boolean;
  /** document.visibilityState === 'visible' */
  pageVisible: boolean;
  viewportHeight: number;
  /**
   * 取得焦點的元件（document.activeElement，不在提醒卡片內）的矩形與卡片（PENDING 時為預期位置）重疊：
   * 提醒不得遮蔽取得焦點的元件（WCAG 2.4.11、NFR-18）
   */
  focusCovered: boolean;
}

/** 目前成立的阻擋條件（空陣列 = 可顯示）；達標後只要有任一項即保持 PENDING */
export function activeBlockers(i: BlockerInput): NoticeBlocker[] {
  const out: NoticeBlocker[] = [];
  if (i.targetIsEditable) out.push('EDITABLE_FOCUS');
  if (i.overlayOpen) out.push('OVERLAY');
  if (i.toastVisible) out.push('TOAST');
  if (i.demoPanelOpen) out.push('DEMO_PANEL');
  if (i.onCheckoutOrPayment) out.push('ROUTE');
  if (!i.pageVisible) out.push('PAGE_HIDDEN');
  if (i.viewportHeight < NOTICE_MIN_VIEWPORT_HEIGHT) out.push('SHORT_VIEWPORT');
  if (i.focusCovered) out.push('FOCUS_COVERED');
  return out;
}

/**
 * 提醒已顯示時，哪些條件會「搶走」它（轉 SNOOZED，同次載入不再出現，EC-40）：
 * 浮層、Toast、Demo 面板、結帳 / 付款路由，以及焦點被卡片遮住（於 focusin 偵測重疊）。
 * 輸入元件焦點、頁面隱藏與視窗過矮只影響「是否可顯示」。
 */
export function seizesVisibleNotice(blockers: ReadonlyArray<NoticeBlocker>): boolean {
  return blockers.some(
    (b) => b === 'OVERLAY' || b === 'TOAST' || b === 'DEMO_PANEL' || b === 'ROUTE' || b === 'FOCUS_COVERED',
  );
}

// ───────── 狀態轉換（FLOW-25） ─────────

export type NoticePhase =
  | 'OFF' | 'WATCHING' | 'PENDING' | 'VISIBLE' | 'PAUSED' | 'CONFIRMED' | 'SNOOZED' | 'DECLINED';

export type NoticeEvent =
  /** gate 可通過（載入、偏好或模式改變後重新評估） */
  | { type: 'GATE_OPEN' }
  /** gate 因次數、間隔、本次載入已顯示或儲存降級而關閉：只影響尚未顯示者 */
  | { type: 'GATE_CLOSED' }
  /** 單鍵快速鍵已被其他途徑或分頁啟用，或其他分頁已決定（開啟 / 不用了） */
  | { type: 'EXTERNAL_CHANGE' }
  | { type: 'ENTER_KIOSK' }
  /**
   * 使用者以任何入口開啟 PG-19（點 ⌨ 按鈕、跳過連結、頁尾連結）：提醒與 ⌨ 上的小圓點一併清除，本次載入不再提醒。
   * 於對話框開啟前送入，焦點交給對話框（不還原先前焦點）；路由切換不是此事件，不清除小圓點
   */
  | { type: 'PREFS_OPENED' }
  /** 證據達標；blocked = 此刻有任一阻擋條件 */
  | { type: 'EVIDENCE'; blocked: boolean }
  /** 阻擋條件解除並經確認期（300 ms；Toast 為 400 ms） */
  | { type: 'UNBLOCKED' }
  /** 證據保留 60 秒逾時；Demo 重播產生的待命沒有證據，不送出此事件（不受 60 秒限制） */
  | { type: 'EVIDENCE_EXPIRED' }
  /**
   * 暫停與繼續計時；確認狀態只暫停計時，階段不變。來源為 hover、焦點在卡片內、頁面隱藏三者的合取：
   * 任一為真即維持暫停，三者皆解除才送出 RELEASE（由 applyHold 產生，避免單一布林互相覆寫）
   */
  | { type: 'HOLD' }
  | { type: 'RELEASE' }
  | { type: 'TIMEOUT' }
  /** 被 Toast、浮層、Demo 面板、結帳 / 付款路由搶走，或焦點被卡片遮住（FOCUS_COVERED） */
  | { type: 'SEIZED' }
  /** 焦點在提醒內按 Esc（由 closeTarget 判定為 NOTICE 才送入） */
  | { type: 'ESC' }
  /** 按「開啟」；viaKeyboard = 由鍵盤（Enter / Space）啟動：只有此時才把焦點移到「查看全部」，滑鼠與觸控點擊不移動焦點 */
  | { type: 'ACCEPT'; viaKeyboard: boolean }
  | { type: 'DECLINE' }
  | { type: 'UNDO' }
  | { type: 'VIEW_ALL' }
  /** Demo「重播鍵盤提醒」：略過證據，仍遵守阻擋條件；觸控面板不送入 */
  | { type: 'REPLAY'; blocked: boolean };

export type NoticeEffect =
  /** shownCount + 1、lastShownAt = now，並以 polite 通報一次 */
  | 'RECORD_SHOWN'
  /** hotkeysEnabled = true、outcome = ACCEPTED，通報「單鍵快速鍵已開啟」 */
  | 'ENABLE_HOTKEYS'
  /** hotkeysEnabled = false，通報「單鍵快速鍵已關閉」 */
  | 'DISABLE_HOTKEYS'
  /** outcome = DECLINED，通報「已不再提醒」 */
  | 'MARK_DECLINED'
  | 'OPEN_SHORTCUTS'
  /** 收起當下焦點仍在卡片內：還原先前焦點（已不在 DOM 則留給瀏覽器）；焦點已離開卡片時不附此效果，不得移動焦點（R-Z） */
  | 'RESTORE_FOCUS'
  /** 確認狀態：僅由鍵盤啟動「開啟」時，焦點才由「開啟」移到「查看全部」，避免焦點遺失 */
  | 'FOCUS_VIEW_ALL';

export interface NoticeTransition {
  phase: NoticePhase;
  effects: NoticeEffect[];
}

const stay = (phase: NoticePhase): NoticeTransition => ({ phase, effects: [] });
const go = (phase: NoticePhase, ...effects: NoticeEffect[]): NoticeTransition => ({ phase, effects });

/** 提醒卡片是否在畫面上 */
export function isNoticeShown(phase: NoticePhase): boolean {
  return phase === 'VISIBLE' || phase === 'PAUSED' || phase === 'CONFIRMED';
}

// ───────── 暫停來源的合取（FLOW-25 的 PAUSED） ─────────

/** 暫停計時的三個來源：滑鼠停留、焦點在卡片內、頁面隱藏 */
export type HoldSource = 'HOVER' | 'FOCUS' | 'HIDDEN';
export type HoldFlags = Readonly<Record<HoldSource, boolean>>;

export const NO_HOLDS: HoldFlags = { HOVER: false, FOCUS: false, HIDDEN: false };

/** 任一來源為真即維持暫停；三者皆解除才繼續計時 */
export function isHeld(flags: HoldFlags): boolean {
  return flags.HOVER || flags.FOCUS || flags.HIDDEN;
}

/**
 * 更新某個來源後的旗標，以及要送入 nextNoticeState 的事件（'HOLD' 或 'RELEASE'）；
 * 整體暫停狀態沒有改變時為 null（例如滑鼠移出但焦點仍在卡片內，不得送出 RELEASE）。
 */
export function applyHold(
  flags: HoldFlags,
  source: HoldSource,
  active: boolean,
): { flags: HoldFlags; event: 'HOLD' | 'RELEASE' | null } {
  const next: HoldFlags = { ...flags, [source]: active };
  const before = isHeld(flags);
  const after = isHeld(next);
  return { flags: next, event: after === before ? null : after ? 'HOLD' : 'RELEASE' };
}

/**
 * 依 FLOW-25 的狀態圖與圖下補充轉換；未列出的（狀態，事件）組合維持原狀態。
 * focusInsideCard：事件發生當下 document.activeElement 是否在提醒卡片內（由呼叫端取得）。
 * 收起時只有焦點仍在卡片內才附 'RESTORE_FOCUS'；焦點已離開（已 Tab 到搜尋框，或被浮層帶走）時不附，
 * 不得移動焦點（R-Z、WCAG 3.2.1）。
 */
export function nextNoticeState(phase: NoticePhase, e: NoticeEvent, focusInsideCard: boolean): NoticeTransition {
  const restore: NoticeEffect[] = focusInsideCard ? ['RESTORE_FOCUS'] : [];
  if (e.type === 'ENTER_KIOSK') {
    if (phase === 'OFF') return stay('OFF');
    return isNoticeShown(phase) ? go('OFF', ...restore) : go('OFF');
  }
  if (e.type === 'PREFS_OPENED') {
    // 焦點交給 PG-19，不還原先前焦點；OFF 與 DECLINED 不受影響
    return phase === 'OFF' || phase === 'DECLINED' ? stay(phase) : go('OFF');
  }
  if (e.type === 'REPLAY') {
    return e.blocked ? go('PENDING') : go('VISIBLE', 'RECORD_SHOWN');
  }

  switch (phase) {
    case 'OFF':
    case 'DECLINED':
      return e.type === 'GATE_OPEN' ? go('WATCHING') : stay(phase);

    case 'WATCHING':
      switch (e.type) {
        case 'EVIDENCE':
          return e.blocked ? go('PENDING') : go('VISIBLE', 'RECORD_SHOWN');
        case 'GATE_CLOSED':
        case 'EXTERNAL_CHANGE':
          return go('OFF');
        default:
          return stay(phase);
      }

    case 'PENDING':
      switch (e.type) {
        case 'UNBLOCKED':
          return go('VISIBLE', 'RECORD_SHOWN');
        case 'EVIDENCE_EXPIRED':
          return go('WATCHING');
        case 'GATE_CLOSED':
        case 'EXTERNAL_CHANGE':
          return go('OFF');
        default:
          return stay(phase);
      }

    case 'VISIBLE':
    case 'PAUSED':
      switch (e.type) {
        case 'HOLD':
          return phase === 'VISIBLE' ? go('PAUSED') : stay(phase);
        case 'RELEASE':
          return phase === 'PAUSED' ? go('VISIBLE') : stay(phase);
        case 'TIMEOUT':
          return phase === 'VISIBLE' ? go('SNOOZED', ...restore) : stay(phase);
        case 'SEIZED':
        case 'ESC':
          return go('SNOOZED', ...restore);
        case 'ACCEPT':
          // 僅鍵盤啟動才移動焦點；滑鼠點擊不移動，確認卡依計時於 6 秒後收起
          return e.viaKeyboard
            ? go('CONFIRMED', 'ENABLE_HOTKEYS', 'FOCUS_VIEW_ALL')
            : go('CONFIRMED', 'ENABLE_HOTKEYS');
        case 'DECLINE':
          return go('DECLINED', 'MARK_DECLINED', ...restore);
        case 'EXTERNAL_CHANGE':
          return go('OFF', ...restore);
        default:
          return stay(phase);
      }

    case 'CONFIRMED':
      switch (e.type) {
        case 'TIMEOUT':
        case 'SEIZED':
        case 'ESC':
          return go('OFF', ...restore);
        case 'VIEW_ALL':
          return go('OFF', 'OPEN_SHORTCUTS');
        case 'UNDO':
          return go('DECLINED', 'DISABLE_HOTKEYS', 'MARK_DECLINED', ...restore);
        default:
          // 自己剛寫入的偏好變更（EXTERNAL_CHANGE）不影響確認狀態；HOLD / RELEASE 只暫停 / 繼續 6 秒計時，階段不變
          return stay(phase);
      }

    case 'SNOOZED':
      // ⌨ 上的小圓點（≥ 768）只在 EXTERNAL_CHANGE（他途徑啟用）或 PREFS_OPENED（點 ⌨ / 開啟 PG-19）時清除；路由切換不清除
      return e.type === 'EXTERNAL_CHANGE' ? go('OFF') : stay(phase);
  }
}
