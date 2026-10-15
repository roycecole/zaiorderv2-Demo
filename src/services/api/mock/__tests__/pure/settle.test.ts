// BR-17 / BR-38 / FLOW-14：逾時判斷（半開區間）、寫入路徑結算、自動模擬與接單逾時
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { countsTowardStock } from '@/domain/availability';
import { acceptDeadlineMs } from '@/domain/timeouts';
import type { OrderStatus } from '@/domain/types';
import { expiryOf, findExpired } from '../../settle';
import type { SettleCandidate } from '../../settle';
import { autoAcceptAtMs, simulatedStatusAt } from '../../simulator';

const NOW = Date.parse('2026-10-14T12:00:00+08:00');
const at = (h: number, m: number, s = 0): number => Date.UTC(2026, 9, 14, h, m, s);
const cand = (o: Partial<SettleCandidate> = {}): SettleCandidate => ({
  id: 'o',
  status: 'PENDING_PAYMENT',
  paymentExpiresAtMs: null,
  acceptDeadlineMs: null,
  autoAcceptAtMs: null,
  ...o,
});
const pend = (o: Partial<SettleCandidate> = {}): SettleCandidate =>
  cand({ status: 'PENDING', ...o });

describe('expiryOf', () => {
  it('付款逾時：到期前 1 ms 不逾時、到期當下起逾時（半開區間）', () => {
    expect(expiryOf(cand({ paymentExpiresAtMs: NOW + 1 }), NOW)).toBeNull();
    expect(expiryOf(cand({ paymentExpiresAtMs: NOW }), NOW)).toBe('PAYMENT_TIMEOUT');
    expect(expiryOf(cand({ paymentExpiresAtMs: NOW - 1 }), NOW)).toBe('PAYMENT_TIMEOUT');
  });

  it('接單逾時：PENDING 於接單期限當下起逾時（半開區間）', () => {
    expect(expiryOf(pend({ acceptDeadlineMs: NOW }), NOW)).toBe('ACCEPT_TIMEOUT');
    expect(expiryOf(pend({ acceptDeadlineMs: NOW + 1 }), NOW)).toBeNull();
  });

  it('其他狀態不逾時（即使帶有過期欄位）', () => {
    for (const status of [
      'ACCEPTED',
      'READY',
      'DELIVERING',
      'COMPLETED',
      'CANCELLED',
    ] as OrderStatus[]) {
      expect(
        expiryOf(cand({ status, paymentExpiresAtMs: NOW - 1, acceptDeadlineMs: NOW - 1 }), NOW),
        status,
      ).toBeNull();
    }
  });

  it('缺少期限欄位（null）不逾時', () => {
    expect(expiryOf(cand(), NOW)).toBeNull();
    expect(expiryOf(pend(), NOW)).toBeNull();
  });

  it('與 countsTowardStock 互為補集：待付款的「逾時」恰為「不計入」', () => {
    for (let d = -2; d <= 2; d++) {
      const o = { status: 'PENDING_PAYMENT' as const, paymentExpiresAtMs: NOW + d };
      expect(expiryOf(cand(o), NOW) === 'PAYMENT_TIMEOUT', String(d)).toBe(
        !countsTowardStock(o, NOW),
      );
    }
  });

  it('性質：待付款訂單 expiryOf 非 null ⇔ 不計入集合', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (expires, now) => {
          const o = { status: 'PENDING_PAYMENT' as const, paymentExpiresAtMs: expires };
          expect(expiryOf(cand(o), now) !== null).toBe(!countsTowardStock(o, now));
        },
      ),
    );
  });
});

describe('findExpired（寫入路徑結算）', () => {
  it('付款逾時與接單逾時兩種都結算；未到期者不含', () => {
    const found = findExpired(
      [
        cand({ id: 'a', paymentExpiresAtMs: NOW - 5 }),
        cand({ id: 'b', paymentExpiresAtMs: NOW + 5 }),
        pend({ id: 'p', acceptDeadlineMs: NOW - 1 }),
      ],
      NOW,
    );
    expect(found).toEqual([
      { id: 'a', reason: 'PAYMENT_TIMEOUT' },
      { id: 'p', reason: 'ACCEPT_TIMEOUT' },
    ]);
  });

  it('重複結算冪等：已轉為 CANCELLED 者不再命中', () => {
    const found = findExpired([cand({ id: 'a', paymentExpiresAtMs: NOW - 5 })], NOW);
    expect(found).toHaveLength(1);
    const again = found.map((f) => cand({ id: f.id, status: 'CANCELLED' }));
    expect(findExpired(again, NOW)).toEqual([]);
  });

  it('空陣列回傳空陣列', () => {
    expect(findExpired([], NOW)).toEqual([]);
  });
});

describe('接單期限與模擬器的關係（R-B、R-V、FLOW-14）', () => {
  it('R-B：12:00 線上付款、12:11 付款成功 → 期限 12:21，進入 PENDING 當下不逾時', () => {
    const deadline = acceptDeadlineMs({
      pendingAtMs: at(12, 11),
      scheduledAtMs: null,
      leadMinutes: 15,
      acceptTimeoutMinutes: 10,
    });
    expect(deadline).toBe(at(12, 21));
    expect(expiryOf(pend({ acceptDeadlineMs: deadline }), at(12, 11))).toBeNull();
    expect(expiryOf(pend({ acceptDeadlineMs: deadline }), at(12, 20, 59))).toBeNull();
    expect(expiryOf(pend({ acceptDeadlineMs: deadline }), at(12, 21))).toBe('ACCEPT_TIMEOUT');
    // 對照：誤以下單時間（12:00）起算，付款成功當下（12:11）就已逾時
    const wrong = acceptDeadlineMs({
      pendingAtMs: at(12, 0),
      scheduledAtMs: null,
      leadMinutes: 15,
      acceptTimeoutMinutes: 10,
    });
    expect(expiryOf(pend({ acceptDeadlineMs: wrong }), at(12, 11))).toBe('ACCEPT_TIMEOUT');
  });

  it('R-B：預約單快轉到製作基準時為 ACCEPTED 而非 CANCELLED（接單期限與自動接單不互相競賽）', () => {
    const o = {
      orderType: 'PICKUP' as const,
      pendingAtMs: at(14, 30),
      scheduledAtMs: at(17, 0),
      leadMinutes: 15,
    };
    const deadline = acceptDeadlineMs({
      pendingAtMs: o.pendingAtMs,
      scheduledAtMs: o.scheduledAtMs,
      leadMinutes: o.leadMinutes,
      acceptTimeoutMinutes: 10,
    });
    expect(deadline).toBe(at(16, 45));
    for (const now of [
      at(14, 30),
      at(14, 30, 5),
      at(14, 40),
      at(15, 0),
      at(16, 44, 59),
      deadline,
      deadline + 5_000,
      at(17, 0),
    ]) {
      const status = simulatedStatusAt(o, now, 1);
      expect(
        expiryOf(pend({ status, acceptDeadlineMs: deadline }), now),
        `${new Date(now).toISOString()} ${status}`,
      ).toBeNull();
    }
    // 自動模擬關閉：維持 PENDING 到期限，即由 expiryOf 取消（逾時不受開關影響）
    expect(expiryOf(pend({ acceptDeadlineMs: deadline }), deadline)).toBe('ACCEPT_TIMEOUT');
  });

  it('R-V：自動模擬開啟時，離頁超過接單期限後才讀取不被判接單逾時；自動模擬關閉才逾時', () => {
    const live = {
      orderType: 'PICKUP' as const,
      pendingAtMs: at(15, 0),
      scheduledAtMs: null,
      leadMinutes: 15,
    };
    const deadline = acceptDeadlineMs({
      pendingAtMs: live.pendingAtMs,
      scheduledAtMs: null,
      leadMinutes: 15,
      acceptTimeoutMinutes: 10,
    }); // 15:10
    const readAt = at(15, 11);
    const on = pend({
      acceptDeadlineMs: deadline,
      autoAcceptAtMs: autoAcceptAtMs(live.pendingAtMs, 1),
    });
    expect(expiryOf(on, readAt)).toBeNull();
    expect(findExpired([on], readAt)).toEqual([]);
    expect(autoAcceptAtMs(live.pendingAtMs, 1)).toBe(at(15, 0, 5));
    expect(simulatedStatusAt(live, readAt, 1)).toBe('COMPLETED');
    // 自動模擬關閉：同一筆 PENDING 於期限當下逾時
    const off = pend({ acceptDeadlineMs: deadline, autoAcceptAtMs: null });
    expect(expiryOf(off, deadline - 1)).toBeNull();
    expect(expiryOf(off, deadline)).toBe('ACCEPT_TIMEOUT');
    expect(expiryOf(off, readAt)).toBe('ACCEPT_TIMEOUT');
  });

  it('R-V：預約單 14:30 下單、17:00 預約 → 期限 16:45；離頁到 16:50 才讀取仍不逾時', () => {
    const booked = {
      orderType: 'PICKUP' as const,
      pendingAtMs: at(14, 30),
      scheduledAtMs: at(17, 0),
      leadMinutes: 15,
    };
    const deadline = acceptDeadlineMs({
      pendingAtMs: booked.pendingAtMs,
      scheduledAtMs: booked.scheduledAtMs,
      leadMinutes: 15,
      acceptTimeoutMinutes: 10,
    });
    expect(deadline).toBe(at(16, 45));
    const on = pend({
      acceptDeadlineMs: deadline,
      autoAcceptAtMs: autoAcceptAtMs(booked.pendingAtMs, 1),
    });
    expect(expiryOf(on, at(16, 50))).toBeNull();
    expect(simulatedStatusAt(booked, at(16, 45, 24), 1)).toBe('ACCEPTED');
    expect(simulatedStatusAt(booked, at(16, 50), 1)).toBe('COMPLETED');
  });

  it('R-V 邊界：模擬接單與期限同一時刻 → 以接單為準；晚 1 ms 才接單 → 逾時', () => {
    const d = at(15, 10);
    expect(expiryOf(pend({ acceptDeadlineMs: d, autoAcceptAtMs: d }), d)).toBeNull();
    expect(expiryOf(pend({ acceptDeadlineMs: d, autoAcceptAtMs: d + 1 }), d)).toBe(
      'ACCEPT_TIMEOUT',
    );
  });

  it('付款逾時不受自動模擬開關影響；已不是 PENDING 者不再判斷接單逾時', () => {
    const payOn = cand({ id: 'p', paymentExpiresAtMs: NOW, autoAcceptAtMs: NOW - 1 });
    expect(expiryOf(payOn, NOW)).toBe('PAYMENT_TIMEOUT');
    expect(expiryOf({ ...payOn, autoAcceptAtMs: null }, NOW)).toBe('PAYMENT_TIMEOUT');
    expect(expiryOf(cand({ status: 'ACCEPTED', acceptDeadlineMs: NOW - 1 }), NOW)).toBeNull();
  });
});
