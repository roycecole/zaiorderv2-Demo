// src/services/api/mock/otherOrders.ts —— 他人訂單（Demo 注入）：以真實訂單列占用份數與時段（07 §6.8、08 §8）
// pickup_no 前綴 X；無 user_id、不寫入 guestOrders，不出現在任何列表與查詢；手動店家操作與模擬器排除之。
import { paymentDeadlineMs } from '@/domain/timeouts';
import type { ID, ISODate } from '@/domain/types';
import type { OrderRow } from './dbTypes';
import { newOrderNo, newUlid } from './ids';
import { OTHER_ORDER_PREFIX, clampInjection, nextPickupNo, slotFillCount } from './inject';
import { isOtherOrder, logCreated, transition } from './orderModel';
import type { OrderCtx } from './orderModel';
import { STORE_ID } from './seed/store';
import { loadWorld } from './world';
import type { World, WorldProduct } from './world';

export interface InjectSpec {
  productId: ID;
  quantity: number;
  status?: 'ACCEPTED' | 'PENDING_PAYMENT';
  scheduledAtMs?: number | null;
  /** 省略時依 scheduledAt 推得（即時單為現在所屬營業日） */
  businessDate?: ISODate;
}

const worldOf = (ctx: OrderCtx): World =>
  loadWorld({ seed: ctx.seed, data: ctx.data, demo: ctx.demo, nowMs: ctx.nowMs });

function addOtherOrder(
  ctx: OrderCtx,
  product: WorldProduct,
  quantity: number,
  status: 'ACCEPTED' | 'PENDING_PAYMENT',
  scheduledAtMs: number | null,
  businessDate: ISODate,
): OrderRow {
  const now = ctx.nowMs;
  const id = newUlid(now);
  const online = status === 'PENDING_PAYMENT';
  const pickupNo = nextPickupNo(
    ctx.data.orders.map((o) => ({ businessDate: o.business_date, pickupNo: o.pickup_no })),
    businessDate,
    OTHER_ORDER_PREFIX,
  );
  const total = product.basePrice * quantity;
  const row: OrderRow = {
    id,
    order_no: newOrderNo(now),
    store_id: STORE_ID,
    user_id: null,
    order_type: 'PICKUP',
    status: online ? 'PENDING_PAYMENT' : 'PENDING',
    payment_status: 'UNPAID',
    payment_method: online ? 'LINE_PAY' : 'CASH',
    business_date: businessDate,
    pickup_no: pickupNo,
    customer_name: null,
    customer_phone: null,
    scheduled_at: scheduledAtMs,
    estimated_ready_at: scheduledAtMs ?? now,
    table_no: null,
    delivery_city: null,
    delivery_district: null,
    delivery_zip_code: null,
    delivery_address_line: null,
    delivery_note: null,
    subtotal_amount: total,
    delivery_fee: 0,
    discount_amount: 0,
    total_amount: total,
    coupon_id: null,
    coupon_code: null,
    need_utensils: false,
    note: null,
    marketing_opt_in: false,
    cancelled_by: null,
    cancel_reason: null,
    placed_at: now,
    payment_expires_at: online ? paymentDeadlineMs(now, ctx.seed.settings.paymentTimeoutMinutes) : null,
    pending_at: online ? null : now,
    accepted_at: null,
    ready_at: null,
    completed_at: null,
    cancelled_at: null,
    refund_started_at: null,
    idempotency_key: null,
    idempotency_request_hash: null,
    tracking_token_hash: null,
  };
  ctx.data.orders.push(row);
  ctx.data.order_items.push({
    id: newUlid(now),
    order_id: id,
    product_id: product.id,
    product_name: product.name,
    base_price: product.basePrice,
    options_price: 0,
    quantity,
    line_total: total,
    note: null,
    sort_order: 0,
  });
  logCreated(ctx, row, now);
  // 預設 ACCEPTED：不受接單逾時影響，持續占用份數與時段，直到「清除他人訂單」
  if (!online) transition(ctx, row, 'ACCEPTED', 'STORE', { at: now });
  return row;
}

/**
 * 他人現在下單（FR-DM-12）：份數夾在目前剩餘內，Demo 動作本身不得造成超賣；回傳實際注入的份數。
 */
export function injectOtherOrderRow(ctx: OrderCtx, spec: InjectSpec): number {
  const world = worldOf(ctx);
  const product = world.products.get(spec.productId);
  if (product === undefined) return 0;
  const scheduledAtMs = spec.scheduledAtMs ?? null;
  const businessDate = spec.businessDate ?? world.businessDateOf(scheduledAtMs);
  const added = clampInjection(spec.quantity, world.remaining(businessDate, product));
  if (added <= 0) return 0;
  addOtherOrder(ctx, product, added, spec.status ?? 'ACCEPTED', scheduledAtMs, businessDate);
  return added;
}

/** 讓時段額滿（leave = 0）或只剩 1 個名額（leave = 1）：以不限量商品 ×1 補單；回傳補入的單數 */
export function fillSlotRows(ctx: OrderCtx, startAtMs: number, leave: 0 | 1): number {
  const world = worldOf(ctx);
  const need = slotFillCount(ctx.seed.settings.maxOrdersPerSlot, world.bookedAt(startAtMs), leave);
  if (need <= 0) return 0;
  const filler = world.productList.find((p) => p.listed && p.dailyLimit === null);
  if (filler === undefined) return 0;
  const businessDate = world.businessDateOf(startAtMs);
  for (let i = 0; i < need; i++) {
    addOtherOrder(ctx, filler, 1, 'ACCEPTED', startAtMs, businessDate);
  }
  return need;
}

/** 清除所有他人訂單（X 前綴）並釋放其占用的份數與時段；回傳清除筆數 */
export function clearOtherOrderRows(ctx: OrderCtx): number {
  const ids = new Set(ctx.data.orders.filter(isOtherOrder).map((o) => o.id));
  if (ids.size === 0) return 0;
  const itemIds = new Set(ctx.data.order_items.filter((i) => ids.has(i.order_id)).map((i) => i.id));
  ctx.data.orders = ctx.data.orders.filter((o) => !ids.has(o.id));
  ctx.data.order_items = ctx.data.order_items.filter((i) => !ids.has(i.order_id));
  ctx.data.order_item_options = ctx.data.order_item_options.filter((o) => !itemIds.has(o.order_item_id));
  ctx.data.order_status_logs = ctx.data.order_status_logs.filter((l) => !ids.has(l.order_id));
  ctx.data.payments = ctx.data.payments.filter((p) => !ids.has(p.order_id));
  ctx.data.order_invoices = ctx.data.order_invoices.filter((i) => !ids.has(i.order_id));
  return ids.size;
}
