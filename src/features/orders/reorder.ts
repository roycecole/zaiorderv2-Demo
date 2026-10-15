// src/features/orders/reorder.ts —— 再來一單的規劃（FLOW-13、BR-11、BR-40；純函式）
//
// 依訂單當時的品項（名稱快照）與商品「目前」的狀態，決定哪些品項可以加入購物車：
//   · 商品下架 / 售完 → 略過；
//   · 數量超過可購買份數 → 調整為可購買份數（扣除購物車內同商品其他行與本次已配置的份數；同訂單內同商品多行依序配置）；
//   · 選項以「群組名稱 + 選項名稱」比對（訂單只存名稱快照）：失效者丟棄，必選群組不足以預設補足；
//     必選群組失效且無預設選項 → 整個品項略過；
//   · 這是不保留的預覽（加入購物車不保留庫存，送出時仍以伺服器最終確認為準）。
import { applyRemembered, satisfiesGroups } from '@/domain/rememberedChoice';
import { MAX_LINES, MAX_QTY_PER_LINE, cartLineKey } from '@/domain/cart';
import type { CartLine } from '@/domain/cart';
import type { ID, OrderItem, ProductDetail } from '@/domain/types';

export type ReorderSkipReason = 'UNLISTED' | 'SOLD_OUT' | 'OPTIONS' | 'LINE_LIMIT' | 'CART_LIMIT';

export interface ReorderSkipped {
  name: string;
  reason: ReorderSkipReason;
}

export interface ReorderAdjusted {
  name: string;
  from: number;
  to: number;
  /** LIMITED：今日限量；MAX_LINE：單一品項上限 */
  reason: 'LIMITED' | 'MAX_LINE';
}

export interface ReorderPlan {
  /** 可加入購物車的品項行（尚未含 lineId） */
  lines: Array<Omit<CartLine, 'lineId'>>;
  adjusted: ReorderAdjusted[];
  /** 部分選項已不提供而改用預設的品項名稱 */
  optionsDropped: string[];
  skipped: ReorderSkipped[];
}

type CartLineLike = Pick<CartLine, 'productId' | 'quantity' | 'optionIds' | 'note'>;

/** 把訂單品項的選項名稱對應回商品目前的選項 ID；找不到者回傳於 unmatched */
function matchOptions(
  detail: ProductDetail,
  item: OrderItem,
): { ids: ID[]; unmatched: number } {
  const ids: ID[] = [];
  let unmatched = 0;
  for (const wanted of item.options) {
    const group = detail.optionGroups.find((g) => g.name === wanted.groupName);
    const option = group?.options.find((o) => o.name === wanted.name);
    if (option === undefined) unmatched += 1;
    else if (!ids.includes(option.id)) ids.push(option.id);
  }
  return { ids, unmatched };
}

/**
 * @param details 商品目前的詳情；`null` 表示商品已下架或不存在
 * @param cartLines 購物車目前的品項行（用來扣除可購買份數與判斷合併）
 */
export function planReorder(
  items: ReadonlyArray<OrderItem>,
  details: ReadonlyMap<ID, ProductDetail | null>,
  cartLines: ReadonlyArray<CartLineLike>,
): ReorderPlan {
  const plan: ReorderPlan = { lines: [], adjusted: [], optionsDropped: [], skipped: [] };

  // 本次規劃中各商品已配置的份數，以及各合併鍵（購物車與本次）的累計數量
  const plannedByProduct = new Map<ID, number>();
  const quantityByKey = new Map<string, number>();
  const cartQtyByProduct = new Map<ID, number>();
  for (const l of cartLines) {
    quantityByKey.set(cartLineKey(l), (quantityByKey.get(cartLineKey(l)) ?? 0) + l.quantity);
    cartQtyByProduct.set(l.productId, (cartQtyByProduct.get(l.productId) ?? 0) + l.quantity);
  }

  for (const item of items) {
    const skip = (reason: ReorderSkipReason): void => {
      plan.skipped.push({ name: item.name, reason });
    };

    const productId = item.productId ?? null;
    const detail = productId === null ? null : (details.get(productId) ?? null);
    if (productId === null || detail === null) {
      skip('UNLISTED');
      continue;
    }
    if (detail.isSoldOut) {
      skip('SOLD_OUT');
      continue;
    }

    // 選項：名稱比對 → 以商品目前的群組規則驗證（失效者丟棄、必選不足以預設補足）
    const { ids, unmatched } = matchOptions(detail, item);
    const applied = applyRemembered(detail, {
      productId,
      optionIds: ids,
      labels: [],
      at: 0,
    });
    const optionIds = applied.optionIds;
    if (!satisfiesGroups(detail, optionIds)) {
      skip('OPTIONS');
      continue;
    }
    const optionsChanged =
      item.options.length > 0 && (unmatched > 0 || applied.status === 'PARTIAL');

    // 數量
    const remaining = detail.remainingToday;
    const alreadyIn = (cartQtyByProduct.get(productId) ?? 0) + (plannedByProduct.get(productId) ?? 0);
    const stockCap =
      typeof remaining === 'number' ? Math.max(0, remaining - alreadyIn) : Number.POSITIVE_INFINITY;

    const note = item.note?.trim();
    const key = cartLineKey({ productId, optionIds, ...(note ? { note } : {}) });
    const existingInLine = quantityByKey.get(key) ?? 0;
    const lineCap = Math.max(0, MAX_QTY_PER_LINE - existingInLine);

    const want = Math.max(1, item.quantity);
    const take = Math.min(want, stockCap, lineCap);
    if (take <= 0) {
      skip(remaining === 0 ? 'SOLD_OUT' : 'CART_LIMIT');
      continue;
    }

    // 品項行數上限：合併到既有行不占新的行
    const isNewLine = !quantityByKey.has(key);
    if (isNewLine && quantityByKey.size >= MAX_LINES) {
      skip('LINE_LIMIT');
      continue;
    }

    if (take < want) {
      plan.adjusted.push({
        name: item.name,
        from: want,
        to: take,
        reason: stockCap < want ? 'LIMITED' : 'MAX_LINE',
      });
    }
    if (optionsChanged) plan.optionsDropped.push(item.name);

    const picked = detail.optionGroups.flatMap((g) => g.options.filter((o) => optionIds.includes(o.id)));
    const line: Omit<CartLine, 'lineId'> = {
      productId,
      quantity: take,
      optionIds,
      snapshot: {
        name: detail.name,
        unitPrice: detail.basePrice + picked.reduce((sum, o) => sum + o.priceDelta, 0),
        optionLabels: picked.map((o) => o.name),
      },
    };
    if (note) line.note = note;
    if (detail.imageUrl !== undefined) line.snapshot.imageUrl = detail.imageUrl;
    plan.lines.push(line);

    plannedByProduct.set(productId, (plannedByProduct.get(productId) ?? 0) + take);
    quantityByKey.set(key, existingInLine + take);
  }

  return plan;
}

/** 計畫是否「完全照原樣」加入（沒有調整、沒有略過、沒有選項異動）：可直接導向購物車而不需說明 */
export function isCleanPlan(plan: ReorderPlan): boolean {
  return (
    plan.lines.length > 0 &&
    plan.adjusted.length === 0 &&
    plan.skipped.length === 0 &&
    plan.optionsDropped.length === 0
  );
}
