// FR-DM-12 Demo 注入：他人訂單份數夾在剩餘內、時段補滿所需單數、取餐號碼序號（BR / 05 §5.4）
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { OTHER_ORDER_PREFIX, clampInjection, nextPickupNo, slotFillCount } from '../../inject';
import type { PickupNoRow } from '../../inject';

describe('clampInjection（Demo 動作本身不得造成超賣）', () => {
  it('份數夾在目前剩餘內', () => {
    expect(clampInjection(5, 3)).toBe(3);
    expect(clampInjection(2, 3)).toBe(2);
    expect(clampInjection(3, 3)).toBe(3);
  });
  it('不限量（null）照給；剩餘 0 → 0', () => {
    expect(clampInjection(5, null)).toBe(5);
    expect(clampInjection(5, 0)).toBe(0);
  });
  it('負數與小數：夾為 0 / 無條件捨去；負的剩餘視為 0', () => {
    expect(clampInjection(-1, 3)).toBe(0);
    expect(clampInjection(2.9, 5)).toBe(2);
    expect(clampInjection(3, -4)).toBe(0);
  });
  it('性質：結果為 0 與 min(份數, 剩餘) 之間的整數，永不超過剩餘', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10, max: 100 }),
        fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
        (q, remaining) => {
          const r = clampInjection(q, remaining);
          expect(Number.isInteger(r)).toBe(true);
          expect(r).toBeGreaterThanOrEqual(0);
          if (remaining !== null) expect(r).toBeLessThanOrEqual(remaining);
          expect(r).toBeLessThanOrEqual(Math.max(0, q));
        },
      ),
    );
  });
});

describe('slotFillCount', () => {
  it('讓時段額滿（leave = 0）或只剩 1 個名額（leave = 1）所需補入的單數', () => {
    expect(slotFillCount(8, 3, 0)).toBe(5);
    expect(slotFillCount(8, 3, 1)).toBe(4);
  });
  it('已額滿或超收：不需補入（不為負）', () => {
    expect(slotFillCount(8, 8, 0)).toBe(0);
    expect(slotFillCount(8, 9, 1)).toBe(0);
    expect(slotFillCount(8, 7, 1)).toBe(0);
  });
  it('不限量的時段回傳 0', () => {
    expect(slotFillCount(null, 0, 0)).toBe(0);
    expect(slotFillCount(null, 5, 1)).toBe(0);
  });
  it('性質：補入後已訂數 + 補入 = 上限 − leave（或原本已更多）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 0, max: 40 }),
        fc.constantFrom(0, 1 as const),
        (max, booked, leave) => {
          const n = slotFillCount(max, booked, leave);
          expect(n).toBeGreaterThanOrEqual(0);
          expect(booked + n).toBe(Math.max(booked, max - leave));
        },
      ),
    );
  });
});

describe('OTHER_ORDER_PREFIX', () => {
  it('他人訂單取餐號碼前綴為 X', () => {
    expect(OTHER_ORDER_PREFIX).toBe('X');
  });
});

describe('nextPickupNo（O-07、庫存-25：序號以 (營業日, 前綴) 為鍵）', () => {
  const rows: PickupNoRow[] = [
    { businessDate: '2026-10-14', pickupNo: 'A001' },
    { businessDate: '2026-10-14', pickupNo: 'A002' },
    { businessDate: '2026-10-14', pickupNo: 'D001' },
    { businessDate: '2026-10-14', pickupNo: 'X001' },
    { businessDate: '2026-10-14', pickupNo: 'X002' },
    { businessDate: '2026-10-15', pickupNo: 'A001' },
  ];

  it('各前綴與營業日獨立遞增；X 前綴自成一組', () => {
    expect(nextPickupNo(rows, '2026-10-14', 'A')).toBe('A003');
    expect(nextPickupNo(rows, '2026-10-14', 'D')).toBe('D002');
    expect(nextPickupNo(rows, '2026-10-14', 'T')).toBe('T001');
    expect(nextPickupNo(rows, '2026-10-14', 'X')).toBe('X003');
    expect(nextPickupNo(rows, '2026-10-15', 'A')).toBe('A002');
  });

  it('明日還沒有任何單：從 001 開始', () => {
    expect(
      nextPickupNo(
        rows.filter((r) => r.businessDate === '2026-10-14'),
        '2026-10-15',
        'A',
      ),
    ).toBe('A001');
    expect(nextPickupNo([], '2026-10-14', 'A')).toBe('A001');
  });

  it('R-T(6)：今日下的隔日預約單取得明日序號且不佔用今日序號；明日第一張即時單為 A002 不重號', () => {
    const today: PickupNoRow[] = [
      { businessDate: '2026-10-14', pickupNo: 'A001' },
      { businessDate: '2026-10-14', pickupNo: 'A002' },
    ];
    const reservation = nextPickupNo(today, '2026-10-15', 'A');
    expect(reservation).toBe('A001');
    const withReservation = [...today, { businessDate: '2026-10-15', pickupNo: reservation }];
    expect(nextPickupNo(withReservation, '2026-10-14', 'A')).toBe('A003'); // 今日下一張 A 序號不受影響
    expect(nextPickupNo(withReservation, '2026-10-15', 'A')).toBe('A002'); // 明日第一張即時單，不與預約單重號
  });

  it('序號超過 999 時自然進位（A1000），不截斷', () => {
    expect(nextPickupNo([{ businessDate: 'd', pickupNo: 'A999' }], 'd', 'A')).toBe('A1000');
  });

  it('跳號後取最大值 + 1（不補洞）；非數字序號忽略', () => {
    const r: PickupNoRow[] = [
      { businessDate: 'd', pickupNo: 'A001' },
      { businessDate: 'd', pickupNo: 'A007' },
      { businessDate: 'd', pickupNo: 'Axyz' },
    ];
    expect(nextPickupNo(r, 'd', 'A')).toBe('A008');
  });

  it('性質：連續取號永不重複', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom('2026-10-14', '2026-10-15'),
            fc.constantFrom('A', 'D', 'T', 'X'),
          ),
          { maxLength: 40 },
        ),
        (picks) => {
          const rows2: PickupNoRow[] = [];
          for (const [businessDate, prefix] of picks) {
            const no = nextPickupNo(rows2, businessDate, prefix);
            expect(rows2.some((r) => r.businessDate === businessDate && r.pickupNo === no)).toBe(
              false,
            );
            expect(no).toMatch(new RegExp(`^${prefix}\\d{3,}$`));
            rows2.push({ businessDate, pickupNo: no });
          }
        },
      ),
    );
  });
});
