// BR-02、BR-03、BR-05、BR-06 與 UAT-01 / UAT-02、06 §5.8 的計價算例
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { calcDeliveryFee, calcDiscount, calcTotal, lineTotal, unitPrice } from '../pricing';
import type { DiscountRule } from '../pricing';

const zone106 = { deliveryFee: 30, freeDeliveryThreshold: 400 };
const lunch10: DiscountRule = { discountType: 'PERCENT', discountValue: 10, maxDiscountAmount: 40 };

describe('unitPrice / lineTotal（BR-02）', () => {
  it('PD-03：(35 + 20 + 12) × 2 = 134', () => {
    expect(unitPrice({ basePrice: 35, optionDeltas: [20, 12] })).toBe(67);
    expect(lineTotal({ basePrice: 35, optionDeltas: [20, 12], quantity: 2 })).toBe(134);
  });

  it('無選項時單價等於基本價', () => {
    expect(unitPrice({ basePrice: 25, optionDeltas: [] })).toBe(25);
    expect(unitPrice({ basePrice: 25, optionDeltas: [0, 0, 0] })).toBe(25);
  });

  it('選項加價可為負；合計為負時單價夾在 0（不得小於 0）', () => {
    expect(unitPrice({ basePrice: 100, optionDeltas: [-30, 10] })).toBe(80);
    expect(unitPrice({ basePrice: 10, optionDeltas: [-30] })).toBe(0);
    expect(lineTotal({ basePrice: 10, optionDeltas: [-30], quantity: 5 })).toBe(0);
  });

  it('UAT-01：滷肉飯（大碗 + 滷蛋）$67 + 紅茶 $25 = $92，自取無運費', () => {
    const subtotal =
      lineTotal({ basePrice: 35, optionDeltas: [20, 12], quantity: 1 }) +
      lineTotal({ basePrice: 25, optionDeltas: [0, 0, 0], quantity: 1 });
    expect(subtotal).toBe(92);
    const fee = calcDeliveryFee('PICKUP', subtotal, zone106);
    expect(fee).toBe(0);
    expect(calcTotal(subtotal, fee, 0)).toBe(92);
  });
});

describe('calcDeliveryFee（BR-03）', () => {
  it('免運門檻邊界：399 付運費、400 免運（以折扣前小計判斷）', () => {
    expect(calcDeliveryFee('DELIVERY', 399, zone106)).toBe(30);
    expect(calcDeliveryFee('DELIVERY', 400, zone106)).toBe(0);
    expect(calcDeliveryFee('DELIVERY', 401, zone106)).toBe(0);
  });

  it('06 §5.8：小計 120 未達門檻 → 運費 30、總計 150', () => {
    const fee = calcDeliveryFee('DELIVERY', 120, zone106);
    expect(fee).toBe(30);
    expect(calcTotal(120, fee, 0)).toBe(150);
  });

  it('無免運門檻（null）永遠收運費', () => {
    expect(
      calcDeliveryFee('DELIVERY', 9999, { deliveryFee: 30, freeDeliveryThreshold: null }),
    ).toBe(30);
  });

  it('僅外送收運費：自取、內用一律 0；沒有配送區（null）亦為 0', () => {
    expect(calcDeliveryFee('PICKUP', 100, zone106)).toBe(0);
    expect(calcDeliveryFee('DINE_IN', 100, zone106)).toBe(0);
    expect(calcDeliveryFee('DELIVERY', 100, null)).toBe(0);
  });

  it('門檻為 0 代表任何小計皆免運', () => {
    expect(calcDeliveryFee('DELIVERY', 0, { deliveryFee: 30, freeDeliveryThreshold: 0 })).toBe(0);
  });
});

describe('calcDiscount（BR-05）', () => {
  it('UAT-02：外送小計 $420 → 運費 0、LUNCH10 −$40、總計 $380', () => {
    const fee = calcDeliveryFee('DELIVERY', 420, zone106);
    const discount = calcDiscount(lunch10, 420, fee);
    expect(fee).toBe(0);
    expect(discount).toBe(40);
    expect(calcTotal(420, fee, discount)).toBe(380);
  });

  it('06 §5.8：小計 494 → floor(49.4) = 49，受上限 40 約束、總計 454', () => {
    expect(calcDiscount(lunch10, 494, 0)).toBe(40);
    expect(calcTotal(494, 0, 40)).toBe(454);
  });

  it('百分比無條件捨去：155 × 10% = 15.5 → 15（無上限）', () => {
    const rule: DiscountRule = {
      discountType: 'PERCENT',
      discountValue: 10,
      maxDiscountAmount: null,
    };
    expect(calcDiscount(rule, 155, 0)).toBe(15);
    expect(calcDiscount({ discountType: 'PERCENT', discountValue: 10 }, 155, 0)).toBe(15);
    expect(calcDiscount(rule, 9, 0)).toBe(0); // floor(0.9)
  });

  it('百分比未達上限時取計算值：小計 150 × 10% = 15 < 40', () => {
    expect(calcDiscount(lunch10, 150, 0)).toBe(15);
  });

  it('固定金額不超過小計', () => {
    const rule: DiscountRule = { discountType: 'FIXED_AMOUNT', discountValue: 50 };
    expect(calcDiscount(rule, 250, 0)).toBe(50);
    expect(calcDiscount(rule, 30, 0)).toBe(30);
  });

  it('免運折抵等於運費（不論小計）；沒有運費時為 0', () => {
    const rule: DiscountRule = { discountType: 'FREE_DELIVERY', discountValue: 0 };
    expect(calcDiscount(rule, 300, 30)).toBe(30);
    expect(calcDiscount(rule, 300, 0)).toBe(0);
  });

  it('沒有折扣規則為 0', () => {
    expect(calcDiscount(null, 300, 30)).toBe(0);
  });
});

describe('calcTotal（BR-06）', () => {
  it('total = subtotal + deliveryFee − discount', () => {
    expect(calcTotal(100, 30, 20)).toBe(110);
  });

  it('折扣大於應付時總額不為負', () => {
    expect(calcTotal(10, 0, 50)).toBe(0);
    expect(calcTotal(0, 0, 0)).toBe(0);
  });
});

describe('性質測試', () => {
  const money = fc.integer({ min: 0, max: 100_000 });
  const delta = fc.integer({ min: -500, max: 500 });

  it('unitPrice：永不為負、等於 max(0, 基本價 + 加價合計)、與選項順序無關', () => {
    fc.assert(
      fc.property(money, fc.array(delta, { maxLength: 8 }), (basePrice, optionDeltas) => {
        const u = unitPrice({ basePrice, optionDeltas });
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBe(Math.max(0, basePrice + optionDeltas.reduce((a, b) => a + b, 0)));
        expect(unitPrice({ basePrice, optionDeltas: [...optionDeltas].reverse() })).toBe(u);
      }),
    );
  });

  it('lineTotal = unitPrice × quantity，且對數量單調不減', () => {
    fc.assert(
      fc.property(
        money,
        fc.array(delta, { maxLength: 5 }),
        fc.integer({ min: 1, max: 20 }),
        (basePrice, optionDeltas, quantity) => {
          const line = { basePrice, optionDeltas, quantity };
          expect(lineTotal(line)).toBe(unitPrice(line) * quantity);
          expect(lineTotal({ ...line, quantity: quantity + 1 })).toBeGreaterThanOrEqual(
            lineTotal(line),
          );
        },
      ),
    );
  });

  const zoneArb = fc.record({
    deliveryFee: fc.integer({ min: 0, max: 200 }),
    freeDeliveryThreshold: fc.option(fc.integer({ min: 0, max: 2000 }), { nil: null }),
  });

  it('calcDeliveryFee：只會是 0 或配送區運費；非外送恆為 0；小計越高運費不增', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('PICKUP', 'DELIVERY', 'DINE_IN' as const),
        money,
        fc.integer({ min: 0, max: 5000 }),
        zoneArb,
        (orderType, subtotal, extra, zone) => {
          const fee = calcDeliveryFee(orderType, subtotal, zone);
          expect([0, zone.deliveryFee]).toContain(fee);
          if (orderType !== 'DELIVERY') expect(fee).toBe(0);
          expect(calcDeliveryFee(orderType, subtotal + extra, zone)).toBeLessThanOrEqual(fee);
        },
      ),
    );
  });

  const ruleArb: fc.Arbitrary<DiscountRule> = fc.oneof(
    fc.record({
      discountType: fc.constant('PERCENT' as const),
      discountValue: fc.integer({ min: 0, max: 100 }),
      maxDiscountAmount: fc.option(fc.integer({ min: 0, max: 500 }), { nil: null }),
    }),
    fc.record({
      discountType: fc.constant('FIXED_AMOUNT' as const),
      discountValue: fc.integer({ min: 0, max: 1000 }),
    }),
  );

  it('calcDiscount：百分比與固定金額的折抵介於 0 與小計之間，且遵守上限', () => {
    fc.assert(
      fc.property(ruleArb, money, (rule, subtotal) => {
        const d = calcDiscount(rule, subtotal, 30);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(subtotal);
        expect(Number.isInteger(d)).toBe(true);
        if (rule.discountType === 'PERCENT' && rule.maxDiscountAmount != null) {
          expect(d).toBeLessThanOrEqual(rule.maxDiscountAmount);
        }
        if (rule.discountType === 'FIXED_AMOUNT') {
          expect(d).toBe(Math.min(rule.discountValue, subtotal));
        }
      }),
    );
  });

  it('calcDiscount：免運折抵恆等於運費', () => {
    fc.assert(
      fc.property(money, fc.integer({ min: 0, max: 200 }), (subtotal, fee) => {
        expect(
          calcDiscount({ discountType: 'FREE_DELIVERY', discountValue: 0 }, subtotal, fee),
        ).toBe(fee);
      }),
    );
  });

  it('端到端：total 非負，且折扣不會讓總額低於運費（折扣 ≤ 小計）', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('PICKUP', 'DELIVERY', 'DINE_IN' as const),
        money,
        fc.option(zoneArb, { nil: null }),
        fc.option(ruleArb, { nil: null }),
        (orderType, subtotal, zone, rule) => {
          const fee = calcDeliveryFee(orderType, subtotal, zone);
          const discount = calcDiscount(rule, subtotal, fee);
          const total = calcTotal(subtotal, fee, discount);
          expect(total).toBeGreaterThanOrEqual(0);
          expect(total).toBe(subtotal + fee - discount);
          expect(total).toBeGreaterThanOrEqual(fee);
        },
      ),
    );
  });
});
