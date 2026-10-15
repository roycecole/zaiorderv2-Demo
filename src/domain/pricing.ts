// src/domain/pricing.ts
import type { DeliveryZone, DiscountType, OrderType, TWD } from './types';

export interface PricedLine {
  basePrice: TWD;
  optionDeltas: number[];
  quantity: number;
}

/** BR-02：單價 = 基本價 + Σ 選項加價，且不得小於 0 */
export function unitPrice(line: Pick<PricedLine, 'basePrice' | 'optionDeltas'>): TWD {
  const delta = line.optionDeltas.reduce((sum, d) => sum + d, 0);
  return Math.max(0, line.basePrice + delta);
}

export function lineTotal(line: PricedLine): TWD {
  return unitPrice(line) * line.quantity;
}

/** BR-03：僅外送；以「折扣前小計」判斷免運 */
export function calcDeliveryFee(
  orderType: OrderType,
  subtotal: TWD,
  zone: Pick<DeliveryZone, 'deliveryFee' | 'freeDeliveryThreshold'> | null,
): TWD {
  if (orderType !== 'DELIVERY' || zone === null) return 0;
  const free = zone.freeDeliveryThreshold;
  return free !== null && subtotal >= free ? 0 : zone.deliveryFee;
}

export interface DiscountRule {
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount?: TWD | null;
}

/** BR-05：百分比無條件捨去並受上限約束；不得超過小計；免運折抵等於運費 */
export function calcDiscount(rule: DiscountRule | null, subtotal: TWD, deliveryFee: TWD): TWD {
  if (rule === null) return 0;
  switch (rule.discountType) {
    case 'PERCENT': {
      const raw = Math.floor((subtotal * rule.discountValue) / 100);
      return Math.min(raw, rule.maxDiscountAmount ?? raw, subtotal);
    }
    case 'FIXED_AMOUNT':
      return Math.min(rule.discountValue, subtotal);
    case 'FREE_DELIVERY':
      return deliveryFee;
  }
}

/** BR-06 */
export function calcTotal(subtotal: TWD, deliveryFee: TWD, discount: TWD): TWD {
  return Math.max(0, subtotal + deliveryFee - discount);
}
