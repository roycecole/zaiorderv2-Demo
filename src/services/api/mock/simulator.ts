// src/services/api/mock/simulator.ts
import type { OrderStatus, OrderType } from '@/domain/types';

interface Step { to: OrderStatus; afterSeconds: number }

/** 已付款訂單取消後，完成退款所需秒數（速度 1×） */
export const REFUND_SECONDS = 10;

/** PENDING → ACCEPTED 自 pending_at 起算的秒數（速度 1×）；即時單與預約單皆同 */
export const ACCEPT_AFTER_SECONDS = 5;

/** 自取 / 內用：5s 接單 → 25s 出餐 → 40s 完成；外送：5s → 25s → 35s 出發 → 55s 送達（速度 1×，自時間基準起算） */
export function simulationPlan(orderType: OrderType): Step[] {
  const base: Step[] = [
    { to: 'ACCEPTED', afterSeconds: ACCEPT_AFTER_SECONDS },
    { to: 'READY', afterSeconds: 25 },
  ];
  return orderType === 'DELIVERY'
    ? [...base, { to: 'DELIVERING', afterSeconds: 35 }, { to: 'COMPLETED', afterSeconds: 55 }]
    : [...base, { to: 'COMPLETED', afterSeconds: 40 }];
}

/**
 * 製作時間基準：即時單自 pending_at 起算；預約單自「開始製作時間」（scheduledAt − lead）起算，
 * 避免 14:30 下的 17:00 預約單在 40 秒內就「完成」。接單不用此基準：預約單同樣在 pending_at + 5 秒接單（autoAcceptAtMs）。
 * leadMinutes 同 BR-08 與接單期限（timeouts.leadMinutesFor）：外送取該單配送區的 estimated_minutes，缺值才用店家預設。
 */
export function simulationBaselineMs(
  pendingAtMs: number,
  scheduledAtMs: number | null,
  leadMinutes: number,
): number {
  if (scheduledAtMs === null) return pendingAtMs;
  return Math.max(pendingAtMs, scheduledAtMs - leadMinutes * 60_000);
}

/**
 * 自動接單的時點：pending_at + 5 秒（速度倍率套用），即時單與預約單皆同。
 * 早於任何接單期限（BR-17），預約單因此不會在能被接單之前先逾時；其後維持 ACCEPTED，直到製作基準。
 */
export function autoAcceptAtMs(pendingAtMs: number, speed: 1 | 2 | 5): number {
  return pendingAtMs + (ACCEPT_AFTER_SECONDS * 1000) / speed;
}

/** 回傳「經過 elapsedSeconds 後應抵達的所有轉換」（依序），尚未到時間者不含 */
export function dueTransitions(
  orderType: OrderType,
  elapsedSeconds: number,
  speed: 1 | 2 | 5,
): OrderStatus[] {
  const scaled = elapsedSeconds * speed;
  return simulationPlan(orderType)
    .filter((s) => scaled >= s.afterSeconds)
    .map((s) => s.to);
}

export interface SimulationInput {
  orderType: OrderType;
  /** orders.pending_at：進入 PENDING 的時間 */
  pendingAtMs: number;
  scheduledAtMs: number | null;
  /** 前置分鐘，同 BR-08（timeouts.leadMinutesFor），與接單期限使用同一個值 */
  leadMinutes: number;
}

/**
 * 自動模擬開啟時，訂單（自 PENDING 起）在 nowMs 應抵達的狀態：
 * pending_at + 5 秒 ACCEPTED（預約單同），其後依製作基準的 dueTransitions 推進；基準之前維持 ACCEPTED。
 */
export function simulatedStatusAt(i: SimulationInput, nowMs: number, speed: 1 | 2 | 5): OrderStatus {
  const baseline = simulationBaselineMs(i.pendingAtMs, i.scheduledAtMs, i.leadMinutes);
  const due = dueTransitions(i.orderType, (nowMs - baseline) / 1000, speed);
  const last = due[due.length - 1];
  if (last !== undefined) return last;
  return nowMs >= autoAcceptAtMs(i.pendingAtMs, speed) ? 'ACCEPTED' : 'PENDING';
}

/** 取消後經過 secondsSinceCancel 是否已完成退款 */
export function refundDone(secondsSinceCancel: number, speed: 1 | 2 | 5): boolean {
  return secondsSinceCancel * speed >= REFUND_SECONDS;
}
