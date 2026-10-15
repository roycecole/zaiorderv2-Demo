// FLOW-14 模擬器時間表（5 / 25 / 40 秒；外送 35 / 55 秒）、速度倍率、預約單製作基準、退款時間
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canTransition } from '@/domain/orderStateMachine';
import type { OrderStatus, OrderType } from '@/domain/types';
import {
  ACCEPT_AFTER_SECONDS,
  REFUND_SECONDS,
  autoAcceptAtMs,
  dueTransitions,
  refundDone,
  simulatedStatusAt,
  simulationBaselineMs,
  simulationPlan,
} from '../../simulator';

const at = (h: number, m: number, s = 0): number => Date.UTC(2026, 9, 14, h, m, s);
const ORDER_TYPES: OrderType[] = ['PICKUP', 'DELIVERY', 'DINE_IN'];

describe('simulationPlan', () => {
  it('自取 / 內用：5s 接單 → 25s 出餐 → 40s 完成', () => {
    for (const type of ['PICKUP', 'DINE_IN'] as const) {
      expect(simulationPlan(type)).toEqual([
        { to: 'ACCEPTED', afterSeconds: 5 },
        { to: 'READY', afterSeconds: 25 },
        { to: 'COMPLETED', afterSeconds: 40 },
      ]);
    }
  });

  it('外送：5s → 25s → 35s 出發 → 55s 送達', () => {
    expect(simulationPlan('DELIVERY')).toEqual([
      { to: 'ACCEPTED', afterSeconds: 5 },
      { to: 'READY', afterSeconds: 25 },
      { to: 'DELIVERING', afterSeconds: 35 },
      { to: 'COMPLETED', afterSeconds: 55 },
    ]);
  });

  it('計畫順序合法：每一步皆為狀態機允許的轉換，且終點為 COMPLETED', () => {
    for (const type of ORDER_TYPES) {
      let cur: OrderStatus = 'PENDING';
      for (const step of simulationPlan(type)) {
        expect(canTransition(cur, step.to, type), `${type}: ${cur} → ${step.to}`).toBe(true);
        cur = step.to;
      }
      expect(cur).toBe('COMPLETED');
    }
  });

  it('時間遞增', () => {
    for (const type of ORDER_TYPES) {
      const secs = simulationPlan(type).map((s) => s.afterSeconds);
      expect(secs).toEqual([...secs].sort((a, b) => a - b));
    }
  });

  it('常數', () => {
    expect(ACCEPT_AFTER_SECONDS).toBe(5);
    expect(REFUND_SECONDS).toBe(10);
  });
});

describe('dueTransitions', () => {
  it('自取：4s 無、5s 接單、25s 出餐、40s 完成', () => {
    expect(dueTransitions('PICKUP', 4, 1)).toEqual([]);
    expect(dueTransitions('PICKUP', 5, 1)).toEqual(['ACCEPTED']);
    expect(dueTransitions('PICKUP', 25, 1)).toEqual(['ACCEPTED', 'READY']);
    expect(dueTransitions('PICKUP', 40, 1)).toEqual(['ACCEPTED', 'READY', 'COMPLETED']);
  });

  it('外送：+10s 出發（35s）、+20s 送達（55s）', () => {
    expect(dueTransitions('DELIVERY', 34, 1)).toEqual(['ACCEPTED', 'READY']);
    expect(dueTransitions('DELIVERY', 35, 1)).toEqual(['ACCEPTED', 'READY', 'DELIVERING']);
    expect(dueTransitions('DELIVERY', 55, 1)).toEqual([
      'ACCEPTED',
      'READY',
      'DELIVERING',
      'COMPLETED',
    ]);
  });

  it('5× 速度下 8 秒即完成自取；2× 速度 20 秒', () => {
    expect(dueTransitions('PICKUP', 8, 5)).toEqual(['ACCEPTED', 'READY', 'COMPLETED']);
    expect(dueTransitions('PICKUP', 20, 2)).toEqual(['ACCEPTED', 'READY', 'COMPLETED']);
    expect(dueTransitions('PICKUP', 19.9, 2)).toEqual(['ACCEPTED', 'READY']);
  });

  it('預約單於基準之前（經過時間為負）不推進', () => {
    expect(dueTransitions('PICKUP', -3600, 1)).toEqual([]);
  });

  it('性質：經過時間越長，抵達的轉換越多（前綴關係）；速度 s × 時間 t 等價於 1× 的 t × s', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ORDER_TYPES),
        fc.integer({ min: -10, max: 120 }),
        fc.integer({ min: 0, max: 60 }),
        fc.constantFrom(1, 2, 5 as const),
        (type, t, extra, speed) => {
          const a = dueTransitions(type, t, speed);
          const b = dueTransitions(type, t + extra, speed);
          expect(b.slice(0, a.length)).toEqual(a);
          expect(b.length).toBeGreaterThanOrEqual(a.length);
          expect(dueTransitions(type, t, speed)).toEqual(dueTransitions(type, t * speed, 1));
        },
      ),
    );
  });
});

describe('simulationBaselineMs', () => {
  it('即時單 = 下單（pending_at）；預約單 = scheduledAt − lead', () => {
    expect(simulationBaselineMs(at(14, 30), null, 15)).toBe(at(14, 30));
    expect(simulationBaselineMs(at(14, 30), at(17, 0), 15)).toBe(at(16, 45));
  });
  it('太晚下單（scheduledAt − lead 早於 pending_at）→ 以下單時間', () => {
    expect(simulationBaselineMs(at(16, 50), at(17, 0), 15)).toBe(at(16, 50));
  });
  it('R-U：lead 取配送區 35 分 → 16:25（與接單期限使用同一個值）', () => {
    expect(simulationBaselineMs(at(14, 30), at(17, 0), 35)).toBe(at(16, 25));
  });
});

describe('autoAcceptAtMs / simulatedStatusAt（R-B）', () => {
  it('自動接單時點 = pending_at + 5 秒 ÷ 速度（即時與預約同）', () => {
    expect(autoAcceptAtMs(at(14, 30), 1)).toBe(at(14, 30, 5));
    expect(autoAcceptAtMs(at(14, 30), 5)).toBe(at(14, 30, 1));
    expect(autoAcceptAtMs(at(14, 30), 2)).toBe(at(14, 30) + 2500);
  });

  it('即時單：4s PENDING、5s ACCEPTED、25s READY、40s COMPLETED；5× 速度 8 秒完成', () => {
    const o = {
      orderType: 'PICKUP' as const,
      pendingAtMs: at(12, 0),
      scheduledAtMs: null,
      leadMinutes: 15,
    };
    expect([4, 5, 25, 40].map((sec) => simulatedStatusAt(o, at(12, 0, sec), 1))).toEqual([
      'PENDING',
      'ACCEPTED',
      'READY',
      'COMPLETED',
    ]);
    expect(simulatedStatusAt(o, at(12, 0, 8), 5)).toBe('COMPLETED');
  });

  it('外送：34s READY、35s DELIVERING、55s COMPLETED', () => {
    const o = {
      orderType: 'DELIVERY' as const,
      pendingAtMs: at(12, 0),
      scheduledAtMs: null,
      leadMinutes: 35,
    };
    expect([34, 35, 55].map((sec) => simulatedStatusAt(o, at(12, 0, sec), 1))).toEqual([
      'READY',
      'DELIVERING',
      'COMPLETED',
    ]);
  });

  it('R-B：預約單 pending_at + 5 秒即 ACCEPTED，製作基準之前維持 ACCEPTED，之後依時間表推進', () => {
    const o = {
      orderType: 'PICKUP' as const,
      pendingAtMs: at(14, 30),
      scheduledAtMs: at(17, 0),
      leadMinutes: 15,
    };
    expect(simulationBaselineMs(o.pendingAtMs, o.scheduledAtMs, o.leadMinutes)).toBe(at(16, 45));
    expect(simulatedStatusAt(o, at(14, 30, 4), 1)).toBe('PENDING');
    expect(simulatedStatusAt(o, at(14, 30, 5), 1)).toBe('ACCEPTED');
    expect(simulatedStatusAt(o, at(16, 44, 59), 1)).toBe('ACCEPTED');
    expect(simulatedStatusAt(o, at(16, 45), 1)).toBe('ACCEPTED'); // 製作基準：尚未到 +25 秒
    expect(simulatedStatusAt(o, at(16, 45, 25), 1)).toBe('READY');
    expect(simulatedStatusAt(o, at(16, 45, 40), 1)).toBe('COMPLETED');
  });

  it('性質：模擬狀態隨時間單調推進，且每一步都是狀態機允許的路徑（PENDING 起）', () => {
    const rank: Record<string, number> = {
      PENDING: 0,
      ACCEPTED: 1,
      READY: 2,
      DELIVERING: 3,
      COMPLETED: 4,
    };
    fc.assert(
      fc.property(
        fc.constantFrom(...ORDER_TYPES),
        fc.option(fc.integer({ min: 0, max: 7_200_000 }), { nil: null }),
        fc.integer({ min: 0, max: 60 }),
        fc.constantFrom(1, 2, 5 as const),
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), { minLength: 2, maxLength: 8 }),
        (orderType, scheduleOffset, lead, speed, times) => {
          const pendingAtMs = at(12, 0);
          const o = {
            orderType,
            pendingAtMs,
            scheduledAtMs: scheduleOffset === null ? null : pendingAtMs + scheduleOffset,
            leadMinutes: lead,
          };
          const sorted = [...times].sort((a, b) => a - b).map((d) => pendingAtMs + d);
          let prev: OrderStatus = 'PENDING';
          for (const now of sorted) {
            const s = simulatedStatusAt(o, now, speed);
            expect(rank[s]).toBeGreaterThanOrEqual(rank[prev] as number);
            if (s !== prev) {
              // 允許連續跳過中間狀態（快轉），但每個狀態都在計畫路徑上
              expect(['PENDING', 'ACCEPTED', 'READY', 'DELIVERING', 'COMPLETED']).toContain(s);
              if (orderType !== 'DELIVERY') expect(s).not.toBe('DELIVERING');
            }
            prev = s;
          }
        },
      ),
    );
  });
});

describe('refundDone', () => {
  it('退款完成：10 秒（1×）/ 2 秒（5×）', () => {
    expect(refundDone(9, 1)).toBe(false);
    expect(refundDone(10, 1)).toBe(true);
    expect(refundDone(2, 5)).toBe(true);
    expect(refundDone(1.9, 5)).toBe(false);
  });
});
