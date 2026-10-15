// orders.create：FLOW-22 管線（冪等 → 結算逾期 → 驗證 → PRICE_CHANGED → 計入）、失敗注入與預備情境
import { afterEach, describe, expect, it } from 'vitest';
import { COMBO, LUROU, TEA, createReq, line, newKey, quoteReq, rejection, setup } from './harness';
import type { CreateOrderRequest } from '@/domain/types';
import type { Harness } from './harness';

let h: Harness;
afterEach(() => h.cleanup());

const stock = (id = 'prd_combo_share') => h.client.demo.getStock(id);

describe('成功建單', () => {
  it('UAT-01：現金自取 → PENDING、A001、$92、acceptBy = 建單 + 10 分、nextAction = TRACK', async () => {
    h = setup();
    const res = await h.client.orders.create(
      createReq([line('prd_lurou', 1, ['opt_bowl_l', 'opt_egg'], '不要蔥'), TEA()], 92, { note: '麻煩分開裝' }),
      newKey(),
    );
    expect(res.nextAction).toBe('TRACK');
    expect(res.replayed).toBeUndefined();
    expect(res.trackingToken).toMatch(/^trk_[0-9a-f]{16}$/);
    const o = res.order;
    expect(o).toMatchObject({
      orderType: 'PICKUP', status: 'PENDING', pickupNo: 'A001', businessDate: '2026-10-14',
      scheduledAt: null, estimatedReadyAt: '2026-10-14T12:15:00+08:00', acceptBy: '2026-10-14T12:10:00+08:00',
      customer: { name: '王小明', phone: '0912345678' }, note: '麻煩分開裝', needUtensils: false,
      amounts: { subtotal: 92, deliveryFee: 0, discount: 0, total: 92 },
      payment: { method: 'CASH', status: 'UNPAID', expiresAt: null },
      invoice: { type: 'PAPER', status: 'PENDING' },
      permissions: { canCancel: true, canPay: false, canReorder: true, canReview: false },
      placedAt: '2026-10-14T12:00:00+08:00',
    });
    expect(o.orderNo).toMatch(/^ZO261014[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(o.items).toHaveLength(2);
    expect(o.items[0]).toMatchObject({
      productId: 'prd_lurou', name: '招牌滷肉飯', quantity: 1, unitPrice: 67, lineTotal: 67, note: '不要蔥',
      options: [
        { groupName: '份量', name: '大碗', priceDelta: 20 },
        { groupName: '加料', name: '滷蛋', priceDelta: 12 },
      ],
    });
    expect(o.timeline).toEqual([{ status: 'PENDING', at: '2026-10-14T12:00:00+08:00', by: 'CUSTOMER' }]);
    expect(o.payment.latest).toMatchObject({ method: 'CASH', status: 'PENDING', amount: 92 });
  });

  it('線上付款：PENDING_PAYMENT、付款期限 15 分鐘、nextAction = PAY、不建立線上交易', async () => {
    h = setup();
    const res = await h.client.orders.create(createReq([LUROU()], 67, { paymentMethod: 'LINE_PAY' }), newKey());
    expect(res.nextAction).toBe('PAY');
    expect(res.order).toMatchObject({
      status: 'PENDING_PAYMENT',
      payment: { method: 'LINE_PAY', status: 'UNPAID', expiresAt: '2026-10-14T12:15:00+08:00' },
      permissions: { canCancel: true, canPay: true },
    });
    expect(res.order.acceptBy).toBeUndefined();
    expect(res.order.payment.latest).toBeUndefined();
  });

  it('取餐號碼前綴：外送 D、內用 T（桌號快照）', async () => {
    h = setup();
    const d = await h.client.orders.create(
      createReq([line('prd_beef_noodle', 2, ['opt_noodle_thin', 'opt_spice_none']), line('prd_danzai', 1)], 420, {
        orderType: 'DELIVERY',
        delivery: { city: '臺北市', district: '大安區', zipCode: '106', line: '示範路 5 號 3 樓', note: '請按電鈴' },
      }),
      newKey(),
    );
    expect(d.order.pickupNo).toBe('D001');
    expect(d.order.delivery).toEqual({
      city: '臺北市', district: '大安區', zipCode: '106', line: '示範路 5 號 3 樓', note: '請按電鈴',
    });
    // 外送預估 35 分、接單期限 = 建單 + 10 分
    expect(d.order.estimatedReadyAt).toBe('2026-10-14T12:35:00+08:00');

    const t = await h.client.orders.create(
      createReq([TEA()], 25, { orderType: 'DINE_IN', dineIn: { tableNo: 'A3' }, contact: {} }),
      newKey(),
    );
    expect(t.order.pickupNo).toBe('T001');
    expect(t.order.table).toEqual({ tableNo: 'A3' });
    expect(t.order.customer).toBeUndefined();
  });

  it('內用可以沒有桌號：不帶 dineIn 也成立，order.table 省略、取餐號碼仍為 T 前綴、table_no 為 null', async () => {
    h = setup();
    const res = await h.client.orders.create(
      createReq([TEA()], 25, { orderType: 'DINE_IN', contact: {} }),
      newKey(),
    );
    expect(res.order).toMatchObject({ orderType: 'DINE_IN', status: 'PENDING', pickupNo: 'T001' });
    expect(res.order.table).toBeUndefined();
    expect('table' in res.order).toBe(false);
    expect(res.order.delivery).toBeUndefined();
    const db = JSON.parse(h.storage.getItem('zaiorder:v1:db') ?? '{}') as {
      orders: Array<{ id: string; table_no: string | null; order_type: string }>;
    };
    const row = db.orders.find((o) => o.id === res.order.id);
    expect(row).toMatchObject({ order_type: 'DINE_IN', table_no: null });
    // 以追蹤權杖再讀一次（訪客訂單頁的路徑）也沒有桌號
    const again = await h.client.orders.get(res.order.id, { trackingToken: res.trackingToken ?? '' });
    expect('table' in again).toBe(false);
  });

  it('dineIn 為空物件 / tableNo 與 qrToken 為空字串或全空白：視同未提供，不檢查、不報錯', async () => {
    h = setup();
    for (const dineIn of [{}, { tableNo: '' }, { tableNo: '   ' }, { tableNo: '', qrToken: '  ' }]) {
      const res = await h.client.orders.create(
        createReq([TEA()], 25, { orderType: 'DINE_IN', dineIn, contact: {} }),
        newKey(),
      );
      expect(res.order.orderType).toBe('DINE_IN');
      expect(res.order.table).toBeUndefined();
    }
  });

  it('內用有提供桌號：手動桌號不分大小寫、QR 權杖優先，快照為店家桌號', async () => {
    h = setup();
    const manual = await h.client.orders.create(
      createReq([TEA()], 25, { orderType: 'DINE_IN', dineIn: { tableNo: ' a2 ' }, contact: {} }),
      newKey(),
    );
    expect(manual.order.table).toEqual({ tableNo: 'A2' });
    const qr = await h.client.orders.create(
      createReq([TEA()], 25, {
        orderType: 'DINE_IN',
        dineIn: { tableNo: 'A2', qrToken: 'a4' },
        contact: {},
      }),
      newKey(),
    );
    expect(qr.order.table).toEqual({ tableNo: 'A4' });
    const tokenOnly = await h.client.orders.create(
      createReq([TEA()], 25, { orderType: 'DINE_IN', dineIn: { qrToken: 'A5' }, contact: {} }),
      newKey(),
    );
    expect(tokenOnly.order.table).toEqual({ tableNo: 'A5' });
  });

  it('同一營業日的取餐號碼遞增；他人訂單 X 前綴不影響 A', async () => {
    h = setup();
    await h.client.demo.injectOtherOrder({ productId: 'prd_combo_share', quantity: 1 });
    const a = await h.client.orders.create(createReq([TEA()], 25), newKey());
    const b = await h.client.orders.create(createReq([TEA()], 25), newKey());
    expect([a.order.pickupNo, b.order.pickupNo]).toEqual(['A001', 'A002']);
  });

  it('庫存-25：今日下的隔日預約單取得明日序號，不佔用今日序號；明日第一張即時單為 A002', async () => {
    h = setup();
    const tomorrow = await h.client.orders.create(
      createReq([TEA()], 25, { scheduledAt: '2026-10-15T11:00:00+08:00' }),
      newKey(),
    );
    expect(tomorrow.order).toMatchObject({ pickupNo: 'A001', businessDate: '2026-10-15' });
    const today = await h.client.orders.create(createReq([TEA()], 25), newKey());
    expect(today.order).toMatchObject({ pickupNo: 'A001', businessDate: '2026-10-14' });
    h.advance(24 * 3_600_000);
    const next = await h.client.orders.create(createReq([TEA()], 25), newKey());
    expect(next.order).toMatchObject({ pickupNo: 'A002', businessDate: '2026-10-15' });
  });

  it('預約單：scheduledAt 為估計完成時間；接單期限 = max(建單 + 10 分, 預約 − 前置 15 分)（BR-17）', async () => {
    h = setup({ now: Date.parse('2026-10-14T14:30:00+08:00') });
    const res = await h.client.orders.create(
      createReq([LUROU()], 67, { scheduledAt: '2026-10-14T17:00:00+08:00' }),
      newKey(),
    );
    expect(res.order).toMatchObject({
      status: 'PENDING', scheduledAt: '2026-10-14T17:00:00+08:00',
      estimatedReadyAt: '2026-10-14T17:00:00+08:00', acceptBy: '2026-10-14T16:45:00+08:00',
    });
  });

  it('外送預約單的前置分鐘取配送區預估：大安區 35 → 預約 18:00 的接單期限為 17:25', async () => {
    h = setup({ now: Date.parse('2026-10-14T14:30:00+08:00') });
    const res = await h.client.orders.create(
      createReq([line('prd_beef_noodle', 2, ['opt_noodle_thin', 'opt_spice_none']), line('prd_danzai', 1)], 420, {
        orderType: 'DELIVERY',
        scheduledAt: '2026-10-14T18:00:00+08:00',
        delivery: { city: '臺北市', district: '大安區', zipCode: '106', line: '示範路 5 號 3 樓' },
      }),
      newKey(),
    );
    expect(res.order.acceptBy).toBe('2026-10-14T17:25:00+08:00');
  });

  it('計入限量：create ×2 後剩餘少 2（庫存-2）；現金保留至接單', async () => {
    h = setup();
    await h.client.orders.create(createReq([COMBO(1)], 299), newKey());
    await h.client.orders.create(createReq([COMBO(1)], 299), newKey());
    expect(stock()).toMatchObject({ dailyLimit: 5, sold: 2, held: 0, remaining: 3 });
    const menu = await h.client.store.getMenu();
    const combo = menu.categories.flatMap((c) => c.products).find((p) => p.id === 'prd_combo_share');
    expect(combo?.remainingToday).toBe(3);
  });

  it('會員訂單：不回傳 trackingToken，user_id 綁定；訪客訂單才有權杖', async () => {
    h = setup();
    await h.client.demo.loginAsDemoUser();
    const res = await h.client.orders.create(createReq([TEA()], 25), newKey());
    expect(res.trackingToken).toBeUndefined();
    const got = await h.client.orders.get(res.order.id);
    expect(got.id).toBe(res.order.id);
  });
});

describe('422 / 409 與 error.quote（FLOW-22）', () => {
  it('庫存-4：售完 → 422 ITEM_SOLD_OUT，error.quote 與 quote 回應逐欄一致、不建單', async () => {
    h = setup({ demo: { soldOutProductIds: ['prd_black_tea'] } });
    const req = createReq([LUROU(), TEA()], 92);
    const err = await rejection(h.client.orders.create(req, newKey()));
    expect(err.status).toBe(422);
    expect(err.code).toBe('ITEM_SOLD_OUT');
    const quote = await h.client.orders.quote(quoteReq(req.items));
    expect(err.body?.quote).toEqual(quote);
    expect(err.body?.details).toEqual([
      { field: 'items', code: 'ITEM_SOLD_OUT', message: '古早味紅茶已售完' },
    ]);
    expect(err.body?.message).toBe('古早味紅茶已售完');
    // 不建單、不綁定 Key：下一張仍是 A001
    h.client.demo.setState({ soldOutProductIds: [] });
    const ok = await h.client.orders.create(createReq([LUROU(), TEA()], 92), newKey());
    expect(ok.order.pickupNo).toBe('A001');
  });

  it('庫存-7：一次回報三項異動，頂層為優先序最高者；庫存先於價格', async () => {
    h = setup({ demo: { soldOutProductIds: ['prd_black_tea'], priceOverrides: { prd_lurou: 40 } } });
    h.client.demo.setRemaining('prd_combo_share', 2);
    await h.client.demo.fillSlot('2026-10-14T12:30:00+08:00', 0);
    const err = await rejection(
      h.client.orders.create(
        createReq([LUROU(), TEA(), COMBO(3)], 989, { scheduledAt: '2026-10-14T12:30:00+08:00' }),
        newKey(),
      ),
    );
    expect(err.status).toBe(422);
    expect(err.code).toBe('ITEM_SOLD_OUT');
    const codes = err.body?.quote?.checks.map((c) => c.code);
    expect(codes).toEqual(['ITEM_SOLD_OUT', 'ITEM_STOCK_INSUFFICIENT', 'SLOT_UNAVAILABLE']);
    expect(err.body?.message).toBe(
      '有 3 項需要調整：古早味紅茶已售完、雙人分享餐只剩 2 份、12:30 這個時段已額滿',
    );
    // 金額以可成立內容計：滷肉飯已調價（35+40−... 大碗 +20、滷蛋 +12 = 72）+ 雙人分享餐 ×2
    expect(err.body?.quote?.total).toBe(72 + 598);
  });

  it('庫存-5：數量不足 422；改為可購買份數後以同一把 Key 重送即成立（庫存-15）', async () => {
    h = setup();
    h.client.demo.setRemaining('prd_combo_share', 2);
    const key = newKey();
    const err = await rejection(h.client.orders.create(createReq([COMBO(3)], 897), key));
    expect(err.code).toBe('ITEM_STOCK_INSUFFICIENT');
    expect(err.body?.quote?.items[0]).toMatchObject({ availableQuantity: 2, remaining: 2 });
    const ok = await h.client.orders.create(createReq([COMBO(2)], 598), key);
    expect(ok.replayed).toBeUndefined();
    expect(ok.order.amounts.total).toBe(598);
    expect(stock()).toMatchObject({ remaining: 0 });
  });

  it('庫存-9：全有或全無 — 任一行失敗，其餘行不計入、優惠券不消耗、取餐號碼不變', async () => {
    h = setup({ demo: { soldOutProductIds: ['prd_black_tea'] } });
    await rejection(
      h.client.orders.create(createReq([COMBO(1), TEA()], 274, { couponCode: 'WELCOME50' }), newKey()),
    );
    expect(stock()).toMatchObject({ sold: 0, remaining: 5 });
    // WELCOME50 每人限用 1 次：先前被拒的送出沒有消耗它
    const ok = await h.client.orders.create(
      createReq([COMBO(1)], 249, { couponCode: 'WELCOME50' }),
      newKey(),
    );
    expect(ok.order).toMatchObject({ pickupNo: 'A001', couponCode: 'WELCOME50' });
    expect(ok.order.amounts.discount).toBe(50);
  });

  it('PRICE_CHANGED：無任何業務錯誤時才回 409，並附最新報價（UAT-08）', async () => {
    h = setup({ demo: { priceOverrides: { prd_lurou: 40 } } });
    const err = await rejection(h.client.orders.create(createReq([LUROU(), TEA()], 92), newKey()));
    expect(err.status).toBe(409);
    expect(err.code).toBe('PRICE_CHANGED');
    expect(err.message).toBe('部分商品價格已更新，請確認後再送出');
    expect(err.body?.quote).toMatchObject({ valid: true, total: 97, checks: [] });
    expect(err.body?.quote?.items[0]?.unitPrice).toBe(72);
    expect(err.body?.details).toBeUndefined();
  });

  it('付款方式、發票與桌號只在 create 檢查（出現在 error.quote）', async () => {
    h = setup();
    const inv = await rejection(
      h.client.orders.create(
        createReq([TEA()], 25, { invoice: { type: 'COMPANY', taxId: '04595258' } }),
        newKey(),
      ),
    );
    expect(inv.code).toBe('INVOICE_INVALID');
    expect(inv.body?.quote?.checks[0]).toMatchObject({ field: 'invoice.taxId' });
    const okInv = await h.client.orders.create(
      createReq([TEA()], 25, { invoice: { type: 'COMPANY', taxId: '04595257', buyerName: '示範公司' } }),
      newKey(),
    );
    expect(okInv.order.invoice).toMatchObject({ type: 'COMPANY', taxId: '04595257', buyerName: '示範公司' });

    const table = await rejection(
      h.client.orders.create(
        createReq([TEA()], 25, { orderType: 'DINE_IN', dineIn: { tableNo: 'Z9' }, contact: {} }),
        newKey(),
      ),
    );
    expect(table.code).toBe('TABLE_NOT_FOUND');
  });

  it('內用有提供桌號但無效 → 422 TABLE_NOT_FOUND（落點 dineIn.tableNo）；格式不符（VR-10）、停用桌位、無效權杖同', async () => {
    h = setup();
    const tryTable = async (dineIn: NonNullable<CreateOrderRequest['dineIn']>) => {
      const err = await rejection(
        h.client.orders.create(
          createReq([TEA()], 25, { orderType: 'DINE_IN', dineIn, contact: {} }),
          newKey(),
        ),
      );
      expect(err.status).toBe(422);
      expect(err.code).toBe('TABLE_NOT_FOUND');
      expect(err.body?.quote?.checks).toEqual([
        expect.objectContaining({ code: 'TABLE_NOT_FOUND', field: 'dineIn.tableNo' }),
      ]);
      expect(err.body?.details?.map((d) => d.field)).toEqual(['dineIn.tableNo']);
    };
    await tryTable({ tableNo: 'Z9' });
    await tryTable({ tableNo: 'A-3' });
    await tryTable({ tableNo: 'A'.repeat(11) });
    await tryTable({ qrToken: 'NOPE' });
    await tryTable({ tableNo: 'A3', qrToken: 'NOPE' }); // 權杖優先，無效就是無效
    // 被拒絕的請求沒有建單
    const db = JSON.parse(h.storage.getItem('zaiorder:v1:db') ?? '{}') as {
      orders: Array<{ order_type: string; user_id: string | null }>;
    };
    expect(db.orders.filter((o) => o.order_type === 'DINE_IN')).toHaveLength(0);
  });

  it('錯誤碼優先序不變（06 §3.2）：庫存 > 桌號；其他條件都通過時才輪到桌號', async () => {
    h = setup({ demo: { soldOutProductIds: ['prd_black_tea'] } });
    const err = await rejection(
      h.client.orders.create(
        createReq([TEA()], 25, { orderType: 'DINE_IN', dineIn: { tableNo: 'Z9' }, contact: {} }),
        newKey(),
      ),
    );
    expect(err.code).toBe('ITEM_SOLD_OUT');
    expect(err.body?.quote?.checks.map((c) => c.code)).toEqual(['ITEM_SOLD_OUT', 'TABLE_NOT_FOUND']);
    // 同樣情境、沒有桌號：只有庫存錯誤，沒有桌號相關檢查
    const none = await rejection(
      h.client.orders.create(createReq([TEA()], 25, { orderType: 'DINE_IN', contact: {} }), newKey()),
    );
    expect(none.code).toBe('ITEM_SOLD_OUT');
    expect(none.body?.quote?.checks.map((c) => c.code)).toEqual(['ITEM_SOLD_OUT']);
  });

  it('dineIn 型別不正確 → 400（不因缺桌號而 400）', async () => {
    h = setup();
    const bad = await rejection(
      h.client.orders.create(
        createReq([TEA()], 25, {
          orderType: 'DINE_IN',
          dineIn: { tableNo: 3 as unknown as string },
          contact: {},
        }),
        newKey(),
      ),
    );
    expect(bad.status).toBe(400);
    expect(bad.body?.details?.map((d) => d.field)).toEqual(['dineIn.tableNo']);
    // 內用不帶 dineIn 與聯絡資訊：格式驗證通過
    const ok = await h.client.orders.create(
      createReq([TEA()], 25, { orderType: 'DINE_IN', contact: {} }),
      newKey(),
    );
    expect(ok.order.pickupNo).toBe('T001');
  });

  it('格式錯誤 → 400（欄位 details）；Idempotency-Key 缺少或格式不符', async () => {
    h = setup();
    const err = await rejection(
      h.client.orders.create(createReq([TEA()], 25, { contact: { name: '', phone: '123' } }), newKey()),
    );
    expect(err.status).toBe(400);
    expect(err.body?.details?.map((d) => d.field)).toEqual(['contact.name', 'contact.phone']);
    const noKey = await rejection(h.client.orders.create(createReq([TEA()], 25), ''));
    expect(noKey.status).toBe(400);
    const noAddr = await rejection(
      h.client.orders.create(createReq([TEA()], 25, { orderType: 'DELIVERY' }), newKey()),
    );
    expect(noAddr.body?.details?.[0]?.field).toBe('delivery');
  });

  it('暫停接單 / 休息中即時單 → 422（STORE_PAUSED / STORE_CLOSED）；休息中預約單可成立', async () => {
    h = setup({ demo: { storeOverride: 'PAUSED' } });
    expect((await rejection(h.client.orders.create(createReq([TEA()], 25), newKey()))).code).toBe(
      'STORE_PAUSED',
    );
    h.client.demo.setState({ storeOverride: 'AUTO' });
    h.setNow(Date.parse('2026-10-14T14:30:00+08:00'));
    expect((await rejection(h.client.orders.create(createReq([TEA()], 25), newKey()))).code).toBe(
      'STORE_CLOSED',
    );
    const ok = await h.client.orders.create(
      createReq([TEA()], 25, { scheduledAt: '2026-10-14T17:00:00+08:00' }),
      newKey(),
    );
    expect(ok.order.status).toBe('PENDING');
  });
});

describe('冪等（BR-27、庫存-12～14）', () => {
  it('同 Key 同內容 → 重放：同一訂單、replayed = true、重新簽發權杖並使舊權杖失效、庫存只扣一次', async () => {
    h = setup();
    const key = newKey();
    const first = await h.client.orders.create(createReq([COMBO(1)], 299), key);
    const again = await h.client.orders.create(createReq([COMBO(1)], 299), key);
    expect(again.replayed).toBe(true);
    expect(again.order.id).toBe(first.order.id);
    expect(again.trackingToken).toBeDefined();
    expect(again.trackingToken).not.toBe(first.trackingToken);
    expect(stock()).toMatchObject({ sold: 1, remaining: 4 });

    const stale = await rejection(
      h.client.orders.get(first.order.id, { trackingToken: first.trackingToken ?? '' }),
    );
    expect(stale.status).toBe(404);
    const fresh = await h.client.orders.get(first.order.id, { trackingToken: again.trackingToken ?? '' });
    expect(fresh.id).toBe(first.order.id);
  });

  it('只有 expectedTotal 不同 → 仍是重放而非衝突；重放不重驗（建單後才售完仍回原訂單）', async () => {
    h = setup();
    const key = newKey();
    const first = await h.client.orders.create(createReq([TEA()], 25), key);
    h.client.demo.setState({ soldOutProductIds: ['prd_black_tea'], priceOverrides: { prd_black_tea: 30 } });
    const again = await h.client.orders.create(createReq([TEA()], 999), key);
    expect(again.replayed).toBe(true);
    expect(again.order.id).toBe(first.order.id);
  });

  it('庫存-14：同 Key 不同內容 → 409 IDEMPOTENCY_CONFLICT（不附 error.quote）', async () => {
    h = setup();
    const key = newKey();
    await h.client.orders.create(createReq([TEA()], 25), key);
    const err = await rejection(h.client.orders.create(createReq([TEA(2)], 50), key));
    expect(err.status).toBe(409);
    expect(err.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(err.body?.quote).toBeUndefined();
  });

  it('庫存-13：原訂單已因付款逾時取消 → 重放回 CANCELLED 與 nextAction = TRACK', async () => {
    h = setup();
    const key = newKey();
    const first = await h.client.orders.create(
      createReq([COMBO(1)], 299, { paymentMethod: 'JKOPAY' }),
      key,
    );
    expect(first.nextAction).toBe('PAY');
    h.advance(15 * 60_000);
    const again = await h.client.orders.create(
      createReq([COMBO(1)], 299, { paymentMethod: 'JKOPAY' }),
      key,
    );
    expect(again.replayed).toBe(true);
    expect(again.nextAction).toBe('TRACK');
    expect(again.order).toMatchObject({
      status: 'CANCELLED',
      cancellation: { by: 'SYSTEM', reason: '付款逾時' },
      permissions: { canCancel: false, canPay: false, canReorder: true },
      estimatedReadyAt: null,
    });
  });

  it('庫存-12：同 Key 並行 ×5 → 只建立 1 筆，其餘 replayed', async () => {
    h = setup();
    const key = newKey();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => h.client.orders.create(createReq([COMBO(1)], 299), key)),
    );
    expect(new Set(results.map((r) => r.order.id)).size).toBe(1);
    expect(results.filter((r) => r.replayed === true)).toHaveLength(4);
    expect(stock()).toMatchObject({ sold: 1, remaining: 4 });
  });

  it('庫存-10：20 個不同 Key 同時搶最後 1 份 → 恰 1 筆成功，其餘 ITEM_SOLD_OUT', async () => {
    h = setup();
    h.client.demo.setRemaining('prd_combo_share', 1);
    const settled = await Promise.allSettled(
      Array.from({ length: 20 }, () => h.client.orders.create(createReq([COMBO(1)], 299), newKey())),
    );
    const ok = settled.filter((r) => r.status === 'fulfilled');
    const failed = settled.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(19);
    for (const f of failed) {
      expect((f as PromiseRejectedResult).reason).toMatchObject({ status: 422, code: 'ITEM_SOLD_OUT' });
    }
    expect(stock()).toMatchObject({ remaining: 0 });
  });

  it('庫存-11：最後 1 個時段名額並行 → 恰 1 筆成功，其餘 SLOT_UNAVAILABLE', async () => {
    h = setup();
    const startAt = '2026-10-14T12:30:00+08:00';
    await h.client.demo.fillSlot(startAt, 1);
    const settled = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        h.client.orders.create(createReq([TEA()], 25, { scheduledAt: startAt }), newKey()),
      ),
    );
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.every((r) => (r.reason as { code: string }).code === 'SLOT_UNAVAILABLE')).toBe(true);
  });

  it('即時單不計入時段容量（Q-11）', async () => {
    h = setup();
    await h.client.demo.fillSlot('2026-10-14T12:30:00+08:00', 0);
    const ok = await h.client.orders.create(createReq([TEA()], 25), newKey());
    expect(ok.order.scheduledAt).toBeNull();
  });
});

describe('失敗注入（failNext，FR-DM-13）', () => {
  it("phase = 'BEFORE'：503 不附 retryAfterSeconds、未建立、不消耗預備情境；同 Key 重送成功", async () => {
    h = setup();
    h.client.demo.armRace({ buy: [{ productId: 'prd_combo_share', quantity: 2 }] });
    h.client.demo.setState({ failNext: { target: 'orders.create', remaining: 1 } });
    const key = newKey();
    const err = await rejection(h.client.orders.create(createReq([TEA()], 25), key));
    expect(err.status).toBe(503);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
    expect(err.body?.retryAfterSeconds).toBeUndefined();
    expect(h.client.demo.getState().failNext).toBeNull();
    expect(h.client.demo.getState().raceOnNextCreate).not.toBeNull(); // 未被消耗
    expect(stock()).toMatchObject({ sold: 0 });
    expect(h.client.demo.getCreateLog(1)[0]).toMatchObject({ outcome: 'FAILED_BEFORE', idempotencyKey: key });

    const ok = await h.client.orders.create(createReq([TEA()], 25), key);
    expect(ok.order.pickupNo).toBe('A001');
    expect(h.client.demo.getState().raceOnNextCreate).toBeNull(); // 此次才消耗
  });

  it("phase = 'AFTER_COMMIT'：訂單已建立、回應遺失（status 0）；同 Key 重送取回原訂單，庫存只扣一次", async () => {
    h = setup();
    h.client.demo.setState({ failNext: { target: 'orders.create', remaining: 1, phase: 'AFTER_COMMIT' } });
    const key = newKey();
    const err = await rejection(h.client.orders.create(createReq([COMBO(1)], 299), key));
    expect(err.status).toBe(0);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
    expect(stock()).toMatchObject({ sold: 1, remaining: 4 });

    const again = await h.client.orders.create(createReq([COMBO(1)], 299), key);
    expect(again.replayed).toBe(true);
    expect(again.order.pickupNo).toBe('A001');
    expect(stock()).toMatchObject({ sold: 1 });
    // 最新在前：重送取回原訂單、回應遺失（訂單已建立，不另記 CREATED）
    expect(h.client.demo.getCreateLog(5).map((e) => e.outcome)).toEqual(['REPLAYED', 'RESPONSE_LOST']);
  });

  it('次數：remaining = 2 連續失敗兩次後恢復；省略階段為 BEFORE', async () => {
    h = setup();
    h.client.demo.setState({ failNext: { target: 'orders.create', remaining: 2 } });
    await rejection(h.client.orders.create(createReq([TEA()], 25), newKey()));
    expect(h.client.demo.getState().failNext?.remaining).toBe(1);
    await rejection(h.client.orders.create(createReq([TEA()], 25), newKey()));
    expect(h.client.demo.getState().failNext).toBeNull();
    await h.client.orders.create(createReq([TEA()], 25), newKey());
  });

  it("target = 'any' 只消耗使用者觸發的請求：getStatus / orders.get 輪詢不消耗，create 才消耗", async () => {
    h = setup();
    const o = await h.client.orders.create(createReq([TEA()], 25), newKey());
    h.client.demo.setState({ failNext: { target: 'any', remaining: 1 } });
    await h.client.store.getStatus();
    await h.client.orders.get(o.order.id, { trackingToken: o.trackingToken ?? '' });
    expect(h.client.demo.getState().failNext?.remaining).toBe(1);
    await rejection(h.client.orders.create(createReq([TEA()], 25), newKey()));
    expect(h.client.demo.getState().failNext).toBeNull();
  });

  it('指定端點：store.getMenu 連續失敗；orders.quote 失敗', async () => {
    h = setup();
    h.client.demo.setState({ failNext: { target: 'store.getMenu', remaining: 3 } });
    for (let i = 0; i < 3; i++) {
      expect((await rejection(h.client.store.getMenu())).status).toBe(503);
    }
    await h.client.store.getMenu();
    h.client.demo.setState({ failNext: { target: 'orders.quote', remaining: 1 } });
    expect((await rejection(h.client.orders.quote(quoteReq([TEA()])))).status).toBe(503);
  });
});

describe('預備情境（raceOnNextCreate，FR-DM-12）', () => {
  it('UAT-21：進入結帳時 quote 仍可購買，送出才變售完 → 422；售完旗標寫入 DemoState 並保留', async () => {
    h = setup();
    const req = createReq([LUROU(), TEA()], 92);
    expect((await h.client.orders.quote(quoteReq(req.items))).valid).toBe(true);
    h.client.demo.armRace({ soldOutProductIds: ['prd_black_tea'] });
    // 預備不影響試算
    expect((await h.client.orders.quote(quoteReq(req.items))).valid).toBe(true);

    const err = await rejection(h.client.orders.create(req, newKey()));
    expect(err.code).toBe('ITEM_SOLD_OUT');
    expect(h.client.demo.getState().raceOnNextCreate).toBeNull(); // 一次性
    expect(h.client.demo.getState().soldOutProductIds).toContain('prd_black_tea');
    expect((await h.client.orders.quote(quoteReq(req.items))).valid).toBe(false);
    expect(h.client.demo.getCreateLog(1)[0]).toMatchObject({
      outcome: 'REJECTED', code: 'ITEM_SOLD_OUT', summary: '古早味紅茶今日售完',
    });
  });

  it('UAT-22 變體：他人買走 3 份（剩 5 → 剩 2），購物車 ×3 送出才被退回；他人訂單同步寫回', async () => {
    h = setup();
    h.client.demo.armRace({ buy: [{ productId: 'prd_combo_share', quantity: 3 }] });
    const err = await rejection(h.client.orders.create(createReq([COMBO(3)], 897), newKey()));
    expect(err.code).toBe('ITEM_STOCK_INSUFFICIENT');
    expect(err.body?.quote?.items[0]).toMatchObject({ availableQuantity: 2, remaining: 2 });
    expect(stock()).toMatchObject({ sold: 3, remaining: 2 });
    expect(h.client.demo.getCreateLog(1)[0]?.summary).toBe('雙人分享餐今日只剩 2 份');
    // 改為 2 份後重送（同一把 Key 概念；此處用新 Key）
    const ok = await h.client.orders.create(createReq([COMBO(2)], 598), newKey());
    expect(ok.order.amounts.total).toBe(598);
  });

  it('買走的份數夾在剩餘內，不造成超賣', async () => {
    h = setup();
    h.client.demo.armRace({ buy: [{ productId: 'prd_combo_share', quantity: 99 }] });
    await rejection(h.client.orders.create(createReq([COMBO(1)], 299), newKey()));
    expect(stock()).toMatchObject({ sold: 5, remaining: 0 });
  });

  it('UAT-23：時段補滿（leave = 0）→ 送出 SLOT_UNAVAILABLE；leave = 1 → 仍可成立並佔用最後一個名額', async () => {
    h = setup();
    const t = '2026-10-14T12:30:00+08:00';
    h.client.demo.armRace({ fillSlots: [{ startAt: t, leave: 0 }] });
    const err = await rejection(
      h.client.orders.create(createReq([TEA()], 25, { scheduledAt: t }), newKey()),
    );
    expect(err.code).toBe('SLOT_UNAVAILABLE');
    expect(err.body?.details?.[0]).toMatchObject({ field: 'scheduledAt', message: '12:30 這個時段已額滿' });

    const t2 = '2026-10-14T12:45:00+08:00';
    h.client.demo.armRace({ fillSlots: [{ startAt: t2, leave: 1 }] });
    const ok = await h.client.orders.create(createReq([TEA()], 25, { scheduledAt: t2 }), newKey());
    expect(ok.order.scheduledAt).toBe(t2);
    const again = await rejection(
      h.client.orders.create(createReq([TEA()], 25, { scheduledAt: t2 }), newKey()),
    );
    expect(again.code).toBe('SLOT_UNAVAILABLE');
  });

  it('重放不消耗預備情境', async () => {
    h = setup();
    const key = newKey();
    await h.client.orders.create(createReq([TEA()], 25), key);
    h.client.demo.armRace({ soldOutProductIds: ['prd_lurou'] });
    const again = await h.client.orders.create(createReq([TEA()], 25), key);
    expect(again.replayed).toBe(true);
    expect(h.client.demo.getState().raceOnNextCreate).not.toBeNull();
    h.client.demo.disarmRace();
    expect(h.client.demo.getState().raceOnNextCreate).toBeNull();
  });
});
