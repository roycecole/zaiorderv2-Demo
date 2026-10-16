// src/features/cart/removeLine.ts —— 移除品項並提供「復原」（6 秒、hover 或焦點暫停）；購物車頁、訂單面板與菜單卡片共用
import type { ToastApi } from '@/components';
import type { CartLine } from '@/domain/cart';
import { formatTWD } from '@/domain/format';
import { t } from '@/i18n/zh-TW';
import { cartSubtotal } from './cartMath';
import { useCartStore } from './cartStore';

export interface RemovalResult {
  /** 移除前緊接在後（無則在前）的品項行 ID：移除後的焦點目標 */
  neighbourId: string | null;
  /** 移除後的品項行數 */
  remaining: number;
}

/**
 * 移除一行；以 Toast 的「復原」把該行放回原本的位置（不影響之後的其他變更）。
 * 回傳鄰近行與剩餘行數，供呼叫端安排焦點並通報。
 */
export function removeLineWithUndo(
  line: CartLine,
  deps: { toast: ToastApi['toast']; announce: (message: string) => void },
): RemovalResult | null {
  const store = useCartStore.getState();
  const index = store.lines.findIndex((l) => l.lineId === line.lineId);
  if (index < 0) return null;
  const neighbour = store.lines[index + 1] ?? store.lines[index - 1];
  store.removeLine(line.lineId);

  const after = useCartStore.getState().lines;
  const name = line.snapshot.name;
  deps.toast({
    message: t.cart.feedback.removed(name),
    tone: 'info',
    // 換頁後不再保留「復原」（見 useCartFeedback）
    dismissOnNavigate: true,
    action: {
      label: t.common.undo,
      onAction: () => {
        const current = useCartStore.getState();
        if (current.lines.some((l) => l.lineId === line.lineId)) return;
        const next = [...current.lines];
        next.splice(Math.min(index, next.length), 0, line);
        current.restoreLines(next);
        deps.announce(t.cart.feedback.restored(name));
      },
    },
  });
  deps.announce(
    after.length === 0
      ? t.cart.feedback.cleared
      : t.cart.feedback.removedAnnounce(name, after.length, formatTWD(cartSubtotal(after))),
  );
  return { neighbourId: neighbour?.lineId ?? null, remaining: after.length };
}
