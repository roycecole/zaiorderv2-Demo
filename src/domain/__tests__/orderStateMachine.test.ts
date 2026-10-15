// FLOW-10 訂單狀態機、BR-15（只允許列出的轉換）、BR-16（顧客可自助取消的狀態）
import { describe, expect, it } from 'vitest';
import {
  TERMINAL_STATUSES,
  canTransition,
  customerCanCancel,
  isTerminal,
} from '../orderStateMachine';
import type { OrderStatus, OrderType } from '../types';

const STATUSES: OrderStatus[] = [
  'PENDING_PAYMENT',
  'PENDING',
  'ACCEPTED',
  'READY',
  'DELIVERING',
  'COMPLETED',
  'CANCELLED',
];
const ORDER_TYPES: OrderType[] = ['PICKUP', 'DELIVERY', 'DINE_IN'];

/** FLOW-10 轉換權限表（逐列抄錄；READY → DELIVERING / COMPLETED 另依取餐方式限制） */
const ALLOWED: Array<[OrderStatus, OrderStatus, OrderType[]]> = [
  ['PENDING_PAYMENT', 'PENDING', ORDER_TYPES],
  ['PENDING_PAYMENT', 'CANCELLED', ORDER_TYPES],
  ['PENDING', 'ACCEPTED', ORDER_TYPES],
  ['PENDING', 'CANCELLED', ORDER_TYPES],
  ['ACCEPTED', 'READY', ORDER_TYPES],
  ['ACCEPTED', 'CANCELLED', ORDER_TYPES],
  ['READY', 'DELIVERING', ['DELIVERY']],
  ['READY', 'COMPLETED', ['PICKUP', 'DINE_IN']],
  ['READY', 'CANCELLED', ORDER_TYPES],
  ['DELIVERING', 'COMPLETED', ORDER_TYPES],
  ['DELIVERING', 'CANCELLED', ORDER_TYPES],
];

describe('canTransition（BR-15）', () => {
  it('FLOW-10 的每一條合法轉換皆允許', () => {
    for (const [from, to, types] of ALLOWED) {
      for (const type of types) {
        expect(canTransition(from, to, type), `${from} → ${to}（${type}）`).toBe(true);
      }
    }
  });

  it('全部 7 × 7 × 3 組合中，只有 FLOW-10 列出者為 true（其餘一律拒絕）', () => {
    const allowed = new Set<string>();
    for (const [from, to, types] of ALLOWED)
      for (const t of types) allowed.add(`${from}|${to}|${t}`);
    let total = 0;
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        for (const type of ORDER_TYPES) {
          total++;
          expect(canTransition(from, to, type), `${from} → ${to}（${type}）`).toBe(
            allowed.has(`${from}|${to}|${type}`),
          );
        }
      }
    }
    expect(total).toBe(147);
  });

  it('自取 / 內用：READY → COMPLETED 可、→ DELIVERING 不可', () => {
    for (const type of ['PICKUP', 'DINE_IN'] as const) {
      expect(canTransition('READY', 'COMPLETED', type)).toBe(true);
      expect(canTransition('READY', 'DELIVERING', type)).toBe(false);
    }
  });

  it('外送：READY → DELIVERING 可、→ COMPLETED 不可；DELIVERING → COMPLETED 可', () => {
    expect(canTransition('READY', 'DELIVERING', 'DELIVERY')).toBe(true);
    expect(canTransition('READY', 'COMPLETED', 'DELIVERY')).toBe(false);
    expect(canTransition('DELIVERING', 'COMPLETED', 'DELIVERY')).toBe(true);
  });

  it('終態不可再轉換', () => {
    for (const from of ['COMPLETED', 'CANCELLED'] as const) {
      for (const to of STATUSES) {
        for (const type of ORDER_TYPES) expect(canTransition(from, to, type)).toBe(false);
      }
    }
  });

  it('不可跳級、不可回頭、不可原地轉換', () => {
    expect(canTransition('PENDING', 'READY', 'PICKUP')).toBe(false);
    expect(canTransition('PENDING_PAYMENT', 'ACCEPTED', 'PICKUP')).toBe(false);
    expect(canTransition('ACCEPTED', 'PENDING', 'PICKUP')).toBe(false);
    expect(canTransition('READY', 'ACCEPTED', 'PICKUP')).toBe(false);
    expect(canTransition('PENDING', 'PENDING', 'PICKUP')).toBe(false);
  });

  it('付款失敗不屬於狀態轉換：PENDING_PAYMENT 只能到 PENDING / CANCELLED', () => {
    const targets = STATUSES.filter((to) => canTransition('PENDING_PAYMENT', to, 'PICKUP'));
    expect(targets).toEqual(['PENDING', 'CANCELLED']);
  });

  it('READY → CANCELLED（顧客未取餐、無法聯絡）所有取餐方式皆可', () => {
    for (const type of ORDER_TYPES) expect(canTransition('READY', 'CANCELLED', type)).toBe(true);
  });
});

describe('customerCanCancel（BR-16）', () => {
  it('顧客僅能於 PENDING_PAYMENT / PENDING 自助取消', () => {
    const can = ['PENDING_PAYMENT', 'PENDING'];
    for (const s of STATUSES) expect(customerCanCancel(s), s).toBe(can.includes(s));
  });
});

describe('isTerminal', () => {
  it('COMPLETED、CANCELLED 為終態，其餘不是', () => {
    expect(TERMINAL_STATUSES).toEqual(['COMPLETED', 'CANCELLED']);
    for (const s of STATUSES) expect(isTerminal(s), s).toBe(s === 'COMPLETED' || s === 'CANCELLED');
  });

  it('終態在任何取餐方式下都沒有後續轉換（與 canTransition 一致）', () => {
    for (const s of STATUSES) {
      const hasNext = ORDER_TYPES.some((t) => STATUSES.some((to) => canTransition(s, to, t)));
      expect(isTerminal(s), s).toBe(!hasNext);
    }
  });
});
