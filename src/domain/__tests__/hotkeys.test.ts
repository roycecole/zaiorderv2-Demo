// BR-34 / FLOW-19 快速鍵解析；03 §10.3 快速鍵地圖；Esc 順序（closeTarget）；isEditableTarget
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { HOTKEYS, closeTarget, isEditableTarget, normalizeKey, resolveHotkey } from '../hotkeys';
import type {
  CloseState,
  EditableProbe,
  HotkeyAction,
  HotkeyContext,
  HotkeyScope,
  KeyEventLike,
} from '../hotkeys';

// ───────── 測試輔助 ─────────
const ev = (o: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key: '',
  code: '',
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  ...o,
});
/** 一般字元鍵：自動補上 QWERTY 的實體 code */
const key = (k: string, extra: Partial<KeyEventLike> = {}): KeyEventLike =>
  ev({
    key: k,
    code: /^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : /^[0-9]$/.test(k) ? `Digit${k}` : '',
    ...extra,
  });
const ctx = (o: Partial<HotkeyContext> = {}): HotkeyContext => ({
  enabled: true,
  scopes: ['menu', 'cart', 'global'],
  targetIsEditable: false,
  modalOpen: false,
  ...o,
});
const act = (e: KeyEventLike, c: HotkeyContext): HotkeyAction | null => {
  const r = resolveHotkey(e, c);
  return r.type === 'action' ? r.action : null;
};
const ESC = ev({ key: 'Escape', code: 'Escape' });
const CTRL_ENTER = ev({ key: 'Enter', code: 'Enter', ctrlKey: true });
const QUESTION = ev({ key: '?', code: 'Slash', shiftKey: true });

// ───────── 登錄表（單一事實來源，03 §10.3） ─────────
describe('HOTKEYS 登錄表', () => {
  /** 03 §10.3「快速鍵地圖」逐列抄錄：[範圍, 鍵, 動作] */
  const MAP: Array<[HotkeyScope, string[], HotkeyAction]> = [
    ['global', ['?'], 'help'],
    ['global', ['s', '/'], 'search'],
    ['global', ['m'], 'goMenu'],
    ['global', ['c'], 'openCart'],
    ['global', ['o'], 'goOrders'],
    ['global', ['i'], 'goStore'],
    ['global', ['l'], 'goLogin'],
    ['global', ['Escape'], 'close'],
    ['menu', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], 'jumpCategory'],
    ['menu', ['v'], 'toggleLayout'],
    ['menu', ['a'], 'addFocused'],
    ['menu', ['r'], 'repeatFocused'],
    ['menu', ['f'], 'toggleFavorite'],
    ['sheet', ['+', '='], 'qtyUp'],
    ['sheet', ['-'], 'qtyDown'],
    ['sheet', ['a'], 'confirmAdd'],
    ['sheet', ['d'], 'restoreDefault'],
    ['cart', ['e'], 'editLine'],
    ['cart', ['d'], 'removeLine'],
    ['cart', ['+', '='], 'qtyUp'],
    ['cart', ['-'], 'qtyDown'],
    ['cart', ['p'], 'checkout'],
    ['checkout', ['b'], 'back'],
    ['checkout', ['Ctrl+Enter'], 'submitOrder'],
    ['order', ['a'], 'again'],
    ['order', ['u'], 'refresh'],
  ];

  it('與 03 §10.3 快速鍵地圖完全一致（範圍、鍵位、動作）', () => {
    expect(HOTKEYS).toHaveLength(MAP.length);
    expect(HOTKEYS).toHaveLength(26);
    MAP.forEach(([scope, keys, action], i) => {
      const def = HOTKEYS[i];
      expect(def?.scope, `第 ${i + 1} 列`).toBe(scope);
      expect(def?.action, `第 ${i + 1} 列`).toBe(action);
      expect([...(def?.keys ?? [])], `第 ${i + 1} 列`).toEqual(keys);
    });
  });

  it('每個項目都有繁體中文說明', () => {
    for (const d of HOTKEYS) expect(d.label.length, d.action).toBeGreaterThan(0);
  });

  it('同時有效的範圍組合內沒有重複按鍵', () => {
    const combos: HotkeyScope[][] = [
      ['global', 'menu', 'cart'],
      ['global', 'sheet'],
      ['global', 'cart'],
      ['global', 'checkout'],
      ['global', 'order'],
    ];
    for (const sc of combos) {
      const seen = new Map<string, string>();
      for (const d of HOTKEYS.filter((h) => sc.includes(h.scope))) {
        for (const k of d.keys) {
          expect(seen.has(k), `${sc.join('+')} 重複按鍵 ${k}：${seen.get(k)} vs ${d.action}`).toBe(
            false,
          );
          seen.set(k, d.action);
        }
      }
    }
  });

  it('所有字母鍵為小寫單字元；alwaysOn 僅限 Escape 與 Ctrl+Enter（WCAG 2.1.4）', () => {
    for (const d of HOTKEYS) {
      for (const k of d.keys) {
        expect(
          k === 'Escape' || k === 'Ctrl+Enter' || /^[a-z0-9?/+=-]$/.test(k),
          `非法按鍵 ${k}`,
        ).toBe(true);
        if (d.alwaysOn) expect(k === 'Escape' || k === 'Ctrl+Enter').toBe(true);
      }
    }
    expect(
      HOTKEYS.filter((h) => h.alwaysOn)
        .map((h) => h.action)
        .sort(),
    ).toEqual(['close', 'submitOrder']);
  });

  it('help（?）不是 alwaysOn：符號字元快捷鍵須可關閉', () => {
    expect(HOTKEYS.find((h) => h.action === 'help')?.alwaysOn).toBeUndefined();
  });
});

// ───────── 比對與觸發條件 ─────────
describe('resolveHotkey', () => {
  it('c → openCart；s 與 / → search；? → help（Shift）', () => {
    expect(act(key('c'), ctx())).toBe('openCart');
    expect(act(key('s'), ctx())).toBe('search');
    expect(act(ev({ key: '/', code: 'Slash' }), ctx())).toBe('search');
    expect(act(QUESTION, ctx())).toBe('help');
  });

  it('不分大小寫：CapsLock（key = C 無 Shift）可觸發；Shift + c 不觸發', () => {
    expect(act(ev({ key: 'C', code: 'KeyC' }), ctx())).toBe('openCart');
    expect(act(ev({ key: 'C', code: 'KeyC', shiftKey: true }), ctx())).toBeNull();
    expect(act(key('3', { shiftKey: true }), ctx())).toBeNull(); // Shift + 數字不觸發
  });

  it('輸入框內不觸發；Esc 與 Ctrl+Enter 仍有效', () => {
    const c = ctx({ targetIsEditable: true, scopes: ['checkout', 'global'] });
    expect(act(key('c'), c)).toBeNull();
    expect(act(key('b'), c)).toBeNull();
    expect(act(ESC, c)).toBe('close');
    expect(act(CTRL_ENTER, c)).toBe('submitOrder');
  });

  it('輸入法組字中（isComposing）不觸發；keyCode 229 於輸入元件內不觸發（含 Esc）', () => {
    expect(act(key('c', { isComposing: true }), ctx())).toBeNull();
    expect(act(key('c', { keyCode: 229 }), ctx({ targetIsEditable: true }))).toBeNull();
    expect(
      act(ev({ key: 'Escape', code: 'Escape', keyCode: 229 }), ctx({ targetIsEditable: true })),
    ).toBeNull();
    expect(act(ev({ key: 'Escape', code: 'Escape', isComposing: true }), ctx())).toBeNull(); // EC-25
  });

  it('非輸入元件焦點下，輸入法送出的 Process / 229 仍以實體按鍵比對', () => {
    expect(act(ev({ key: 'Process', code: 'KeyC', keyCode: 229 }), ctx())).toBe('openCart');
    expect(
      act(ev({ key: 'Process', code: 'KeyC', keyCode: 229 }), ctx({ targetIsEditable: true })),
    ).toBeNull();
  });

  it('注音輸入法下 key 為 Process 或注音符號時，以實體按鍵（event.code）比對', () => {
    expect(act(ev({ key: 'Process', code: 'KeyC' }), ctx())).toBe('openCart');
    expect(act(ev({ key: 'ㄘ', code: 'KeyC' }), ctx())).toBe('openCart');
    expect(resolveHotkey(ev({ key: 'ㄧ', code: 'Digit3' }), ctx())).toEqual({
      type: 'action',
      action: 'jumpCategory',
      scope: 'menu',
      arg: '3',
    });
  });

  it('非拉丁字元（西里爾、全形）與 Unidentified 仍以實體鍵位比對', () => {
    expect(act(ev({ key: 'с', code: 'KeyC' }), ctx())).toBe('openCart'); // 西里爾 es
    expect(act(ev({ key: 'ｃ', code: 'KeyC' }), ctx())).toBe('openCart'); // 全形 c
    expect(act(ev({ key: 'Unidentified', code: 'KeyC' }), ctx())).toBe('openCart');
  });

  it('Ctrl / Meta / Alt 組合不觸發（除 Ctrl/⌘ + Enter）', () => {
    expect(act(key('c', { ctrlKey: true }), ctx())).toBeNull();
    expect(act(key('c', { metaKey: true }), ctx())).toBeNull();
    expect(act(key('c', { altKey: true }), ctx())).toBeNull();
    const co = ctx({ scopes: ['checkout', 'global'] });
    expect(act(ev({ key: 'Enter', code: 'Enter', metaKey: true }), co)).toBe('submitOrder');
    expect(act(ev({ key: 'Enter', code: 'Enter', ctrlKey: true, altKey: true }), co)).toBeNull();
    expect(act(ev({ key: 'Escape', code: 'Escape', ctrlKey: true }), co)).toBeNull();
  });

  it('單獨 Enter（無 Ctrl / ⌘）不是快速鍵', () => {
    expect(
      act(ev({ key: 'Enter', code: 'Enter' }), ctx({ scopes: ['checkout', 'global'] })),
    ).toBeNull();
  });

  it('長按（repeat）不重複觸發，Esc 亦然', () => {
    expect(act(key('c', { repeat: true }), ctx())).toBeNull();
    expect(act(ev({ key: 'Escape', code: 'Escape', repeat: true }), ctx())).toBeNull();
  });

  it('停用單鍵快速鍵：字母鍵與 ? 失效，Esc 與 Ctrl+Enter 仍有效（預設未啟用）', () => {
    const off = ctx({ enabled: false, scopes: ['checkout', 'global'] });
    expect(act(key('c'), off)).toBeNull();
    expect(act(key('b'), off)).toBeNull();
    expect(act(QUESTION, off)).toBeNull();
    expect(act(ESC, off)).toBe('close');
    expect(act(CTRL_ENTER, off)).toBe('submitOrder');
  });

  it('數字鍵跳分類並帶參數；範圍外（無 menu）不觸發', () => {
    expect(resolveHotkey(key('3'), ctx())).toEqual({
      type: 'action',
      action: 'jumpCategory',
      scope: 'menu',
      arg: '3',
    });
    expect(resolveHotkey(key('0'), ctx())).toEqual({
      type: 'action',
      action: 'jumpCategory',
      scope: 'menu',
      arg: '0',
    });
    expect(act(key('3'), ctx({ scopes: ['global'] }))).toBeNull();
  });

  it('桌機菜單頁同時有 menu + cart 範圍：a 加入、e 編輯、p 結帳、r 再點', () => {
    expect(act(key('a'), ctx())).toBe('addFocused');
    expect(act(key('e'), ctx())).toBe('editLine');
    expect(act(key('p'), ctx())).toBe('checkout');
    expect(act(key('r'), ctx())).toBe('repeatFocused');
    expect(act(key('f'), ctx())).toBe('toggleFavorite');
    expect(act(key('v'), ctx())).toBe('toggleLayout');
  });

  it('範圍順序由最特定到最泛用：同鍵在較前範圍優先（菜單 a = addFocused，訂單頁 a = again）', () => {
    expect(act(key('a'), ctx({ scopes: ['order', 'global'] }))).toBe('again');
    expect(act(key('u'), ctx({ scopes: ['order', 'global'] }))).toBe('refresh');
    expect(act(key('d'), ctx({ scopes: ['sheet', 'cart', 'global'] }))).toBe('restoreDefault');
    expect(act(key('d'), ctx({ scopes: ['cart', 'sheet', 'global'] }))).toBe('removeLine');
  });

  it('全域鍵：m / o / i / l', () => {
    const g = ctx({ scopes: ['global'] });
    expect(act(key('m'), g)).toBe('goMenu');
    expect(act(key('o'), g)).toBe('goOrders');
    expect(act(key('i'), g)).toBe('goStore');
    expect(act(key('l'), g)).toBe('goLogin');
  });

  it('未登錄的鍵回傳 none', () => {
    expect(resolveHotkey(key('z'), ctx())).toEqual({ type: 'none' });
    expect(resolveHotkey(key('x'), ctx())).toEqual({ type: 'none' });
  });

  it('合成事件沒有 key / code 時不丟例外', () => {
    const bare = {
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
      isComposing: false,
    } as unknown as KeyEventLike;
    expect(() => resolveHotkey(bare, ctx())).not.toThrow();
    expect(resolveHotkey(bare, ctx())).toEqual({ type: 'none' });
  });

  describe('商品面板與浮層（modalScope）', () => {
    const sheet = ctx({ scopes: ['sheet', 'global'], modalOpen: true, modalScope: 'sheet' });

    it('+ / = 增加、- 減少、a 加入、d 恢復預設；全域導覽鍵失效；? 與 Esc 仍有效', () => {
      expect(act(ev({ key: '+', code: 'Equal', shiftKey: true }), sheet)).toBe('qtyUp');
      expect(act(ev({ key: '=', code: 'Equal' }), sheet)).toBe('qtyUp');
      expect(act(ev({ key: '-', code: 'Minus' }), sheet)).toBe('qtyDown');
      expect(act(key('a'), sheet)).toBe('confirmAdd');
      expect(act(key('d'), sheet)).toBe('restoreDefault');
      expect(act(key('c'), sheet)).toBeNull(); // 全域 openCart 被擋
      expect(act(key('s'), sheet)).toBeNull();
      expect(act(QUESTION, sheet)).toBe('help');
      expect(act(ESC, sheet)).toBe('close');
    });

    it('背景頁面範圍（menu 的 v / r / f / 數字、cart 的 e / p、checkout 的 Ctrl+Enter 與 b）一併失效，且不遮蔽浮層自己的範圍', () => {
      const withBackground = ctx({
        scopes: ['sheet', 'menu', 'cart', 'global'],
        modalOpen: true,
        modalScope: 'sheet',
      });
      for (const k of ['v', 'r', 'f', '3', 'e', 'p', 'c'])
        expect(act(key(k), withBackground), k).toBeNull();
      expect(act(key('a'), withBackground)).toBe('confirmAdd'); // 不被 menu 的 addFocused 遮蔽
      expect(act(key('d'), withBackground)).toBe('restoreDefault'); // 不被 cart 的 removeLine 遮蔽
      const confirm = ctx({ scopes: ['checkout', 'global'], modalOpen: true });
      expect(act(CTRL_ENTER, confirm)).toBeNull();
      expect(act(key('b'), confirm)).toBeNull();
      expect(act(ESC, confirm)).toBe('close');
    });

    it('純對話框（無 modalScope）只剩 ? 與 Esc', () => {
      const help = ctx({ scopes: ['menu', 'global'], modalOpen: true });
      expect(act(key('a'), help)).toBeNull();
      expect(act(key('c'), help)).toBeNull();
      expect(act(QUESTION, help)).toBe('help');
      expect(act(ESC, help)).toBe('close');
    });

    it('購物車抽屜為浮層（modalScope = cart）：e / d / p / ± 有效，菜單鍵失效', () => {
      const drawer = ctx({
        scopes: ['cart', 'menu', 'global'],
        modalOpen: true,
        modalScope: 'cart',
      });
      expect(act(key('p'), drawer)).toBe('checkout');
      expect(act(key('e'), drawer)).toBe('editLine');
      expect(act(key('d'), drawer)).toBe('removeLine');
      expect(act(key('v'), drawer)).toBeNull();
      expect(act(key('a'), drawer)).toBeNull();
    });

    it('浮層開啟但單鍵未啟用：只剩 Esc', () => {
      const off = ctx({
        enabled: false,
        scopes: ['sheet', 'global'],
        modalOpen: true,
        modalScope: 'sheet',
      });
      expect(act(key('a'), off)).toBeNull();
      expect(act(QUESTION, off)).toBeNull();
      expect(act(ESC, off)).toBe('close');
    });

    it('選項群組（radio / checkbox）上按 a 仍可加入購物車（這類元件不算輸入元件）', () => {
      const onCheckbox = ctx({
        scopes: ['sheet', 'global'],
        modalOpen: true,
        modalScope: 'sheet',
        targetIsEditable: false,
      });
      expect(act(key('a'), onCheckbox)).toBe('confirmAdd');
    });
  });

  describe('以 key 為準（非 QWERTY 配置、Dead key、Shift + -）', () => {
    it('AZERTY：鍵帽上的字元為準，不被實體位置誤判', () => {
      expect(act(ev({ key: ',', code: 'KeyM' }), ctx({ scopes: ['global'] }))).toBeNull(); // 實體 M 位置印著 ,
      expect(act(ev({ key: '!', code: 'Slash' }), ctx({ scopes: ['global'] }))).toBeNull();
    });
    it('Dead key、帶音符字元不會被當成別的鍵', () => {
      expect(
        act(ev({ key: 'Dead', code: 'Equal' }), ctx({ scopes: ['sheet', 'global'] })),
      ).toBeNull();
      expect(act(ev({ key: 'é', code: 'KeyE' }), ctx())).toBeNull(); // 美式國際
    });
    it('Shift + - 輸入的是 _，不當成數量 −1；單獨 - 為 qtyDown', () => {
      const s = ctx({ scopes: ['sheet', 'global'] });
      expect(act(ev({ key: '_', code: 'Minus', shiftKey: true }), s)).toBeNull();
      expect(act(ev({ key: '-', code: 'Minus' }), s)).toBe('qtyDown');
    });
    it('CJK 輸入法下 Shift + - / Shift + = 仍以實體鍵位比對（注音佔位）', () => {
      const s = ctx({ scopes: ['sheet', 'global'] });
      expect(act(ev({ key: 'Process', code: 'Minus', shiftKey: true }), s)).toBeNull();
      expect(act(ev({ key: 'Process', code: 'Minus' }), s)).toBe('qtyDown');
      expect(act(ev({ key: 'Process', code: 'Equal', shiftKey: true }), s)).toBe('qtyUp'); // +
      expect(act(ev({ key: 'Process', code: 'Equal' }), s)).toBe('qtyUp'); // =
    });
  });

  it('性質：未啟用單鍵快速鍵時，只有 Esc 與 Ctrl/⌘ + Enter 可能觸發', () => {
    const keyArb = fc.oneof(
      fc.constantFrom(
        'a',
        'c',
        's',
        '?',
        '/',
        '+',
        '-',
        '=',
        '1',
        '0',
        'Escape',
        'Enter',
        'Tab',
        'Process',
      ),
      fc.string({ minLength: 1, maxLength: 1 }),
    );
    fc.assert(
      fc.property(
        keyArb,
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom<HotkeyScope[]>(
          ['menu', 'cart', 'global'],
          ['sheet', 'global'],
          ['checkout', 'global'],
          ['order', 'global'],
        ),
        (k, ctrlKey, metaKey, shiftKey, modalOpen, scopes) => {
          const r = resolveHotkey(
            ev({
              key: k,
              code: k.length === 1 && /[a-z]/i.test(k) ? `Key${k.toUpperCase()}` : '',
              ctrlKey,
              metaKey,
              shiftKey,
            }),
            ctx({ enabled: false, scopes, modalOpen }),
          );
          if (r.type === 'action') expect(['close', 'submitOrder']).toContain(r.action);
        },
      ),
    );
  });

  it('性質：焦點在輸入元件時，只有 Esc 與 Ctrl/⌘ + Enter 可能觸發', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...HOTKEYS.flatMap((h) => h.keys)),
        fc.constantFrom<HotkeyScope[]>(
          ['menu', 'cart', 'global'],
          ['sheet', 'global'],
          ['checkout', 'global'],
          ['order', 'global'],
        ),
        (token, scopes) => {
          const e =
            token === 'Escape'
              ? ESC
              : token === 'Ctrl+Enter'
                ? CTRL_ENTER
                : token.length === 1 && /[a-z0-9]/.test(token)
                  ? key(token)
                  : ev({ key: token, code: '' });
          const r = resolveHotkey(e, ctx({ targetIsEditable: true, scopes }));
          if (r.type === 'action') expect(['close', 'submitOrder']).toContain(r.action);
        },
      ),
    );
  });
});

describe('normalizeKey', () => {
  it('一般字元轉小寫；符號原樣；Escape / Enter 保留；其餘為 null', () => {
    expect(normalizeKey(key('C'))).toBe('c');
    expect(normalizeKey(ev({ key: '+', code: 'Equal' }))).toBe('+');
    expect(normalizeKey(ev({ key: 'Escape', code: 'Escape' }))).toBe('Escape');
    expect(normalizeKey(ev({ key: 'Enter', code: 'Enter' }))).toBe('Enter');
    expect(normalizeKey(ev({ key: 'Tab', code: 'Tab' }))).toBeNull();
    expect(normalizeKey(ev({ key: 'ArrowDown', code: 'ArrowDown' }))).toBeNull();
    expect(normalizeKey(ev({ key: ',', code: 'Comma' }))).toBeNull();
  });
  it('Process / Unidentified / 非拉丁字元才改用實體 code：Key*、Digit*、Slash、Equal、Minus', () => {
    expect(normalizeKey(ev({ key: 'Process', code: 'KeyS' }))).toBe('s');
    expect(normalizeKey(ev({ key: 'Process', code: 'Digit7' }))).toBe('7');
    expect(normalizeKey(ev({ key: 'Process', code: 'Slash' }))).toBe('/');
    expect(normalizeKey(ev({ key: 'Process', code: 'Slash', shiftKey: true }))).toBe('?');
    expect(normalizeKey(ev({ key: 'Process', code: 'Equal', shiftKey: true }))).toBe('+');
    expect(normalizeKey(ev({ key: 'Process', code: 'Comma' }))).toBeNull();
    expect(normalizeKey(ev({ key: 'Process', code: '' }))).toBeNull();
  });
});

// ───────── isEditableTarget（BR-34） ─────────
describe('isEditableTarget', () => {
  const el = (
    tagName: string,
    o: { type?: string; ce?: boolean; role?: string } = {},
  ): EditableProbe => ({
    tagName,
    ...(o.type !== undefined ? { type: o.type } : {}),
    ...(o.ce !== undefined ? { isContentEditable: o.ce } : {}),
    getAttribute: (n: string) =>
      n === 'role' ? (o.role ?? null) : n === 'type' ? (o.type ?? null) : null,
  });

  it('文字類輸入為可編輯', () => {
    for (const type of [
      'text',
      'search',
      'email',
      'tel',
      'number',
      'password',
      'url',
      'date',
      'time',
    ]) {
      expect(isEditableTarget(el('INPUT', { type })), type).toBe(true);
    }
    expect(isEditableTarget(el('INPUT'))).toBe(true); // 無 type 預設 text
    expect(isEditableTarget(el('TEXTAREA'))).toBe(true);
    expect(isEditableTarget(el('SELECT'))).toBe(true);
    expect(isEditableTarget(el('textarea'))).toBe(true); // 小寫 tagName
  });

  it('contenteditable 與 role = textbox / searchbox / combobox 為可編輯', () => {
    expect(isEditableTarget(el('DIV', { ce: true }))).toBe(true);
    for (const role of ['textbox', 'searchbox', 'combobox'])
      expect(isEditableTarget(el('DIV', { role })), role).toBe(true);
  });

  it('radio / checkbox / button / range / 步進器（spinbutton）不算輸入元件', () => {
    for (const type of [
      'radio',
      'checkbox',
      'button',
      'submit',
      'range',
      'file',
      'image',
      'reset',
    ]) {
      expect(isEditableTarget(el('INPUT', { type })), type).toBe(false);
    }
    expect(isEditableTarget(el('DIV', { role: 'spinbutton' }))).toBe(false);
    expect(isEditableTarget(el('BUTTON'))).toBe(false);
    expect(isEditableTarget(el('A'))).toBe(false);
  });

  it('沒有焦點元素（null / undefined）為否', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });

  it('真實 DOM 元素（jsdom）', () => {
    const input = document.createElement('input');
    input.type = 'text';
    expect(isEditableTarget(input)).toBe(true);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    expect(isEditableTarget(checkbox)).toBe(false);
    const div = document.createElement('div');
    div.setAttribute('role', 'searchbox');
    expect(isEditableTarget(div)).toBe(true);
  });
});

// ───────── Esc 順序（BR-34、O-27） ─────────
describe('closeTarget', () => {
  const s = (o: Partial<CloseState> = {}): CloseState => ({
    overlayOpen: false,
    noticeVisible: false,
    focusInNotice: false,
    searchHasText: false,
    ...o,
  });

  it('依序：浮層 → 鍵盤提醒（可見且焦點在其中）→ 搜尋框有字 → 不動作', () => {
    expect(
      closeTarget(
        s({ overlayOpen: true, noticeVisible: true, focusInNotice: true, searchHasText: true }),
      ),
    ).toBe('OVERLAY');
    expect(closeTarget(s({ noticeVisible: true, focusInNotice: true, searchHasText: true }))).toBe(
      'NOTICE',
    );
    expect(closeTarget(s({ searchHasText: true }))).toBe('SEARCH');
    expect(closeTarget(s())).toBe('NONE');
  });

  it('焦點不在提醒內：不劫持 Esc（改處理搜尋框）', () => {
    expect(closeTarget(s({ noticeVisible: true, focusInNotice: false, searchHasText: true }))).toBe(
      'SEARCH',
    );
    expect(closeTarget(s({ noticeVisible: true, focusInNotice: false }))).toBe('NONE');
  });

  it('提醒未顯示時，即使 focusInNotice 為真也不處理', () => {
    expect(closeTarget(s({ focusInNotice: true }))).toBe('NONE');
  });
});
