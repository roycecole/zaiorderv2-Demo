// orders.quote：單一 evaluateOrder（BR-39）；金額以「可成立內容」計（06 §5.8）
import { afterEach, describe, expect, it } from 'vitest';
import { COMBO, LUROU, TEA, createReq, line, newKey, quoteReq, rejection, setup } from './harness';
import type { Harness } from './harness';

let h: Harness;
afterEach(() => h.cleanup());

const BEEF = (qty = 2) => line('prd_beef_noodle', qty, ['opt_noodle_thin', 'opt_spice_none']);

describe('計價與必要欄位', () => {
  it('UAT-01：滷肉飯（大碗・滷蛋）+ 紅茶 = $92', async () => {
    h = setup();
    const q = await h.client.orders.quote(quoteReq([LUROU(), TEA()]));
    expect(q).toMatchObject({ valid: true, subtotal: 92, deliveryFee: 0, discount: 0, total: 92 });
    expect(q.items[0]).toMatchObject({
      index: 0, productId: 'prd_lurou', name: '招牌滷肉飯', optionLabels: ['大碗', '滷蛋'],
      unitPrice: 67, quantity: 1, lineTotal: 67, available: true, availableQuantity: 1, remaining: null,
    });
    expect(q.items[0]?.imageUrl).toBe('/images/products/lurou.svg');
    expect(q.checks).toEqual([]);
    expect(q.estimatedReadyAt).toBe('2026-10-14T12:15:00+08:00');
  });

  it('UAT-02：外送大安區、免運 + LUNCH10（百分比受上限約束）= $380', async () => {
    h = setup();
    const q = await h.client.orders.quote(
      quoteReq([BEEF(2), line('prd_danzai', 1)], { orderType: 'DELIVERY', zipCode: '106', couponCode: 'LUNCH10' }),
    );
    expect(q).toMatchObject({ subtotal: 420, deliveryFee: 0, discount: 40, total: 380, valid: true });
    expect(q.coupon).toEqual({
      code: 'LUNCH10', name: '午餐 9 折', discountType: 'PERCENT', applied: true,
    });
    // 外送預估 = 配送區 35 分
    expect(q.estimatedReadyAt).toBe('2026-10-14T12:35:00+08:00');
  });

  it('外送未達免運門檻：運費 $30；折扣碼大小寫與空白不影響', async () => {
    h = setup();
    const q = await h.client.orders.quote(
      quoteReq([BEEF(1), line('prd_danzai', 1)], { orderType: 'DELIVERY', zipCode: '106', couponCode: ' lunch10 ' }),
    );
    // 240 → 運費 30；10% = 24；total = 240 + 30 − 24 = 246
    expect(q).toMatchObject({ subtotal: 240, deliveryFee: 30, discount: 24, total: 246 });
  });

  it('未達外送最低消費：valid=false、仍計算 total（06 §5.8 範例）', async () => {
    h = setup();
    const q = await h.client.orders.quote(
      quoteReq([line('prd_chicken_rice', 1, ['opt_bowl_l']), line('prd_lurou', 1, ['opt_bowl_l'])], {
        orderType: 'DELIVERY',
        zipCode: '106',
      }),
    );
    expect(q).toMatchObject({ valid: false, subtotal: 120, deliveryFee: 30, total: 150, minOrderShortfall: 30 });
    expect(q.checks).toEqual([
      { code: 'MIN_ORDER_NOT_MET', severity: 'ERROR', message: '還差 $30 可外送', field: 'items' },
    ]);
  });

  it('超出外送範圍：OUT_OF_DELIVERY_AREA，運費 0', async () => {
    h = setup();
    const q = await h.client.orders.quote(quoteReq([BEEF(2)], { orderType: 'DELIVERY', zipCode: '220' }));
    expect(q.valid).toBe(false);
    expect(q.checks[0]).toMatchObject({ code: 'OUT_OF_DELIVERY_AREA', field: 'delivery.zipCode' });
    expect(q.deliveryFee).toBe(0);
  });

  it('不論業務結果，quote 永不回 4xx；格式錯誤才 400', async () => {
    h = setup({ demo: { storeOverride: 'PAUSED', soldOutProductIds: ['prd_black_tea'] } });
    const q = await h.client.orders.quote(quoteReq([TEA()]));
    expect(q.valid).toBe(false);
    const bad = await rejection(h.client.orders.quote(quoteReq([line('prd_lurou', 0)])));
    expect(bad.status).toBe(400);
    expect(bad.code).toBe('VALIDATION_FAILED');
    const empty = await rejection(h.client.orders.quote(quoteReq([])));
    expect(empty.status).toBe(400);
  });
});

describe('店家狀態與取餐方式', () => {
  it('暫停接單：STORE_PAUSED（含預約單）', async () => {
    h = setup({ demo: { storeOverride: 'PAUSED' } });
    const q = await h.client.orders.quote(
      quoteReq([LUROU()], { scheduledAt: '2026-10-14T17:00:00+08:00' }),
    );
    expect(q.checks.map((c) => c.code)).toContain('STORE_PAUSED');
  });

  it('休息中：即時單 STORE_CLOSED、預約單可成立（UAT-03）', async () => {
    h = setup({ now: Date.parse('2026-10-14T14:30:00+08:00') });
    const asap = await h.client.orders.quote(quoteReq([LUROU()]));
    expect(asap.checks.map((c) => c.code)).toEqual(['STORE_CLOSED']);
    expect(asap.checks[0]?.message).toBe('目前休息中，可預約 17:00 後取餐');
    const scheduled = await h.client.orders.quote(
      quoteReq([LUROU()], { scheduledAt: '2026-10-14T17:00:00+08:00' }),
    );
    expect(scheduled.valid).toBe(true);
  });

  it('預約時段不在產生的時段內、額滿 → SLOT_UNAVAILABLE', async () => {
    h = setup();
    const past = await h.client.orders.quote(
      quoteReq([LUROU()], { scheduledAt: '2026-10-14T12:05:00+08:00' }),
    );
    expect(past.checks[0]).toMatchObject({ code: 'SLOT_UNAVAILABLE', field: 'scheduledAt' });
    await h.client.demo.fillSlot('2026-10-14T12:30:00+08:00', 0);
    const full = await h.client.orders.quote(
      quoteReq([LUROU()], { scheduledAt: '2026-10-14T12:30:00+08:00' }),
    );
    expect(full.checks[0]).toMatchObject({
      code: 'SLOT_UNAVAILABLE', message: '12:30 這個時段已額滿', field: 'scheduledAt',
    });
  });

  it('外送「盡快」來不及打烊 → SLOT_UNAVAILABLE', async () => {
    h = setup({ now: Date.parse('2026-10-14T13:30:00+08:00') });
    const q = await h.client.orders.quote(quoteReq([BEEF(2)], { orderType: 'DELIVERY', zipCode: '106' }));
    expect(q.checks.map((c) => c.code)).toContain('SLOT_UNAVAILABLE');
  });
});

describe('售完、限量與同商品多行（BR-11、BR-40）', () => {
  it('手動售完：行 availableQuantity = 0，金額以可成立內容計', async () => {
    h = setup({ demo: { soldOutProductIds: ['prd_black_tea'] } });
    const q = await h.client.orders.quote(quoteReq([LUROU(), TEA()]));
    expect(q.valid).toBe(false);
    expect(q.items[1]).toMatchObject({
      available: false, availableQuantity: 0, lineTotal: 0, issue: 'ITEM_SOLD_OUT', remaining: null,
    });
    expect(q).toMatchObject({ subtotal: 67, total: 67 });
    expect(q.checks).toEqual([
      { code: 'ITEM_SOLD_OUT', severity: 'ERROR', message: '古早味紅茶已售完', field: 'items', lineIndex: 1 },
    ]);
  });

  it('全部不可購買：各金額皆為 0，且不回報最低消費', async () => {
    h = setup({ demo: { soldOutProductIds: ['prd_black_tea', 'prd_kong_rou'] } });
    const q = await h.client.orders.quote(
      quoteReq([TEA(), line('prd_kong_rou', 1)], { orderType: 'DELIVERY', zipCode: '106' }),
    );
    expect(q).toMatchObject({ subtotal: 0, deliveryFee: 0, discount: 0, total: 0, valid: false });
    expect(q.checks.map((c) => c.code)).toEqual(['ITEM_SOLD_OUT', 'ITEM_SOLD_OUT']);
  });

  it('數量不足（06 §5.8）：剩 2 要 3 → availableQuantity 2、total 為調整後金額', async () => {
    h = setup();
    h.client.demo.setRemaining('prd_combo_share', 2);
    const q = await h.client.orders.quote(quoteReq([COMBO(3), TEA()]));
    expect(q.items[0]).toMatchObject({
      available: false, availableQuantity: 2, lineTotal: 598, remaining: 2, issue: 'ITEM_STOCK_INSUFFICIENT',
    });
    expect(q).toMatchObject({ subtotal: 623, total: 623, valid: false });
    expect(q.checks[0]).toMatchObject({
      code: 'ITEM_STOCK_INSUFFICIENT', message: '雙人分享餐只剩 2 份', lineIndex: 0,
    });
  });

  it('同商品多行依請求順序配置：剩 3、A×4、B×2 → A = 3、B = 0（不是售完）', async () => {
    h = setup();
    h.client.demo.setRemaining('prd_combo_share', 3);
    const a = { ...COMBO(4), note: 'A' };
    const b = { ...COMBO(2), note: 'B' };
    const q = await h.client.orders.quote(quoteReq([a, b]));
    expect(q.items.map((i) => [i.availableQuantity, i.issue, i.remaining])).toEqual([
      [3, 'ITEM_STOCK_INSUFFICIENT', 3],
      [0, 'ITEM_STOCK_INSUFFICIENT', 3],
    ]);
  });

  it('剩 3、A×2、B×2 → A = 2、B = 1；剩 0 → 兩行皆 ITEM_SOLD_OUT', async () => {
    h = setup();
    h.client.demo.setRemaining('prd_combo_share', 3);
    const a = { ...COMBO(2), note: 'A' };
    const b = { ...COMBO(2), note: 'B' };
    const q = await h.client.orders.quote(quoteReq([a, b]));
    expect(q.items.map((i) => i.availableQuantity)).toEqual([2, 1]);
    h.client.demo.setRemaining('prd_combo_share', 0);
    const none = await h.client.orders.quote(quoteReq([a, b]));
    expect(none.items.map((i) => i.issue)).toEqual(['ITEM_SOLD_OUT', 'ITEM_SOLD_OUT']);
  });

  it('待付款訂單暫時占用份數；逾期後 quote 以條件排除（不寫入）', async () => {
    h = setup();
    const cartTotal = 299 * 5;
    await h.client.orders.create(
      createReq([COMBO(5)], cartTotal, { paymentMethod: 'LINE_PAY' }),
      newKey(),
    );
    let q = await h.client.orders.quote(quoteReq([COMBO(1)]));
    expect(q.items[0]).toMatchObject({ availableQuantity: 0, issue: 'ITEM_SOLD_OUT', remaining: 0 });
    h.advance(15 * 60_000); // 付款期限當下即不計入（半開區間）
    const before = h.storage.getItem('zaiorder:v1:db');
    q = await h.client.orders.quote(quoteReq([COMBO(1)]));
    expect(q.valid).toBe(true);
    expect(h.storage.getItem('zaiorder:v1:db')).toBe(before); // 唯讀：不結算、不寫入
  });

  it('單行數量超過 20：QUANTITY_EXCEEDED，availableQuantity = 20', async () => {
    h = setup();
    const q = await h.client.orders.quote(quoteReq([line('prd_danzai', 25)]));
    expect(q.items[0]).toMatchObject({
      availableQuantity: 20, lineTotal: 1200, issue: 'QUANTITY_EXCEEDED', available: false,
    });
    expect(q.checks[0]).toMatchObject({ code: 'QUANTITY_EXCEEDED', lineIndex: 0 });
  });

  it('品項行數超過 30：整單 QUANTITY_EXCEEDED（無 lineIndex）', async () => {
    h = setup();
    const items = Array.from({ length: 31 }, () => line('prd_danzai', 1));
    const q = await h.client.orders.quote(quoteReq(items));
    const whole = q.checks.find((c) => c.lineIndex === undefined);
    expect(whole).toMatchObject({ code: 'QUANTITY_EXCEEDED', field: 'items' });
  });

  it('下架或不存在的商品：ITEM_UNLISTED', async () => {
    h = setup();
    const q = await h.client.orders.quote(quoteReq([line('prd_ghost', 1)]));
    expect(q.items[0]).toMatchObject({ issue: 'ITEM_UNLISTED', availableQuantity: 0, lineTotal: 0 });
    expect(q.items[0]?.remaining).toBeUndefined();
  });

  it('預約隔日：今日手動售完旗標與今日已售完的限量都不影響明日（BR-40、EC-38）', async () => {
    h = setup({ demo: { soldOutProductIds: ['prd_black_tea'] } });
    await h.client.orders.create(createReq([COMBO(5)], 299 * 5), newKey()); // 今日限量用盡
    const today = await h.client.orders.quote(quoteReq([TEA(), COMBO(1)]));
    expect(today.items.map((i) => i.issue)).toEqual(['ITEM_SOLD_OUT', 'ITEM_SOLD_OUT']);
    const tomorrow = '2026-10-15T11:00:00+08:00';
    const q = await h.client.orders.quote(quoteReq([TEA(), COMBO(1)], { scheduledAt: tomorrow }));
    expect(q.valid).toBe(true);
    expect(q.items.map((i) => i.availableQuantity)).toEqual([1, 1]);
    expect(q.items[1]?.remaining).toBe(5);
  });
});

describe('選項驗證（BR-12）', () => {
  it('必選群組沒選、選項不屬於商品、超過上限 → OPTION_INVALID，該行不參與配置', async () => {
    h = setup();
    const missing = await h.client.orders.quote(quoteReq([line('prd_lurou', 1, ['opt_egg'])]));
    expect(missing.items[0]).toMatchObject({ issue: 'OPTION_INVALID', availableQuantity: 0 });
    const foreign = await h.client.orders.quote(quoteReq([line('prd_lurou', 1, ['opt_bowl_s', 'opt_cup_m'])]));
    expect(foreign.items[0]?.issue).toBe('OPTION_INVALID');
    const tooMany = await h.client.orders.quote(
      quoteReq([line('prd_lurou', 1, ['opt_bowl_s', 'opt_egg', 'opt_tofu_dry', 'opt_fried_egg', 'opt_extra_meat'])]),
    );
    expect(tooMany.items[0]?.issue).toBe('OPTION_INVALID');
  });

  it('多選必選 2–2（雙人分享餐）：選 1 個 → OPTION_INVALID', async () => {
    h = setup();
    const q = await h.client.orders.quote(
      quoteReq([line('prd_combo_share', 1, ['opt_sm_lurou', 'opt_ss_oyster', 'opt_sd_greens'])]),
    );
    expect(q.items[0]?.issue).toBe('OPTION_INVALID');
  });

  it('單價 = 基本價 + 選項加價；選項標籤依群組順序', async () => {
    h = setup();
    const q = await h.client.orders.quote(
      quoteReq([line('prd_bubble_tea', 1, ['opt_top_pearl', 'opt_cup_l', 'opt_ice_none', 'opt_sugar_none'])]),
    );
    expect(q.items[0]).toMatchObject({
      unitPrice: 55 + 10 + 10,
      optionLabels: ['大杯', '無糖', '去冰', '珍珠'],
    });
  });

  it('MINIMAL 目錄視圖：選項群組為空、單價為 basePrice；庫存事實仍取原始值（07 §6.7）', async () => {
    h = setup({ demo: { menuProfile: 'MINIMAL' } });
    h.client.demo.setRemaining('prd_combo_share', 2);
    const q = await h.client.orders.quote(quoteReq([line('prd_lurou', 1), line('prd_combo_share', 3)]));
    expect(q.items[0]).toMatchObject({ unitPrice: 35, available: true });
    // 限量檢查沒有因 remainingToday 被刪除而失效
    expect(q.items[1]).toMatchObject({ availableQuantity: 2, issue: 'ITEM_STOCK_INSUFFICIENT', unitPrice: 299 });
  });
});

describe('折扣碼（FLOW-07、BR-20）', () => {
  const lunch = [LUROU(), line('prd_chicken_rice', 2, ['opt_bowl_l'])]; // 67 + 130 = 197

  it('COUPON_NOT_FOUND / EXPIRED / USED_UP', async () => {
    h = setup();
    const codeOf = async (code: string) =>
      (await h.client.orders.quote(quoteReq(lunch, { couponCode: code }))).checks[0]?.code;
    expect(await codeOf('HELLO1234')).toBe('COUPON_NOT_FOUND');
    expect(await codeOf('OLD2025')).toBe('COUPON_EXPIRED');
    expect(await codeOf('USEDUP')).toBe('COUPON_USED_UP');
  });

  it('WELCOME50 小計滿 $250：不足 → COUPON_MIN_NOT_MET（還差 $53）', async () => {
    h = setup();
    const q = await h.client.orders.quote(quoteReq(lunch, { couponCode: 'WELCOME50' }));
    expect(q.checks[0]).toMatchObject({
      code: 'COUPON_MIN_NOT_MET', message: '還差 $53 可使用', field: 'couponCode',
    });
    expect(q.coupon).toMatchObject({ code: 'WELCOME50', applied: false });
    expect(q.discount).toBe(0);
    const enough = await h.client.orders.quote(
      quoteReq([...lunch, line('prd_danzai', 1)], { couponCode: 'WELCOME50' }),
    );
    expect(enough).toMatchObject({ subtotal: 257, discount: 50, total: 207 });
  });

  it('FREESHIP 僅外送：自取 → COUPON_NOT_APPLICABLE；外送且已免運 → 折抵 $0', async () => {
    h = setup();
    const pickup = await h.client.orders.quote(quoteReq([BEEF(2)], { couponCode: 'FREESHIP' }));
    expect(pickup.checks[0]?.code).toBe('COUPON_NOT_APPLICABLE');
    const delivery = await h.client.orders.quote(
      quoteReq([BEEF(2), line('prd_danzai', 1)], { orderType: 'DELIVERY', zipCode: '106', couponCode: 'FREESHIP' }),
    );
    expect(delivery).toMatchObject({ valid: true, deliveryFee: 0, discount: 0, total: 420 });
    expect(delivery.coupon?.applied).toBe(true);
  });

  it('FREESHIP 於未達免運門檻的外送：折抵運費', async () => {
    h = setup();
    const q = await h.client.orders.quote(
      quoteReq([line('prd_beef_noodle', 1, ['opt_noodle_thin', 'opt_spice_none']), line('prd_danzai', 2)], {
        orderType: 'DELIVERY', zipCode: '106', couponCode: 'FREESHIP',
      }),
    );
    // 小計 300、滿 $300 → 折抵運費 $30（未達 $400 免運門檻）
    expect(q).toMatchObject({ subtotal: 300, deliveryFee: 30, discount: 30, total: 300, valid: true });
  });

  it('MEMBER20 僅會員：訪客 LOGIN_REQUIRED（ERROR）；登入後可用', async () => {
    h = setup();
    const guest = await h.client.orders.quote(quoteReq(lunch, { couponCode: 'MEMBER20' }));
    expect(guest.valid).toBe(false);
    expect(guest.checks[0]).toMatchObject({ code: 'LOGIN_REQUIRED', severity: 'ERROR', field: 'couponCode' });
    await h.client.demo.loginAsDemoUser();
    const member = await h.client.orders.quote(quoteReq(lunch, { couponCode: 'MEMBER20' }));
    expect(member).toMatchObject({ valid: true, discount: 20, total: 177 });
  });

  it('個人上限：WELCOME50 每人 1 次（以訂單聯絡手機計）→ 第二次 COUPON_USED_UP', async () => {
    h = setup();
    const items = [COMBO(1)]; // 299
    const first = await h.client.orders.create(
      createReq(items, 249, { couponCode: 'WELCOME50' }),
      newKey(),
    );
    expect(first.order.amounts).toMatchObject({ discount: 50, total: 249 });
    expect(first.order.couponCode).toBe('WELCOME50');
    const err = await rejection(
      h.client.orders.create(createReq(items, 249, { couponCode: 'WELCOME50' }), newKey()),
    );
    expect(err.code).toBe('COUPON_USED_UP');
    expect(err.status).toBe(422);
  });

  it('總量用盡後取消會返還（BR-29）', async () => {
    h = setup();
    const items = [COMBO(1)];
    const first = await h.client.orders.create(
      createReq(items, 249, { couponCode: 'WELCOME50' }),
      newKey(),
    );
    const token = first.trackingToken;
    await h.client.orders.cancel(first.order.id, '改變心意', { trackingToken: token ?? '' });
    const again = await h.client.orders.create(
      createReq(items, 249, { couponCode: 'WELCOME50' }),
      newKey(),
    );
    expect(again.order.amounts.discount).toBe(50);
  });
});
