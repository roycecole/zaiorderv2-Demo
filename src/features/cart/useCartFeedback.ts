// src/features/cart/useCartFeedback.ts —— 加入購物車後的回饋：Toast（含「復原」）與 aria-live 通報（03 §9、§10.4）
import { useCallback } from 'react';
import { useToast } from '@/components';
import { MAX_LINES, MAX_QTY_PER_LINE } from '@/domain/cart';
import { formatTWD } from '@/domain/format';
import { useAnnounce } from '@/features/a11y';
import { t } from '@/i18n/zh-TW';
import { addToCart, undoAdd } from './addToCart';
import type { AddFailure, AddOutcome, AddRequest } from './addToCart';

export type AddKind = 'add' | 'repeat';

/** 「品名（選項摘要）」；沒有選項時只有品名 */
export function itemLabel(name: string, optionLabels: ReadonlyArray<string>): string {
  return optionLabels.length > 0 ? `${name}（${optionLabels.join('・')}）` : name;
}

/** 無法加入時的說明（Toast 與 live region 共用） */
export function addFailureMessage(failure: AddFailure): string {
  switch (failure.reason) {
    case 'LINE_LIMIT':
      return t.errors.quantityExceededLines(MAX_LINES);
    case 'STOCK_LIMIT':
      return failure.remaining !== undefined
        ? t.common.maxReachedToday(failure.remaining)
        : t.common.maxQuantityReached(MAX_QTY_PER_LINE);
    case 'QUANTITY_LIMIT':
      return t.common.maxQuantityReached(MAX_QTY_PER_LINE);
  }
}

export interface CartFeedback {
  /**
   * 加入購物車並給予回饋：成功 → Toast（含「復原」）+ polite 通報；失敗 → Toast（warning）+ 通報。
   * `kind = 'repeat'` 使用「已再點：…」文案（§6.8）。回傳加入結果，呼叫端據此關閉面板等。
   */
  add: (req: AddRequest, kind?: AddKind) => AddOutcome;
  /** 僅顯示失敗說明（呼叫端自行判斷無法加入，例如取得商品詳情失敗） */
  fail: (message: string) => void;
}

export function useCartFeedback(): CartFeedback {
  const { toast } = useToast();
  const announce = useAnnounce();

  const fail = useCallback(
    (message: string): void => {
      toast({ message, tone: 'warning' });
      announce(message);
    },
    [toast, announce],
  );

  const add = useCallback(
    (req: AddRequest, kind: AddKind = 'add'): AddOutcome => {
      const outcome = addToCart(req);
      if (!outcome.ok) {
        fail(addFailureMessage(outcome));
        return outcome;
      }

      const label = itemLabel(req.name, req.optionLabels);
      const total = formatTWD(outcome.subtotal);
      const clamped = outcome.added < outcome.requested;
      const repeated = kind === 'repeat';
      const spoken = repeated
        ? t.cart.feedback.repeated(
            label,
            formatTWD(outcome.unitPrice * outcome.added),
            outcome.lineCount,
            total,
          )
        : t.cart.feedback.addedAnnounce(label, outcome.lineCount, total);

      toast({
        // 一般加入維持簡短（03 §9「已加入購物車（復原）」），完整句由 live region 播報；再點的完整句即 Toast 文案（§6.8）
        message: repeated
          ? spoken
          : clamped
            ? t.cart.feedback.addedClamped(MAX_QTY_PER_LINE)
            : t.cart.feedback.added,
        tone: 'success',
        action: {
          label: t.common.undo,
          onAction: () => {
            if (undoAdd(outcome)) announce(t.cart.feedback.undone(label));
          },
        },
      });
      announce(clamped ? `${spoken}。${t.common.maxQuantityReached(MAX_QTY_PER_LINE)}` : spoken);
      return outcome;
    },
    [toast, announce, fail],
  );

  return { add, fail };
}
