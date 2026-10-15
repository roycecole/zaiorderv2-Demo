// BR-07 / FLOW-02 營業狀態判定；08 §5 時間穿梭預設
import { describe, expect, it } from 'vitest';
import { computeStoreStatus, nextOpenAfter, operatingSpans, spanContaining } from '../storeStatus';
import type { StoreStatusInput } from '../storeStatus';
import { toIsoTaipei } from '../taipeiTime';
import type { BusinessHour, SpecialDay } from '../types';

/** 週一～週六 11:00–14:00、17:00–21:00；週日公休（08 §2.2） */
const WEEKLY: BusinessHour[] = [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
  { weekday: weekday as BusinessHour['weekday'], open: '11:00', close: '14:00' },
  { weekday: weekday as BusinessHour['weekday'], open: '17:00', close: '21:00' },
]);

/** 台北時間 2026-10-14（週三）hh:mm */
const at = (hh: number, mm: number, date = '2026-10-14'): number =>
  Date.parse(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+08:00`);

const base = (over: Partial<StoreStatusInput> = {}): StoreStatusInput => ({
  nowMs: at(12, 0),
  businessHours: WEEKLY,
  specialDays: [],
  lastOrderOffsetMinutes: 15,
  isAcceptingOrders: true,
  pausedUntilMs: null,
  ...over,
});

describe('computeStoreStatus：08 §5 的時間穿梭預設', () => {
  it('開店前 10:30 → CLOSED · OUT_OF_HOURS，下次 11:00', () => {
    const r = computeStoreStatus(base({ nowMs: at(10, 30) }));
    expect(r.status).toBe('CLOSED');
    expect(r.closedReason).toBe('OUT_OF_HOURS');
    expect(toIsoTaipei(r.nextOpenAtMs ?? 0)).toBe('2026-10-14T11:00:00+08:00');
  });

  it('午餐 12:00 → OPEN，今日營業時段兩段', () => {
    const r = computeStoreStatus(base({ nowMs: at(12, 0) }));
    expect(r.status).toBe('OPEN');
    expect(r.nextOpenAtMs).toBeUndefined();
    expect(r.todayHours).toEqual([
      { open: '11:00', close: '14:00' },
      { open: '17:00', close: '21:00' },
    ]);
  });

  it('午休 14:30 → CLOSED · OUT_OF_HOURS，下次 17:00', () => {
    const r = computeStoreStatus(base({ nowMs: at(14, 30) }));
    expect(r.closedReason).toBe('OUT_OF_HOURS');
    expect(toIsoTaipei(r.nextOpenAtMs ?? 0)).toBe('2026-10-14T17:00:00+08:00');
  });

  it('即將停止接單 20:40 → OPEN；20:45 → CLOSED · LAST_ORDER_PASSED（邊界時刻即不再接受）', () => {
    expect(computeStoreStatus(base({ nowMs: at(20, 40) })).status).toBe('OPEN');
    expect(computeStoreStatus(base({ nowMs: at(20, 44) })).status).toBe('OPEN');
    const r = computeStoreStatus(base({ nowMs: at(20, 45) }));
    expect(r.status).toBe('CLOSED');
    expect(r.closedReason).toBe('LAST_ORDER_PASSED');
    expect(toIsoTaipei(r.nextOpenAtMs ?? 0)).toBe('2026-10-15T11:00:00+08:00');
  });

  it('已打烊 21:30 → 下個營業日 11:00；週六則為週一', () => {
    const wed = computeStoreStatus(base({ nowMs: at(21, 30) }));
    expect(toIsoTaipei(wed.nextOpenAtMs ?? 0)).toBe('2026-10-15T11:00:00+08:00');
    // 2026-10-17 為週六
    const sat = computeStoreStatus(base({ nowMs: at(21, 30, '2026-10-17') }));
    expect(sat.closedReason).toBe('OUT_OF_HOURS');
    expect(toIsoTaipei(sat.nextOpenAtMs ?? 0)).toBe('2026-10-19T11:00:00+08:00');
  });

  it('週日 12:00 → CLOSED · HOLIDAY（2026-10-18 為週日）', () => {
    const r = computeStoreStatus(base({ nowMs: at(12, 0, '2026-10-18') }));
    expect(r.status).toBe('CLOSED');
    expect(r.closedReason).toBe('HOLIDAY');
    expect(r.todayHours).toEqual([]);
    expect(toIsoTaipei(r.nextOpenAtMs ?? 0)).toBe('2026-10-19T11:00:00+08:00');
  });
});

describe('computeStoreStatus：特殊日、暫停與跨午夜', () => {
  const closedDay: SpecialDay = { date: '2026-10-17', type: 'CLOSED', note: '店休日' };

  it('特殊公休日 → HOLIDAY，下次營業為下一個有時段的日子', () => {
    const r = computeStoreStatus(base({ nowMs: at(12, 0, '2026-10-17'), specialDays: [closedDay] }));
    expect(r.closedReason).toBe('HOLIDAY');
    // 10-18 週日公休，10-19 週一
    expect(toIsoTaipei(r.nextOpenAtMs ?? 0)).toBe('2026-10-19T11:00:00+08:00');
  });

  it('特殊營業時間覆蓋每週時段', () => {
    const special: SpecialDay = { date: '2026-10-14', type: 'SPECIAL_HOURS', open: '09:00', close: '12:00' };
    expect(computeStoreStatus(base({ nowMs: at(10, 0), specialDays: [special] })).status).toBe('OPEN');
    const r = computeStoreStatus(base({ nowMs: at(13, 0), specialDays: [special] }));
    expect(r.closedReason).toBe('OUT_OF_HOURS');
    expect(r.todayHours).toEqual([{ open: '09:00', close: '12:00' }]);
  });

  it('PAUSED：手動暫停需人工恢復；paused_until 到達即自動恢復', () => {
    const manual = computeStoreStatus(base({ isAcceptingOrders: false }));
    expect(manual.status).toBe('PAUSED');
    expect(manual.pausedUntilMs).toBeUndefined();

    const until = at(12, 30);
    expect(
      computeStoreStatus(base({ isAcceptingOrders: false, pausedUntilMs: until })).pausedUntilMs,
    ).toBe(until);
    expect(
      computeStoreStatus(base({ nowMs: until, isAcceptingOrders: false, pausedUntilMs: until })).status,
    ).toBe('OPEN');
  });

  it('PAUSED 優先於休息中', () => {
    expect(computeStoreStatus(base({ nowMs: at(15, 0), isAcceptingOrders: false })).status).toBe('PAUSED');
  });

  describe('跨午夜營業（18:00–01:00，BR-23、EC-18）', () => {
    const night: BusinessHour[] = [{ weekday: 3, open: '18:00', close: '01:00' }]; // 週三
    const common = { businessHours: night, specialDays: [] };

    it('週四凌晨 00:30 仍屬週三營業日：OPEN（即使週四無時段）', () => {
      const r = computeStoreStatus(base({ ...common, nowMs: at(0, 30, '2026-10-15') }));
      expect(r.status).toBe('OPEN');
    });

    it('延伸段內已過最後點餐時間（00:45）→ LAST_ORDER_PASSED', () => {
      const r = computeStoreStatus(base({ ...common, nowMs: at(0, 45, '2026-10-15') }));
      expect(r.closedReason).toBe('LAST_ORDER_PASSED');
    });

    it('01:00 後 → 週四無時段 → HOLIDAY；下次營業為下週三 18:00', () => {
      const r = computeStoreStatus(base({ ...common, nowMs: at(1, 0, '2026-10-15') }));
      expect(r.closedReason).toBe('HOLIDAY');
      expect(toIsoTaipei(r.nextOpenAtMs ?? 0)).toBe('2026-10-21T18:00:00+08:00');
    });

    it('operatingSpans：close 為隔日', () => {
      const [span] = operatingSpans('2026-10-14', { ...common }, 15);
      expect(span?.overnight).toBe(true);
      expect(toIsoTaipei(span?.closeMs ?? 0)).toBe('2026-10-15T01:00:00+08:00');
      expect(toIsoTaipei(span?.lastOrderMs ?? 0)).toBe('2026-10-15T00:45:00+08:00');
    });
  });
});

describe('spanContaining / nextOpenAfter', () => {
  it('不在任何時段回傳 null；時段內回傳該時段', () => {
    expect(spanContaining(at(15, 0), base(), 15)).toBeNull();
    const span = spanContaining(at(12, 0), base(), 15);
    expect(toIsoTaipei(span?.closeMs ?? 0)).toBe('2026-10-14T14:00:00+08:00');
  });

  it('nextOpenAfter 為嚴格晚於現在者（開店時刻當下不算「下次」）', () => {
    expect(toIsoTaipei(nextOpenAfter(at(11, 0), base(), 15) ?? 0)).toBe('2026-10-14T17:00:00+08:00');
  });

  it('找不到時回傳 null', () => {
    expect(nextOpenAfter(at(12, 0), { businessHours: [], specialDays: [] }, 15)).toBeNull();
  });
});
