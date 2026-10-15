// src/features/demo/storeActions.ts —— 「對我的訂單執行店家動作」的合法轉換（FR-DM-01、FLOW-14）
import { canTransition } from '@/domain/orderStateMachine';
import type { OrderStatus, OrderType } from '@/domain/types';
import type { StoreAction } from '@/services/api/mock/demoControl';

/**
 * 目前狀態下合法的店家動作（依 domain/orderStateMachine 的 canTransition）。
 * 拒單：Mock 不允許對待付款訂單拒單（顧客尚未付款，只能由顧客取消或逾時）。
 */
export function legalStoreActions(status: OrderStatus, orderType: OrderType): StoreAction[] {
  const out: StoreAction[] = [];
  if (canTransition(status, 'ACCEPTED', orderType)) out.push('ACCEPT');
  if (canTransition(status, 'READY', orderType)) out.push('READY');
  if (canTransition(status, 'DELIVERING', orderType)) out.push('DISPATCH');
  if (canTransition(status, 'COMPLETED', orderType)) out.push('COMPLETE');
  if (status !== 'PENDING_PAYMENT' && canTransition(status, 'CANCELLED', orderType))
    out.push('REJECT');
  return out;
}
