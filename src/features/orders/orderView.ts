// src/features/orders/orderView.ts —— 訂單的顯示邏輯（純函式，無 React、無 I/O）
// 狀態名稱、時間軸步驟與是否需要輪詢（03 §6.4、FLOW-10、FLOW-16）。
import { isTerminal } from '@/domain/orderStateMachine';
import type { ISODateTime, OperatorType, Order, OrderStatus, OrderType } from '@/domain/types';
import { orders as tOrders } from '@/i18n/strings/orders';

// ───────── 狀態名稱 ─────────

/** 狀態名稱（徽章、清單卡片、通報共用）；READY 與 COMPLETED 依取餐方式（03 §6.4、FLOW-10） */
export function statusLabel(status: OrderStatus, orderType: OrderType): string {
  const labels = tOrders.statusLabel;
  switch (status) {
    case 'READY':
      return labels.READY[orderType];
    case 'COMPLETED':
      return labels.COMPLETED[orderType];
    default:
      return labels[status];
  }
}

/** 朗讀取餐號碼：「取餐號碼 A 0 2 7」（以空白分隔，避免被唸成單字；03 §10.4） */
export const spokenPickupNo = (pickupNo: string): string => tOrders.pickupNoSpoken(pickupNo);

// ───────── 輪詢（FLOW-16、07 §7.1） ─────────

/** 非終態，或終態但退款進行中（payment.status = REFUNDING）時需要持續輪詢 */
export function shouldPoll(order: Pick<Order, 'status' | 'payment'> | undefined): boolean {
  if (order === undefined) return false;
  return !isTerminal(order.status) || order.payment.status === 'REFUNDING';
}

// ───────── 時間軸（03 §6.4） ─────────

export type TimelineStepKey = 'submitted' | 'preparing' | 'ready' | 'completed';
export type TimelineStepState = 'done' | 'current' | 'upcoming';

export const STEP_KEYS: readonly TimelineStepKey[] = ['submitted', 'preparing', 'ready', 'completed'];

/** 狀態對應的主要步驟索引（0～3）；CANCELLED 沒有對應步驟 */
export function stepIndexOf(status: OrderStatus): number | null {
  switch (status) {
    case 'PENDING_PAYMENT':
    case 'PENDING':
      return 0;
    case 'ACCEPTED':
      return 1;
    case 'READY':
    case 'DELIVERING':
      return 2;
    case 'COMPLETED':
      return 3;
    default:
      return null;
  }
}

export interface TimelineStep {
  key: TimelineStepKey;
  label: string;
  state: TimelineStepState;
  /** 已發生的時間（來自狀態紀錄） */
  at?: ISODateTime;
  /** 尚未發生的預計時間（僅「可取餐」步驟） */
  expectedAt?: ISODateTime;
}

export interface TimelineModel {
  /** PENDING_PAYMENT：於步驟 1 之前額外顯示「等待付款」與倒數 */
  awaitingPayment: boolean;
  steps: TimelineStep[];
  /** CANCELLED：時間軸在中斷處以 ✕ 顯示「已取消」，並呈現取消者與原因 */
  cancelled: { at?: ISODateTime; by: OperatorType; reason?: string } | null;
}

export type TimelineSource = Pick<
  Order,
  'status' | 'orderType' | 'timeline' | 'placedAt' | 'estimatedReadyAt' | 'cancellation' | 'cancelledAt'
>;

function stepLabel(
  key: TimelineStepKey,
  orderType: OrderType,
  state: TimelineStepState,
  status: OrderStatus,
): string {
  const s = tOrders.timeline;
  switch (key) {
    case 'submitted':
      return state === 'done' ? s.submitted : s.submittedWaiting;
    case 'preparing':
      return s.preparing;
    case 'ready': {
      if (orderType !== 'DELIVERY') return s.ready[orderType];
      if (state === 'done') return s.ready.DELIVERY.done;
      if (state === 'current') {
        return status === 'DELIVERING' ? s.ready.DELIVERY.delivering : s.ready.DELIVERY.waiting;
      }
      return s.ready.DELIVERY.upcoming;
    }
    case 'completed':
      return s.completed[orderType];
  }
}

export function buildTimeline(order: TimelineSource): TimelineModel {
  const { status, orderType, timeline } = order;
  const firstAt = (index: number): ISODateTime | undefined =>
    timeline.find((l) => stepIndexOf(l.status) === index)?.at;

  if (status === 'CANCELLED') {
    // 中斷處：已到達過的最後一個步驟之後
    let reached = 0;
    for (const log of timeline) {
      const idx = stepIndexOf(log.status);
      if (idx !== null && idx > reached) reached = idx;
    }
    const steps: TimelineStep[] = STEP_KEYS.slice(0, reached + 1).map((key, i) => {
      const step: TimelineStep = {
        key,
        label: stepLabel(key, orderType, 'done', status),
        state: 'done',
      };
      const at = firstAt(i) ?? (i === 0 ? order.placedAt : undefined);
      if (at !== undefined) step.at = at;
      return step;
    });
    const cancelledLog = [...timeline].reverse().find((l) => l.status === 'CANCELLED');
    const cancelled: NonNullable<TimelineModel['cancelled']> = {
      by: order.cancellation?.by ?? cancelledLog?.by ?? 'SYSTEM',
    };
    const at = order.cancellation?.at ?? order.cancelledAt ?? cancelledLog?.at;
    if (at !== undefined) cancelled.at = at;
    const reason = order.cancellation?.reason ?? cancelledLog?.note;
    if (reason !== undefined && reason !== '') cancelled.reason = reason;
    return { awaitingPayment: false, steps, cancelled };
  }

  const awaitingPayment = status === 'PENDING_PAYMENT';
  const current = stepIndexOf(status) ?? 0;
  const steps: TimelineStep[] = STEP_KEYS.map((key, i) => {
    let state: TimelineStepState;
    if (awaitingPayment) state = 'upcoming'; // 尚未付款：訂單還沒送給店家
    else if (i < current) state = 'done';
    else if (i === current) state = status === 'COMPLETED' ? 'done' : 'current';
    else state = 'upcoming';

    const step: TimelineStep = { key, label: stepLabel(key, orderType, state, status), state };
    if (state !== 'upcoming') {
      const at = firstAt(i) ?? (i === 0 ? order.placedAt : undefined);
      if (at !== undefined) step.at = at;
    } else if (key === 'ready' && order.estimatedReadyAt !== null) {
      step.expectedAt = order.estimatedReadyAt;
    }
    return step;
  });
  return { awaitingPayment, steps, cancelled: null };
}

// ───────── 取消與付款 ─────────

/**
 * 付款逾時取消：由系統取消，且從未進入 PENDING（線上付款成功或改現金才會進入）。
 * 接單逾時同樣由系統取消，但狀態紀錄中有 PENDING，不屬於此類。
 */
export function isPaymentTimeout(
  order: Pick<Order, 'status' | 'cancellation' | 'timeline'>,
): boolean {
  if (order.status !== 'CANCELLED') return false;
  const by = order.cancellation?.by ?? [...order.timeline].reverse().find((l) => l.status === 'CANCELLED')?.by;
  return by === 'SYSTEM' && !order.timeline.some((l) => l.status === 'PENDING');
}
