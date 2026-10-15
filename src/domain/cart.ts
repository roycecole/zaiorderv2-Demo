// src/domain/cart.ts
import type { ID, OrderType } from './types';

export const MAX_QTY_PER_LINE = 20;
export const MAX_LINES = 30;
export const CART_TTL_MS = 24 * 60 * 60 * 1000;

export interface CartLine {
  lineId: string;                 // 前端產生
  productId: ID;
  quantity: number;
  optionIds: ID[];
  note?: string;
  /** 顯示用快照；價格以伺服器 quote 為準 */
  snapshot: { name: string; imageUrl?: string; unitPrice: number; optionLabels: string[] };
}

export interface CartState {
  lines: CartLine[];
  orderType: OrderType;
  updatedAt: number;              // epoch ms
}

/** BR-13：商品 + 排序後選項 + 備註 即為合併鍵 */
export function cartLineKey(l: Pick<CartLine, 'productId' | 'optionIds' | 'note'>): string {
  const opts = [...l.optionIds].sort().join(',');
  return `${l.productId}|${opts}|${(l.note ?? '').trim()}`;
}

export function isCartExpired(state: Pick<CartState, 'updatedAt'>, nowMs: number): boolean {
  return nowMs - state.updatedAt > CART_TTL_MS;
}
