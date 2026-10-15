// FR-SY-18、BR-42、EC-39～41、FLOW-25：實體鍵盤偵測證據、門檻、gate、阻擋條件與提醒狀態機
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_KBD_NOTICE,
  DEFAULT_KEYBOARD_PREFS,
  EDIT_TYPING_COUNT,
  ENABLE_EDIT_TYPING,
  NOTICE_CONFIRMED_MS,
  NOTICE_EVIDENCE_TTL_MS,
  NOTICE_MAX_SHOWN,
  NOTICE_MIN_VIEWPORT_HEIGHT,
  NOTICE_REPEAT_AFTER_MS,
  NOTICE_SETTLE_MS,
  NOTICE_TOAST_SETTLE_MS,
  NOTICE_VISIBLE_MS,
  NO_HOLDS,
  PREFS_VERSION,
  TOUCH_EVIDENCE_COUNT,
  TOUCH_EVIDENCE_WINDOW_MS,
  activeBlockers,
  applyHold,
  classifyKeyboardEvidence,
  declineNotice,
  disableHotkeys,
  enableHotkeys,
  evidenceReached,
  gateOffReason,
  isHeld,
  isNoticeShown,
  migratePrefs,
  nextNoticeState,
  recordEvidence,
  recordNoticeShown,
  resetKeyboardNotice,
  seizesVisibleNotice,
  undoAccept,
} from '../kbdNotice';
import type {
  BlockerInput,
  EvidenceContext,
  EvidenceEvent,
  GateInput,
  HoldFlags,
  KeyboardEvidenceInput,
  KeyboardPrefs,
  NoticeEffect,
  NoticeEvent,
  NoticePhase,
} from '../kbdNotice';

describe('常數（Q-16、BR-42）', () => {
  it('停留 12 秒、確認 6 秒、證據保留 60 秒、確認期 300 / 400 ms、視窗高度門檻 480、最多 2 次、24 小時', () => {
    expect(NOTICE_VISIBLE_MS).toBe(12_000);
    expect(NOTICE_CONFIRMED_MS).toBe(6_000);
    expect(NOTICE_EVIDENCE_TTL_MS).toBe(60_000);
    expect(NOTICE_SETTLE_MS).toBe(300);
    expect(NOTICE_TOAST_SETTLE_MS).toBe(400);
    expect(NOTICE_MIN_VIEWPORT_HEIGHT).toBe(480);
    expect(NOTICE_MAX_SHOWN).toBe(2);
    expect(NOTICE_REPEAT_AFTER_MS).toBe(24 * 60 * 60 * 1000);
    expect(TOUCH_EVIDENCE_WINDOW_MS).toBe(10_000);
    expect(TOUCH_EVIDENCE_COUNT).toBe(3);
    expect(EDIT_TYPING_COUNT).toBe(3);
    expect(PREFS_VERSION).toBe(2);
  });
});

// ═════════ 證據分類（O-23、EC-39） ═════════
describe('classifyKeyboardEvidence', () => {
  const kev = (o: Partial<KeyboardEvidenceInput> = {}): KeyboardEvidenceInput => ({
    key: '',
    code: '',
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    isTrusted: true,
    defaultPrevented: false,
    ...o,
  });
  const kc = (o: Partial<EvidenceContext> = {}): EvidenceContext => ({
    targetIsEditable: false,
    focusOnBody: false,
    finePointer: true,
    ...o,
  });
  const cls = (e: Partial<KeyboardEvidenceInput>, c: Partial<EvidenceContext> = {}) =>
    classifyKeyboardEvidence(kev(e), kc(c));

  it('Tab / Shift + Tab 為 NAV（不論焦點位置，含輸入元件內與 body）', () => {
    expect(cls({ key: 'Tab', code: 'Tab' })).toBe('NAV');
    expect(cls({ key: 'Tab', code: 'Tab', shiftKey: true })).toBe('NAV');
    expect(cls({ key: 'Tab', code: 'Tab' }, { targetIsEditable: true })).toBe('NAV');
    expect(cls({ key: 'Tab', code: 'Tab', shiftKey: true }, { targetIsEditable: true })).toBe(
      'NAV',
    );
    expect(cls({ key: 'Tab', code: 'Tab' }, { focusOnBody: true })).toBe('NAV');
  });

  it('方向鍵與 Enter：須目標不是可編輯元件且焦點不在 body', () => {
    expect(cls({ key: 'ArrowDown', code: 'ArrowDown' }, { focusOnBody: true })).toBe('NONE'); // 滑鼠使用者用方向鍵捲動
    expect(cls({ key: 'ArrowDown', code: 'ArrowDown' })).toBe('NAV'); // 在商品卡 / 膠囊列上
    expect(cls({ key: 'Enter', code: 'Enter' }, { focusOnBody: true })).toBe('NONE');
    expect(cls({ key: 'Enter', code: 'Enter' })).toBe('NAV');
    expect(cls({ key: 'Enter', code: 'NumpadEnter' })).toBe('NAV');
    expect(cls({ key: 'ArrowLeft', code: 'ArrowLeft' }, { targetIsEditable: true })).toBe('NONE');
    expect(cls({ key: 'Enter', code: 'Enter' }, { targetIsEditable: true })).toBe('NONE');
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      expect(cls({ key: code, code }), code).toBe('NAV');
    }
  });

  it('字母、數字、/ = - ?（Shift + /）在非輸入元件為 CHAR；AZERTY 以 code 為準', () => {
    expect(cls({ key: 'c', code: 'KeyC' })).toBe('CHAR');
    expect(cls({ key: 'q', code: 'KeyA' })).toBe('CHAR'); // AZERTY：鍵帽 q 在 QWERTY 的 A 位置
    expect(cls({ key: '1', code: 'Digit1' })).toBe('CHAR');
    expect(cls({ key: '1', code: 'Numpad1' })).toBe('CHAR');
    expect(cls({ key: '?', code: 'Slash', shiftKey: true })).toBe('CHAR');
    expect(cls({ key: '/', code: 'Slash' })).toBe('CHAR');
    expect(cls({ key: '=', code: 'Equal' })).toBe('CHAR');
    expect(cls({ key: '-', code: 'Minus' })).toBe('CHAR');
    expect(cls({ key: '+', code: 'NumpadAdd' })).toBe('CHAR');
    expect(cls({ key: '-', code: 'NumpadSubtract' })).toBe('CHAR');
  });

  it('排除：不可信、已消費、長按、組字、Alt / Ctrl / ⌘（含 Ctrl/⌘ + Enter）', () => {
    expect(cls({ key: 'c', code: 'KeyC', isTrusted: false })).toBe('NONE');
    expect(cls({ key: 'c', code: 'KeyC', defaultPrevented: true })).toBe('NONE');
    expect(cls({ key: 'c', code: 'KeyC', repeat: true })).toBe('NONE');
    expect(cls({ key: 'c', code: 'KeyC', isComposing: true })).toBe('NONE');
    expect(cls({ key: 'c', code: 'KeyC', ctrlKey: true })).toBe('NONE');
    expect(cls({ key: 'Enter', code: 'Enter', metaKey: true })).toBe('NONE'); // Ctrl/⌘ + Enter 屬送出，不算證據
    expect(cls({ key: 'a', code: 'KeyA', altKey: true })).toBe('NONE');
    expect(cls({ key: 'Tab', code: 'Tab', isTrusted: false })).toBe('NONE');
    expect(cls({ key: 'Tab', code: 'Tab', ctrlKey: true })).toBe('NONE');
  });

  it('排除：Esc、Space、PageUp / PageDown、Home / End、純修飾鍵、CapsLock、F 鍵', () => {
    for (const code of [
      'Escape',
      'Space',
      'PageUp',
      'PageDown',
      'Home',
      'End',
      'ShiftLeft',
      'ControlLeft',
      'AltRight',
      'MetaLeft',
      'CapsLock',
      'F5',
    ]) {
      expect(cls({ key: code, code }), code).toBe('NONE');
    }
  });

  it('軟鍵盤與輸入法合成事件（無實體 code）為 NONE；Process + 實體 code 在非輸入元件為 CHAR', () => {
    expect(cls({ key: 'Unidentified', code: '' })).toBe('NONE');
    expect(cls({ key: 'c', code: '' })).toBe('NONE');
    expect(
      classifyKeyboardEvidence(
        { ...kev({ key: 'c' }), code: undefined as unknown as string },
        kc(),
      ),
    ).toBe('NONE');
    expect(cls({ key: 'Process', code: 'KeyC', keyCode: 229 })).toBe('CHAR');
    expect(cls({ key: 'Process', code: 'KeyC', keyCode: 229 }, { targetIsEditable: true })).toBe(
      'NONE',
    );
  });

  it('BR-42、EC-39：輸入元件內的打字預設不算證據（ENABLE_EDIT_TYPING = false）', () => {
    expect(ENABLE_EDIT_TYPING).toBe(false);
    expect(cls({ key: 'a', code: 'KeyA' }, { targetIsEditable: true })).toBe('NONE');
    expect(cls({ key: '5', code: 'Digit5' }, { targetIsEditable: true })).toBe('NONE');
  });

  it('P2 選配（editTyping: true）：僅 fine pointer 為 EDIT_TYPING；純觸控不計；只算字母與數字', () => {
    expect(cls({ key: 'a', code: 'KeyA' }, { targetIsEditable: true, editTyping: true })).toBe(
      'EDIT_TYPING',
    );
    expect(cls({ key: '5', code: 'Digit5' }, { targetIsEditable: true, editTyping: true })).toBe(
      'EDIT_TYPING',
    );
    expect(
      cls(
        { key: 'a', code: 'KeyA' },
        { targetIsEditable: true, editTyping: true, finePointer: false },
      ),
    ).toBe('NONE');
    expect(cls({ key: '/', code: 'Slash' }, { targetIsEditable: true, editTyping: true })).toBe(
      'NONE',
    );
  });
});

// ═════════ 門檻 ═════════
describe('evidenceReached / recordEvidence', () => {
  const ev = (at: number, kind: EvidenceEvent['kind'], code: string): EvidenceEvent => ({
    at,
    kind,
    code,
  });
  const fine = { finePointer: true, editableLeft: false };
  const touch = { finePointer: false, editableLeft: false };

  it('有 fine pointer：1 次 NAV 或 CHAR 即達標；沒有證據不達標', () => {
    expect(evidenceReached([], 0, fine)).toBe(false);
    expect(evidenceReached([ev(0, 'CHAR', 'KeyC')], 0, fine)).toBe(true);
    expect(evidenceReached([ev(0, 'NAV', 'Tab')], 0, fine)).toBe(true);
  });

  it('證據過期（> 60 秒）不計', () => {
    const h = [ev(0, 'CHAR', 'KeyC')];
    expect(evidenceReached(h, NOTICE_EVIDENCE_TTL_MS, fine)).toBe(true);
    expect(evidenceReached(h, NOTICE_EVIDENCE_TTL_MS + 1, fine)).toBe(false);
  });

  it('fine pointer 的 EDIT_TYPING 須累積 ≥ 3 次且焦點離開輸入框；純觸控不計', () => {
    const h = [
      ev(0, 'EDIT_TYPING', 'KeyA'),
      ev(10, 'EDIT_TYPING', 'KeyB'),
      ev(20, 'EDIT_TYPING', 'KeyC'),
    ];
    expect(evidenceReached(h, 30, { finePointer: true, editableLeft: false })).toBe(false);
    expect(evidenceReached(h, 30, { finePointer: true, editableLeft: true })).toBe(true);
    expect(evidenceReached(h.slice(0, 2), 30, { finePointer: true, editableLeft: true })).toBe(
      false,
    );
    expect(evidenceReached(h, 30, { finePointer: false, editableLeft: true })).toBe(false);
  });

  it('純觸控裝置：證據含 Tab 即達標（O-23）；單次非 Tab 不達標', () => {
    expect(evidenceReached([ev(0, 'NAV', 'Tab')], 0, touch)).toBe(true);
    expect(evidenceReached([ev(0, 'CHAR', 'KeyC')], 0, touch)).toBe(false);
  });

  it('純觸控裝置：10 秒內 ≥ 3 次且至少一次非 Enter 鍵', () => {
    const three = [
      ev(0, 'NAV', 'ArrowDown'),
      ev(1000, 'NAV', 'ArrowDown'),
      ev(2000, 'NAV', 'Enter'),
    ];
    expect(evidenceReached(three, 2000, touch)).toBe(true);
    const enters = [
      ev(0, 'NAV', 'Enter'),
      ev(1000, 'NAV', 'Enter'),
      ev(2000, 'NAV', 'NumpadEnter'),
    ];
    expect(evidenceReached(enters, 2000, touch)).toBe(false); // 只有 Enter 不算
    expect(evidenceReached(three.slice(0, 2), 2000, touch)).toBe(false); // 只有 2 次
    expect(evidenceReached(three, 10_001 + 2000, touch)).toBe(false); // 超過 10 秒視窗
  });

  it('純觸控的 EDIT_TYPING 不算入 3 次', () => {
    const h = [
      ev(0, 'EDIT_TYPING', 'KeyA'),
      ev(1, 'EDIT_TYPING', 'KeyB'),
      ev(2, 'NAV', 'ArrowDown'),
    ];
    expect(evidenceReached(h, 3, touch)).toBe(false);
  });

  it('性質：已達標後再加入證據不會變成未達標（同一時間點、同一裝置類型）', () => {
    const evArb: fc.Arbitrary<EvidenceEvent> = fc.record({
      at: fc.integer({ min: 0, max: 30_000 }),
      kind: fc.constantFrom('NAV', 'CHAR', 'EDIT_TYPING' as const),
      code: fc.constantFrom('Tab', 'Enter', 'NumpadEnter', 'ArrowDown', 'KeyC', 'Digit1'),
    });
    fc.assert(
      fc.property(
        fc.array(evArb, { maxLength: 8 }),
        evArb,
        fc.boolean(),
        fc.boolean(),
        (history, extra, finePointer, editableLeft) => {
          const now = 30_000;
          const opts = { finePointer, editableLeft };
          if (evidenceReached(history, now, opts)) {
            expect(
              evidenceReached([...history, { ...extra, at: Math.min(extra.at, now) }], now, opts),
            ).toBe(true);
          }
        },
      ),
    );
  });

  it('recordEvidence：只留 60 秒內的證據；不改動輸入陣列', () => {
    const h = [ev(0, 'CHAR', 'KeyC')];
    const next = recordEvidence(h, ev(NOTICE_EVIDENCE_TTL_MS + 1, 'CHAR', 'KeyS'));
    expect(next.map((x) => x.code)).toEqual(['KeyS']);
    expect(h).toHaveLength(1);
    expect(recordEvidence(h, ev(NOTICE_EVIDENCE_TTL_MS, 'CHAR', 'KeyS'))).toHaveLength(2);
  });
});

// ═════════ gate 與偏好 ═════════
describe('gateOffReason', () => {
  const NOW = 1_000_000_000_000;
  const DAY = NOTICE_REPEAT_AFTER_MS;
  const gate = (o: Partial<GateInput> = {}): GateInput => ({
    kiosk: false,
    hotkeysActive: false,
    storageDegraded: false,
    shownThisLoad: false,
    prefsOpenedThisLoad: false,
    notice: DEFAULT_KBD_NOTICE,
    nowMs: NOW,
    ...o,
  });

  it('預設為開（null）', () => {
    expect(gateOffReason(gate())).toBeNull();
  });

  it('觸控面板、已啟用、已決定、已提醒 2 次、本次已顯示、儲存降級各自關閉', () => {
    expect(gateOffReason(gate({ kiosk: true }))).toBe('KIOSK');
    expect(gateOffReason(gate({ hotkeysActive: true }))).toBe('ENABLED');
    expect(
      gateOffReason(gate({ notice: { outcome: 'DECLINED', shownCount: 0, lastShownAt: null } })),
    ).toBe('DECIDED');
    expect(
      gateOffReason(gate({ notice: { outcome: 'ACCEPTED', shownCount: 1, lastShownAt: 1 } })),
    ).toBe('DECIDED');
    expect(
      gateOffReason(
        gate({ notice: { outcome: 'NONE', shownCount: 2, lastShownAt: NOW - 2 * DAY } }),
      ),
    ).toBe('MAX_SHOWN');
    expect(gateOffReason(gate({ shownThisLoad: true }))).toBe('SHOWN_THIS_LOAD');
    expect(gateOffReason(gate({ storageDegraded: true }))).toBe('STORAGE_DEGRADED');
  });

  it('判斷順序：KIOSK > ENABLED > DECIDED > MAX_SHOWN > TOO_SOON > SHOWN_THIS_LOAD > PREFS_OPENED_THIS_LOAD > STORAGE_DEGRADED', () => {
    const all = gate({
      kiosk: true,
      hotkeysActive: true,
      storageDegraded: true,
      shownThisLoad: true,
      prefsOpenedThisLoad: true,
      notice: { outcome: 'DECLINED', shownCount: 2, lastShownAt: NOW - 1 },
    });
    expect(gateOffReason(all)).toBe('KIOSK');
    expect(gateOffReason({ ...all, kiosk: false })).toBe('ENABLED');
    expect(gateOffReason({ ...all, kiosk: false, hotkeysActive: false })).toBe('DECIDED');
    expect(
      gateOffReason({
        ...all,
        kiosk: false,
        hotkeysActive: false,
        notice: { outcome: 'NONE', shownCount: 2, lastShownAt: NOW - 1 },
      }),
    ).toBe('MAX_SHOWN');
    expect(
      gateOffReason({
        ...all,
        kiosk: false,
        hotkeysActive: false,
        notice: { outcome: 'NONE', shownCount: 1, lastShownAt: NOW - 1 },
      }),
    ).toBe('TOO_SOON');
    expect(
      gateOffReason({ ...all, kiosk: false, hotkeysActive: false, notice: DEFAULT_KBD_NOTICE }),
    ).toBe('SHOWN_THIS_LOAD');
    expect(
      gateOffReason({
        ...all,
        kiosk: false,
        hotkeysActive: false,
        notice: DEFAULT_KBD_NOTICE,
        shownThisLoad: false,
      }),
    ).toBe('PREFS_OPENED_THIS_LOAD');
    expect(
      gateOffReason({
        ...all,
        kiosk: false,
        hotkeysActive: false,
        notice: DEFAULT_KBD_NOTICE,
        shownThisLoad: false,
        prefsOpenedThisLoad: false,
      }),
    ).toBe('STORAGE_DEGRADED');
  });

  it('R-AB(2)：本次載入已開啟過 PG-19 → 關閉', () => {
    expect(gateOffReason(gate({ prefsOpenedThisLoad: true }))).toBe('PREFS_OPENED_THIS_LOAD');
    expect(gateOffReason(gate({ prefsOpenedThisLoad: true, shownThisLoad: true }))).toBe(
      'SHOWN_THIS_LOAD',
    );
    expect(gateOffReason(gate({ prefsOpenedThisLoad: true, storageDegraded: true }))).toBe(
      'PREFS_OPENED_THIS_LOAD',
    );
    expect(gateOffReason(gate({ prefsOpenedThisLoad: true, hotkeysActive: true }))).toBe('ENABLED');
    expect(gateOffReason(gate({ prefsOpenedThisLoad: false }))).toBeNull();
  });

  it('R-AB(2)：未被提醒前由頁尾開啟 PG-19，之後只切換其他偏好重新評估 gate，仍不提醒', () => {
    const afterOpen = nextNoticeState('WATCHING', { type: 'PREFS_OPENED' }, false);
    expect(afterOpen).toEqual({ phase: 'OFF', effects: [] });
    const reevaluate = (phase: NoticePhase, g: GateInput): NoticePhase =>
      gateOffReason(g) === null
        ? nextNoticeState(phase, { type: 'GATE_OPEN' }, false).phase
        : phase;
    expect(reevaluate(afterOpen.phase, gate({ prefsOpenedThisLoad: true }))).toBe('OFF');
    expect(reevaluate(afterOpen.phase, gate({ prefsOpenedThisLoad: false }))).toBe('WATCHING'); // 對照：無旗標時會回到 WATCHING
  });

  it('第 2 次須距上次 ≥ 24 小時（24h 當下可、少 1 ms 不可）；時鐘倒退保守不提醒', () => {
    const shown = (at: number): GateInput =>
      gate({ notice: { outcome: 'NONE', shownCount: 1, lastShownAt: at } });
    expect(gateOffReason(shown(NOW - DAY + 1))).toBe('TOO_SOON');
    expect(gateOffReason(shown(NOW - DAY))).toBeNull();
    expect(gateOffReason(shown(NOW - DAY - 1))).toBeNull();
    expect(gateOffReason(shown(NOW + 1000))).toBe('TOO_SOON');
  });

  it('提醒次數（Q-16）：shownCount 未達 2 且間隔足夠可再提醒；達 2 即關閉，不論間隔', () => {
    for (const count of [0, 1]) {
      expect(
        gateOffReason(
          gate({
            notice: {
              outcome: 'NONE',
              shownCount: count,
              lastShownAt: count === 0 ? null : NOW - 2 * DAY,
            },
          }),
        ),
      ).toBeNull();
    }
    expect(
      gateOffReason(
        gate({ notice: { outcome: 'NONE', shownCount: 3, lastShownAt: NOW - 30 * DAY } }),
      ),
    ).toBe('MAX_SHOWN');
  });
});

describe('偏好轉換', () => {
  it('預設 hotkeysEnabled = false；kbdNotice 為 NONE / 0 / null', () => {
    expect(DEFAULT_KEYBOARD_PREFS.hotkeysEnabled).toBe(false);
    expect(DEFAULT_KEYBOARD_PREFS.kbdNotice).toEqual({
      outcome: 'NONE',
      shownCount: 0,
      lastShownAt: null,
    });
  });

  it('enableHotkeys：outcome NONE → ACCEPTED，DECLINED 不被覆寫；關閉後不再自動提醒', () => {
    const on = enableHotkeys(DEFAULT_KEYBOARD_PREFS);
    expect([on.hotkeysEnabled, on.kbdNotice.outcome]).toEqual([true, 'ACCEPTED']);
    const off = disableHotkeys(on);
    expect([off.hotkeysEnabled, off.kbdNotice.outcome]).toEqual([false, 'ACCEPTED']);
    expect(
      gateOffReason({
        kiosk: false,
        hotkeysActive: false,
        storageDegraded: false,
        shownThisLoad: false,
        prefsOpenedThisLoad: false,
        notice: off.kbdNotice,
        nowMs: 0,
      }),
    ).toBe('DECIDED');
    const declined = declineNotice(DEFAULT_KEYBOARD_PREFS);
    expect(enableHotkeys(declined).kbdNotice.outcome).toBe('DECLINED');
    expect(DEFAULT_KEYBOARD_PREFS.hotkeysEnabled).toBe(false); // 不改動預設物件
    expect(DEFAULT_KEYBOARD_PREFS.kbdNotice.outcome).toBe('NONE');
  });

  it('recordNoticeShown：shownCount + 1 與 lastShownAt 於轉為 VISIBLE 時寫入；上限 2', () => {
    let p = recordNoticeShown(DEFAULT_KEYBOARD_PREFS, 111);
    expect(p.kbdNotice).toEqual({ outcome: 'NONE', shownCount: 1, lastShownAt: 111 });
    p = recordNoticeShown(recordNoticeShown(p, 222), 333);
    expect([p.kbdNotice.shownCount, p.kbdNotice.lastShownAt]).toEqual([2, 333]);
  });

  it('declineNotice 不改變 hotkeysEnabled；undoAccept 關閉並視為不用了；resetKeyboardNotice（Demo 重播）歸零', () => {
    const accepted = enableHotkeys(recordNoticeShown(DEFAULT_KEYBOARD_PREFS, 5));
    expect(declineNotice(accepted).hotkeysEnabled).toBe(true);
    const undone = undoAccept(accepted);
    expect([undone.hotkeysEnabled, undone.kbdNotice.outcome]).toEqual([false, 'DECLINED']);
    expect(resetKeyboardNotice(accepted)).toEqual({
      hotkeysEnabled: false,
      kbdNotice: { outcome: 'NONE', shownCount: 0, lastShownAt: null },
    });
  });

  it('所有轉換皆為不可變：不改動輸入', () => {
    const p: KeyboardPrefs = {
      hotkeysEnabled: false,
      kbdNotice: { outcome: 'NONE', shownCount: 1, lastShownAt: 5 },
    };
    const snapshot = JSON.stringify(p);
    enableHotkeys(p);
    disableHotkeys(p);
    recordNoticeShown(p, 9);
    declineNotice(p);
    undoAccept(p);
    resetKeyboardNotice(p);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it('resetKeyboardNotice 回傳的 kbdNotice 不與預設常數共用物件', () => {
    const r = resetKeyboardNotice(DEFAULT_KEYBOARD_PREFS);
    expect(r.kbdNotice).not.toBe(DEFAULT_KBD_NOTICE);
  });
});

describe('migratePrefs（persist v1 → v2）', () => {
  it('v1 的 hotkeysEnabled: true 一律重設為關閉並補 kbdNotice，其餘欄位保留；不改動輸入', () => {
    const v1 = { hotkeysEnabled: true, largeText: true, rememberChoices: false };
    expect(migratePrefs(v1, 1)).toEqual({
      hotkeysEnabled: false,
      largeText: true,
      rememberChoices: false,
      kbdNotice: { outcome: 'NONE', shownCount: 0, lastShownAt: null },
    });
    expect(v1.hotkeysEnabled).toBe(true);
  });

  it('v0 同樣遷移；v2 與無法辨識的資料不動', () => {
    expect((migratePrefs({ hotkeysEnabled: true }, 0) as KeyboardPrefs).hotkeysEnabled).toBe(false);
    const v2 = {
      hotkeysEnabled: true,
      kbdNotice: { outcome: 'ACCEPTED', shownCount: 1, lastShownAt: 5 },
    };
    expect(migratePrefs(v2, 2)).toBe(v2);
    expect(migratePrefs(v2, 3)).toBe(v2);
    expect(migratePrefs(null, 1)).toBeNull();
    expect(migratePrefs('x', 1)).toBe('x');
    expect(migratePrefs(undefined, 1)).toBeUndefined();
  });

  it('遷移出的 kbdNotice 為新物件（不共用預設）', () => {
    const m = migratePrefs({}, 1) as KeyboardPrefs;
    expect(m.kbdNotice).not.toBe(DEFAULT_KBD_NOTICE);
  });
});

// ═════════ 阻擋條件與讓位 ═════════
describe('activeBlockers / seizesVisibleNotice', () => {
  const bi = (o: Partial<BlockerInput> = {}): BlockerInput => ({
    targetIsEditable: false,
    overlayOpen: false,
    toastVisible: false,
    demoPanelOpen: false,
    onCheckoutOrPayment: false,
    pageVisible: true,
    viewportHeight: 800,
    focusCovered: false,
    ...o,
  });

  it('各條件各自成立；視窗高度 479 阻擋、480 不阻擋', () => {
    expect(activeBlockers(bi())).toEqual([]);
    expect(activeBlockers(bi({ targetIsEditable: true }))).toEqual(['EDITABLE_FOCUS']);
    expect(activeBlockers(bi({ overlayOpen: true }))).toEqual(['OVERLAY']);
    expect(activeBlockers(bi({ toastVisible: true }))).toEqual(['TOAST']);
    expect(activeBlockers(bi({ demoPanelOpen: true }))).toEqual(['DEMO_PANEL']);
    expect(activeBlockers(bi({ onCheckoutOrPayment: true }))).toEqual(['ROUTE']);
    expect(activeBlockers(bi({ pageVisible: false }))).toEqual(['PAGE_HIDDEN']);
    expect(activeBlockers(bi({ viewportHeight: 479 }))).toEqual(['SHORT_VIEWPORT']);
    expect(activeBlockers(bi({ viewportHeight: 480 }))).toEqual([]);
    expect(activeBlockers(bi({ focusCovered: true }))).toEqual(['FOCUS_COVERED']);
  });

  it('多項同時成立依固定順序回傳', () => {
    expect(
      activeBlockers(bi({ targetIsEditable: true, toastVisible: true, focusCovered: true })),
    ).toEqual(['EDITABLE_FOCUS', 'TOAST', 'FOCUS_COVERED']);
  });

  it('讓位：浮層、Toast、Demo 面板、結帳 / 付款路由、焦點被遮住會搶走顯示中的提醒；輸入元件焦點、隱藏、視窗過矮不會', () => {
    for (const b of ['OVERLAY', 'TOAST', 'DEMO_PANEL', 'ROUTE', 'FOCUS_COVERED'] as const) {
      expect(seizesVisibleNotice([b]), b).toBe(true);
    }
    for (const b of ['EDITABLE_FOCUS', 'PAGE_HIDDEN', 'SHORT_VIEWPORT'] as const) {
      expect(seizesVisibleNotice([b]), b).toBe(false);
    }
    expect(seizesVisibleNotice([])).toBe(false);
    expect(seizesVisibleNotice(['PAGE_HIDDEN', 'TOAST'])).toBe(true);
  });
});

// ═════════ 暫停來源的合取（R-S） ═════════
describe('applyHold / isHeld', () => {
  it('hover、焦點、頁面隱藏三個來源的合取：任一為真即維持暫停，三者皆解除才 RELEASE', () => {
    let f: HoldFlags = NO_HOLDS;
    const send = (source: 'HOVER' | 'FOCUS' | 'HIDDEN', active: boolean) => {
      const r = applyHold(f, source, active);
      f = r.flags;
      return r.event;
    };
    expect(send('HOVER', true)).toBe('HOLD');
    expect(send('FOCUS', true)).toBeNull(); // 已在暫停中：不重複送出 HOLD
    expect(send('HOVER', false)).toBeNull(); // 滑鼠移出但焦點仍在卡片內：維持暫停
    expect(isHeld(f)).toBe(true);
    expect(send('HIDDEN', true)).toBeNull();
    expect(send('FOCUS', false)).toBeNull(); // 焦點離開，但頁面仍隱藏
    expect(send('HIDDEN', false)).toBe('RELEASE'); // 三者皆解除
    expect(isHeld(f)).toBe(false);
    expect(send('HIDDEN', false)).toBeNull(); // 重複解除不送事件
    expect(NO_HOLDS).toEqual({ HOVER: false, FOCUS: false, HIDDEN: false }); // 不改動共用的預設物件
  });

  it('搭配狀態機：只有 HOLD 使 VISIBLE → PAUSED，RELEASE 才回到 VISIBLE', () => {
    expect(nextNoticeState('VISIBLE', { type: 'HOLD' }, true).phase).toBe('PAUSED');
    expect(nextNoticeState('PAUSED', { type: 'RELEASE' }, true).phase).toBe('VISIBLE');
  });

  it('性質：任意來源序列下，事件序列恰為 HOLD / RELEASE 交替（開始時未暫停）', () => {
    const srcArb = fc.constantFrom('HOVER', 'FOCUS', 'HIDDEN' as const);
    fc.assert(
      fc.property(fc.array(fc.tuple(srcArb, fc.boolean()), { maxLength: 40 }), (steps) => {
        let f: HoldFlags = NO_HOLDS;
        let held = false;
        for (const [source, active] of steps) {
          const r = applyHold(f, source, active);
          f = r.flags;
          const nowHeld = isHeld(f);
          if (r.event === 'HOLD') expect([held, nowHeld]).toEqual([false, true]);
          else if (r.event === 'RELEASE') expect([held, nowHeld]).toEqual([true, false]);
          else expect(nowHeld).toBe(held);
          held = nowHeld;
        }
      }),
    );
  });
});

// ═════════ 狀態轉換（FLOW-25） ═════════
describe('nextNoticeState', () => {
  // 第三參數 focusInsideCard 預設為真（收起當下焦點仍在卡片內）；焦點已離開的案例另測（R-Z）
  const step = (phase: NoticePhase, e: NoticeEvent, inside = true) =>
    nextNoticeState(phase, e, inside);
  const to = (phase: NoticePhase, e: NoticeEvent): NoticePhase => step(phase, e).phase;

  it('OFF → WATCHING；WATCHING 證據達標無阻擋 → VISIBLE 並記次；有阻擋 → PENDING', () => {
    expect(to('OFF', { type: 'GATE_OPEN' })).toBe('WATCHING');
    expect(step('WATCHING', { type: 'EVIDENCE', blocked: false })).toEqual({
      phase: 'VISIBLE',
      effects: ['RECORD_SHOWN'],
    });
    expect(step('WATCHING', { type: 'EVIDENCE', blocked: true })).toEqual({
      phase: 'PENDING',
      effects: [],
    });
  });

  it('PENDING 解除阻擋 → VISIBLE（此時才記次）；證據逾 60 秒 → WATCHING；不計 shownCount', () => {
    expect(step('PENDING', { type: 'UNBLOCKED' })).toEqual({
      phase: 'VISIBLE',
      effects: ['RECORD_SHOWN'],
    });
    expect(to('PENDING', { type: 'EVIDENCE_EXPIRED' })).toBe('WATCHING');
    expect(step('PENDING', { type: 'EVIDENCE', blocked: true })).toEqual({
      phase: 'PENDING',
      effects: [],
    });
  });

  it('VISIBLE ⇄ PAUSED（hover / 焦點）；PAUSED 不逾時；VISIBLE 12 秒逾時 → SNOOZED', () => {
    expect(to('VISIBLE', { type: 'HOLD' })).toBe('PAUSED');
    expect(to('PAUSED', { type: 'RELEASE' })).toBe('VISIBLE');
    expect(to('PAUSED', { type: 'HOLD' })).toBe('PAUSED');
    expect(to('VISIBLE', { type: 'RELEASE' })).toBe('VISIBLE');
    expect(to('PAUSED', { type: 'TIMEOUT' })).toBe('PAUSED');
    expect(step('VISIBLE', { type: 'TIMEOUT' })).toEqual({
      phase: 'SNOOZED',
      effects: ['RESTORE_FOCUS'],
    });
  });

  it('被搶走（Toast / 浮層 / 路由）與焦點在提醒內按 Esc → SNOOZED（同次載入不再出現）', () => {
    for (const from of ['VISIBLE', 'PAUSED'] as const) {
      expect(to(from, { type: 'SEIZED' }), from).toBe('SNOOZED');
      expect(to(from, { type: 'ESC' }), from).toBe('SNOOZED');
    }
    expect(to('SNOOZED', { type: 'GATE_CLOSED' })).toBe('SNOOZED'); // 已記次後 gate 關閉，不影響小圓點
  });

  it('「開啟」→ CONFIRMED 並啟用快速鍵、焦點移到「查看全部」；6 秒逾時或「查看全部」→ OFF；「復原」→ DECLINED', () => {
    for (const from of ['VISIBLE', 'PAUSED'] as const) {
      expect(step(from, { type: 'ACCEPT', viaKeyboard: true })).toEqual({
        phase: 'CONFIRMED',
        effects: ['ENABLE_HOTKEYS', 'FOCUS_VIEW_ALL'],
      });
    }
    expect(to('CONFIRMED', { type: 'EXTERNAL_CHANGE' })).toBe('CONFIRMED'); // 自己剛寫入的偏好不影響確認狀態
    expect(to('CONFIRMED', { type: 'GATE_CLOSED' })).toBe('CONFIRMED');
    expect(step('CONFIRMED', { type: 'TIMEOUT' })).toEqual({
      phase: 'OFF',
      effects: ['RESTORE_FOCUS'],
    });
    expect(step('CONFIRMED', { type: 'VIEW_ALL' })).toEqual({
      phase: 'OFF',
      effects: ['OPEN_SHORTCUTS'],
    });
    expect(step('CONFIRMED', { type: 'UNDO' })).toEqual({
      phase: 'DECLINED',
      effects: ['DISABLE_HOTKEYS', 'MARK_DECLINED', 'RESTORE_FOCUS'],
    });
  });

  it('R-AB / 03 §10.2：「開啟」僅由鍵盤啟動才附 FOCUS_VIEW_ALL；滑鼠或觸控點擊不移動焦點', () => {
    for (const from of ['VISIBLE', 'PAUSED'] as const) {
      expect(step(from, { type: 'ACCEPT', viaKeyboard: false }), from).toEqual({
        phase: 'CONFIRMED',
        effects: ['ENABLE_HOTKEYS'],
      });
    }
    // 確認卡的計時不因 FOCUS_VIEW_ALL 缺席而改變：逾時後收起（焦點不在卡片內時不附還原焦點）
    expect(step('CONFIRMED', { type: 'TIMEOUT' }, false)).toEqual({ phase: 'OFF', effects: [] });
  });

  it('R-Z：收起當下焦點仍在卡片內才附 RESTORE_FOCUS；焦點已離開卡片時不得移動焦點', () => {
    expect(step('VISIBLE', { type: 'TIMEOUT' }, true)).toEqual({
      phase: 'SNOOZED',
      effects: ['RESTORE_FOCUS'],
    });
    expect(step('PAUSED', { type: 'ESC' }, true)).toEqual({
      phase: 'SNOOZED',
      effects: ['RESTORE_FOCUS'],
    });
    // 焦點曾進入但已離開（Enter 開啟後按 s 進搜尋框輸入，6 秒確認狀態逾時）：不附效果
    expect(step('CONFIRMED', { type: 'TIMEOUT' }, false)).toEqual({ phase: 'OFF', effects: [] });
    expect(step('VISIBLE', { type: 'TIMEOUT' }, false)).toEqual({ phase: 'SNOOZED', effects: [] });
    // 被浮層搶走：不得把焦點拉回背後的元件
    for (const from of ['VISIBLE', 'PAUSED'] as const) {
      expect(step(from, { type: 'SEIZED' }, false), from).toEqual({
        phase: 'SNOOZED',
        effects: [],
      });
    }
    expect(step('CONFIRMED', { type: 'SEIZED' }, false)).toEqual({ phase: 'OFF', effects: [] });
    // 其他收起路徑同理：不用了、復原、他途徑啟用、切入觸控面板
    expect(step('VISIBLE', { type: 'DECLINE' }, false)).toEqual({
      phase: 'DECLINED',
      effects: ['MARK_DECLINED'],
    });
    expect(step('CONFIRMED', { type: 'UNDO' }, false)).toEqual({
      phase: 'DECLINED',
      effects: ['DISABLE_HOTKEYS', 'MARK_DECLINED'],
    });
    expect(step('VISIBLE', { type: 'EXTERNAL_CHANGE' }, false)).toEqual({
      phase: 'OFF',
      effects: [],
    });
    expect(step('VISIBLE', { type: 'ENTER_KIOSK' }, false)).toEqual({ phase: 'OFF', effects: [] });
    // 焦點在內時其餘路徑仍還原
    expect(step('VISIBLE', { type: 'EXTERNAL_CHANGE' }, true)).toEqual({
      phase: 'OFF',
      effects: ['RESTORE_FOCUS'],
    });
    expect(step('VISIBLE', { type: 'DECLINE' }, true)).toEqual({
      phase: 'DECLINED',
      effects: ['MARK_DECLINED', 'RESTORE_FOCUS'],
    });
  });

  it('「不用了」→ DECLINED（不再自動提醒）；DECLINED 只在 Demo 重置資料後經 gate 回到 WATCHING', () => {
    for (const from of ['VISIBLE', 'PAUSED'] as const) {
      expect(step(from, { type: 'DECLINE' })).toEqual({
        phase: 'DECLINED',
        effects: ['MARK_DECLINED', 'RESTORE_FOCUS'],
      });
    }
    expect(to('DECLINED', { type: 'EVIDENCE', blocked: false })).toBe('DECLINED');
    expect(to('DECLINED', { type: 'GATE_OPEN' })).toBe('WATCHING');
  });

  it('R-I：⌨ 小圓點（SNOOZED）只在 PREFS_OPENED 或 EXTERNAL_CHANGE 時清除；其他事件與路由切換不清除', () => {
    expect(to('SNOOZED', { type: 'PREFS_OPENED' })).toBe('OFF');
    expect(to('SNOOZED', { type: 'EXTERNAL_CHANGE' })).toBe('OFF');
    for (const type of [
      'GATE_OPEN',
      'GATE_CLOSED',
      'HOLD',
      'RELEASE',
      'TIMEOUT',
      'SEIZED',
      'ESC',
      'UNBLOCKED',
      'EVIDENCE_EXPIRED',
    ] as const) {
      expect(to('SNOOZED', { type }), type).toBe('SNOOZED');
    }
    expect(to('SNOOZED', { type: 'EVIDENCE', blocked: false })).toBe('SNOOZED');
  });

  it('PREFS_OPENED：WATCHING / PENDING / VISIBLE / PAUSED / CONFIRMED / SNOOZED 直接 OFF（不還原焦點）；OFF 與 DECLINED 不變', () => {
    for (const from of [
      'WATCHING',
      'PENDING',
      'VISIBLE',
      'PAUSED',
      'CONFIRMED',
      'SNOOZED',
    ] as const) {
      expect(step(from, { type: 'PREFS_OPENED' }), from).toEqual({ phase: 'OFF', effects: [] });
    }
    expect(to('OFF', { type: 'PREFS_OPENED' })).toBe('OFF');
    expect(to('DECLINED', { type: 'PREFS_OPENED' })).toBe('DECLINED');
  });

  it('R-O：確認狀態的 HOLD / RELEASE 只暫停 / 繼續計時，階段與效果不變', () => {
    expect(step('CONFIRMED', { type: 'HOLD' })).toEqual({ phase: 'CONFIRMED', effects: [] });
    expect(step('CONFIRMED', { type: 'RELEASE' })).toEqual({ phase: 'CONFIRMED', effects: [] });
  });

  it('進入觸控面板或單鍵快速鍵被其他途徑 / 分頁啟用 → OFF（多分頁收起，EC-40）', () => {
    for (const from of [
      'WATCHING',
      'PENDING',
      'VISIBLE',
      'PAUSED',
      'SNOOZED',
      'CONFIRMED',
      'DECLINED',
    ] as const) {
      expect(to(from, { type: 'ENTER_KIOSK' }), `${from} 進入觸控面板`).toBe('OFF');
    }
    for (const from of ['WATCHING', 'PENDING', 'VISIBLE', 'PAUSED', 'SNOOZED'] as const) {
      expect(to(from, { type: 'EXTERNAL_CHANGE' }), `${from} 外部啟用`).toBe('OFF');
    }
    expect(step('VISIBLE', { type: 'ENTER_KIOSK' })).toEqual({
      phase: 'OFF',
      effects: ['RESTORE_FOCUS'],
    }); // 顯示中切入立即收起
    expect(to('OFF', { type: 'ENTER_KIOSK' })).toBe('OFF');
    expect(to('DECLINED', { type: 'EXTERNAL_CHANGE' })).toBe('DECLINED'); // 其他分頁決定不影響 DECLINED
  });

  it('gate 關閉只影響尚未顯示者（WATCHING、PENDING）；顯示中不收起', () => {
    expect(to('WATCHING', { type: 'GATE_CLOSED' })).toBe('OFF');
    expect(to('PENDING', { type: 'GATE_CLOSED' })).toBe('OFF');
    expect(to('VISIBLE', { type: 'GATE_CLOSED' })).toBe('VISIBLE');
    expect(to('PAUSED', { type: 'GATE_CLOSED' })).toBe('PAUSED');
  });

  it('Demo「重播鍵盤提醒」：任何狀態直接進入 VISIBLE 並記次；有阻擋條件時待命（PENDING）', () => {
    for (const from of ['SNOOZED', 'DECLINED', 'OFF', 'WATCHING', 'PENDING', 'VISIBLE'] as const) {
      expect(step(from, { type: 'REPLAY', blocked: false }), from).toEqual({
        phase: 'VISIBLE',
        effects: ['RECORD_SHOWN'],
      });
      expect(to(from, { type: 'REPLAY', blocked: true }), from).toBe('PENDING');
    }
  });

  it('OFF / DECLINED 對 GATE_OPEN 以外的事件維持原狀態', () => {
    for (const from of ['OFF', 'DECLINED'] as const) {
      for (const type of [
        'EVIDENCE',
        'HOLD',
        'TIMEOUT',
        'ESC',
        'ACCEPT',
        'DECLINE',
        'UNDO',
      ] as const) {
        const e =
          type === 'EVIDENCE'
            ? ({ type, blocked: false } as const)
            : type === 'ACCEPT'
              ? ({ type, viaKeyboard: true } as const)
              : ({ type } as NoticeEvent);
        expect(to(from, e), `${from} + ${type}`).toBe(from);
      }
    }
  });

  it('性質：RECORD_SHOWN 只在進入 VISIBLE 時出現；所有（狀態，事件）組合都回傳有效狀態且不丟例外', () => {
    const phases: NoticePhase[] = [
      'OFF',
      'WATCHING',
      'PENDING',
      'VISIBLE',
      'PAUSED',
      'CONFIRMED',
      'SNOOZED',
      'DECLINED',
    ];
    const events: NoticeEvent[] = [
      { type: 'GATE_OPEN' },
      { type: 'GATE_CLOSED' },
      { type: 'EXTERNAL_CHANGE' },
      { type: 'ENTER_KIOSK' },
      { type: 'EVIDENCE', blocked: false },
      { type: 'EVIDENCE', blocked: true },
      { type: 'UNBLOCKED' },
      { type: 'EVIDENCE_EXPIRED' },
      { type: 'HOLD' },
      { type: 'RELEASE' },
      { type: 'TIMEOUT' },
      { type: 'SEIZED' },
      { type: 'ESC' },
      { type: 'ACCEPT', viaKeyboard: true },
      { type: 'ACCEPT', viaKeyboard: false },
      { type: 'DECLINE' },
      { type: 'UNDO' },
      { type: 'VIEW_ALL' },
      { type: 'PREFS_OPENED' },
      { type: 'REPLAY', blocked: false },
      { type: 'REPLAY', blocked: true },
    ];
    for (const p of phases) {
      for (const e of events) {
        for (const inside of [true, false]) {
          const r = nextNoticeState(p, e, inside);
          const label = `${p} + ${e.type}`;
          expect(phases, label).toContain(r.phase);
          if (r.effects.includes('RECORD_SHOWN')) expect(r.phase, label).toBe('VISIBLE');
          if (!inside)
            expect(r.effects, `${label}：焦點已離開卡片不得還原焦點`).not.toContain(
              'RESTORE_FOCUS',
            );
          if (e.type === 'ACCEPT' && !e.viaKeyboard)
            expect(r.effects, label).not.toContain('FOCUS_VIEW_ALL');
          expect(isNoticeShown(r.phase)).toBe(['VISIBLE', 'PAUSED', 'CONFIRMED'].includes(r.phase));
          // 啟用 / 關閉單鍵快速鍵的效果只會來自 ACCEPT（開啟）與 UNDO（復原）
          const enables: NoticeEffect[] = r.effects.filter(
            (x) => x === 'ENABLE_HOTKEYS' || x === 'DISABLE_HOTKEYS',
          );
          if (enables.length > 0) expect(['ACCEPT', 'UNDO']).toContain(e.type);
        }
      }
    }
  });

  it('isNoticeShown：僅 VISIBLE / PAUSED / CONFIRMED 在畫面上', () => {
    const shown: NoticePhase[] = ['VISIBLE', 'PAUSED', 'CONFIRMED'];
    for (const p of [
      'OFF',
      'WATCHING',
      'PENDING',
      'VISIBLE',
      'PAUSED',
      'CONFIRMED',
      'SNOOZED',
      'DECLINED',
    ] as const) {
      expect(isNoticeShown(p)).toBe(shown.includes(p));
    }
  });
});
