// src/features/cart/useCartLineActions.ts —— 購物車品項的操作（數量、移除含「復原」、改為 n 份、清空）與焦點管理
// 購物車頁（PG-03）與桌機訂單面板（CMP-31）共用；回饋一律是 Toast（含「復原」）+ aria-live 通報。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useToast } from '@/components';
import type { CartLine } from '@/domain/cart';
import { formatTWD } from '@/domain/format';
import { useAnnounce } from '@/features/a11y';
import { t } from '@/i18n/zh-TW';
import { cartSubtotal } from './cartMath';
import { useCartStore } from './cartStore';
import { removeLineWithUndo } from './removeLine';

export interface Adjustment {
  from: number;
  to: number;
}

export interface CartLineActions {
  /** 「改為 n 份」後的標示（lineId → 調整前後）；手動改數量或移除時清除 */
  adjusted: Readonly<Record<string, Adjustment>>;
  changeQuantity: (line: CartLine, next: number) => void;
  /** 立即移除並提供「復原」（6 秒、hover 或焦點暫停） */
  removeNow: (line: CartLine) => void;
  /** 「改為 n 份」 */
  fit: (line: CartLine, quantity: number) => void;
  undoAdjust: (line: CartLine) => void;
  /** 清空（呼叫端已完成二次確認）；提供「復原」 */
  clearAll: () => void;
}

const summaryOf = (): { count: number; total: string } => {
  const { lines } = useCartStore.getState();
  return { count: lines.length, total: formatTWD(cartSubtotal(lines)) };
};

/**
 * @param listRef 品項清單容器：移除後把焦點移到下一個品項（最後一項被移除則移到前一項），
 *                購物車變空則移到標有 `data-cart-empty-focus` 的「回菜單」（03 §10.2）。
 * @param dialogOpen 確認對話框開啟中：焦點等對話框關閉後才移動（對話框的焦點陷阱會把焦點拉回去）
 */
export function useCartLineActions(
  listRef: RefObject<HTMLElement | null>,
  dialogOpen = false,
): CartLineActions {
  const { toast } = useToast();
  const announce = useAnnounce();
  const lines = useCartStore((s) => s.lines);
  const [adjusted, setAdjusted] = useState<Record<string, Adjustment>>({});
  const pendingFocus = useRef<{ lineId: string | null } | null>(null);

  // 移除造成的重新渲染完成後才移動焦點。使用 passive effect：確認對話框卸載時其焦點陷阱的清理
  // 先於本 effect 執行，避免剛移過去的焦點被陷阱拉回已移除的對話框
  useEffect(() => {
    if (dialogOpen) return;
    const pending = pendingFocus.current;
    if (pending === null) return;
    pendingFocus.current = null;
    if (pending.lineId !== null) {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-line-id="${pending.lineId}"]`);
      if (row) {
        row.focus({ preventScroll: false });
        return;
      }
    }
    document.querySelector<HTMLElement>('[data-cart-empty-focus]')?.focus();
  }, [lines, listRef, dialogOpen]);

  const forget = useCallback((lineId: string): void => {
    setAdjusted((prev) => {
      if (!(lineId in prev)) return prev;
      const { [lineId]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const changeQuantity = useCallback(
    (line: CartLine, next: number): void => {
      useCartStore.getState().setQuantity(line.lineId, next);
      forget(line.lineId);
      const { count, total } = summaryOf();
      announce(t.cart.feedback.quantityChanged(line.snapshot.name, next, count, total));
    },
    [announce, forget],
  );

  const removeNow = useCallback(
    (line: CartLine): void => {
      const result = removeLineWithUndo(line, { toast, announce });
      if (result === null) return;
      forget(line.lineId);
      pendingFocus.current = { lineId: result.neighbourId };
    },
    [announce, forget, toast],
  );

  const fit = useCallback(
    (line: CartLine, quantity: number): void => {
      const from = line.quantity;
      useCartStore.getState().fitLinesToAvailable([{ lineId: line.lineId, quantity }]);
      setAdjusted((prev) => ({ ...prev, [line.lineId]: { from, to: quantity } }));
      const { total } = summaryOf();
      announce(t.cart.line.adjusted(quantity) + `，${total}`);
    },
    [announce],
  );

  const undoAdjust = useCallback(
    (line: CartLine): void => {
      const entry = adjusted[line.lineId];
      if (entry === undefined) return;
      useCartStore.getState().setQuantity(line.lineId, entry.from);
      forget(line.lineId);
      announce(t.cart.feedback.restored(line.snapshot.name));
    },
    [adjusted, announce, forget],
  );

  const clearAll = useCallback((): void => {
    const store = useCartStore.getState();
    const previous = store.lines;
    if (previous.length === 0) return;
    store.clear();
    setAdjusted({});
    pendingFocus.current = { lineId: null };
    toast({
      message: t.cart.feedback.cleared,
      tone: 'info',
      action: {
        label: t.common.undo,
        onAction: () => {
          const current = useCartStore.getState();
          if (current.lines.length === 0) current.restoreLines(previous);
        },
      },
    });
    announce(t.cart.feedback.cleared);
  }, [announce, toast]);

  return { adjusted, changeQuantity, removeNow, fit, undoAdjust, clearAll };
}
