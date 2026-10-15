// src/domain/orderStateMachine.ts
import type { OrderStatus, OrderType } from './types';

const BASE: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ['PENDING', 'CANCELLED'],
  PENDING: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['READY', 'CANCELLED'],
  READY: ['DELIVERING', 'COMPLETED', 'CANCELLED'],
  DELIVERING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const TERMINAL_STATUSES: readonly OrderStatus[] = ['COMPLETED', 'CANCELLED'];

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** 依取餐方式限制：外送才會經過 DELIVERING；其餘直接 READY → COMPLETED */
export function canTransition(from: OrderStatus, to: OrderStatus, orderType: OrderType): boolean {
  if (!BASE[from].includes(to)) return false;
  if (from === 'READY' && to === 'DELIVERING') return orderType === 'DELIVERY';
  if (from === 'READY' && to === 'COMPLETED') return orderType !== 'DELIVERY';
  return true;
}

/** 顧客可自助取消（BR-16） */
export function customerCanCancel(status: OrderStatus): boolean {
  return status === 'PENDING_PAYMENT' || status === 'PENDING';
}
