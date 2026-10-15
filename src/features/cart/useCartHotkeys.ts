// src/features/cart/useCartHotkeys.ts —— 購物車範圍的單鍵快速鍵（scope 'cart'）：`e` 編輯、`d` 移除、`+` / `-` 數量、`p` 前往結帳
// 作用於「焦點品項」＝焦點所在（含其內的按鈕）的品項行；單鍵是否生效由 HotkeyProvider 依偏好與焦點解析（BR-34）。
import type { RefObject } from 'react';
import type { CartLine } from '@/domain/cart';
import { MAX_QTY_PER_LINE } from '@/domain/cart';
import { useAnnounce, useHotkeyAction } from '@/features/a11y';
import { t } from '@/i18n/zh-TW';
import { useCartStore } from './cartStore';
import type { CartLineActions } from './useCartLineActions';

export interface CartHotkeyOptions {
  /** 品項清單所在的容器（只處理焦點在其中的品項） */
  rootRef: RefObject<HTMLElement | null>;
  /** 商品面板開啟時背景範圍失效，由呼叫端傳 false（避免與面板的 `+` `-` 重複處理） */
  enabled: boolean;
  actions: CartLineActions;
  /** 商品剩餘份數（quote 優先，其次菜單）；供 `+` 的上限判斷 */
  remainingOf: (productId: string) => number | null | undefined;
  onEdit: (line: CartLine) => void;
  /** `d` 與 `−`（於 1 份時）：由呼叫端詢問確認 */
  onRequestRemove: (line: CartLine) => void;
  onCheckout: () => void;
}

export function useCartHotkeys({
  rootRef,
  enabled,
  actions,
  remainingOf,
  onEdit,
  onRequestRemove,
  onCheckout,
}: CartHotkeyOptions): void {
  const announce = useAnnounce();

  const focusedLine = (): CartLine | undefined => {
    const root = rootRef.current;
    const active = document.activeElement;
    if (root === null || !(active instanceof HTMLElement) || !root.contains(active))
      return undefined;
    const lineId = active.closest<HTMLElement>('[data-line-id]')?.dataset.lineId;
    if (lineId === undefined) return undefined;
    return useCartStore.getState().lines.find((l) => l.lineId === lineId);
  };

  const step = (delta: 1 | -1): void => {
    const line = focusedLine();
    if (line === undefined) return;
    if (delta === -1) {
      if (line.quantity <= 1) onRequestRemove(line);
      else actions.changeQuantity(line, line.quantity - 1);
      return;
    }
    const max = useCartStore
      .getState()
      .maxAddableFor(line.productId, remainingOf(line.productId), line.lineId);
    if (line.quantity >= max) {
      const remaining = remainingOf(line.productId);
      announce(
        typeof remaining === 'number' && max < MAX_QTY_PER_LINE
          ? t.common.maxReachedToday(remaining)
          : t.common.maxQuantityReached(MAX_QTY_PER_LINE),
      );
      return;
    }
    actions.changeQuantity(line, line.quantity + 1);
  };

  useHotkeyAction(
    'editLine',
    () => {
      const line = focusedLine();
      if (line !== undefined) onEdit(line);
    },
    { enabled },
  );
  useHotkeyAction(
    'removeLine',
    () => {
      const line = focusedLine();
      if (line !== undefined) onRequestRemove(line);
    },
    { enabled },
  );
  useHotkeyAction('qtyUp', () => step(1), { enabled });
  useHotkeyAction('qtyDown', () => step(-1), { enabled });
  useHotkeyAction('checkout', onCheckout, { enabled });
}
