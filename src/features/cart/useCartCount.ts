// src/features/cart/useCartCount.ts —— 購物車的品項數與小計 selector（CartBar、CartPanel、AppBar 角標共用）
import { cartQuantity, cartSubtotal } from './cartMath';
import { useCartStore } from './cartStore';

export interface CartCount {
  /** 品項行數（「3 項」；FR-CT-01 的品項數，與原型 CartBar 一致） */
  lineCount: number;
  /** 全部份數加總 */
  quantity: number;
  /** 快照價小計（TWD） */
  subtotal: number;
  isEmpty: boolean;
}

/**
 * 以個別 selector 取值（回傳原始型別，不產生新物件），購物車內容未變時不會重新渲染。
 * 小計以加入當下的快照單價計；結帳前的實際金額以 quote 為準（BR-25）。
 */
export function useCartCount(): CartCount {
  const lineCount = useCartStore((s) => s.lines.length);
  const quantity = useCartStore((s) => cartQuantity(s.lines));
  const subtotal = useCartStore((s) => cartSubtotal(s.lines));
  return { lineCount, quantity, subtotal, isEmpty: lineCount === 0 };
}
