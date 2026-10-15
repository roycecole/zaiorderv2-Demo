// src/features/cart/useCartPreview.ts —— 購物車的背景預檢（quote）與逐行狀態（FR-CT-05；07 §7.1「報價」列）
//
// 進入購物車 / 訂單面板時，以 quote 取得最新價格與可購買量，只標示並提供就地動作，不阻擋前往結帳。
// 逾時或 5xx 不影響使用（POST /orders 會完整重驗，BR-39）：isError 時畫面維持快照價並說明「送出時會再確認」。
import { useMemo } from 'react';
import type { CartLine } from '@/domain/cart';
import type { ID, OrderType } from '@/domain/types';
import { useQuote } from '@/features/quote/useQuote';
import type { QuoteResult } from '@/features/quote/useQuote';
import { useMenu } from '@/features/store/queries';
import { cartSubtotal } from './cartMath';
import { useCartStore } from './cartStore';
import { deriveLineStatuses } from './lineStatus';
import type { CartAvailability } from './lineStatus';

export interface CartPreview {
  lines: CartLine[];
  orderType: OrderType;
  availability: CartAvailability;
  /** 以可成立內容計的小計：quote 與目前購物車一致時為 quote.subtotal，否則為快照價 */
  subtotal: number;
  /** 未達最低消費的差額（quote 提供時） */
  shortfall: number | undefined;
  /** 正在預檢（debounce 或請求中） */
  checking: boolean;
  /** 預檢失敗（逾時或 5xx）：不阻擋，說明送出時會再確認 */
  failed: boolean;
  /** 商品剩餘份數（quote 優先，其次菜單）；供步進器上限與「今日只剩 n 份」 */
  remainingOf: (productId: ID) => number | null | undefined;
}

/** quote 的請求內容與目前購物車一致（行與份數相同）：才可採用 quote 的小計 */
function matchesCart(data: QuoteResult, lines: ReadonlyArray<CartLine>): boolean {
  if (data.lineIds.length !== lines.length) return false;
  return lines.every((line, i) => {
    const item = data.quote.items[i];
    return (
      data.lineIds[i] === line.lineId &&
      item !== undefined &&
      item.productId === line.productId &&
      item.quantity === line.quantity
    );
  });
}

export function useCartPreview(options: { enabled?: boolean } = {}): CartPreview {
  const { enabled = true } = options;
  const lines = useCartStore((s) => s.lines);
  const orderType = useCartStore((s) => s.orderType);
  const menu = useMenu();
  const quote = useQuote({ orderType, lines, scheduledAt: null, enabled });

  const menuRemaining = useMemo(() => {
    const map = new Map<ID, number | null | undefined>();
    for (const category of menu.data?.categories ?? []) {
      for (const product of category.products) map.set(product.id, product.remainingToday);
    }
    return map;
  }, [menu.data]);

  const data = quote.data;
  const availability = useMemo(
    () => deriveLineStatuses(data, lines, (productId) => menuRemaining.get(productId)),
    [data, lines, menuRemaining],
  );

  const trusted = data !== undefined && matchesCart(data, lines);
  const subtotal = trusted ? data.quote.subtotal : cartSubtotal(lines);
  const shortfall = trusted ? data.quote.minOrderShortfall : undefined;

  const remainingOf = (productId: ID): number | null | undefined => {
    for (const line of lines) {
      if (line.productId !== productId) continue;
      const status = availability.byLineId.get(line.lineId);
      if (status?.remaining !== undefined) return status.remaining;
    }
    return menuRemaining.get(productId);
  };

  return {
    lines,
    orderType,
    availability,
    subtotal,
    shortfall,
    checking: enabled && lines.length > 0 && (quote.isStale || quote.isFetching),
    failed: quote.isError && data === undefined,
    remainingOf,
  };
}
