// 03 §6.4 時間軸步驟與文案、狀態名稱、輪詢條件（FLOW-10、FLOW-16）
import { describe, expect, it } from 'vitest';
import { buildTimeline, isPaymentTimeout, shouldPoll, spokenPickupNo, statusLabel } from '../orderView';
import { log, makeOrder } from './fixtures';

const T = (hm: string) => `2026-10-14T${hm}:00+08:00`;

describe('statusLabel', () => {
  it('依取餐方式顯示 READY 與 COMPLETED', () => {
    expect(statusLabel('READY', 'PICKUP')).toBe('可取餐');
    expect(statusLabel('READY', 'DELIVERY')).toBe('餐點完成，等待外送');
    expect(statusLabel('READY', 'DINE_IN')).toBe('餐點完成');
    expect(statusLabel('DELIVERING', 'DELIVERY')).toBe('外送中');
    expect(statusLabel('COMPLETED', 'PICKUP')).toBe('已取餐');
    expect(statusLabel('COMPLETED', 'DELIVERY')).toBe('已送達');
    expect(statusLabel('COMPLETED', 'DINE_IN')).toBe('已完成');
    expect(statusLabel('PENDING', 'PICKUP')).toBe('等待店家確認');
    expect(statusLabel('CANCELLED', 'PICKUP')).toBe('已取消');
  });

  it('取餐號碼朗讀以空白分隔', () => {
    expect(spokenPickupNo('A027')).toBe('取餐號碼 A 0 2 7');
  });
});

describe('shouldPoll（FLOW-16）', () => {
  it('非終態一律輪詢', () => {
    for (const status of ['PENDING_PAYMENT', 'PENDING', 'ACCEPTED', 'READY', 'DELIVERING'] as const) {
      expect(shouldPoll(makeOrder({ status }))).toBe(true);
    }
  });

  it('終態停止，但退款進行中（REFUNDING）仍輪詢', () => {
    expect(shouldPoll(makeOrder({ status: 'COMPLETED' }))).toBe(false);
    expect(shouldPoll(makeOrder({ status: 'CANCELLED' }))).toBe(false);
    expect(
      shouldPoll(
        makeOrder({ status: 'CANCELLED', payment: { method: 'LINE_PAY', status: 'REFUNDING', expiresAt: null } }),
      ),
    ).toBe(true);
    expect(
      shouldPoll(
        makeOrder({ status: 'CANCELLED', payment: { method: 'LINE_PAY', status: 'REFUNDED', expiresAt: null } }),
      ),
    ).toBe(false);
  });

  it('尚無資料不輪詢', () => {
    expect(shouldPoll(undefined)).toBe(false);
  });
});

describe('buildTimeline', () => {
  it('PENDING：步驟 1 進行中，其餘未達；「可取餐」帶預計時間', () => {
    const m = buildTimeline(makeOrder({ status: 'PENDING' }));
    expect(m.awaitingPayment).toBe(false);
    expect(m.steps.map((s) => [s.key, s.state])).toEqual([
      ['submitted', 'current'],
      ['preparing', 'upcoming'],
      ['ready', 'upcoming'],
      ['completed', 'upcoming'],
    ]);
    expect(m.steps[0]?.label).toBe('訂單已送出，等待店家確認');
    expect(m.steps[0]?.at).toBe(T('12:20'));
    expect(m.steps[2]?.label).toBe('可取餐');
    expect(m.steps[2]?.expectedAt).toBe(T('12:35'));
    expect(m.steps[3]?.label).toBe('已取餐');
  });

  it('PENDING_PAYMENT：額外顯示「等待付款」，訂單尚未送出（步驟 1 為未達）', () => {
    const m = buildTimeline(
      makeOrder({
        status: 'PENDING_PAYMENT',
        timeline: [log('PENDING_PAYMENT', T('12:20'), 'CUSTOMER')],
      }),
    );
    expect(m.awaitingPayment).toBe(true);
    expect(m.steps.every((s) => s.state === 'upcoming')).toBe(true);
  });

  it('ACCEPTED：步驟 1 完成、製作中進行中，時間取自狀態紀錄', () => {
    const m = buildTimeline(
      makeOrder({
        status: 'ACCEPTED',
        timeline: [log('PENDING', T('12:20'), 'CUSTOMER'), log('ACCEPTED', T('12:21'))],
      }),
    );
    expect(m.steps.map((s) => s.state)).toEqual(['done', 'current', 'upcoming', 'upcoming']);
    expect(m.steps[0]?.label).toBe('訂單已送出');
    expect(m.steps[0]?.at).toBe(T('12:20'));
    expect(m.steps[1]?.label).toBe('製作中');
    expect(m.steps[1]?.at).toBe(T('12:21'));
  });

  it('外送：READY 為「餐點完成，等待外送」、DELIVERING 為「外送中」、完成為「已送達」', () => {
    const base = { orderType: 'DELIVERY' as const };
    const ready = buildTimeline(makeOrder({ ...base, status: 'READY' }));
    expect(ready.steps[2]?.label).toBe('餐點完成，等待外送');
    expect(ready.steps[2]?.state).toBe('current');
    const delivering = buildTimeline(makeOrder({ ...base, status: 'DELIVERING' }));
    expect(delivering.steps[2]?.label).toBe('外送中');
    expect(delivering.steps[3]?.label).toBe('已送達');
    const done = buildTimeline(makeOrder({ ...base, status: 'COMPLETED' }));
    expect(done.steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('內用：第三步「餐點完成」、第四步「已完成」', () => {
    const m = buildTimeline(makeOrder({ orderType: 'DINE_IN', status: 'READY' }));
    expect(m.steps[2]?.label).toBe('餐點完成');
    expect(m.steps[3]?.label).toBe('已完成');
  });

  it('COMPLETED：全部完成，沒有進行中的步驟', () => {
    const m = buildTimeline(
      makeOrder({
        status: 'COMPLETED',
        timeline: [
          log('PENDING', T('12:20'), 'CUSTOMER'),
          log('ACCEPTED', T('12:21')),
          log('READY', T('12:33')),
          log('COMPLETED', T('12:40')),
        ],
      }),
    );
    expect(m.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done']);
    expect(m.steps[3]?.at).toBe(T('12:40'));
    expect(m.cancelled).toBeNull();
  });

  it('CANCELLED：在中斷處以「已取消」結束，帶取消者與原因', () => {
    const m = buildTimeline(
      makeOrder({
        status: 'CANCELLED',
        timeline: [
          log('PENDING', T('12:20'), 'CUSTOMER'),
          log('ACCEPTED', T('12:21')),
          log('CANCELLED', T('12:25'), 'STORE', '缺料'),
        ],
        cancellation: { by: 'STORE', reason: '缺料', at: T('12:25') },
      }),
    );
    expect(m.steps.map((s) => s.key)).toEqual(['submitted', 'preparing']);
    expect(m.steps.every((s) => s.state === 'done')).toBe(true);
    expect(m.cancelled).toEqual({ by: 'STORE', reason: '缺料', at: T('12:25') });
  });

  it('付款逾時取消：只有步驟 1，取消者為系統', () => {
    const order = makeOrder({
      status: 'CANCELLED',
      timeline: [log('PENDING_PAYMENT', T('12:20'), 'CUSTOMER'), log('CANCELLED', T('12:35'), 'SYSTEM')],
      cancellation: { by: 'SYSTEM', reason: '付款逾時', at: T('12:35') },
    });
    const m = buildTimeline(order);
    expect(m.steps).toHaveLength(1);
    expect(m.cancelled?.by).toBe('SYSTEM');
    expect(isPaymentTimeout(order)).toBe(true);
  });
});

describe('isPaymentTimeout', () => {
  it('接單逾時（曾進入 PENDING）不屬於付款逾時', () => {
    expect(
      isPaymentTimeout(
        makeOrder({
          status: 'CANCELLED',
          timeline: [log('PENDING', T('12:20'), 'CUSTOMER'), log('CANCELLED', T('12:30'), 'SYSTEM')],
          cancellation: { by: 'SYSTEM', reason: '接單逾時', at: T('12:30') },
        }),
      ),
    ).toBe(false);
  });

  it('顧客自己放棄 / 非取消狀態皆不是', () => {
    expect(
      isPaymentTimeout(
        makeOrder({
          status: 'CANCELLED',
          timeline: [log('PENDING_PAYMENT', T('12:20'), 'CUSTOMER'), log('CANCELLED', T('12:22'), 'CUSTOMER')],
          cancellation: { by: 'CUSTOMER', at: T('12:22') },
        }),
      ),
    ).toBe(false);
    expect(isPaymentTimeout(makeOrder({ status: 'PENDING' }))).toBe(false);
  });
});
