// BR-38（計入集合）、BR-40（同商品多行配置）、BR-23（取餐營業日）、FLOW-23（異動清單）、
// FLOW-19 / BR-27（送出決策）與 07 §13 的 I1～I6 不變式
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  REMAINING_DISCLOSE_MAX,
  allocateByProduct,
  blockingCount,
  countsTowardStock,
  decideSubmit,
  deriveCheckoutIssues,
  disclosedRemaining,
  hasNothingToBuy,
  maxAddable,
  remainingOf,
  slotHasCapacity,
  targetBusinessDate,
} from '../availability';
import type {
  AllocationLine,
  BusinessCalendar,
  CheckoutIssue,
  CountableOrder,
  ProductFacts,
  ShownTotals,
  SubmitContext,
} from '../availability';
import { MAX_QTY_PER_LINE } from '../cart';
import type { CartLine } from '../cart';
import type { ErrorCode, ID, OrderStatus, QuoteCheck, QuoteResponse, QuotedLine } from '../types';

const NOW = Date.parse('2026-10-14T12:00:00+08:00');
const MIN = 60_000;

// ═════════ 計入集合與剩餘份數（BR-38） ═════════
describe('countsTowardStock（BR-38）', () => {
  it('CANCELLED 不計入', () => {
    expect(countsTowardStock({ status: 'CANCELLED', paymentExpiresAtMs: null }, NOW)).toBe(false);
    expect(countsTowardStock({ status: 'CANCELLED', paymentExpiresAtMs: NOW + MIN }, NOW)).toBe(
      false,
    );
  });

  it('待付款：到期前 1 ms 計入、到期當下起不計入（半開區間）', () => {
    expect(countsTowardStock({ status: 'PENDING_PAYMENT', paymentExpiresAtMs: NOW + 1 }, NOW)).toBe(
      true,
    );
    expect(countsTowardStock({ status: 'PENDING_PAYMENT', paymentExpiresAtMs: NOW }, NOW)).toBe(
      false,
    );
    expect(countsTowardStock({ status: 'PENDING_PAYMENT', paymentExpiresAtMs: NOW - 1 }, NOW)).toBe(
      false,
    );
  });

  it('待付款但沒有付款期限（資料不完整）視為計入', () => {
    expect(countsTowardStock({ status: 'PENDING_PAYMENT', paymentExpiresAtMs: null }, NOW)).toBe(
      true,
    );
  });

  it('PENDING、ACCEPTED、READY、DELIVERING、COMPLETED 一律計入（逾期排除只針對待付款）', () => {
    for (const status of ['PENDING', 'ACCEPTED', 'READY', 'DELIVERING', 'COMPLETED'] as const) {
      expect(countsTowardStock({ status, paymentExpiresAtMs: null }, NOW), status).toBe(true);
      expect(
        countsTowardStock({ status, paymentExpiresAtMs: NOW - MIN }, NOW),
        `${status} 帶過期欄位`,
      ).toBe(true);
    }
  });

  it('性質：待付款訂單一旦不計入，之後（時間更晚）不會再計入（釋放單調，I3）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (expires, t1, dt) => {
          const o: CountableOrder = { status: 'PENDING_PAYMENT', paymentExpiresAtMs: expires };
          if (!countsTowardStock(o, t1)) expect(countsTowardStock(o, t1 + dt)).toBe(false);
        },
      ),
    );
  });
});

describe('remainingOf', () => {
  it('不限量為 null；已售超過限量夾為 0（調降限量不得為負）', () => {
    expect(remainingOf(null, 99)).toBeNull();
    expect(remainingOf(5, 0)).toBe(5);
    expect(remainingOf(5, 3)).toBe(2);
    expect(remainingOf(5, 5)).toBe(0);
    expect(remainingOf(3, 5)).toBe(0);
  });

  it('性質（I6）：剩餘份數永不為負', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 5000 }),
        (limit, consumed) => {
          const r = remainingOf(limit, consumed);
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBe(Math.max(0, limit - consumed));
        },
      ),
    );
  });
});

describe('disclosedRemaining（FR-MN-06）', () => {
  it('只在 1～10 份揭露「今日剩 n 份」', () => {
    expect(REMAINING_DISCLOSE_MAX).toBe(10);
    expect(disclosedRemaining(1)).toBe(1);
    expect(disclosedRemaining(10)).toBe(10);
  });
  it('0、不限量（null）、未提供（undefined）、> 10 不揭露', () => {
    for (const v of [0, 11, 999, null, undefined])
      expect(disclosedRemaining(v), String(v)).toBeNull();
  });
});

// ═════════ 同商品多行配置（BR-40、O-08） ═════════
const L = (
  index: number,
  productId: ID,
  quantity: number,
  optionsValid = true,
): AllocationLine => ({
  index,
  productId,
  quantity,
  optionsValid,
});
const facts = (o: Record<ID, Partial<ProductFacts>>): Map<ID, ProductFacts> =>
  new Map(
    Object.entries(o).map(([k, v]) => [
      k,
      { listed: true, manualSoldOut: false, remaining: null, ...v },
    ]),
  );
const qtys = (r: Array<{ availableQuantity: number }>): number[] =>
  r.map((x) => x.availableQuantity);

describe('allocateByProduct（BR-40）', () => {
  it('單行足夠、數量不足（ITEM_STOCK_INSUFFICIENT）、不限量不受影響', () => {
    expect(allocateByProduct([L(0, 'c', 2)], facts({ c: { remaining: 5 } }))).toEqual([
      { index: 0, availableQuantity: 2, remaining: 5 },
    ]);
    expect(allocateByProduct([L(0, 'c', 3)], facts({ c: { remaining: 2 } }))).toEqual([
      { index: 0, availableQuantity: 2, remaining: 2, issue: 'ITEM_STOCK_INSUFFICIENT' },
    ]);
    expect(allocateByProduct([L(0, 't', 20)], facts({ t: { remaining: null } }))).toEqual([
      { index: 0, availableQuantity: 20, remaining: null },
    ]);
  });

  it('同商品多行依請求順序配置：剩 3，[1,2,2] → [1,2,0]；[4,2] → [3,0]；[2,2] → [2,1]', () => {
    const f = facts({ c: { remaining: 3 } });
    expect(qtys(allocateByProduct([L(0, 'c', 1), L(1, 'c', 2), L(2, 'c', 2)], f))).toEqual([
      1, 2, 0,
    ]);
    const b = allocateByProduct([L(0, 'c', 4), L(1, 'c', 2)], f);
    expect(qtys(b)).toEqual([3, 0]);
    expect(b.map((x) => x.remaining)).toEqual([3, 3]); // remaining 為加總前的商品層級剩餘
    expect(qtys(allocateByProduct([L(0, 'c', 2), L(1, 'c', 2)], f))).toEqual([2, 1]); // 庫存-6
  });

  it('O-08：配置為 0 而商品層級仍有剩餘 → ITEM_STOCK_INSUFFICIENT（已被同商品其他行占用），不是 ITEM_SOLD_OUT', () => {
    const b = allocateByProduct([L(0, 'c', 4), L(1, 'c', 2)], facts({ c: { remaining: 3 } }));
    expect(b[1]).toMatchObject({ issue: 'ITEM_STOCK_INSUFFICIENT', availableQuantity: 0 });
    expect(b[0]).toMatchObject({ issue: 'ITEM_STOCK_INSUFFICIENT', availableQuantity: 3 });
  });

  it('ITEM_SOLD_OUT 僅限手動售完或商品層級 remaining = 0（庫存-6：剩 0 → 兩行皆售完）', () => {
    const zero = allocateByProduct([L(0, 'c', 1), L(1, 'c', 1)], facts({ c: { remaining: 0 } }));
    expect(zero.map((x) => x.issue)).toEqual(['ITEM_SOLD_OUT', 'ITEM_SOLD_OUT']);
    const manual = allocateByProduct(
      [L(0, 'k', 1)],
      facts({ k: { manualSoldOut: true, remaining: null } }),
    );
    expect(manual).toEqual([
      { index: 0, availableQuantity: 0, remaining: null, issue: 'ITEM_SOLD_OUT' },
    ]);
  });

  it('手動售完即使仍有剩餘份數也是售完', () => {
    const r = allocateByProduct(
      [L(0, 'k', 1)],
      facts({ k: { manualSoldOut: true, remaining: 5 } }),
    );
    expect(r[0]).toMatchObject({ availableQuantity: 0, issue: 'ITEM_SOLD_OUT', remaining: 5 });
  });

  it('下架 → ITEM_UNLISTED（不帶 remaining）；查無商品視同下架', () => {
    const r = allocateByProduct(
      [L(0, 'x', 1), L(1, 'ghost', 1)],
      new Map([['x', { listed: false, manualSoldOut: false, remaining: 5 }]]),
    );
    expect(r).toEqual([
      { index: 0, availableQuantity: 0, issue: 'ITEM_UNLISTED' },
      { index: 1, availableQuantity: 0, issue: 'ITEM_UNLISTED' },
    ]);
  });

  it('下架優先於手動售完與剩餘為 0', () => {
    const r = allocateByProduct(
      [L(0, 'x', 1)],
      new Map([['x', { listed: false, manualSoldOut: true, remaining: 0 }]]),
    );
    expect(r[0]?.issue).toBe('ITEM_UNLISTED');
  });

  it('選項無效的行不參與配置：不占用同商品剩餘、availableQuantity 為 0、不帶庫存 issue', () => {
    const r = allocateByProduct(
      [L(0, 'c', 2, false), L(1, 'c', 3)],
      facts({ c: { remaining: 3 } }),
    );
    expect(qtys(r)).toEqual([0, 3]);
    expect(r[0]?.issue).toBeUndefined();
    expect(r[1]?.issue).toBeUndefined();
  });

  it('商品已售完時，選項無效的行仍回報售完（售完先於選項判斷）', () => {
    const r = allocateByProduct([L(0, 'c', 1, false)], facts({ c: { remaining: 0 } }));
    expect(r[0]?.issue).toBe('ITEM_SOLD_OUT');
  });

  it('不同商品互不影響；請求順序即配置順序', () => {
    const r = allocateByProduct(
      [L(0, 'a', 2), L(1, 'b', 5), L(2, 'a', 2)],
      facts({ a: { remaining: 3 }, b: { remaining: 1 } }),
    );
    expect(qtys(r)).toEqual([2, 1, 1]);
    expect(r.map((x) => x.issue)).toEqual([
      undefined,
      'ITEM_STOCK_INSUFFICIENT',
      'ITEM_STOCK_INSUFFICIENT',
    ]);
  });

  it('不限量商品的多行全部滿足；數量為負或 0 夾為 0', () => {
    const r = allocateByProduct(
      [L(0, 't', 20), L(1, 't', 20), L(2, 't', -3)],
      facts({ t: { remaining: null } }),
    );
    expect(qtys(r)).toEqual([20, 20, 0]);
  });

  it('不改動輸入', () => {
    const lines = [L(0, 'c', 4), L(1, 'c', 2)];
    const snapshot = JSON.stringify(lines);
    allocateByProduct(lines, facts({ c: { remaining: 3 } }));
    expect(JSON.stringify(lines)).toBe(snapshot);
  });

  describe('性質測試', () => {
    const lineArb = fc.record({
      productId: fc.constantFrom('a', 'b', 'c'),
      quantity: fc.integer({ min: 1, max: 20 }),
      optionsValid: fc.boolean(),
    });
    const factArb = fc.record({
      listed: fc.boolean(),
      manualSoldOut: fc.boolean(),
      remaining: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }),
    });
    const scenarioArb = fc.record({
      lines: fc.array(lineArb, { maxLength: 8 }),
      a: factArb,
      b: factArb,
      c: factArb,
    });
    const build = (s: {
      lines: Array<Omit<AllocationLine, 'index'>>;
      a: ProductFacts;
      b: ProductFacts;
      c: ProductFacts;
    }) => ({
      lines: s.lines.map((l, index): AllocationLine => ({ index, ...l })),
      facts: new Map<ID, ProductFacts>([
        ['a', s.a],
        ['b', s.b],
        ['c', s.c],
      ]),
    });

    it('配置不超賣（I1）：每個商品被配置的份數總和 ≤ 剩餘；每行 0 ≤ 配置 ≤ 請求', () => {
      fc.assert(
        fc.property(scenarioArb, (s) => {
          const { lines, facts: f } = build(s);
          const out = allocateByProduct(lines, f);
          expect(out).toHaveLength(lines.length);
          const sums = new Map<ID, number>();
          out.forEach((o, i) => {
            const line = lines[i] as AllocationLine;
            expect(o.index).toBe(line.index);
            expect(o.availableQuantity).toBeGreaterThanOrEqual(0);
            expect(o.availableQuantity).toBeLessThanOrEqual(line.quantity);
            sums.set(line.productId, (sums.get(line.productId) ?? 0) + o.availableQuantity);
          });
          for (const [pid, sum] of sums) {
            const fact = f.get(pid) as ProductFacts;
            if (fact.remaining !== null) expect(sum).toBeLessThanOrEqual(fact.remaining);
            if (!fact.listed || fact.manualSoldOut) expect(sum).toBe(0);
          }
        }),
      );
    });

    it('issue 與配置結果一致：全額配置無 issue；ITEM_SOLD_OUT 僅限手動售完或剩餘 0；STOCK_INSUFFICIENT 必有剩餘', () => {
      fc.assert(
        fc.property(scenarioArb, (s) => {
          const { lines, facts: f } = build(s);
          const out = allocateByProduct(lines, f);
          out.forEach((o, i) => {
            const line = lines[i] as AllocationLine;
            const fact = f.get(line.productId) as ProductFacts;
            if (
              o.issue === undefined &&
              fact.listed &&
              !fact.manualSoldOut &&
              fact.remaining !== 0 &&
              line.optionsValid
            ) {
              expect(o.availableQuantity).toBe(line.quantity);
            }
            if (o.issue === 'ITEM_SOLD_OUT')
              expect(fact.manualSoldOut || fact.remaining === 0).toBe(true);
            if (o.issue === 'ITEM_STOCK_INSUFFICIENT') {
              expect(fact.remaining).not.toBeNull();
              expect(fact.remaining as number).toBeGreaterThan(0);
              expect(o.availableQuantity).toBeLessThan(line.quantity);
            }
            if (o.issue === 'ITEM_UNLISTED') expect(fact.listed).toBe(false);
          });
        }),
      );
    });

    it('前綴獨立：後面的行不影響前面行的配置（後面的行先被縮減）', () => {
      fc.assert(
        fc.property(scenarioArb, fc.nat(8), (s, k) => {
          const { lines, facts: f } = build(s);
          const cut = Math.min(k, lines.length);
          const full = allocateByProduct(lines, f);
          const head = allocateByProduct(lines.slice(0, cut), f);
          expect(head).toEqual(full.slice(0, cut));
        }),
      );
    });

    it('商品互不影響：只留同一商品的行得到相同的配置', () => {
      fc.assert(
        fc.property(scenarioArb, fc.constantFrom('a', 'b', 'c'), (s, pid) => {
          const { lines, facts: f } = build(s);
          const full = allocateByProduct(lines, f);
          const mine = lines.filter((l) => l.productId === pid);
          const alone = allocateByProduct(mine, f);
          expect(alone.map((x) => x.availableQuantity)).toEqual(
            full
              .filter((_, i) => (lines[i] as AllocationLine).productId === pid)
              .map((x) => x.availableQuantity),
          );
        }),
      );
    });

    it('結果單調性：剩餘份數增加，任何一行的可購買份數都不會減少', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({ quantity: fc.integer({ min: 1, max: 20 }), optionsValid: fc.boolean() }),
            { maxLength: 6 },
          ),
          fc.integer({ min: 0, max: 30 }),
          fc.integer({ min: 0, max: 30 }),
          (rawLines, remaining, extra) => {
            const lines = rawLines.map((l, index): AllocationLine => ({
              index,
              productId: 'p',
              ...l,
            }));
            const low = allocateByProduct(lines, facts({ p: { remaining } }));
            const high = allocateByProduct(lines, facts({ p: { remaining: remaining + extra } }));
            low.forEach((o, i) =>
              expect(high[i]?.availableQuantity).toBeGreaterThanOrEqual(o.availableQuantity),
            );
            // 不限量時全部滿足（選項有效者）
            const unlimited = allocateByProduct(lines, facts({ p: { remaining: null } }));
            unlimited.forEach((o, i) => {
              const line = lines[i] as AllocationLine;
              expect(o.availableQuantity).toBe(line.optionsValid ? line.quantity : 0);
            });
          },
        ),
      );
    });

    it('全有或全無：以配置結果判斷整單可否成立，成立時全數滿足、不成立時沒有任何行被計入', () => {
      fc.assert(
        fc.property(scenarioArb, (s) => {
          const { lines, facts: f } = build(s);
          const out = allocateByProduct(lines, f);
          const ok = out.every(
            (o, i) =>
              o.issue === undefined &&
              o.availableQuantity === (lines[i] as AllocationLine).quantity,
          );
          const counted = ok ? out.reduce((sum, o) => sum + o.availableQuantity, 0) : 0;
          if (ok) {
            // 成立：每個商品的整體請求量都不超過剩餘
            const need = new Map<ID, number>();
            for (const l of lines) need.set(l.productId, (need.get(l.productId) ?? 0) + l.quantity);
            for (const [pid, n] of need) {
              const r = (f.get(pid) as ProductFacts).remaining;
              if (r !== null) expect(n).toBeLessThanOrEqual(r);
            }
          } else {
            expect(counted).toBe(0);
          }
        }),
      );
    });
  });
});

// ═════════ 步進器上限、時段容量 ═════════
describe('maxAddable（FR-PD-04）', () => {
  it('剩 2 且其他行已有 1 → 1；null → 20；省略 → 20；0 → 0；25 → 20（單行上限優先）', () => {
    expect(maxAddable(2, 1, 20)).toBe(1);
    expect(maxAddable(null, 7, 20)).toBe(20);
    expect(maxAddable(undefined, 0, 20)).toBe(20);
    expect(maxAddable(0, 0, 20)).toBe(0);
    expect(maxAddable(25, 0, 20)).toBe(20);
  });

  it('其他行已超過剩餘：不得為負；其他行份數為負視為 0', () => {
    expect(maxAddable(2, 5, 20)).toBe(0);
    expect(maxAddable(2, -3, 20)).toBe(2);
  });

  it('使用 MAX_QTY_PER_LINE 時的步進上限', () => {
    expect(maxAddable(100, 0, MAX_QTY_PER_LINE)).toBe(20);
    expect(maxAddable(3, 0, MAX_QTY_PER_LINE)).toBe(3);
  });

  it('性質：介於 0 與單行上限之間；不超過 剩餘 − 其他行；剩餘越多上限越高', () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 50 }),
        (remaining, other, maxPerLine, extra) => {
          const m = maxAddable(remaining, other, maxPerLine);
          expect(m).toBeGreaterThanOrEqual(0);
          expect(m).toBeLessThanOrEqual(maxPerLine);
          if (remaining !== null) {
            expect(m).toBeLessThanOrEqual(Math.max(0, remaining - other));
            expect(maxAddable(remaining + extra, other, maxPerLine)).toBeGreaterThanOrEqual(m);
          }
        },
      ),
    );
  });
});

describe('slotHasCapacity（BR-09）', () => {
  it('已訂 = 上限 − 1 可選、= 上限為額滿、null 不限', () => {
    expect(slotHasCapacity(8, 7)).toBe(true);
    expect(slotHasCapacity(8, 8)).toBe(false);
    expect(slotHasCapacity(8, 9)).toBe(false);
    expect(slotHasCapacity(null, 999)).toBe(true);
    expect(slotHasCapacity(0, 0)).toBe(false);
  });
});

// ═════════ 取餐營業日（BR-23） ═════════
describe('targetBusinessDate（BR-23、BR-40）', () => {
  const cal: BusinessCalendar = {
    utcOffsetMinutes: 480,
    businessHours: [
      { weekday: 3, open: '18:00', close: '01:00' }, // 週三 18:00 – 隔日 01:00（跨午夜）
      { weekday: 1, open: '11:00', close: '14:00' },
      { weekday: 1, open: '17:00', close: '21:00' },
    ],
  };
  const bd = (iso: string, scheduled: string | null = null, c: BusinessCalendar = cal): string =>
    targetBusinessDate(Date.parse(iso), scheduled, c);

  it('即時單為 now 所屬營業日；預約明日為明日', () => {
    expect(bd('2026-10-14T12:00:00+08:00')).toBe('2026-10-14');
    expect(bd('2026-10-14T12:00:00+08:00', '2026-10-15T12:30:00+08:00')).toBe('2026-10-15');
  });

  it('跨午夜 00:30 歸屬前一營業日；01:00 起歸屬當日（BR-23）', () => {
    expect(bd('2026-10-15T00:30:00+08:00')).toBe('2026-10-14');
    expect(bd('2026-10-15T00:59:00+08:00')).toBe('2026-10-14');
    expect(bd('2026-10-15T01:00:00+08:00')).toBe('2026-10-15');
    expect(bd('2026-10-14T12:00:00+08:00', '2026-10-15T00:30:00+08:00')).toBe('2026-10-14'); // 預約跨午夜時段
    expect(bd('2026-10-14T16:30:00Z')).toBe('2026-10-14'); // UTC 時間換算店家時區（= 台北 00:30）
  });

  it('前一日沒有跨午夜營業時，00:30 屬於當日', () => {
    expect(bd('2026-10-13T00:30:00+08:00')).toBe('2026-10-13'); // 週一 → 週二凌晨
  });

  it('特殊營業日優先於一般時段（CLOSED 取消跨午夜歸屬；SPECIAL_HOURS 可新增跨午夜）', () => {
    const closed: BusinessCalendar = {
      ...cal,
      specialDays: [{ date: '2026-10-14', type: 'CLOSED' }],
    };
    expect(bd('2026-10-15T00:30:00+08:00', null, closed)).toBe('2026-10-15');
    const late: BusinessCalendar = {
      ...cal,
      businessHours: [],
      specialDays: [{ date: '2026-10-14', type: 'SPECIAL_HOURS', open: '20:00', close: '02:00' }],
    };
    expect(bd('2026-10-15T01:30:00+08:00', null, late)).toBe('2026-10-14');
    expect(bd('2026-10-15T02:00:00+08:00', null, late)).toBe('2026-10-15');
  });

  it('純算術日期換算與 Date 一致（含閏日、世紀年、1970 之前）；無法解析的預約時間退回 now', () => {
    const empty: BusinessCalendar = { utcOffsetMinutes: 480, businessHours: [] };
    for (const iso of [
      '1969-12-31T20:00:00Z',
      '1970-01-01T00:00:00Z',
      '2000-02-28T17:00:00Z',
      '2000-02-29T00:00:00Z',
      '2024-02-29T10:00:00Z',
      '2026-12-31T16:00:00Z',
      '2100-02-28T16:30:00Z',
      '2100-03-01T00:00:00Z',
      '1900-03-01T00:00:00Z',
    ]) {
      const ms = Date.parse(iso);
      expect(targetBusinessDate(ms, null, empty), iso).toBe(
        new Date(ms + 480 * MIN).toISOString().slice(0, 10),
      );
    }
    expect(targetBusinessDate(NOW, 'not-a-date', empty)).toBe('2026-10-14');
  });

  it('性質：跨午夜時段只在「開始營業日的隔日凌晨」歸屬前一日（星期以 Date 獨立計算）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 6 }), // 有跨午夜營業的星期
        fc.integer({ min: 18_000, max: 20_000 }), // 自 1970-01-01 起的日數（約 2019～2024）
        fc.integer({ min: 0, max: 59 }), // 凌晨 00:mm
        (weekday, day, minute) => {
          const c: BusinessCalendar = {
            utcOffsetMinutes: 480,
            businessHours: [
              { weekday: weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6, open: '18:00', close: '01:00' },
            ],
          };
          const localMidnightUtc = day * 86_400_000 - 480 * MIN; // 該日台北 00:00 的瞬間
          const instant = localMidnightUtc + minute * MIN;
          const prevWeekday = new Date((day - 1) * 86_400_000).getUTCDay();
          const iso = (d: number): string => new Date(d * 86_400_000).toISOString().slice(0, 10);
          const expected = prevWeekday === weekday ? iso(day - 1) : iso(day);
          expect(targetBusinessDate(instant, null, c)).toBe(expected);
          // 01:00 起一律歸屬當日
          expect(targetBusinessDate(localMidnightUtc + 60 * MIN, null, c)).toBe(iso(day));
        },
      ),
    );
  });

  it('性質：沒有跨午夜營業時，結果等於店家時區的曆日', () => {
    const empty: BusinessCalendar = { utcOffsetMinutes: 480, businessHours: [] };
    fc.assert(
      fc.property(fc.integer({ min: -2_000_000_000_000, max: 4_000_000_000_000 }), (ms) => {
        expect(targetBusinessDate(ms, null, empty)).toBe(
          new Date(ms + 480 * MIN).toISOString().slice(0, 10),
        );
      }),
    );
  });
});

// ═════════ 結帳異動清單（FR-CK-16、FLOW-23、O-13） ═════════
const cartLine = (n: number, productId: ID, quantity: number, unitPrice: number): CartLine => ({
  lineId: `ln_${n}`,
  productId,
  quantity,
  optionIds: [],
  snapshot: { name: productId, unitPrice, optionLabels: [] },
});
const qline = (index: number, productId: ID, o: Partial<QuotedLine> = {}): QuotedLine => ({
  index,
  productId,
  name: productId,
  optionLabels: [],
  unitPrice: 10,
  quantity: 1,
  lineTotal: 10,
  available: true,
  availableQuantity: 1,
  ...o,
});
const check = (code: ErrorCode | string, o: Partial<QuoteCheck> = {}): QuoteCheck => ({
  code: code as ErrorCode,
  severity: 'ERROR',
  message: String(code),
  ...o,
});
const quoteOf = (
  items: QuotedLine[],
  checks: QuoteCheck[] = [],
  o: Partial<QuoteResponse> = {},
): QuoteResponse => ({
  valid: checks.every((c) => c.severity !== 'ERROR'),
  items,
  subtotal: 0,
  deliveryFee: 0,
  discount: 0,
  total: 0,
  checks,
  ...o,
});
/** R-Y：lineIds 為 quote 請求當時 items[i] 對應的購物車行 lineId（快照）；預設為「請求當時的購物車 = 目前購物車」 */
const lineIdsOf = (cart: CartLine[]): string[] => cart.map((l) => l.lineId);
const deriveFull = (
  quote: QuoteResponse,
  cart: CartLine[],
  shown?: ShownTotals,
  previous?: QuoteResponse,
) => deriveCheckoutIssues(quote, lineIdsOf(cart), cart, shown, previous);
const derive = (
  quote: QuoteResponse,
  cart: CartLine[],
  shown?: ShownTotals,
  previous?: QuoteResponse,
): CheckoutIssue[] => deriveFull(quote, cart, shown, previous).issues;

describe('deriveCheckoutIssues', () => {
  it('06 §5.9 範例：售完 + 數量不足 + 時段額滿 + 單價變動 → 4 項，依序為無法購買、數量、時段、價格', () => {
    const cart = [
      cartLine(0, 'lurou', 1, 67),
      cartLine(1, 'tea', 1, 25),
      cartLine(2, 'combo', 3, 299),
    ];
    const quote = quoteOf(
      [
        qline(0, 'lurou', { unitPrice: 72, lineTotal: 72 }),
        qline(1, 'tea', {
          unitPrice: 25,
          lineTotal: 0,
          available: false,
          availableQuantity: 0,
          issue: 'ITEM_SOLD_OUT',
        }),
        qline(2, 'combo', {
          unitPrice: 299,
          quantity: 3,
          lineTotal: 598,
          available: false,
          availableQuantity: 2,
          remaining: 2,
          issue: 'ITEM_STOCK_INSUFFICIENT',
        }),
      ],
      [
        check('ITEM_SOLD_OUT', { field: 'items', lineIndex: 1 }),
        check('ITEM_STOCK_INSUFFICIENT', { field: 'items', lineIndex: 2 }),
        check('SLOT_UNAVAILABLE', { field: 'scheduledAt' }),
      ],
    );
    const issues = derive(quote, cart);
    expect(issues.map((i) => [i.kind, i.code])).toEqual([
      ['UNAVAILABLE', 'ITEM_SOLD_OUT'],
      ['QUANTITY', 'ITEM_STOCK_INSUFFICIENT'],
      ['SLOT', 'SLOT_UNAVAILABLE'],
      ['PRICE', 'PRICE_UPDATED'],
    ]);
    expect(blockingCount(issues)).toBe(3);
    expect([
      issues[1]?.requestedQuantity,
      issues[1]?.availableQuantity,
      issues[1]?.lineId,
      issues[1]?.productId,
    ]).toEqual([3, 2, 'ln_2', 'combo']);
    expect([issues[3]?.from, issues[3]?.to, issues[3]?.blocking, issues[3]?.lineIndex]).toEqual([
      67,
      72,
      false,
      0,
    ]);
    expect(issues[2]?.field).toBe('scheduledAt');
  });

  it('僅價格變動 → 阻擋數 0（價格異動不計入鎖定數）', () => {
    const cart = [cartLine(0, 'lurou', 1, 67)];
    const issues = derive(quoteOf([qline(0, 'lurou', { unitPrice: 40, lineTotal: 40 })]), cart);
    expect(issues.map((i) => i.code)).toEqual(['PRICE_UPDATED']);
    expect(blockingCount(issues)).toBe(0);
  });

  it('EC-32：同商品多行各自標示，保留 productId 供分組；不可購買行不再判斷價格', () => {
    const cart = [cartLine(0, 'combo', 4, 299), cartLine(1, 'combo', 2, 250)];
    const quote = quoteOf(
      [
        qline(0, 'combo', {
          quantity: 4,
          availableQuantity: 3,
          available: false,
          issue: 'ITEM_STOCK_INSUFFICIENT',
          remaining: 3,
          unitPrice: 299,
        }),
        qline(1, 'combo', {
          quantity: 2,
          availableQuantity: 0,
          available: false,
          issue: 'ITEM_STOCK_INSUFFICIENT',
          remaining: 3,
          unitPrice: 299,
        }),
      ],
      [
        check('ITEM_STOCK_INSUFFICIENT', { field: 'items', lineIndex: 0 }),
        check('ITEM_STOCK_INSUFFICIENT', { field: 'items', lineIndex: 1 }),
      ],
    );
    const issues = derive(quote, cart);
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.productId)).toEqual(['combo', 'combo']);
    expect(issues.map((i) => i.availableQuantity)).toEqual([3, 0]);
    expect(issues.every((i) => i.kind === 'QUANTITY')).toBe(true);
    // 第 1 行 availableQuantity = 0（不可購買）：即使單價 250 ≠ 299 也不列價格更新
    expect(issues.some((i) => i.code === 'PRICE_UPDATED')).toBe(false);
  });

  it('未帶 issue 但可購買量不足者視為數量不足', () => {
    const cart = [cartLine(0, 'combo', 3, 299)];
    const quote = quoteOf([
      qline(0, 'combo', { quantity: 3, availableQuantity: 1, available: false, unitPrice: 299 }),
    ]);
    const issues = derive(quote, cart);
    expect(issues.map((i) => [i.kind, i.code, i.requestedQuantity, i.availableQuantity])).toEqual([
      ['QUANTITY', 'ITEM_STOCK_INSUFFICIENT', 3, 1],
    ]);
  });

  it('O-13 第 4 類：折扣碼失效定位到 couponCode 並阻擋；同時以「折扣 −$40 已失效，總額 $380 → $420」列為價格差異', () => {
    const cart = [cartLine(0, 'lurou', 6, 70)];
    const quote = quoteOf(
      [qline(0, 'lurou', { unitPrice: 70, quantity: 6, lineTotal: 420, availableQuantity: 6 })],
      [check('COUPON_USED_UP', { field: 'couponCode' })],
      { total: 420, discount: 0 },
    );
    const issues = derive(quote, cart, { total: 380, discount: 40 });
    expect(issues.map((i) => [i.kind, i.code, i.blocking])).toEqual([
      ['CONDITION', 'COUPON_USED_UP', true],
      ['PRICE', 'DISCOUNT_LOST', false],
    ]);
    const lost = issues[1] as CheckoutIssue;
    expect([lost.from, lost.to, lost.discountLost, lost.field]).toEqual([
      380,
      420,
      40,
      'couponCode',
    ]);
  });

  it('O-13 / R-D：每個 422 錯誤碼都有落點欄位且阻擋；店家狀態不進清單', () => {
    const landing: Record<string, [string, string]> = {
      MIN_ORDER_NOT_MET: ['CONDITION', 'items'],
      OUT_OF_DELIVERY_AREA: ['CONDITION', 'delivery.zipCode'],
      PAYMENT_METHOD_NOT_ALLOWED: ['CONDITION', 'paymentMethod'],
      INVOICE_INVALID: ['CONDITION', 'invoice'],
      TABLE_NOT_FOUND: ['CONDITION', 'dineIn.tableNo'],
      COUPON_NOT_FOUND: ['CONDITION', 'couponCode'],
      COUPON_EXPIRED: ['CONDITION', 'couponCode'],
      COUPON_NOT_APPLICABLE: ['CONDITION', 'couponCode'],
      COUPON_MIN_NOT_MET: ['CONDITION', 'couponCode'],
      COUPON_USED_UP: ['CONDITION', 'couponCode'],
      LOGIN_REQUIRED: ['CONDITION', 'couponCode'],
      SLOT_UNAVAILABLE: ['SLOT', 'scheduledAt'],
      SERVICE_NOT_AVAILABLE: ['SLOT', 'orderType'],
    };
    for (const [code, [kind, field]] of Object.entries(landing)) {
      const r = deriveFull(quoteOf([], [check(code)]), []);
      expect(r.issues, code).toHaveLength(1);
      expect([r.issues[0]?.kind, r.issues[0]?.field, r.issues[0]?.blocking], code).toEqual([
        kind,
        field,
        true,
      ]);
      expect(r.storeIssue, code).toBeNull();
    }
  });

  it('LOGIN_REQUIRED 為折扣類阻擋項（BR-33）；折扣因此失效時同樣列為價格差異', () => {
    const lost = deriveFull(
      quoteOf([], [check('LOGIN_REQUIRED', { field: 'couponCode' })], { total: 420, discount: 0 }),
      [],
      { total: 380, discount: 40 },
    );
    expect(lost.issues.map((i) => [i.code, i.blocking])).toEqual([
      ['LOGIN_REQUIRED', true],
      ['DISCOUNT_LOST', false],
    ]);
  });

  it('未知錯誤碼：列為第 4 類阻擋項並以 message 作為降級文字；WARNING 不進清單', () => {
    const fallback = derive(
      quoteOf([], [check('SOMETHING_NEW', { message: '請調整後再送出' })]),
      [],
    );
    expect([fallback[0]?.kind, fallback[0]?.blocking, fallback[0]?.message]).toEqual([
      'CONDITION',
      true,
      '請調整後再送出',
    ]);
    expect(
      derive(quoteOf([], [{ code: 'MIN_ORDER_NOT_MET', severity: 'WARNING', message: 'w' }]), []),
    ).toEqual([]);
  });

  it('check 自帶 field 時以其為準（不使用預設落點）', () => {
    const r = derive(quoteOf([], [check('MIN_ORDER_NOT_MET', { field: 'custom.field' })]), []);
    expect(r[0]?.field).toBe('custom.field');
  });

  it('R-K：STORE_PAUSED / STORE_CLOSED 不進清單，以 storeIssue 旗標回傳（PAUSED 優先）；不計入鎖定數', () => {
    const closed = deriveFull(quoteOf([], [check('STORE_CLOSED')]), []);
    expect([closed.issues, closed.storeIssue]).toEqual([[], 'STORE_CLOSED']);
    const paused = deriveFull(quoteOf([], [check('STORE_CLOSED'), check('STORE_PAUSED')]), []);
    expect(paused.storeIssue).toBe('STORE_PAUSED');
    const pausedFirst = deriveFull(quoteOf([], [check('STORE_PAUSED'), check('STORE_CLOSED')]), []);
    expect(pausedFirst.storeIssue).toBe('STORE_PAUSED');
    expect(blockingCount(paused.issues)).toBe(0);
    expect(deriveFull(quoteOf([], []), []).storeIssue).toBeNull();
  });

  it('店家狀態說明與品項異動並存：各自呈現', () => {
    const both = deriveFull(
      quoteOf(
        [qline(0, 'tea', { availableQuantity: 0, available: false, issue: 'ITEM_SOLD_OUT' })],
        [check('STORE_PAUSED'), check('ITEM_SOLD_OUT', { field: 'items', lineIndex: 0 })],
      ),
      [cartLine(0, 'tea', 1, 25)],
    );
    expect([both.issues.length, both.storeIssue]).toEqual([1, 'STORE_PAUSED']);
  });

  it('R-L：QUANTITY_EXCEEDED 品項行帶 requested / availableQuantity（= min(quantity, 單行上限)）；行數超過 maxLines 為無 lineIndex 的整單項', () => {
    const cart = [cartLine(0, 'tea', 25, 25)];
    const row = derive(
      quoteOf(
        [
          qline(0, 'tea', {
            quantity: 25,
            unitPrice: 25,
            availableQuantity: 20,
            available: false,
            lineTotal: 500,
            issue: 'QUANTITY_EXCEEDED',
          }),
        ],
        [check('QUANTITY_EXCEEDED', { field: 'items', lineIndex: 0 })],
      ),
      cart,
    );
    expect(row).toHaveLength(1);
    expect([
      row[0]?.kind,
      row[0]?.code,
      row[0]?.requestedQuantity,
      row[0]?.availableQuantity,
      row[0]?.blocking,
    ]).toEqual(['QUANTITY', 'QUANTITY_EXCEEDED', 25, 20, true]);
    const lines = derive(quoteOf([], [check('QUANTITY_EXCEEDED', { field: 'items' })]), []);
    expect([
      lines.length,
      lines[0]?.kind,
      lines[0]?.lineIndex,
      lines[0]?.field,
      lines[0]?.blocking,
    ]).toEqual([1, 'QUANTITY', undefined, 'items', true]);
  });

  it('FLOW-23 排序：行數超過 maxLines 的整單項排在「數量不足」類別最前；無法購買仍在最前', () => {
    const cart = [cartLine(0, 'tea', 1, 25), cartLine(1, 'combo', 3, 299)];
    const quote = quoteOf(
      [
        qline(0, 'tea', { availableQuantity: 0, available: false, issue: 'ITEM_SOLD_OUT' }),
        qline(1, 'combo', {
          unitPrice: 299,
          quantity: 3,
          availableQuantity: 2,
          available: false,
          issue: 'ITEM_STOCK_INSUFFICIENT',
          remaining: 2,
        }),
      ],
      [
        check('QUANTITY_EXCEEDED', { field: 'items' }), // 整單項：品項行數超過 maxLines
        check('ITEM_SOLD_OUT', { field: 'items', lineIndex: 0 }),
        check('ITEM_STOCK_INSUFFICIENT', { field: 'items', lineIndex: 1 }),
      ],
    );
    expect(derive(quote, cart).map((i) => [i.kind, i.code, i.lineIndex])).toEqual([
      ['UNAVAILABLE', 'ITEM_SOLD_OUT', 0],
      ['QUANTITY', 'QUANTITY_EXCEEDED', undefined],
      ['QUANTITY', 'ITEM_STOCK_INSUFFICIENT', 1],
    ]);
    // 第 0 行本身是數量不足：整單項仍在它之前（以 ?? 0 排序時會落在其後）
    const first = quoteOf(
      [
        qline(0, 'combo', {
          unitPrice: 299,
          quantity: 3,
          availableQuantity: 2,
          available: false,
          issue: 'ITEM_STOCK_INSUFFICIENT',
          remaining: 2,
        }),
      ],
      [
        check('ITEM_STOCK_INSUFFICIENT', { field: 'items', lineIndex: 0 }),
        check('QUANTITY_EXCEEDED', { field: 'items' }),
      ],
    );
    expect(derive(first, [cartLine(0, 'combo', 3, 299)]).map((i) => i.code)).toEqual([
      'QUANTITY_EXCEEDED',
      'ITEM_STOCK_INSUFFICIENT',
    ]);
  });

  it('R-Y：以 quote 請求當時的 lineId 快照對應購物車行並驗證 productId；錯位時略過，不指到別的品項', () => {
    // 購物車 [滷肉飯, 紅茶, 雙人餐 ×3]；quote：index 1 紅茶售完、index 2 雙人餐數量不足
    const requested = [
      cartLine(0, 'lurou', 1, 67),
      cartLine(1, 'tea', 1, 25),
      cartLine(2, 'combo', 3, 299),
    ];
    const quote = quoteOf(
      [
        qline(0, 'lurou', { unitPrice: 67, lineTotal: 67 }),
        qline(1, 'tea', { availableQuantity: 0, available: false, issue: 'ITEM_SOLD_OUT' }),
        qline(2, 'combo', {
          unitPrice: 299,
          quantity: 3,
          availableQuantity: 2,
          available: false,
          issue: 'ITEM_STOCK_INSUFFICIENT',
          remaining: 2,
        }),
      ],
      [
        check('ITEM_SOLD_OUT', { field: 'items', lineIndex: 1 }),
        check('ITEM_STOCK_INSUFFICIENT', { field: 'items', lineIndex: 2 }),
      ],
    );
    const snapshot = lineIdsOf(requested);
    // 正常：快照與目前購物車一致
    const ok = deriveCheckoutIssues(quote, snapshot, requested).issues;
    expect(ok.map((i) => [i.code, i.lineId, i.productId])).toEqual([
      ['ITEM_SOLD_OUT', 'ln_1', 'tea'],
      ['ITEM_STOCK_INSUFFICIENT', 'ln_2', 'combo'],
    ]);
    // 顧客按「移除紅茶」→ 目前購物車 [滷肉飯, 雙人餐]，新 quote 尚未回來：沿用快照；
    // 紅茶的項目因對不到而略過，雙人餐仍以 lineId 對到正確的行
    const current = [requested[0] as CartLine, requested[2] as CartLine];
    const stale = deriveCheckoutIssues(quote, snapshot, current).issues;
    expect(stale.map((i) => [i.code, i.lineId, i.productId, i.lineIndex])).toEqual([
      ['ITEM_STOCK_INSUFFICIENT', 'ln_2', 'combo', 2],
    ]);
    expect(blockingCount(stale)).toBe(1);
    // 快照的 lineId 在目前購物車對到不同商品（行被取代、lineId 重用）→ productId 不一致，略過
    const swapped = [
      { ...(requested[1] as CartLine), productId: 'other' },
      requested[2] as CartLine,
    ];
    expect(deriveCheckoutIssues(quote, snapshot, swapped).issues.map((i) => i.code)).toEqual([
      'ITEM_STOCK_INSUFFICIENT',
    ]);
    // 指向被略過行的 check 同樣略過；整單項（無 lineIndex）不受影響
    const withWhole = quoteOf(quote.items, [
      ...quote.checks,
      check('QUANTITY_EXCEEDED', { field: 'items' }),
    ]);
    expect(deriveCheckoutIssues(withWhole, snapshot, current).issues.map((i) => i.code)).toEqual([
      'QUANTITY_EXCEEDED',
      'ITEM_STOCK_INSUFFICIENT',
    ]);
    // 快照比 quote 短（對不到 lineId）：略過
    expect(deriveCheckoutIssues(quote, [], requested).issues).toEqual([]);
    // 價格更新同樣只對綁得到的行判斷
    const priced = quoteOf([qline(0, 'lurou', { unitPrice: 72, lineTotal: 72 })]);
    expect(
      deriveCheckoutIssues(priced, ['ln_0'], [requested[0] as CartLine]).issues.map((i) => i.code),
    ).toEqual(['PRICE_UPDATED']);
    expect(deriveCheckoutIssues(priced, ['ln_0'], []).issues).toEqual([]);
  });

  it('R-L / 06 §4.3：同一行同時有 issue 與其他 check 只算一項，不重複計入「還有 n 項」；不同行各算一項', () => {
    const cart = [cartLine(0, 'tea', 1, 25)];
    const quote = quoteOf(
      [qline(0, 'tea', { availableQuantity: 0, available: false, issue: 'ITEM_SOLD_OUT' })],
      [
        check('ITEM_SOLD_OUT', { field: 'items', lineIndex: 0 }),
        check('OPTION_UNAVAILABLE', { field: 'items', lineIndex: 0 }),
      ],
    );
    const issues = derive(quote, cart);
    expect(issues.map((i) => i.code)).toEqual(['ITEM_SOLD_OUT']);
    expect(blockingCount(issues)).toBe(1);

    const two = derive(
      quoteOf(
        [
          qline(0, 'a', { availableQuantity: 0, available: false, issue: 'ITEM_SOLD_OUT' }),
          qline(1, 'b', { availableQuantity: 0, available: false, issue: 'OPTION_UNAVAILABLE' }),
        ],
        [
          check('ITEM_SOLD_OUT', { field: 'items', lineIndex: 0 }),
          check('OPTION_UNAVAILABLE', { field: 'items', lineIndex: 1 }),
        ],
      ),
      [cartLine(0, 'a', 1, 10), cartLine(1, 'b', 1, 10)],
    );
    expect(blockingCount(two)).toBe(2);
  });

  it('R-D / 2.6：帶 remaining 與 wasAvailable，供「限量用盡」補充說明、「剛剛被訂走了」與「今日只剩 n 份」判斷', () => {
    const cart = [cartLine(0, 'combo', 1, 299), cartLine(1, 'tea', 1, 25)];
    const before = quoteOf([qline(0, 'combo', { remaining: 1 }), qline(1, 'tea')]);
    const after = quoteOf(
      [
        qline(0, 'combo', {
          availableQuantity: 0,
          available: false,
          issue: 'ITEM_SOLD_OUT',
          remaining: 0,
        }),
        qline(1, 'tea', { availableQuantity: 0, available: false, issue: 'ITEM_SOLD_OUT' }),
      ],
      [
        check('ITEM_SOLD_OUT', { field: 'items', lineIndex: 0 }),
        check('ITEM_SOLD_OUT', { field: 'items', lineIndex: 1 }),
      ],
    );
    const issues = derive(after, cart, undefined, before);
    expect(issues.map((i) => [i.productId, i.remaining, i.wasAvailable])).toEqual([
      ['combo', 0, true],
      ['tea', undefined, true],
    ]);
    // 沒有前一次報價（直接進入結帳就已售完）：不判斷 wasAvailable，維持「今日售完」
    expect(derive(after, cart)[0]?.wasAvailable).toBeUndefined();
    // 前一次就不可買：不是「剛剛被訂走」
    expect(derive(after, cart, undefined, after)[0]?.wasAvailable).toBe(false);
    // 同商品組標題「今日只剩 n 份」：數量不足行帶商品層級 remaining（加總前）
    const short = derive(
      quoteOf([
        qline(0, 'combo', {
          quantity: 3,
          availableQuantity: 2,
          available: false,
          issue: 'ITEM_STOCK_INSUFFICIENT',
          remaining: 2,
        }),
      ]),
      [cartLine(0, 'combo', 3, 299)],
    );
    expect(short[0]?.remaining).toBe(2);
  });

  it('總額變動：無阻擋項且單價與折扣都沒變時才列 TOTAL_CHANGED（例如運費調整）；有阻擋項時不列；未提供 shown 時不推測', () => {
    const cart = [cartLine(0, 'lurou', 1, 10)];
    const q = quoteOf([qline(0, 'lurou')], [], { total: 110 });
    expect(derive(q, cart, { total: 100, discount: 0 }).map((i) => [i.code, i.from, i.to])).toEqual(
      [['TOTAL_CHANGED', 100, 110]],
    );
    const sold = quoteOf(
      [qline(0, 'lurou', { availableQuantity: 0, available: false, issue: 'ITEM_SOLD_OUT' })],
      [],
      { total: 0 },
    );
    expect(derive(sold, cart, { total: 100, discount: 0 }).map((i) => i.code)).toEqual([
      'ITEM_SOLD_OUT',
    ]);
    expect(derive(q, cart)).toEqual([]);
    // 總額沒變 → 不列
    expect(
      derive(quoteOf([qline(0, 'lurou')], [], { total: 100 }), cart, { total: 100, discount: 0 }),
    ).toEqual([]);
  });

  it('單價已說明總額變動時不另列 TOTAL_CHANGED', () => {
    const cart = [cartLine(0, 'lurou', 1, 10)];
    const q = quoteOf([qline(0, 'lurou', { unitPrice: 15, lineTotal: 15 })], [], { total: 115 });
    expect(derive(q, cart, { total: 100, discount: 0 }).map((i) => i.code)).toEqual([
      'PRICE_UPDATED',
    ]);
  });

  it('重複的 check（相同 code 與落點）只列一項；同一行只產生一個價格更新', () => {
    const cart = [cartLine(0, 'lurou', 1, 10)];
    const q = quoteOf(
      [qline(0, 'lurou', { unitPrice: 15 })],
      [
        check('SLOT_UNAVAILABLE', { field: 'scheduledAt' }),
        check('SLOT_UNAVAILABLE', { field: 'scheduledAt' }),
      ],
    );
    const codes = derive(q, cart).map((i) => i.code);
    expect(codes.filter((c) => c === 'SLOT_UNAVAILABLE')).toHaveLength(1);
    expect(codes.filter((c) => c === 'PRICE_UPDATED')).toHaveLength(1);
  });

  it('性質：issues 依類別順序排列、blockingCount 只計阻擋項、每個品項行至多一項', () => {
    const KIND_RANK = { UNAVAILABLE: 0, QUANTITY: 1, SLOT: 2, CONDITION: 3, PRICE: 4 } as const;
    const issueArb = fc.constantFrom<QuotedLine['issue'] | undefined>(
      undefined,
      'ITEM_UNLISTED',
      'ITEM_SOLD_OUT',
      'ITEM_STOCK_INSUFFICIENT',
      'OPTION_INVALID',
      'OPTION_UNAVAILABLE',
      'QUANTITY_EXCEEDED',
    );
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            issue: issueArb,
            price: fc.integer({ min: 5, max: 20 }),
            qty: fc.integer({ min: 1, max: 5 }),
          }),
          {
            minLength: 1,
            maxLength: 6,
          },
        ),
        fc.array(
          fc.constantFrom(
            'SLOT_UNAVAILABLE',
            'MIN_ORDER_NOT_MET',
            'COUPON_EXPIRED',
            'STORE_CLOSED',
            'SERVICE_NOT_AVAILABLE',
          ),
          { maxLength: 4 },
        ),
        (rows, checkCodes) => {
          const cart = rows.map((_, i) => cartLine(i, `p${i}`, 1, 10));
          const items = rows.map((r, i) =>
            qline(i, `p${i}`, {
              unitPrice: r.price,
              quantity: r.qty,
              availableQuantity: r.issue === undefined ? r.qty : 0,
              available: r.issue === undefined,
              ...(r.issue !== undefined ? { issue: r.issue } : {}),
            }),
          );
          const checks = [
            ...items
              .filter((x) => x.issue)
              .map((x) => check(x.issue as ErrorCode, { field: 'items', lineIndex: x.index })),
            ...checkCodes.map((c) => check(c)),
          ];
          const { issues } = deriveFull(quoteOf(items, checks), cart);
          const ranks = issues.map((i) => KIND_RANK[i.kind]);
          expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
          expect(blockingCount(issues)).toBe(issues.filter((i) => i.blocking).length);
          const perLine = new Map<number, number>();
          for (const i of issues) {
            if (i.lineIndex !== undefined && i.kind !== 'PRICE')
              perLine.set(i.lineIndex, (perLine.get(i.lineIndex) ?? 0) + 1);
          }
          for (const n of perLine.values()) expect(n).toBe(1);
        },
      ),
    );
  });
});

describe('blockingCount / hasNothingToBuy', () => {
  it('blockingCount 只計阻擋項', () => {
    const issues = [
      { kind: 'UNAVAILABLE', code: 'ITEM_SOLD_OUT', blocking: true },
      { kind: 'PRICE', code: 'PRICE_UPDATED', blocking: false },
      { kind: 'SLOT', code: 'SLOT_UNAVAILABLE', blocking: true },
    ] as CheckoutIssue[];
    expect(blockingCount(issues)).toBe(2);
    expect(blockingCount([])).toBe(0);
  });

  it('EC-37：全部不可購買 → EmptyState；空購物車與部分可購買不是', () => {
    const none = quoteOf([
      qline(0, 'a', { availableQuantity: 0 }),
      qline(1, 'b', { availableQuantity: 0 }),
    ]);
    expect(hasNothingToBuy(none)).toBe(true);
    expect(hasNothingToBuy(quoteOf([qline(0, 'a', { availableQuantity: 0 }), qline(1, 'b')]))).toBe(
      false,
    );
    expect(hasNothingToBuy(quoteOf([]))).toBe(false);
  });
});

// ═════════ 送出決策（O-12 價格兩步、O-17 排入佇列、BR-27） ═════════
describe('decideSubmit', () => {
  const ctx = (o: Partial<SubmitContext> = {}): SubmitContext => ({
    submitting: false,
    coolingDown: false,
    storePaused: false,
    repricing: false,
    priceDiffShown: false,
    ...o,
  });
  const blockingIssue = {
    kind: 'UNAVAILABLE',
    code: 'ITEM_SOLD_OUT',
    blocking: true,
  } as CheckoutIssue;
  const priceIssue = { kind: 'PRICE', code: 'PRICE_UPDATED', blocking: false } as CheckoutIssue;

  it('送出中與暫停接單不動作；重新計價中排入佇列', () => {
    expect(decideSubmit([], 100, 100, ctx({ submitting: true }))).toEqual({ type: 'NOOP' });
    expect(decideSubmit([], 100, 100, ctx({ storePaused: true }))).toEqual({ type: 'NOOP' });
    expect(decideSubmit([], 100, 100, ctx({ repricing: true }))).toEqual({ type: 'QUEUE' });
    expect(decideSubmit([blockingIssue], 100, 100, ctx({ submitting: true }))).toEqual({
      type: 'NOOP',
    });
  });

  it('R-AB(1) / FLOW-19：冷卻中不動作（Ctrl/⌘ + Enter 與點擊相同）；冷卻優先於排入佇列；冷卻結束才可送出', () => {
    expect(decideSubmit([], 100, 100, ctx({ coolingDown: true }))).toEqual({ type: 'NOOP' });
    expect(decideSubmit([blockingIssue], 100, 100, ctx({ coolingDown: true }))).toEqual({
      type: 'NOOP',
    });
    expect(decideSubmit([priceIssue], 380, 420, ctx({ coolingDown: true }))).toEqual({
      type: 'NOOP',
    });
    expect(decideSubmit([], 100, 100, ctx({ coolingDown: true, repricing: true }))).toEqual({
      type: 'NOOP',
    });
    expect(decideSubmit([], 100, 100, ctx({ coolingDown: false }))).toEqual({ type: 'SEND' });
  });

  it('有阻擋項 → 聚焦清單、不送出；重新計價中優先於鎖定（FLOW-19 同序）', () => {
    expect(decideSubmit([blockingIssue, priceIssue], 100, 90, ctx())).toEqual({
      type: 'FOCUS_LIST',
      blockingCount: 1,
    });
    expect(decideSubmit([blockingIssue], 100, 100, ctx({ repricing: true }))).toEqual({
      type: 'QUEUE',
    });
    expect(
      decideSubmit([blockingIssue], 100, 100, ctx({ submitting: true, repricing: true })),
    ).toEqual({ type: 'NOOP' });
    expect(decideSubmit([blockingIssue, blockingIssue], 100, 100, ctx())).toEqual({
      type: 'FOCUS_LIST',
      blockingCount: 2,
    });
  });

  it('O-12：總額增加 → 第一次只展開差異，差異展示後第二次才送出', () => {
    expect(decideSubmit([priceIssue], 380, 420, ctx())).toEqual({ type: 'REVEAL_PRICE_DIFF' });
    expect(decideSubmit([priceIssue], 380, 420, ctx({ priceDiffShown: true }))).toEqual({
      type: 'SEND',
    });
  });

  it('O-12：僅降價或價格不變可一鍵送出', () => {
    expect(decideSubmit([priceIssue], 420, 380, ctx())).toEqual({ type: 'SEND' });
    expect(decideSubmit([], 100, 100, ctx())).toEqual({ type: 'SEND' });
  });

  it('阻擋項優先於價格差異展示', () => {
    expect(decideSubmit([blockingIssue], 380, 420, ctx())).toEqual({
      type: 'FOCUS_LIST',
      blockingCount: 1,
    });
  });
});

// ═════════ 屬性：隨機序列驗證不變式 I1～I6（07 §13；固定 seed 回歸 + 200 組） ═════════
describe('庫存與時段的不變式（I1～I6）', () => {
  it('隨機 create / cancel / 快轉 / quote / 付款序列下不超賣、不超收、釋放單調、重放與 quote 不改計數、剩餘非負', () => {
    const LIMIT = 5;
    const MAX_SLOT = 3;
    interface SimOrder {
      qty: number;
      slot: string | null;
      status: OrderStatus;
      paymentExpiresAtMs: number | null;
    }
    const opArb = fc.record({
      op: fc.integer({ min: 0, max: 6 }),
      pick: fc.nat(),
      qty: fc.integer({ min: 1, max: 4 }),
      slot: fc.option(fc.constantFrom('s0', 's1', 's2'), { nil: null }),
      online: fc.boolean(),
      key: fc.integer({ min: 0, max: 11 }),
      minutes: fc.integer({ min: 0, max: 19 }),
    });
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 80 }), (ops) => {
        let now = NOW;
        const orders: SimOrder[] = [];
        const keys = new Map<string, SimOrder>();
        const counted = (o: SimOrder): boolean =>
          countsTowardStock({ status: o.status, paymentExpiresAtMs: o.paymentExpiresAtMs }, now);
        const sold = (): number => orders.filter(counted).reduce((s, o) => s + o.qty, 0);
        const booked = (slot: string): number =>
          orders.filter((o) => o.slot === slot && counted(o)).length;
        const remaining = (): number | null => remainingOf(LIMIT, sold());
        const oneLine = (qty: number) => [
          { index: 0, productId: 'p', quantity: qty, optionsValid: true },
        ];
        const factsOf = (): Map<ID, ProductFacts> =>
          new Map([['p', { listed: true, manualSoldOut: false, remaining: remaining() }]]);

        for (const o of ops) {
          const before = sold();
          if (o.op === 6) {
            // quote：只讀不扣，前後 db 深度相等（I5；含已逾期尚未結算的待付款單，只以 predicate 排除、不寫入）
            const snapshot = JSON.stringify(orders);
            allocateByProduct(oneLine(o.qty), factsOf());
            expect(JSON.stringify(orders)).toBe(snapshot);
            continue;
          }
          if (o.op <= 2) {
            const key = `k${o.key}`;
            if (keys.has(key)) {
              expect(sold()).toBe(before); // I4：同 Key 重放不改計數
              continue;
            }
            const alloc = allocateByProduct(oneLine(o.qty), factsOf());
            const fits = alloc[0]?.availableQuantity === o.qty;
            const slotOk = o.slot === null || slotHasCapacity(MAX_SLOT, booked(o.slot));
            if (fits && slotOk) {
              const order: SimOrder = {
                qty: o.qty,
                slot: o.slot,
                status: o.online ? 'PENDING_PAYMENT' : 'PENDING',
                paymentExpiresAtMs: o.online ? now + 15 * MIN : null,
              };
              orders.push(order);
              keys.set(key, order);
              expect(sold()).toBeGreaterThanOrEqual(before);
            } else {
              expect(sold()).toBe(before); // 全有或全無：被拒不改變計數
            }
          } else if (o.op === 3 && orders.length > 0) {
            const order = orders[o.pick % orders.length] as SimOrder;
            if (order.status === 'PENDING_PAYMENT' || order.status === 'PENDING') {
              order.status = 'CANCELLED';
              expect(sold()).toBeLessThanOrEqual(before); // I3
            }
          } else if (o.op === 4) {
            now += o.minutes * MIN;
            expect(sold()).toBeLessThanOrEqual(before); // I3：到期釋放只減不增
          } else if (o.op === 5 && orders.length > 0) {
            const order = orders[o.pick % orders.length] as SimOrder;
            if (order.status === 'PENDING_PAYMENT' && (order.paymentExpiresAtMs as number) > now) {
              order.status = 'PENDING';
              order.paymentExpiresAtMs = null;
            }
            expect(sold()).toBe(before); // 付款成功不改變計入集合
          }
          expect(sold()).toBeLessThanOrEqual(LIMIT); // I1
          for (const s of ['s0', 's1', 's2']) expect(booked(s)).toBeLessThanOrEqual(MAX_SLOT); // I2
          expect(remainingOf(LIMIT, sold())).toBeGreaterThanOrEqual(0); // I6
        }
      }),
      { numRuns: 200 },
    );
  });
});
