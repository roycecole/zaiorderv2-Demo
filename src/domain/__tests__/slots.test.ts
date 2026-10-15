// BR-08 / BR-09 / FLOW-05 取餐時段；EC-07 最近可選時段
import { describe, expect, it } from 'vitest';
import {
  asapAvailability, etaRange, findSlot, generateSlotDays, nearestAvailableSlot,
} from '../slots';
import type { SlotGenerationInput } from '../slots';
import type { BusinessHour, Slot } from '../types';

const WEEKLY: BusinessHour[] = [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
  { weekday: weekday as BusinessHour['weekday'], open: '11:00', close: '14:00' },
  { weekday: weekday as BusinessHour['weekday'], open: '17:00', close: '21:00' },
]);

const at = (hh: number, mm: number, date = '2026-10-14'): number =>
  Date.parse(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+08:00`);

const input = (over: Partial<SlotGenerationInput> = {}): SlotGenerationInput => ({
  nowMs: at(14, 30),
  leadMinutes: 15,
  businessHours: WEEKLY,
  specialDays: [],
  rules: { intervalMinutes: 15, maxAdvanceDays: 1, lastOrderOffsetMinutes: 15, maxOrdersPerSlot: 8 },
  bookedAt: () => 0,
  ...over,
});

describe('generateSlotDays（FLOW-05 範例：14:30、自取、lead = 15）', () => {
  it('今日 11:00–14:00 全部早於 earliest（14:45）不產生；17:00 起、最後一個為 20:45', () => {
    const [today] = generateSlotDays(input());
    expect(today?.date).toBe('2026-10-14');
    expect(today?.label).toBe('今天');
    expect(today?.slots[0]?.startAt).toBe('2026-10-14T17:00:00+08:00');
    expect(today?.slots.at(-1)?.startAt).toBe('2026-10-14T20:45:00+08:00');
    expect(today?.slots).toHaveLength(16); // 17:00–20:45，每 15 分一個
  });

  it('明天：兩段營業時段皆產生，標籤「明天」', () => {
    const days = generateSlotDays(input());
    expect(days.map((d) => d.label)).toEqual(['今天', '明天']);
    const tomorrow = days[1];
    expect(tomorrow?.slots[0]?.startAt).toBe('2026-10-15T11:00:00+08:00');
    // 11:00–13:45（12 個）+ 17:00–20:45（16 個）
    expect(tomorrow?.slots).toHaveLength(28);
  });

  it('earliest 進位到下一個時段：12:07 + 15 → 12:30（含邊界：恰等於 earliest 可選）', () => {
    const [today] = generateSlotDays(input({ nowMs: at(12, 7) }));
    expect(today?.slots[0]?.startAt).toBe('2026-10-14T12:30:00+08:00');
    const [exact] = generateSlotDays(input({ nowMs: at(12, 15) }));
    expect(exact?.slots[0]?.startAt).toBe('2026-10-14T12:30:00+08:00');
    const [late] = generateSlotDays(input({ nowMs: at(12, 15) + 1000 }));
    expect(late?.slots[0]?.startAt).toBe('2026-10-14T12:45:00+08:00');
  });

  it('最晚為 close − last_order_offset（含），晚於此者不產生', () => {
    const [today] = generateSlotDays(input({ nowMs: at(11, 0) }));
    const midday = today?.slots.filter((s) => s.startAt < '2026-10-14T15:00');
    expect(midday?.at(-1)?.startAt).toBe('2026-10-14T13:45:00+08:00');
  });

  it('外送前置較長（lead = 35）：11:00 下單 → earliest 11:35 → 起點 11:45', () => {
    const [today] = generateSlotDays(input({ nowMs: at(11, 0), leadMinutes: 35 }));
    expect(today?.slots[0]?.startAt).toBe('2026-10-14T11:45:00+08:00');
  });

  it('額滿標記：已訂數 ≥ max_orders_per_slot 為 FULL，其餘 AVAILABLE', () => {
    const full = at(17, 15);
    const days = generateSlotDays(input({ bookedAt: (t) => (t === full ? 8 : t === at(17, 30) ? 7 : 0) }));
    const slots = days[0]?.slots ?? [];
    expect(slots.find((s) => s.startAt === '2026-10-14T17:15:00+08:00')?.status).toBe('FULL');
    expect(slots.find((s) => s.startAt === '2026-10-14T17:30:00+08:00')?.status).toBe('AVAILABLE');
  });

  it('max_orders_per_slot 為 null 時永不額滿', () => {
    const days = generateSlotDays(
      input({
        rules: { intervalMinutes: 15, maxAdvanceDays: 1, lastOrderOffsetMinutes: 15, maxOrdersPerSlot: null },
        bookedAt: () => 999,
      }),
    );
    expect(days.flatMap((d) => d.slots).every((s) => s.status === 'AVAILABLE')).toBe(true);
  });

  it('特殊公休日無時段；已打烊的當日不回傳（只剩明天）', () => {
    const days = generateSlotDays(
      input({
        nowMs: at(21, 30),
        specialDays: [{ date: '2026-10-15', type: 'CLOSED' }],
      }),
    );
    expect(days).toEqual([]);
    const next = generateSlotDays(input({ nowMs: at(21, 30) }));
    expect(next.map((d) => d.date)).toEqual(['2026-10-15']);
    expect(next[0]?.label).toBe('明天');
  });

  it('max_advance_days = 3 時第三天以日期標示', () => {
    const days = generateSlotDays(
      input({
        nowMs: at(10, 0),
        rules: { intervalMinutes: 30, maxAdvanceDays: 3, lastOrderOffsetMinutes: 15, maxOrdersPerSlot: 8 },
      }),
    );
    expect(days.map((d) => d.label)).toEqual(['今天', '明天', '後天', '10/17（六）']);
  });

  it('跨午夜（18:00–01:00）：凌晨時段歸屬前一營業日，現在為 00:10 時仍屬「今天」的營業日', () => {
    const night: BusinessHour[] = [{ weekday: 3, open: '18:00', close: '01:00' }];
    const days = generateSlotDays(
      input({
        businessHours: night,
        nowMs: at(23, 50),
        rules: { intervalMinutes: 15, maxAdvanceDays: 0, lastOrderOffsetMinutes: 15, maxOrdersPerSlot: null },
      }),
    );
    expect(days).toHaveLength(1);
    // earliest 00:05 → 00:15、00:30、00:45（最後點餐 00:45）
    expect(days[0]?.slots.map((s) => s.startAt)).toEqual([
      '2026-10-15T00:15:00+08:00',
      '2026-10-15T00:30:00+08:00',
      '2026-10-15T00:45:00+08:00',
    ]);
    expect(days[0]?.date).toBe('2026-10-14');
  });
});

describe('asapAvailability（BR-08）', () => {
  it('營業中且來得及：available，預估 lead ～ lead + 5', () => {
    expect(
      asapAvailability({ status: 'OPEN', nowMs: at(12, 0), leadMinutes: 15, containingCloseMs: at(14, 0) }),
    ).toEqual({ available: true, etaMinutes: { min: 15, max: 20 } });
  });

  it('預估完成晚於打烊（外送來不及）→ SLOT_UNAVAILABLE', () => {
    expect(
      asapAvailability({ status: 'OPEN', nowMs: at(13, 30), leadMinutes: 35, containingCloseMs: at(14, 0) }),
    ).toEqual({ available: false, unavailableReason: 'SLOT_UNAVAILABLE' });
    // 恰等於打烊時間仍可（≤）
    expect(
      asapAvailability({ status: 'OPEN', nowMs: at(13, 25), leadMinutes: 35, containingCloseMs: at(14, 0) })
        .available,
    ).toBe(true);
  });

  it('PAUSED / CLOSED 的原因碼', () => {
    expect(asapAvailability({ status: 'PAUSED', nowMs: 0, leadMinutes: 15, containingCloseMs: null })).toEqual({
      available: false,
      unavailableReason: 'STORE_PAUSED',
    });
    expect(asapAvailability({ status: 'CLOSED', nowMs: 0, leadMinutes: 15, containingCloseMs: null })).toEqual({
      available: false,
      unavailableReason: 'STORE_CLOSED',
    });
  });

  it('強制營業（不在任何時段）不檢查打烊', () => {
    expect(
      asapAvailability({ status: 'OPEN', nowMs: at(15, 0), leadMinutes: 40, containingCloseMs: null }).available,
    ).toBe(true);
  });

  it('etaRange', () => {
    expect(etaRange(40)).toEqual({ min: 40, max: 45 });
  });
});

describe('findSlot', () => {
  it('以 epoch ms 比對 startAt', () => {
    const days = generateSlotDays(input());
    expect(findSlot(days, at(17, 15))?.startAt).toBe('2026-10-14T17:15:00+08:00');
    expect(findSlot(days, at(17, 16))).toBeNull();
    expect(findSlot(days, at(12, 0))).toBeNull();
  });
});

describe('nearestAvailableSlot（EC-07）', () => {
  const slot = (hhmm: string, status: Slot['status'] = 'AVAILABLE'): Slot => ({
    startAt: `2026-10-14T${hhmm}:00+08:00`,
    status,
  });

  it('優先之後最近的可用時段', () => {
    const slots = [slot('12:15'), slot('12:30', 'FULL'), slot('12:45'), slot('13:00')];
    expect(nearestAvailableSlot(slots, '2026-10-14T12:30:00+08:00')?.startAt).toBe(
      '2026-10-14T12:45:00+08:00',
    );
  });

  it('之後沒有則取之前最近；都沒有為 null；盡快取最早', () => {
    const slots = [slot('12:00'), slot('12:15'), slot('12:30', 'FULL')];
    expect(nearestAvailableSlot(slots, '2026-10-14T12:30:00+08:00')?.startAt).toBe(
      '2026-10-14T12:15:00+08:00',
    );
    expect(nearestAvailableSlot([slot('12:00', 'FULL')], null)).toBeNull();
    expect(nearestAvailableSlot(slots, null)?.startAt).toBe('2026-10-14T12:00:00+08:00');
  });
});
