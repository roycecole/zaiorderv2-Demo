// src/domain/hotkeys.ts
export type HotkeyScope = 'global' | 'menu' | 'sheet' | 'cart' | 'checkout' | 'order';

export type HotkeyAction =
  | 'help' | 'search' | 'goMenu' | 'openCart' | 'goOrders' | 'goStore' | 'goLogin' | 'close'
  | 'jumpCategory' | 'toggleLayout' | 'addFocused' | 'repeatFocused' | 'toggleFavorite'
  | 'qtyUp' | 'qtyDown' | 'confirmAdd' | 'restoreDefault'
  | 'editLine' | 'removeLine' | 'checkout'
  | 'back' | 'submitOrder'
  | 'again' | 'refresh';

export interface HotkeyDef {
  action: HotkeyAction;
  scope: HotkeyScope;
  /** 小寫單一字元、數字、符號，或 'Escape'、'Ctrl+Enter' */
  keys: readonly string[];
  /** 繁體中文說明：快速鍵說明對話框與提示共用 */
  label: string;
  /** 即使使用者未啟用單鍵快速鍵仍有效（Esc、含修飾鍵的組合；WCAG 2.1.4） */
  alwaysOn?: boolean;
}

/** 單一事實來源：說明對話框、提示徽章、aria-keyshortcuts 與測試皆由此產生 */
export const HOTKEYS: readonly HotkeyDef[] = [
  // `?` 是符號字元快捷鍵（WCAG 2.1.4）：不設 alwaysOn，未啟用時不生效；入口改由鍵盤提醒、頂部 ⌨ 按鈕、跳過連結與頁尾連結提供
  { action: 'help', scope: 'global', keys: ['?'], label: '顯示 / 關閉快速鍵說明' },
  { action: 'search', scope: 'global', keys: ['s', '/'], label: '搜尋菜單' },
  { action: 'goMenu', scope: 'global', keys: ['m'], label: '回到菜單' },
  { action: 'openCart', scope: 'global', keys: ['c'], label: '開啟購物車（桌機：移到訂單面板）' },
  { action: 'goOrders', scope: 'global', keys: ['o'], label: '訂單（會員：歷史訂單；訪客：查詢訂單）' },
  { action: 'goStore', scope: 'global', keys: ['i'], label: '店家資訊' },
  { action: 'goLogin', scope: 'global', keys: ['l'], label: '登入 / 會員中心' },
  // Esc 的處理順序見 closeTarget：浮層 → 鍵盤提醒 → 搜尋框
  { action: 'close', scope: 'global', keys: ['Escape'], label: '關閉浮層、清除搜尋', alwaysOn: true },

  { action: 'jumpCategory', scope: 'menu', keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], label: '跳到第 N 個分類（0 = 全部）' },
  { action: 'toggleLayout', scope: 'menu', keys: ['v'], label: '切換圖卡 / 清單' },
  { action: 'addFocused', scope: 'menu', keys: ['a'], label: '加入焦點商品（含必選選項者開啟面板）' },
  { action: 'repeatFocused', scope: 'menu', keys: ['r'], label: '再點上次的選擇' },
  { action: 'toggleFavorite', scope: 'menu', keys: ['f'], label: '收藏 / 取消收藏' },

  { action: 'qtyUp', scope: 'sheet', keys: ['+', '='], label: '數量 +1' },
  { action: 'qtyDown', scope: 'sheet', keys: ['-'], label: '數量 −1' },
  { action: 'confirmAdd', scope: 'sheet', keys: ['a'], label: '加入購物車' },
  { action: 'restoreDefault', scope: 'sheet', keys: ['d'], label: '恢復預設選項' },

  { action: 'editLine', scope: 'cart', keys: ['e'], label: '編輯焦點品項' },
  { action: 'removeLine', scope: 'cart', keys: ['d'], label: '移除焦點品項（需確認）' },
  { action: 'qtyUp', scope: 'cart', keys: ['+', '='], label: '數量 +1' },
  { action: 'qtyDown', scope: 'cart', keys: ['-'], label: '數量 −1' },
  { action: 'checkout', scope: 'cart', keys: ['p'], label: '前往結帳' },

  { action: 'back', scope: 'checkout', keys: ['b'], label: '返回購物車' },
  { action: 'submitOrder', scope: 'checkout', keys: ['Ctrl+Enter'], label: '送出訂單（macOS 為 ⌘ + Enter）', alwaysOn: true },

  { action: 'again', scope: 'order', keys: ['a'], label: '再來一單' },
  { action: 'refresh', scope: 'order', keys: ['u'], label: '立即更新狀態' },
];

export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  keyCode?: number;
}

export interface HotkeyContext {
  /**
   * 單鍵快速鍵是否啟用：= 使用者已啟用（預設未啟用）且不在觸控面板模式（WCAG 2.1.4：必須可關閉）。
   * Demo 的 inputMode = 'KEYBOARD_HINTS' 視同啟用（不寫入偏好）。
   */
  enabled: boolean;
  /** 目前有效範圍，由最特定到最泛用；例：['menu', 'cart', 'global'] */
  scopes: readonly HotkeyScope[];
  /** 焦點是否在會接收文字輸入的元件（由 isEditableTarget 判定） */
  targetIsEditable: boolean;
  /** 是否有浮層（商品面板、購物車抽屜、對話框）開啟 */
  modalOpen: boolean;
  /**
   * modalOpen 時，浮層自己的範圍（例：商品面板為 'sheet'）。
   * 浮層開啟時背景頁面的範圍一律失效，僅保留此範圍與全域的 help / close；
   * 未提供（純對話框）時只剩 ? 與 Esc。
   */
  modalScope?: HotkeyScope;
}

export type HotkeyResolution =
  | { type: 'none' }
  | { type: 'action'; action: HotkeyAction; scope: HotkeyScope; arg?: string };

const NONE: HotkeyResolution = { type: 'none' };
const SYMBOLS = new Set(['?', '/', '+', '=', '-']);

/**
 * 正規化按鍵：優先使用 event.key。
 * 只有「輸入法佔位值」（'Process'、'Unidentified'）或「非拉丁字元」（注音符號、西里爾字母、全形字母…）
 * 才改用實體按鍵 event.code；'Dead'、ß、é、, . ; 等屬於目前配置下確實輸入的字元，不可當成別的鍵。
 */
export function normalizeKey(e: KeyEventLike): string | null {
  // 瀏覽器自動填入等合成事件可能沒有 key / code
  const key = typeof e.key === 'string' ? e.key : '';
  const code = typeof e.code === 'string' ? e.code : '';

  if (key === 'Escape') return 'Escape';
  if (key === 'Enter') return 'Enter';
  const k = key.length === 1 ? key.toLowerCase() : '';
  if (/^[a-z0-9]$/.test(k) || SYMBOLS.has(k)) return k;

  const viaCode =
    key === 'Process' || key === 'Unidentified' || (key.length === 1 && key.charCodeAt(0) > 0x024f);
  if (!viaCode) return null;

  const letter = /^Key([A-Z])$/.exec(code);
  if (letter?.[1]) return letter[1].toLowerCase();
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit?.[1]) return digit[1];
  if (code === 'Slash') return e.shiftKey ? '?' : '/';
  if (code === 'Equal') return e.shiftKey ? '+' : '=';
  if (code === 'Minus') return e.shiftKey ? null : '-'; // Shift + - 輸入的是 '_'
  return null;
}

export function resolveHotkey(e: KeyEventLike, ctx: HotkeyContext): HotkeyResolution {
  // 輸入法組字中、長按重複：一律忽略（BR-34）。
  // keyCode 229 只在焦點位於輸入元件時視為組字；非輸入元件時 key 為 'Process' 的事件仍以 code 比對。
  if (e.isComposing || e.repeat) return NONE;
  if (e.keyCode === 229 && ctx.targetIsEditable) return NONE;
  if (e.altKey) return NONE;

  const key = normalizeKey(e);
  if (key === null) return NONE;

  const mod = e.ctrlKey || e.metaKey;
  let token: string;
  if (mod) {
    if (key !== 'Enter') return NONE; // 其他 Ctrl / ⌘ 組合留給瀏覽器與輔助科技
    token = 'Ctrl+Enter';
  } else {
    // Shift 僅用於符號（? +）；Shift + 字母 / 數字不觸發
    if (e.shiftKey && /^[a-z0-9]$/.test(key)) return NONE;
    token = key;
  }

  const isAlwaysOn = HOTKEYS.some((h) => h.alwaysOn && h.keys.includes(token));
  if (ctx.targetIsEditable && !isAlwaysOn) return NONE;
  if (!ctx.enabled && !isAlwaysOn) return NONE;

  for (const scope of ctx.scopes) {
    // 浮層開啟：背景頁面範圍失效（含其 Ctrl/⌘ + Enter）；全域只保留 help 與 close
    if (ctx.modalOpen && scope !== 'global' && scope !== ctx.modalScope) continue;
    const def = HOTKEYS.find((h) => h.scope === scope && h.keys.includes(token));
    if (!def) continue;
    if (ctx.modalOpen && scope === 'global' && def.action !== 'help' && def.action !== 'close') continue;
    return def.action === 'jumpCategory'
      ? { type: 'action', action: def.action, scope, arg: token }
      : { type: 'action', action: def.action, scope };
  }
  return NONE;
}

/** 供 isEditableTarget 使用的最小元素介面（真實 DOM 的 HTMLElement 即符合） */
export interface EditableProbe {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute(name: string): string | null;
}

const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'email', 'tel', 'url', 'password', 'number',
  'date', 'datetime-local', 'month', 'time', 'week',
]);
const EDITABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox']);

/**
 * 焦點是否在「會接收文字輸入」的元件：是則單鍵快速鍵一律不觸發（BR-34）。
 * radio、checkbox、button、range 與 role="spinbutton" 的步進器不算，否則選項群組與數量鍵會失效。
 */
export function isEditableTarget(el: EditableProbe | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable === true) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el.type ?? el.getAttribute('type') ?? 'text').toLowerCase();
    return TEXT_INPUT_TYPES.has(type);
  }
  const role = el.getAttribute('role');
  return role !== null && EDITABLE_ROLES.has(role);
}

export type CloseTarget = 'OVERLAY' | 'NOTICE' | 'SEARCH' | 'NONE';

export interface CloseState {
  /** 有浮層（商品面板、購物車抽屜、對話框）開啟 */
  overlayOpen: boolean;
  /** 鍵盤提醒正在顯示（提示或確認狀態） */
  noticeVisible: boolean;
  /** 焦點在提醒卡片內 */
  focusInNotice: boolean;
  /** 搜尋框有字 */
  searchHasText: boolean;
}

/**
 * Esc（close）的處理順序（BR-34）：關閉最上層浮層 → 收起鍵盤提醒（可見且焦點在其中）
 * → 搜尋框有字則清除並失焦 → 其餘不動作（不做頁面返回）。只由 HotkeyProvider 處理，元件不得自行監聽；
 * 'NOTICE' 是本函式的結果，不是 HotkeyScope（HOTKEYS 沒有 notice 範圍）。
 */
export function closeTarget(s: CloseState): CloseTarget {
  if (s.overlayOpen) return 'OVERLAY';
  if (s.noticeVisible && s.focusInNotice) return 'NOTICE';
  if (s.searchHasText) return 'SEARCH';
  return 'NONE';
}
