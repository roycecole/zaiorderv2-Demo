// src/features/a11y/hotkeyRuntime.ts —— 快速鍵的執行期登錄表（處理器、頁面範圍、浮層）；非 React、無 I/O
//
// HotkeyProvider 建立一份並經 context 提供；hooks（useHotkeyAction、useHotkeyScope、useOverlayScope）
// 掛載時登錄、卸載時移除。同一動作有多個處理器時「最後登錄者優先」（最近掛載或啟用者）。
import type { HotkeyAction, HotkeyScope } from '@/domain/hotkeys';

export type HotkeyHandler = (arg?: string) => void;
export interface HotkeyHandlerRef {
  current: HotkeyHandler;
}

/** 範圍由特定到泛用的固定順序：商品面板 > 菜單 > 購物車 > 結帳 > 訂單 > 全域 */
const SCOPE_ORDER: readonly HotkeyScope[] = [
  'sheet',
  'menu',
  'cart',
  'checkout',
  'order',
  'global',
];

export interface ModalState {
  open: boolean;
  /** 最上層（最後開啟）浮層註冊的範圍；純對話框為 undefined */
  scope: HotkeyScope | undefined;
}

export interface HotkeyRuntime {
  /** 登錄動作處理器；回傳取消登錄函式 */
  registerAction(action: HotkeyAction, ref: HotkeyHandlerRef): () => void;
  /** 登錄「後備」處理器（外殼的導覽等）：只有沒有任何一般處理器時才會執行 */
  registerFallback(action: HotkeyAction, ref: HotkeyHandlerRef): () => void;
  hasHandler(action: HotkeyAction): boolean;
  /** 執行動作；回傳是否有處理器被呼叫 */
  run(action: HotkeyAction, arg?: string): boolean;
  /** 宣告頁面範圍；回傳取消函式 */
  addScope(scope: HotkeyScope): () => void;
  /** 登錄開啟中的浮層；回傳取消函式 */
  addOverlay(modalScope?: HotkeyScope): () => void;
  hasScope(scope: HotkeyScope): boolean;
  /** 目前有效範圍（由特定到泛用，恆含 global；浮層的 modalScope 一併納入） */
  getScopes(): HotkeyScope[];
  getModal(): ModalState;
  /** 範圍或浮層變動時通知（供提醒重新評估讓位條件） */
  subscribe(listener: () => void): () => void;
  /** 每次範圍 / 浮層變動遞增，供 useSyncExternalStore 取用 */
  getVersion(): number;
}

export function createHotkeyRuntime(): HotkeyRuntime {
  const actions = new Map<HotkeyAction, HotkeyHandlerRef[]>();
  const fallbacks = new Map<HotkeyAction, HotkeyHandlerRef[]>();
  const scopeCounts = new Map<HotkeyScope, number>();
  const overlays: Array<{ id: number; scope: HotkeyScope | undefined }> = [];
  const listeners = new Set<() => void>();
  let overlayId = 0;
  let version = 0;

  const changed = (): void => {
    version += 1;
    for (const l of [...listeners]) l();
  };

  const push = (
    map: Map<HotkeyAction, HotkeyHandlerRef[]>,
    action: HotkeyAction,
    ref: HotkeyHandlerRef,
  ): (() => void) => {
    const list = map.get(action) ?? [];
    list.push(ref);
    map.set(action, list);
    return () => {
      const cur = map.get(action);
      if (cur === undefined) return;
      const index = cur.lastIndexOf(ref);
      if (index >= 0) cur.splice(index, 1);
      if (cur.length === 0) map.delete(action);
    };
  };

  const top = (map: Map<HotkeyAction, HotkeyHandlerRef[]>, action: HotkeyAction) => {
    const list = map.get(action);
    return list !== undefined && list.length > 0 ? list[list.length - 1] : undefined;
  };

  const getModal = (): ModalState => {
    const last = overlays[overlays.length - 1];
    return { open: overlays.length > 0, scope: last?.scope };
  };

  return {
    registerAction: (action, ref) => push(actions, action, ref),
    registerFallback: (action, ref) => push(fallbacks, action, ref),
    hasHandler: (action) =>
      top(actions, action) !== undefined || top(fallbacks, action) !== undefined,
    run: (action, arg) => {
      const target = top(actions, action) ?? top(fallbacks, action);
      if (target === undefined) return false;
      target.current(arg);
      return true;
    },
    addScope: (scope) => {
      scopeCounts.set(scope, (scopeCounts.get(scope) ?? 0) + 1);
      changed();
      return () => {
        const next = (scopeCounts.get(scope) ?? 1) - 1;
        if (next <= 0) scopeCounts.delete(scope);
        else scopeCounts.set(scope, next);
        changed();
      };
    },
    addOverlay: (modalScope) => {
      overlayId += 1;
      const entry = { id: overlayId, scope: modalScope };
      overlays.push(entry);
      changed();
      return () => {
        const index = overlays.findIndex((o) => o.id === entry.id);
        if (index >= 0) overlays.splice(index, 1);
        changed();
      };
    },
    hasScope: (scope) => (scopeCounts.get(scope) ?? 0) > 0,
    getScopes: () => {
      const wanted = new Set<HotkeyScope>(scopeCounts.keys());
      const modalScope = getModal().scope;
      if (modalScope !== undefined) wanted.add(modalScope);
      wanted.add('global');
      return SCOPE_ORDER.filter((s) => wanted.has(s));
    },
    getModal,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion: () => version,
  };
}
