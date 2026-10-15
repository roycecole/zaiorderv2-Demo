// src/features/cart/addToCart.ts —— 加入購物車的核心邏輯（不含 Toast / 播報；由 useCartFeedback 包裝）
//
// cartStore.addLine 只強制「單行 20 份、30 行」；剩餘份數的步進上限（FR-PD-04）由這裡依
// `maxAddable` 與合併行的剩餘空間一併計算，避免「加了 10 份但實際只加 2 份」的無聲截斷。
import { maxAddable } from '@/domain/availability';
import { MAX_LINES, MAX_QTY_PER_LINE, cartLineKey } from '@/domain/cart';
import type { ID } from '@/domain/types';
import { quantityOfProduct } from './cartMath';
import { useCartStore } from './cartStore';

export interface AddRequest {
  productId: ID;
  name: string;
  imageUrl?: string | undefined;
  /** 取餐營業日剩餘份數；null = 不限量；undefined = 未提供（不預先限制，BR-39） */
  remaining: number | null | undefined;
  optionIds: ID[];
  optionLabels: string[];
  /** 含選項加價的單價（加入當下的現價；伺服器 quote 為準） */
  unitPrice: number;
  quantity: number;
  note?: string | undefined;
}

export type AddFailureReason =
  /** 品項行數已達 30 行（BR-13） */
  | 'LINE_LIMIT'
  /** 該行已達單行 20 份 */
  | 'QUANTITY_LIMIT'
  /** 同商品已占滿今日剩餘份數 */
  | 'STOCK_LIMIT';

export interface AddSuccess {
  ok: true;
  lineId: string;
  /** 實際加入的份數（可能小於要求：受單行 20 份與剩餘份數限制） */
  added: number;
  requested: number;
  unitPrice: number;
  /** 加入後的品項行數與小計（快照價），供通報使用 */
  lineCount: number;
  subtotal: number;
}

export interface AddFailure {
  ok: false;
  reason: AddFailureReason;
  /** STOCK_LIMIT：今日剩餘份數 */
  remaining?: number;
}

export type AddOutcome = AddSuccess | AddFailure;

export function addToCart(req: AddRequest): AddOutcome {
  const store = useCartStore.getState();
  const note = req.note?.trim();
  const keyed = { productId: req.productId, optionIds: req.optionIds, ...(note ? { note } : {}) };
  const key = cartLineKey(keyed);
  const existing = store.lines.find((l) => cartLineKey(l) === key);

  if (existing === undefined && store.lines.length >= MAX_LINES)
    return { ok: false, reason: 'LINE_LIMIT' };

  const inCart = quantityOfProduct(store.lines, req.productId);
  const stockCap = maxAddable(req.remaining, inCart, MAX_QTY_PER_LINE);
  const lineCap = MAX_QTY_PER_LINE - (existing?.quantity ?? 0);
  const allowed = Math.min(Math.max(1, Math.floor(req.quantity)), stockCap, lineCap);

  if (allowed < 1) {
    if (lineCap < 1) return { ok: false, reason: 'QUANTITY_LIMIT' };
    return typeof req.remaining === 'number'
      ? { ok: false, reason: 'STOCK_LIMIT', remaining: req.remaining }
      : { ok: false, reason: 'QUANTITY_LIMIT' };
  }

  const added = store.addLine({
    productId: req.productId,
    quantity: allowed,
    optionIds: [...req.optionIds],
    ...(note ? { note } : {}),
    snapshot: {
      name: req.name,
      ...(req.imageUrl ? { imageUrl: req.imageUrl } : {}),
      unitPrice: req.unitPrice,
      optionLabels: [...req.optionLabels],
    },
  });
  if (!added) return { ok: false, reason: 'LINE_LIMIT' };

  const after = useCartStore.getState().lines;
  const line = after.find((l) => cartLineKey(l) === key);
  return {
    ok: true,
    lineId: line?.lineId ?? existing?.lineId ?? '',
    added: allowed,
    requested: req.quantity,
    unitPrice: req.unitPrice,
    lineCount: after.length,
    subtotal: after.reduce((sum, l) => sum + l.snapshot.unitPrice * l.quantity, 0),
  };
}

/** 「復原」：把本次加入的數量扣回，歸零則移除該行（FLOW-03）。該行已不存在時回傳 false */
export function undoAdd(outcome: Pick<AddSuccess, 'lineId' | 'added'>): boolean {
  const store = useCartStore.getState();
  const line = store.lines.find((l) => l.lineId === outcome.lineId);
  if (line === undefined) return false;
  const next = line.quantity - outcome.added;
  if (next < 1) store.removeLine(line.lineId);
  else store.setQuantity(line.lineId, next);
  return true;
}
