// src/services/api/mock/orderModel.ts —— 訂單的狀態轉換、逾時結算、模擬器推進與 DTO 組裝（FLOW-10、FLOW-11、FLOW-14）
// 這裡的函式都是同步的，且只應在 withDbLock 的臨界區內呼叫（鎖內先 reload、再變更、再 flush）。
// 唯讀路徑（quote、menu、list）不呼叫會寫入的函式。
import { canTransition, customerCanCancel } from '@/domain/orderStateMachine';
import { acceptDeadlineMs, leadMinutesFor } from '@/domain/timeouts';
import { toIsoTaipei } from '@/domain/taipeiTime';
import type {
  ID, ISODateTime, Order, OrderInvoice, OrderItem, OrderStatus, OrderStatusLog, OrderSummary,
  OperatorType, PaymentAttempt,
} from '@/domain/types';
import type { DemoState } from './demoControl';
import type { DbData, OrderInvoiceRow, OrderRow, PaymentRow } from './dbTypes';
import { newInvoiceNo, newUlid } from './ids';
import { OTHER_ORDER_PREFIX } from './inject';
import type { StaticSeed } from './seed';
import { findExpired } from './settle';
import type { SettleCandidate } from './settle';
import {
  autoAcceptAtMs, refundDone, simulatedStatusAt, simulationBaselineMs, simulationPlan,
} from './simulator';

export interface OrderCtx {
  data: DbData;
  seed: StaticSeed;
  demo: DemoState;
  nowMs: number;
}

export const isOtherOrder = (o: Pick<OrderRow, 'pickup_no'>): boolean =>
  o.pickup_no.startsWith(OTHER_ORDER_PREFIX);

const iso = (ms: number | null): ISODateTime | null => (ms === null ? null : toIsoTaipei(ms));

// ───────── 前置分鐘與期限 ─────────

/** 該單的前置分鐘（BR-08）：外送取配送區的 estimated_minutes，缺值才用店家預設；其餘取 pickup_lead_minutes */
export function leadMinutesOfOrder(ctx: OrderCtx, o: OrderRow): number {
  const zone =
    o.order_type === 'DELIVERY' && o.delivery_zip_code !== null
      ? ctx.seed.zones.find((z) => z.zipCode === o.delivery_zip_code)
      : undefined;
  return leadMinutesFor(o.order_type, zone?.estimatedMinutes ?? null, {
    pickupLeadMinutes: ctx.seed.settings.pickupLeadMinutes,
    deliveryLeadMinutes: ctx.seed.settings.deliveryLeadMinutes,
  });
}

/** 接單期限（BR-17，自 pending_at 起算）；僅 PENDING 有意義 */
export function acceptDeadlineOf(ctx: OrderCtx, o: OrderRow): number | null {
  if (o.pending_at === null) return null;
  return acceptDeadlineMs({
    pendingAtMs: o.pending_at,
    scheduledAtMs: o.scheduled_at,
    leadMinutes: leadMinutesOfOrder(ctx, o),
    acceptTimeoutMinutes: ctx.seed.settings.acceptTimeoutMinutes,
  });
}

// ───────── 狀態轉換 ─────────

function pushLog(
  ctx: OrderCtx,
  order: OrderRow,
  from: OrderStatus | null,
  to: OrderStatus,
  by: OperatorType,
  at: number,
  note?: string,
): void {
  ctx.data.order_status_logs.push({
    id: newUlid(at),
    order_id: order.id,
    from_status: from,
    to_status: to,
    operator_type: by,
    operator_id: by === 'CUSTOMER' ? order.user_id : null,
    note: note ?? null,
    created_at: at,
  });
}

/** 記錄建單（from = null）的第一筆狀態紀錄 */
export function logCreated(ctx: OrderCtx, order: OrderRow, at: number): void {
  pushLog(ctx, order, null, order.status, 'CUSTOMER', at);
}

function paymentsOf(ctx: OrderCtx, orderId: ID): PaymentRow[] {
  return ctx.data.payments.filter((p) => p.order_id === orderId);
}

function invoiceOf(ctx: OrderCtx, orderId: ID): OrderInvoiceRow | undefined {
  return ctx.data.order_invoices.find((i) => i.order_id === orderId);
}

export function issueInvoice(ctx: OrderCtx, orderId: ID, at: number): void {
  const inv = invoiceOf(ctx, orderId);
  if (inv !== undefined && inv.status === 'PENDING') {
    inv.status = 'ISSUED';
    inv.invoice_no = newInvoiceNo();
    inv.issued_at = at;
  }
}

/** 一般狀態轉換（不含取消）：更新時間欄位、寫狀態紀錄；完成時（現金）標記已付款並開立模擬發票 */
export function transition(
  ctx: OrderCtx,
  o: OrderRow,
  to: Exclude<OrderStatus, 'CANCELLED'>,
  by: OperatorType,
  opts: { at?: number; note?: string } = {},
): void {
  const at = opts.at ?? ctx.nowMs;
  const from = o.status;
  o.status = to;
  switch (to) {
    case 'PENDING':
      o.pending_at = at;
      break;
    case 'ACCEPTED':
      o.accepted_at = at;
      break;
    case 'READY':
      o.ready_at = at;
      break;
    case 'COMPLETED':
      o.completed_at = at;
      // 現金：訂單完成時收款（BR-18）
      for (const p of paymentsOf(ctx, o.id)) {
        if (p.method === 'CASH' && p.status === 'PENDING') {
          p.status = 'SUCCESS';
          p.paid_at = at;
        }
      }
      if (o.payment_method === 'CASH' && o.payment_status === 'UNPAID') o.payment_status = 'PAID';
      issueInvoice(ctx, o.id, at);
      break;
    default:
      break;
  }
  pushLog(ctx, o, from, to, by, at, opts.note);
}

/** 進入 CANCELLED 的後處理（FLOW-22「釋放與後處理」）：狀態紀錄、作廢交易、返還優惠券、必要時進入 REFUNDING；釋放庫存與時段不需額外寫入 */
export function cancelOrderRow(
  ctx: OrderCtx,
  o: OrderRow,
  by: OperatorType,
  reason: string,
  opts: { expired?: boolean; at?: number } = {},
): void {
  const at = opts.at ?? ctx.nowMs;
  const from = o.status;
  o.status = 'CANCELLED';
  o.cancelled_by = by;
  o.cancelled_at = at;
  o.cancel_reason = reason;
  pushLog(ctx, o, from, 'CANCELLED', by, at, reason);

  // 作廢進行中的付款交易（BR-28 ②）
  for (const p of paymentsOf(ctx, o.id)) {
    if (p.status === 'PENDING') {
      p.status = 'FAILED';
      p.failure_code = opts.expired === true ? 'EXPIRED' : 'ORDER_CANCELLED';
    }
  }

  // 返還優惠券（BR-29）：used_count − 1；user_coupons 於有效期內回復 AVAILABLE，否則 EXPIRED
  if (o.coupon_id !== null) {
    const used = ctx.data.coupon_usage[o.coupon_id] ?? 0;
    ctx.data.coupon_usage[o.coupon_id] = used - 1;
    const uc = ctx.data.user_coupons.find((x) => x.order_id === o.id);
    if (uc !== undefined) {
      const coupon = ctx.seed.coupons.find((c) => c.id === o.coupon_id);
      uc.status = coupon !== undefined && coupon.endsAt > at ? 'AVAILABLE' : 'EXPIRED';
      uc.used_at = null;
      uc.order_id = null;
    }
  }

  // 已付款者進入退款流程（REFUNDING → REFUNDED）
  if (o.payment_status === 'PAID') {
    o.payment_status = 'REFUNDING';
    o.refund_started_at = at;
  }
  const inv = invoiceOf(ctx, o.id);
  if (inv !== undefined && inv.status === 'ISSUED') inv.status = 'VOIDED';
}

// ───────── 逾時結算與模擬器 ─────────

/**
 * settleExpiredOrders：僅寫入路徑呼叫。付款逾時一律結算；接單逾時只對自動模擬關閉者結算
 * （自動模擬開啟時先補寫模擬轉換，由 advanceOrder 完成，R-V）。可重複呼叫（冪等）。
 */
export function settleExpiredOrders(ctx: OrderCtx): number {
  const open = ctx.data.orders.filter((o) => o.status === 'PENDING_PAYMENT' || o.status === 'PENDING');
  if (open.length === 0) return 0;
  const byId = new Map(open.map((o) => [o.id, o] as const));
  const candidates: SettleCandidate[] = open.map((o) => ({
    id: o.id,
    status: o.status,
    paymentExpiresAtMs: o.payment_expires_at,
    acceptDeadlineMs: o.status === 'PENDING' ? acceptDeadlineOf(ctx, o) : null,
    autoAcceptAtMs:
      ctx.demo.autoSimulate && !isOtherOrder(o) && o.pending_at !== null
        ? autoAcceptAtMs(o.pending_at, ctx.demo.speed)
        : null,
  }));
  let n = 0;
  for (const hit of findExpired(candidates, ctx.nowMs)) {
    const o = byId.get(hit.id);
    if (o === undefined) continue;
    if (hit.reason === 'PAYMENT_TIMEOUT') {
      cancelOrderRow(ctx, o, 'SYSTEM', '付款逾時', { expired: true });
    } else {
      cancelOrderRow(ctx, o, 'SYSTEM', '店家未在時限內接單');
    }
    n++;
  }
  return n;
}

const SIMULATED_STATES: ReadonlySet<OrderStatus> = new Set(['PENDING', 'ACCEPTED', 'READY', 'DELIVERING']);

/** 讀取時惰性推進（FLOW-14）：依 pending_at 與時間基準補寫缺漏的狀態紀錄；自動模擬關閉或他人訂單不推進 */
export function advanceOrder(ctx: OrderCtx, o: OrderRow): void {
  if (!ctx.demo.autoSimulate || isOtherOrder(o)) return;
  if (!SIMULATED_STATES.has(o.status) || o.pending_at === null) return;

  const speed = ctx.demo.speed;
  const lead = leadMinutesOfOrder(ctx, o);
  const target = simulatedStatusAt(
    { orderType: o.order_type, pendingAtMs: o.pending_at, scheduledAtMs: o.scheduled_at, leadMinutes: lead },
    ctx.nowMs,
    speed,
  );
  const path: OrderStatus[] =
    o.order_type === 'DELIVERY'
      ? ['PENDING', 'ACCEPTED', 'READY', 'DELIVERING', 'COMPLETED']
      : ['PENDING', 'ACCEPTED', 'READY', 'COMPLETED'];
  const from = path.indexOf(o.status);
  const to = path.indexOf(target);
  if (to <= from) return;

  const baseline = simulationBaselineMs(o.pending_at, o.scheduled_at, lead);
  const plan = simulationPlan(o.order_type);
  let last = Math.max(o.pending_at, lastLogAt(ctx, o.id));
  for (const step of path.slice(from + 1, to + 1)) {
    if (step === 'PENDING' || step === 'CANCELLED') continue;
    const planned =
      step === 'ACCEPTED'
        ? autoAcceptAtMs(o.pending_at, speed)
        : baseline + ((plan.find((s) => s.to === step)?.afterSeconds ?? 0) * 1000) / speed;
    const at = Math.max(last, Math.min(planned, ctx.nowMs));
    if (!canTransition(o.status, step, o.order_type)) break;
    transition(ctx, o, step, 'STORE', { at });
    last = at;
  }
}

function lastLogAt(ctx: OrderCtx, orderId: ID): number {
  let at = 0;
  for (const l of ctx.data.order_status_logs) {
    if (l.order_id === orderId && l.created_at > at) at = l.created_at;
  }
  return at;
}

/** 退款完成（REFUNDING → REFUNDED，約 REFUND_SECONDS 後）；不受「自動模擬」開關影響 */
export function settleRefunds(ctx: OrderCtx, only?: OrderRow): void {
  const targets = only === undefined ? ctx.data.orders : [only];
  for (const o of targets) {
    if (o.payment_status !== 'REFUNDING' || o.refund_started_at === null) continue;
    if (!refundDone((ctx.nowMs - o.refund_started_at) / 1000, ctx.demo.speed)) continue;
    o.payment_status = 'REFUNDED';
    for (const p of paymentsOf(ctx, o.id)) {
      if (p.status === 'SUCCESS' && p.refunded_at === null) {
        p.status = 'REFUNDED';
        p.refunded_at = ctx.nowMs;
      }
    }
  }
}

/** 寫入路徑讀取訂單前的「結算 + 推進」：settleExpired（全域）→ 補寫模擬轉換 → 退款進度 */
export function refreshOrder(ctx: OrderCtx, o: OrderRow): void {
  settleExpiredOrders(ctx);
  advanceOrder(ctx, o);
  settleRefunds(ctx, o);
}

// ───────── 付款 ─────────

/** 建立一筆付款交易（PENDING）；呼叫端須先作廢既有 PENDING 交易 */
export function addPayment(
  ctx: OrderCtx,
  o: OrderRow,
  method: PaymentRow['method'],
  provider: string | null,
): PaymentRow {
  const row: PaymentRow = {
    id: newUlid(ctx.nowMs),
    order_id: o.id,
    method,
    provider,
    amount: o.total_amount,
    status: 'PENDING',
    provider_txn_id: null,
    failure_code: null,
    failure_message: null,
    paid_at: null,
    refunded_at: null,
    created_at: ctx.nowMs,
  };
  ctx.data.payments.push(row);
  return row;
}

/** 作廢同訂單既有 PENDING 交易（FAILED，failure_code = SUPERSEDED；BR-28 ①） */
export function supersedePendingPayments(ctx: OrderCtx, orderId: ID, exceptId?: ID): void {
  for (const p of paymentsOf(ctx, orderId)) {
    if (p.status === 'PENDING' && p.id !== exceptId) {
      p.status = 'FAILED';
      p.failure_code = 'SUPERSEDED';
    }
  }
}

/** 是否仍可付款 / 改用現金：PENDING_PAYMENT 且未逾 payment_expires_at（半開區間，到期當下即逾時） */
export function isPayable(ctx: OrderCtx, o: OrderRow): boolean {
  return o.status === 'PENDING_PAYMENT' && o.payment_expires_at !== null && o.payment_expires_at > ctx.nowMs;
}

/**
 * 付款成功回呼（BR-28 ④⑤、06 §6.2）：先記交易為 SUCCESS，再依訂單目前狀態分流：
 * 正常路徑轉 PENDING / PAID（同時作廢其餘 PENDING 線上交易）；已取消或已逾期 → 逾時路徑，自動退款、不復活訂單；
 * 已為 PENDING 或更後（例如已改用現金）→ 僅退回該筆款項，不變更訂單狀態。
 */
export function applyPaymentSuccess(ctx: OrderCtx, o: OrderRow, txn: PaymentRow): void {
  if (txn.status === 'SUCCESS' || txn.status === 'REFUNDED') return; // 重複回呼：直接略過
  txn.status = 'SUCCESS';
  txn.paid_at = ctx.nowMs;

  if (isPayable(ctx, o)) {
    o.payment_status = 'PAID';
    o.payment_method = txn.method;
    supersedePendingPayments(ctx, o.id, txn.id);
    transition(ctx, o, 'PENDING', 'SYSTEM', { note: '付款成功' });
    issueInvoice(ctx, o.id, ctx.nowMs);
    return;
  }

  if (o.status === 'CANCELLED' || o.status === 'PENDING_PAYMENT') {
    // 逾時路徑：訂單維持（或轉為）CANCELLED，自動退款；不復活、不重新計入庫存
    if (o.status === 'PENDING_PAYMENT') cancelOrderRow(ctx, o, 'SYSTEM', '付款逾時', { expired: true });
    // 此交易於閘門記 SUCCESS（原本可能已被作廢為 FAILED，FAILED → SUCCESS 的例外轉換）
    txn.status = 'SUCCESS';
    o.payment_status = 'REFUNDING';
    o.refund_started_at = ctx.nowMs;
    return;
  }

  // 重複付款路徑：僅退回該筆款項，不得變更訂單狀態與庫存
  txn.status = 'REFUNDED';
  txn.refunded_at = ctx.nowMs;
}

// ───────── DTO ─────────

function toPaymentAttempt(p: PaymentRow): PaymentAttempt {
  const out: PaymentAttempt = {
    id: p.id,
    method: p.method,
    status: p.status,
    amount: p.amount,
    createdAt: toIsoTaipei(p.created_at),
  };
  if (p.failure_message !== null) out.failureMessage = p.failure_message;
  return out;
}

export function toOrderDto(ctx: OrderCtx, o: OrderRow): Order {
  const items: OrderItem[] = ctx.data.order_items
    .filter((it) => it.order_id === o.id)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((it) => {
      const out: OrderItem = {
        id: it.id,
        productId: it.product_id,
        name: it.product_name,
        quantity: it.quantity,
        unitPrice: it.base_price + it.options_price,
        lineTotal: it.line_total,
        options: ctx.data.order_item_options
          .filter((op) => op.order_item_id === it.id)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((op) => ({ groupName: op.option_group_name, name: op.option_name, priceDelta: op.price_delta })),
      };
      if (it.note !== null) out.note = it.note;
      return out;
    });

  const timeline: OrderStatusLog[] = ctx.data.order_status_logs
    .filter((l) => l.order_id === o.id)
    .sort((a, b) => a.created_at - b.created_at)
    .map((l) => {
      const out: OrderStatusLog = { status: l.to_status, at: toIsoTaipei(l.created_at), by: l.operator_type };
      if (l.note !== null) out.note = l.note;
      return out;
    });

  const inv = invoiceOf(ctx, o.id);
  const invoice: OrderInvoice = {
    type: inv?.invoice_type ?? 'PAPER',
    status: inv?.status ?? 'PENDING',
  };
  if (inv !== undefined) {
    if (inv.carrier_code !== null) invoice.carrierCode = inv.carrier_code;
    if (inv.tax_id !== null) invoice.taxId = inv.tax_id;
    if (inv.buyer_name !== null) invoice.buyerName = inv.buyer_name;
    if (inv.donate_code !== null) invoice.donateCode = inv.donate_code;
    if (inv.invoice_no !== null) invoice.invoiceNo = inv.invoice_no;
    if (inv.issued_at !== null) invoice.issuedAt = toIsoTaipei(inv.issued_at);
  }

  const payments = paymentsOf(ctx, o.id).sort((a, b) => a.created_at - b.created_at);
  const latest = payments[payments.length - 1];
  const payable = isPayable(ctx, o);

  const order: Order = {
    id: o.id,
    orderNo: o.order_no,
    storeId: o.store_id,
    orderType: o.order_type,
    status: o.status,
    pickupNo: o.pickup_no,
    businessDate: o.business_date,
    scheduledAt: iso(o.scheduled_at),
    estimatedReadyAt: o.status === 'CANCELLED' ? null : iso(o.estimated_ready_at),
    items,
    amounts: {
      subtotal: o.subtotal_amount,
      deliveryFee: o.delivery_fee,
      discount: o.discount_amount,
      total: o.total_amount,
    },
    needUtensils: o.need_utensils,
    invoice,
    payment: {
      method: o.payment_method,
      status: o.payment_status,
      expiresAt: o.status === 'PENDING_PAYMENT' ? iso(o.payment_expires_at) : null,
    },
    timeline,
    placedAt: toIsoTaipei(o.placed_at),
    permissions: {
      canCancel: customerCanCancel(o.status),
      canPay: payable,
      canReorder: true,
      canReview: false,
    },
  };
  if (latest !== undefined) order.payment.latest = toPaymentAttempt(latest);
  if (o.customer_name !== null || o.customer_phone !== null) {
    order.customer = {};
    if (o.customer_name !== null) order.customer.name = o.customer_name;
    if (o.customer_phone !== null) order.customer.phone = o.customer_phone;
  }
  if (o.status === 'PENDING') {
    const deadline = acceptDeadlineOf(ctx, o);
    if (deadline !== null) order.acceptBy = toIsoTaipei(deadline);
  }
  if (o.table_no !== null) order.table = { tableNo: o.table_no };
  if (o.delivery_address_line !== null) {
    order.delivery = {
      city: o.delivery_city ?? '',
      district: o.delivery_district ?? '',
      zipCode: o.delivery_zip_code ?? '',
      line: o.delivery_address_line,
    };
    if (o.delivery_note !== null) order.delivery.note = o.delivery_note;
  }
  if (o.coupon_code !== null) order.couponCode = o.coupon_code;
  if (o.note !== null) order.note = o.note;
  if (o.cancelled_by !== null && o.cancelled_at !== null) {
    order.cancellation = { by: o.cancelled_by, at: toIsoTaipei(o.cancelled_at) };
    if (o.cancel_reason !== null) order.cancellation.reason = o.cancel_reason;
  }
  if (o.accepted_at !== null) order.acceptedAt = toIsoTaipei(o.accepted_at);
  if (o.ready_at !== null) order.readyAt = toIsoTaipei(o.ready_at);
  if (o.completed_at !== null) order.completedAt = toIsoTaipei(o.completed_at);
  if (o.cancelled_at !== null) order.cancelledAt = toIsoTaipei(o.cancelled_at);
  return order;
}

/** 顯示用狀態：已逾付款期限的待付款單以相同條件顯示為已取消（唯讀的顯示修正，不寫入；06 §5.14） */
export function displayStatus(ctx: OrderCtx, o: OrderRow): OrderStatus {
  return o.status === 'PENDING_PAYMENT' && !isPayable(ctx, o) ? 'CANCELLED' : o.status;
}

export function toOrderSummary(ctx: OrderCtx, o: OrderRow): OrderSummary {
  const items = ctx.data.order_items
    .filter((it) => it.order_id === o.id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const itemCount = items.reduce((s, it) => s + it.quantity, 0);
  const first = items[0]?.product_name ?? '';
  const preview = items.length <= 1 && itemCount <= 1 ? first : `${first} 等 ${itemCount} 項`;
  return {
    id: o.id,
    orderNo: o.order_no,
    orderType: o.order_type,
    status: displayStatus(ctx, o),
    paymentStatus: o.payment_status,
    pickupNo: o.pickup_no,
    total: o.total_amount,
    itemCount,
    itemsPreview: preview,
    placedAt: toIsoTaipei(o.placed_at),
    scheduledAt: iso(o.scheduled_at),
  };
}
