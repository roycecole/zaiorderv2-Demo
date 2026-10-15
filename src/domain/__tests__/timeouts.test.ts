// BR-17 逾時規則（付款期限、接單期限）與 BR-08 前置分鐘；07 §6.6
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { acceptDeadlineMs, leadMinutesFor, paymentDeadlineMs } from '../timeouts';
import type { LeadSettings } from '../timeouts';

const MIN = 60_000;
/** 以 UTC 相對值計算即可，與時區無關 */
const at = (h: number, m: number, s = 0): number => Date.UTC(2026, 9, 14, h, m, s);

describe('paymentDeadlineMs（BR-17）', () => {
  it('付款期限 = 下單時間 + payment_timeout_minutes', () => {
    expect(paymentDeadlineMs(at(12, 0), 15)).toBe(at(12, 15));
    expect(paymentDeadlineMs(at(23, 50), 15)).toBe(at(23, 50) + 15 * MIN);
  });
});

describe('acceptDeadlineMs（BR-17：自 pending_at 起算）', () => {
  const input = (o: {
    pending: number;
    scheduled?: number | null;
    lead?: number;
    timeout?: number;
  }) => ({
    pendingAtMs: o.pending,
    scheduledAtMs: o.scheduled ?? null,
    leadMinutes: o.lead ?? 15,
    acceptTimeoutMinutes: o.timeout ?? 10,
  });

  it('即時單：12:00 進入 PENDING（現金單 = 建單時間）→ 12:10', () => {
    expect(acceptDeadlineMs(input({ pending: at(12, 0) }))).toBe(at(12, 10));
  });

  it('R-B：12:00 線上付款、12:11 付款成功 → 期限 12:21（不以下單時間起算）', () => {
    const deadline = acceptDeadlineMs(input({ pending: at(12, 11) }));
    expect(deadline).toBe(at(12, 21));
    expect(deadline).toBeGreaterThan(at(12, 11)); // 進入 PENDING 當下不會已逾時
    expect(acceptDeadlineMs(input({ pending: at(12, 0) }))).toBe(at(12, 10)); // 對照：以下單時間起算會落在付款成功之前
  });

  it('預約單：14:30 下單、17:00 預約、前置 15 → 16:45（不被 14:40 誤取消）', () => {
    expect(acceptDeadlineMs(input({ pending: at(14, 30), scheduled: at(17, 0) }))).toBe(at(16, 45));
  });

  it('預約單：12:00 下單、預約 12:30、前置 15 → 12:15（不早於下單 + 10）', () => {
    expect(acceptDeadlineMs(input({ pending: at(12, 0), scheduled: at(12, 30) }))).toBe(at(12, 15));
  });

  it('預約時間很近：取 pending_at + 10', () => {
    expect(acceptDeadlineMs(input({ pending: at(12, 0), scheduled: at(12, 20) }))).toBe(at(12, 10));
  });

  it('預約單線上付款：14:40 才付款成功 → max(14:50, 16:45) = 16:45', () => {
    expect(acceptDeadlineMs(input({ pending: at(14, 40), scheduled: at(17, 0) }))).toBe(at(16, 45));
  });

  it('預約單於前置之後才付款成功：以 pending_at + 10 為準', () => {
    expect(acceptDeadlineMs(input({ pending: at(16, 50), scheduled: at(17, 0) }))).toBe(at(17, 0));
    expect(acceptDeadlineMs(input({ pending: at(17, 5), scheduled: at(17, 0) }))).toBe(at(17, 15));
  });

  it('性質：期限永遠 ≥ pending_at + 接單時限；即時單恰等於；預約單 ≥ scheduledAt − lead', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        fc.option(fc.integer({ min: 0, max: 2_000_000_000_000 }), { nil: null }),
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 1, max: 60 }),
        (pendingAtMs, scheduledAtMs, leadMinutes, acceptTimeoutMinutes) => {
          const d = acceptDeadlineMs({
            pendingAtMs,
            scheduledAtMs,
            leadMinutes,
            acceptTimeoutMinutes,
          });
          const base = pendingAtMs + acceptTimeoutMinutes * MIN;
          expect(d).toBeGreaterThanOrEqual(base);
          if (scheduledAtMs === null) expect(d).toBe(base);
          else expect(d).toBeGreaterThanOrEqual(scheduledAtMs - leadMinutes * MIN);
        },
      ),
    );
  });
});

describe('leadMinutesFor（BR-08、R-U）', () => {
  const settings: LeadSettings = { pickupLeadMinutes: 15, deliveryLeadMinutes: 40 };

  it('外送取該單配送區的 estimated_minutes；缺值（null / undefined）才用店家預設', () => {
    expect(leadMinutesFor('DELIVERY', 35, settings)).toBe(35);
    expect(leadMinutesFor('DELIVERY', null, settings)).toBe(40);
    expect(leadMinutesFor('DELIVERY', undefined, settings)).toBe(40);
  });

  it('配送區預估為 0 分視為有值（不退回店家預設）', () => {
    expect(leadMinutesFor('DELIVERY', 0, settings)).toBe(0);
  });

  it('自取與內用一律取 pickup_lead_minutes（忽略配送區）', () => {
    expect(leadMinutesFor('PICKUP', 35, settings)).toBe(15);
    expect(leadMinutesFor('DINE_IN', null, settings)).toBe(15);
  });

  it('08 §2.3：大安區 106 預估 35 分、店家預設 40 → 外送預約單期限 16:25（不是 16:20）', () => {
    const lead = leadMinutesFor('DELIVERY', 35, settings);
    const base = { pendingAtMs: at(14, 30), scheduledAtMs: at(17, 0), acceptTimeoutMinutes: 10 };
    expect(acceptDeadlineMs({ ...base, leadMinutes: lead })).toBe(at(16, 25));
    expect(acceptDeadlineMs({ ...base, leadMinutes: settings.deliveryLeadMinutes })).toBe(
      at(16, 20),
    );
  });
});
