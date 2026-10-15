// 訂單生命週期：模擬器（惰性推進）、逾時結算、取消與退款、付款、查詢與列表（FLOW-10、11、12、14）
import { afterEach, describe, expect, it } from 'vitest';
import { COMBO, LUROU, TEA, createReq, line, newKey, rejection, setup } from './harness';
import type { Harness } from './harness';

let h: Harness;
afterEach(() => h.cleanup());

const SEC = 1000;
const MIN = 60_000;

/** 建立現金自取單，回傳訂單與存取選項 */
async function cashOrder(over: Parameters<typeof createReq>[2] = {}, items = [TEA()], total = 25) {
  const res = await h.client.orders.create(createReq(items, total, over), newKey());
  return { id: res.order.id, opts: { trackingToken: res.trackingToken ?? '' }, res };
}

describe('模擬器：讀取時惰性推進（FLOW-14）', () => {
  it('自取：+5 秒接單、+25 秒出餐、+40 秒完成；時間軸補寫缺漏紀錄，現金於完成時 PAID 並開立發票', async () => {
    h = setup();
    const { id, opts } = await cashOrder();
    h.advance(4 * SEC);
    expect((await h.client.orders.get(id, opts)).status).toBe('PENDING');
    h.advance(2 * SEC);
    const accepted = await h.client.orders.get(id, opts);
    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.acceptedAt).toBe('2026-10-14T12:00:05+08:00');
    expect(accepted.acceptBy).toBeUndefined();
    expect(accepted.permissions.canCancel).toBe(false);

    h.advance(20 * SEC); // t = 26s
    expect((await h.client.orders.get(id, opts)).status).toBe('READY');
    h.advance(15 * SEC); // t = 41s
    const done = await h.client.orders.get(id, opts);
    expect(done.status).toBe('COMPLETED');
    expect(done.completedAt).toBe('2026-10-14T12:00:40+08:00');
    expect(done.payment.status).toBe('PAID');
    expect(done.invoice.status).toBe('ISSUED');
    expect(done.invoice.invoiceNo).toMatch(/^[A-Z]{2}\d{8}$/);
    expect(done.timeline.map((t) => t.status)).toEqual(['PENDING', 'ACCEPTED', 'READY', 'COMPLETED']);
    expect(done.timeline.map((t) => t.at)).toEqual([
      '2026-10-14T12:00:00+08:00',
      '2026-10-14T12:00:05+08:00',
      '2026-10-14T12:00:25+08:00',
      '2026-10-14T12:00:40+08:00',
    ]);
  });

  it('離頁很久後才讀取：一次補到最新狀態（不依賴 setTimeout）', async () => {
    h = setup();
    const { id, opts } = await cashOrder();
    h.advance(10 * MIN);
    const o = await h.client.orders.get(id, opts);
    expect(o.status).toBe('COMPLETED');
    expect(o.timeline).toHaveLength(4);
  });

  it('外送：+5 → ACCEPTED、+25 → READY、+35 → DELIVERING、+55 → COMPLETED', async () => {
    h = setup();
    const res = await h.client.orders.create(
      createReq([line('prd_beef_noodle', 2, ['opt_noodle_thin', 'opt_spice_none']), line('prd_danzai', 1)], 420, {
        orderType: 'DELIVERY',
        delivery: { city: '臺北市', district: '大安區', zipCode: '106', line: '示範路 5 號 3 樓' },
      }),
      newKey(),
    );
    const opts = { trackingToken: res.trackingToken ?? '' };
    const at = async (s: number) => {
      h.setNow(Date.parse('2026-10-14T12:00:00+08:00') + s * SEC);
      return (await h.client.orders.get(res.order.id, opts)).status;
    };
    expect(await at(6)).toBe('ACCEPTED');
    expect(await at(26)).toBe('READY');
    expect(await at(36)).toBe('DELIVERING');
    expect(await at(56)).toBe('COMPLETED');
  });

  it('速度 5×：1 秒即過 5 秒的進度', async () => {
    h = setup({ demo: { speed: 5 } });
    const { id, opts } = await cashOrder();
    h.advance(1 * SEC);
    expect((await h.client.orders.get(id, opts)).status).toBe('ACCEPTED');
  });

  it('自動模擬關閉：維持 PENDING，只能手動推進', async () => {
    h = setup({ demo: { autoSimulate: false } });
    const { id, opts } = await cashOrder();
    h.advance(5 * MIN);
    expect((await h.client.orders.get(id, opts)).status).toBe('PENDING');
    await h.client.demo.act(id, 'ACCEPT');
    expect((await h.client.orders.get(id, opts)).status).toBe('ACCEPTED');
    await h.client.demo.act(id, 'READY');
    h.advance(10 * MIN);
    expect((await h.client.orders.get(id, opts)).status).toBe('READY');
    await h.client.demo.act(id, 'COMPLETE');
    const done = await h.client.orders.get(id, opts);
    expect(done.status).toBe('COMPLETED');
    expect(done.payment.status).toBe('PAID');
  });

  it('預約單：+5 秒即 ACCEPTED，之後維持到製作基準（預約 − 前置 15 分）才繼續推進', async () => {
    h = setup({ now: Date.parse('2026-10-14T14:30:00+08:00') });
    const res = await h.client.orders.create(
      createReq([LUROU()], 67, { scheduledAt: '2026-10-14T17:00:00+08:00' }),
      newKey(),
    );
    const opts = { trackingToken: res.trackingToken ?? '' };
    h.advance(6 * SEC);
    expect((await h.client.orders.get(res.order.id, opts)).status).toBe('ACCEPTED');
    h.setNow(Date.parse('2026-10-14T16:44:00+08:00'));
    expect((await h.client.orders.get(res.order.id, opts)).status).toBe('ACCEPTED'); // 不被推進、也不被取消
    h.setNow(Date.parse('2026-10-14T16:45:30+08:00'));
    expect((await h.client.orders.get(res.order.id, opts)).status).toBe('READY');
  });
});

describe('逾時結算（BR-17、R-V）', () => {
  it('UAT-06：付款逾時（不受自動模擬開關影響）→ CANCELLED（SYSTEM、付款逾時）並釋放份數', async () => {
    for (const autoSimulate of [true, false]) {
      h = setup({ demo: { autoSimulate } });
      const res = await h.client.orders.create(
        createReq([COMBO(3)], 897, { paymentMethod: 'LINE_PAY' }),
        newKey(),
      );
      expect(h.client.demo.getStock('prd_combo_share')).toMatchObject({ held: 3, remaining: 2 });
      h.advance(15 * MIN);
      const o = await h.client.orders.get(res.order.id, { trackingToken: res.trackingToken ?? '' });
      expect(o).toMatchObject({
        status: 'CANCELLED',
        cancellation: { by: 'SYSTEM', reason: '付款逾時' },
        payment: { status: 'UNPAID', expiresAt: null },
        permissions: { canPay: false, canCancel: false },
      });
      expect(h.client.demo.getStock('prd_combo_share')).toMatchObject({ held: 0, remaining: 5 });
      h.cleanup();
    }
  });

  it('付款期限前 1 毫秒仍保留，到期當下即釋放（半開區間）', async () => {
    h = setup();
    const res = await h.client.orders.create(
      createReq([COMBO(1)], 299, { paymentMethod: 'JKOPAY' }),
      newKey(),
    );
    h.advance(15 * MIN - 1);
    expect(h.client.demo.getStock('prd_combo_share').held).toBe(1);
    expect((await h.client.orders.get(res.order.id, { trackingToken: res.trackingToken ?? '' })).status).toBe(
      'PENDING_PAYMENT',
    );
    h.advance(1);
    expect(h.client.demo.getStock('prd_combo_share').held).toBe(0);
  });

  it('接單逾時只在自動模擬關閉、店家未接單時發生（10 分鐘）', async () => {
    h = setup({ demo: { autoSimulate: false } });
    const { id, opts } = await cashOrder();
    h.advance(10 * MIN - 1);
    expect((await h.client.orders.get(id, opts)).status).toBe('PENDING');
    h.advance(1);
    const o = await h.client.orders.get(id, opts);
    expect(o).toMatchObject({ status: 'CANCELLED', cancellation: { by: 'SYSTEM' } });
    expect(h.client.demo.getStock('prd_combo_share').sold).toBe(0);
  });

  it('自動模擬開啟：即使離頁超過接單期限才讀取，仍為已接單（先補寫模擬轉換再判斷，FLOW-14 的 S）', async () => {
    h = setup({ demo: { autoSimulate: true } });
    const { id, opts } = await cashOrder();
    h.advance(20 * MIN);
    const o = await h.client.orders.get(id, opts);
    expect(o.status).not.toBe('CANCELLED');
    expect(o.acceptedAt).toBe('2026-10-14T12:00:05+08:00');
  });

  it('寫入路徑（建單）先結算逾期：他人逾期待付款單釋放後可購買', async () => {
    h = setup();
    await h.client.demo.injectOtherOrder({ productId: 'prd_combo_share', quantity: 5, status: 'PENDING_PAYMENT' });
    expect(h.client.demo.getStock('prd_combo_share')).toMatchObject({ held: 5, remaining: 0 });
    h.advance(15 * MIN);
    const ok = await h.client.orders.create(createReq([COMBO(5)], 1495), newKey());
    expect(ok.order.status).toBe('PENDING');
    expect(h.client.demo.getStock('prd_combo_share')).toMatchObject({ sold: 5, held: 0, remaining: 0 });
  });
});

describe('取消（FLOW-12、BR-16）', () => {
  it('UAT-07：PENDING 可取消 → CANCELLED（CUSTOMER、原因）並釋放份數；重複取消冪等', async () => {
    h = setup({ demo: { autoSimulate: false } });
    const { id, opts, res } = await cashOrder({}, [COMBO(2)], 598);
    expect(res.order.permissions.canCancel).toBe(true);
    const cancelled = await h.client.orders.cancel(id, '不小心點錯了', opts);
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancellation: { by: 'CUSTOMER', reason: '不小心點錯了' },
      payment: { status: 'UNPAID' },
    });
    expect(cancelled.timeline.map((t) => t.status)).toEqual(['PENDING', 'CANCELLED']);
    expect(h.client.demo.getStock('prd_combo_share')).toMatchObject({ sold: 0, remaining: 5 });
    const again = await h.client.orders.cancel(id, undefined, opts);
    expect(again.status).toBe('CANCELLED');
    expect(again.cancellation?.reason).toBe('不小心點錯了');
  });

  it('已接單後取消 → 409 ORDER_STATE_CONFLICT，canCancel = false', async () => {
    h = setup({ demo: { autoSimulate: false } });
    const { id, opts } = await cashOrder();
    await h.client.demo.act(id, 'ACCEPT');
    const err = await rejection(h.client.orders.cancel(id, undefined, opts));
    expect(err.status).toBe(409);
    expect(err.code).toBe('ORDER_STATE_CONFLICT');
    expect((await h.client.orders.get(id, opts)).permissions.canCancel).toBe(false);
  });

  it('自動模擬下 5 秒後取消 → 409（取消前先補寫模擬轉換）', async () => {
    h = setup();
    const { id, opts } = await cashOrder();
    h.advance(20 * SEC);
    const err = await rejection(h.client.orders.cancel(id, undefined, opts));
    expect(err.code).toBe('ORDER_STATE_CONFLICT');
  });

  it('庫存-16：已付款訂單取消 → REFUNDING，約 10 秒後 REFUNDED（不受自動模擬開關影響）', async () => {
    h = setup({ demo: { autoSimulate: false, nextPaymentResult: 'MANUAL' } });
    const res = await h.client.orders.create(createReq([TEA()], 25, { paymentMethod: 'LINE_PAY' }), newKey());
    const opts = { trackingToken: res.trackingToken ?? '' };
    await h.client.orders.pay(res.order.id, { method: 'LINE_PAY' }, opts);
    await h.client.demo.settlePayment(res.order.id, 'SUCCESS');
    const paid = await h.client.orders.get(res.order.id, opts);
    expect(paid).toMatchObject({ status: 'PENDING', payment: { status: 'PAID' } });

    const cancelled = await h.client.orders.cancel(res.order.id, undefined, opts);
    expect(cancelled).toMatchObject({ status: 'CANCELLED', payment: { status: 'REFUNDING' } });
    h.advance(9 * SEC);
    expect((await h.client.orders.get(res.order.id, opts)).payment.status).toBe('REFUNDING');
    h.advance(2 * SEC);
    expect((await h.client.orders.get(res.order.id, opts)).payment.status).toBe('REFUNDED');
  });

  it('拒單（店家）立即釋放保留的份數（S23 變體）', async () => {
    h = setup({ demo: { autoSimulate: false } });
    const { id, opts } = await cashOrder({}, [COMBO(3)], 897);
    expect(h.client.demo.getStock('prd_combo_share').remaining).toBe(2);
    const rejected = await h.client.demo.act(id, 'REJECT');
    expect(rejected).toMatchObject({
      status: 'CANCELLED',
      cancellation: { by: 'STORE', reason: '店家忙碌，無法接單' },
    });
    expect(h.client.demo.getStock('prd_combo_share').remaining).toBe(5);
    expect((await h.client.orders.get(id, opts)).status).toBe('CANCELLED');
  });
});

describe('付款（FLOW-11、06 §5.13）', () => {
  const online = async (method: 'LINE_PAY' | 'JKOPAY' | 'CREDIT_CARD' = 'LINE_PAY') => {
    const res = await h.client.orders.create(createReq([COMBO(1)], 299, { paymentMethod: method }), newKey());
    return { id: res.order.id, opts: { trackingToken: res.trackingToken ?? '' } };
  };

  it('MANUAL：回 PENDING 交易與站內 redirectUrl；settlePayment SUCCESS → PENDING / PAID、acceptBy 出現（自此起算）', async () => {
    h = setup({ demo: { autoSimulate: false } });
    const { id, opts } = await online();
    h.advance(3 * MIN);
    const pay = await h.client.orders.pay(id, { method: 'LINE_PAY' }, opts);
    expect(pay.status).toBe('PENDING');
    expect(pay.redirectUrl).toBe(`/payment/${id}?method=LINE_PAY`);
    expect(pay.expiresAt).toBe('2026-10-14T12:15:00+08:00');
    expect(pay.order.status).toBe('PENDING_PAYMENT');
    expect(pay.order.payment.latest).toMatchObject({ status: 'PENDING', method: 'LINE_PAY' });

    h.advance(2 * MIN);
    const paid = await h.client.demo.settlePayment(id, 'SUCCESS');
    expect(paid).toMatchObject({
      status: 'PENDING',
      payment: { method: 'LINE_PAY', status: 'PAID', expiresAt: null, latest: { status: 'SUCCESS' } },
      acceptBy: '2026-10-14T12:15:00+08:00', // 12:05 付款成功 + 10 分鐘（不以下單時間起算）
    });
    expect(paid.invoice.status).toBe('ISSUED');
    expect(paid.timeline.map((t) => t.status)).toEqual(['PENDING_PAYMENT', 'PENDING']);
  });

  it('S5：付款失敗 → 訂單維持 PENDING_PAYMENT；改用現金 → PENDING、現金', async () => {
    h = setup({ demo: { autoSimulate: false } });
    const { id, opts } = await online();
    await h.client.orders.pay(id, { method: 'LINE_PAY' }, opts);
    const failed = await h.client.demo.settlePayment(id, 'FAILED');
    expect(failed).toMatchObject({
      status: 'PENDING_PAYMENT',
      payment: { status: 'UNPAID', latest: { status: 'FAILED' } },
      permissions: { canPay: true },
    });
    const cash = await h.client.orders.pay(id, { method: 'CASH' }, opts);
    expect(cash.redirectUrl).toBeUndefined();
    expect(cash.order).toMatchObject({
      status: 'PENDING',
      payment: { method: 'CASH', status: 'UNPAID', expiresAt: null },
    });
    expect(cash.order.acceptBy).toBeDefined();
  });

  it('nextPaymentResult：SUCCESS / FAILED 自動結算並於使用一次後回到 MANUAL；TIMEOUT 維持 PENDING', async () => {
    h = setup({ demo: { autoSimulate: false, nextPaymentResult: 'SUCCESS' } });
    const a = await online();
    const paid = await h.client.orders.pay(a.id, { method: 'LINE_PAY' }, a.opts);
    expect(paid.status).toBe('SUCCESS');
    expect(paid.order).toMatchObject({ status: 'PENDING', payment: { status: 'PAID' } });
    expect(h.client.demo.getState().nextPaymentResult).toBe('MANUAL');
    // 面板之後再呼叫 settlePayment 為冪等
    expect((await h.client.demo.settlePayment(a.id, 'SUCCESS')).payment.status).toBe('PAID');

    h.client.demo.setState({ nextPaymentResult: 'FAILED' });
    const b = await online();
    const failed = await h.client.orders.pay(b.id, { method: 'JKOPAY' }, b.opts);
    expect(failed.status).toBe('FAILED');
    expect(failed.order.status).toBe('PENDING_PAYMENT');
    expect(h.client.demo.getState().nextPaymentResult).toBe('MANUAL');

    h.client.demo.setState({ nextPaymentResult: 'TIMEOUT' });
    const c = await online();
    const stuck = await h.client.orders.pay(c.id, { method: 'LINE_PAY' }, c.opts);
    expect(stuck.status).toBe('PENDING');
    expect(stuck.redirectUrl).toContain('sim=timeout');
    h.advance(15 * MIN);
    expect((await h.client.orders.get(c.id, c.opts)).status).toBe('CANCELLED');
  });

  it('重新付款：既有 PENDING 交易作廢（SUPERSEDED），只留最新一筆處理中', async () => {
    h = setup({ demo: { autoSimulate: false } });
    const { id, opts } = await online();
    const first = await h.client.orders.pay(id, { method: 'LINE_PAY' }, opts);
    const second = await h.client.orders.pay(id, { method: 'JKOPAY' }, opts);
    expect(second.paymentId).not.toBe(first.paymentId);
    const o = await h.client.orders.get(id, opts);
    expect(o.payment).toMatchObject({ method: 'JKOPAY', latest: { id: second.paymentId, status: 'PENDING' } });
  });

  it('逾期後付款或改用現金 → 409 ORDER_STATE_CONFLICT（不重驗庫存）', async () => {
    h = setup({ demo: { autoSimulate: false } });
    const { id, opts } = await online();
    h.advance(15 * MIN);
    for (const method of ['LINE_PAY', 'CASH'] as const) {
      const err = await rejection(h.client.orders.pay(id, { method }, opts));
      expect(err.status).toBe(409);
      expect(err.code).toBe('ORDER_STATE_CONFLICT');
    }
  });

  it('付款階段不重驗庫存：保留期間他人買不走，付款時仍可成立', async () => {
    h = setup({ demo: { autoSimulate: false } });
    const { id, opts } = await online();
    h.client.demo.setState({ soldOutProductIds: ['prd_combo_share'], storeOverride: 'PAUSED' });
    const pay = await h.client.orders.pay(id, { method: 'LINE_PAY' }, opts);
    expect(pay.order.status).toBe('PENDING_PAYMENT');
    const paid = await h.client.demo.settlePayment(id, 'SUCCESS');
    expect(paid.status).toBe('PENDING');
  });

  it('庫存-16：逾時後才成功的付款 → 訂單維持 CANCELLED、自動退款、不重新占用份數', async () => {
    h = setup({ demo: { autoSimulate: false } });
    const { id, opts } = await online();
    await h.client.orders.pay(id, { method: 'LINE_PAY' }, opts);
    h.advance(16 * MIN);
    // 期間他人買走最後的份數
    await h.client.demo.injectOtherOrder({ productId: 'prd_combo_share', quantity: 5 });
    const late = await h.client.demo.settlePayment(id, 'SUCCESS');
    expect(late).toMatchObject({
      status: 'CANCELLED',
      payment: { status: 'REFUNDING', latest: { status: 'SUCCESS' } },
    });
    expect(h.client.demo.getStock('prd_combo_share')).toMatchObject({ sold: 5, remaining: 0 });
    h.advance(11 * SEC);
    expect((await h.client.orders.get(id, opts)).payment.status).toBe('REFUNDED');
  });

  it('庫存-24：改現金後晚到的線上付款成功 → 僅退回該筆款項，訂單狀態與庫存不變', async () => {
    h = setup({ demo: { autoSimulate: false } });
    const { id, opts } = await online();
    await h.client.orders.pay(id, { method: 'LINE_PAY' }, opts);
    await h.client.orders.pay(id, { method: 'CASH' }, opts);
    const o = await h.client.demo.settlePayment(id, 'SUCCESS', 'LINE_PAY');
    expect(o).toMatchObject({ status: 'PENDING', payment: { method: 'CASH', status: 'UNPAID' } });
    expect(h.client.demo.getStock('prd_combo_share')).toMatchObject({ sold: 1 });
  });
});

describe('存取控制、查詢與列表', () => {
  it('以 trackingToken 存取；無權杖或錯誤權杖一律 404（不洩漏訂單是否存在）', async () => {
    h = setup();
    const { id, opts } = await cashOrder();
    expect((await h.client.orders.get(id, opts)).id).toBe(id);
    for (const bad of [undefined, { trackingToken: 'trk_nope' }]) {
      const err = await rejection(h.client.orders.get(id, bad));
      expect(err.status).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
    }
    expect((await rejection(h.client.orders.cancel(id, undefined, { trackingToken: 'x' }))).status).toBe(404);
    expect((await rejection(h.client.orders.pay(id, { method: 'CASH' }, undefined))).status).toBe(404);
  });

  it('lookup：訂單編號 + 手機換取新權杖並使舊權杖失效；查無一律 404；10 分鐘 5 次限流', async () => {
    h = setup();
    const { id, opts, res } = await cashOrder();
    const found = await h.client.orders.lookup(res.order.orderNo.toLowerCase(), '0912-345-678');
    expect(found.orderId).toBe(id);
    expect(found.trackingToken).not.toBe(opts.trackingToken);
    expect((await rejection(h.client.orders.get(id, opts))).status).toBe(404);
    expect((await h.client.orders.get(id, { trackingToken: found.trackingToken })).id).toBe(id);

    expect((await rejection(h.client.orders.lookup(res.order.orderNo, '0911111111'))).status).toBe(404);
    // 同一手機 10 分鐘內最多 5 次嘗試（不論訂單編號是否正確）：前面已用 1 次，再 4 次達上限
    for (let i = 0; i < 4; i++) await rejection(h.client.orders.lookup('ZO000000AAAAAA', '0912345678'));
    const limited = await rejection(h.client.orders.lookup(res.order.orderNo, '0912345678'));
    expect(limited.status).toBe(429);
    expect(limited.code).toBe('RATE_LIMITED');
    expect(limited.body?.retryAfterSeconds).toBeGreaterThan(0);
    h.advance(10 * MIN + SEC);
    expect((await h.client.orders.lookup(res.order.orderNo, '0912345678')).orderId).toBe(id);
  });

  it('他人訂單（X 前綴）不出現在列表、查詢與詳情；手動店家操作不作用', async () => {
    h = setup();
    await h.client.demo.loginAsDemoUser();
    await h.client.demo.injectOtherOrder({ productId: 'prd_combo_share', quantity: 2 });
    const all = await h.client.orders.list({ tab: 'active' });
    expect(all.items).toEqual([]);
    const xId = JSON.parse(h.storage.getItem('zaiorder:v1:db') ?? '{}').orders.find(
      (o: { pickup_no: string }) => o.pickup_no.startsWith('X'),
    ).id as string;
    expect((await rejection(h.client.orders.get(xId))).status).toBe(404);
    expect((await rejection(h.client.demo.act(xId, 'ACCEPT'))).status).toBe(404);
    expect(h.client.demo.getStock('prd_combo_share').sold).toBe(2);
  });

  it('orders.list：會員的歷史訂單三個分頁（3 天前完成、7 天前完成外送、10 天前取消）與摘要文字', async () => {
    h = setup();
    expect((await rejection(h.client.orders.list({ tab: 'active' }))).status).toBe(401);
    await h.client.demo.loginAsDemoUser();
    const completed = await h.client.orders.list({ tab: 'completed' });
    expect(completed.items.map((o) => [o.pickupNo, o.itemsPreview, o.total, o.itemCount])).toEqual([
      ['A001', '招牌滷肉飯 等 3 項', 157, 3],
      ['D001', '紅燒牛肉麵 等 3 項', 420, 3],
    ]);
    const cancelled = await h.client.orders.list({ tab: 'cancelled' });
    expect(cancelled.items.map((o) => [o.pickupNo, o.itemsPreview, o.status])).toEqual([
      ['A001', '蚵仔煎', 'CANCELLED'],
    ]);
    expect((await h.client.orders.list({ tab: 'active' })).items).toEqual([]);
  });

  it('orders.list：游標分頁（limit / nextCursor）；新訂單在最前；唯讀顯示修正（逾期待付款顯示為已取消，不寫入）', async () => {
    h = setup({ demo: { autoSimulate: false } });
    await h.client.demo.loginAsDemoUser();
    const a = await h.client.orders.create(createReq([TEA()], 25), newKey());
    h.advance(MIN);
    const b = await h.client.orders.create(createReq([COMBO(1)], 299, { paymentMethod: 'LINE_PAY' }), newKey());
    let page = await h.client.orders.list({ tab: 'active', limit: 1 });
    expect(page.items.map((o) => o.id)).toEqual([b.order.id]);
    expect(page.nextCursor).not.toBeNull();
    page = await h.client.orders.list({ tab: 'active', limit: 1, cursor: page.nextCursor ?? '' });
    expect(page.items.map((o) => o.id)).toEqual([a.order.id]);
    expect(page.nextCursor).toBeNull();

    h.advance(15 * MIN);
    const before = h.storage.getItem('zaiorder:v1:db');
    const active = await h.client.orders.list({ tab: 'active' });
    expect(active.items.map((o) => o.id)).toEqual([a.order.id]);
    const cancelled = await h.client.orders.list({ tab: 'cancelled' });
    expect(cancelled.items[0]).toMatchObject({ id: b.order.id, status: 'CANCELLED' });
    expect(h.storage.getItem('zaiorder:v1:db')).toBe(before);
  });

  it('會員以 session 存取自己的訂單；他人的訂單（有權杖的訪客單除外）404', async () => {
    h = setup();
    const guest = await cashOrder();
    await h.client.demo.loginAsDemoUser();
    // 登入後無法以 session 存取訪客單，仍需權杖
    expect((await rejection(h.client.orders.get(guest.id))).status).toBe(404);
    expect((await h.client.orders.get(guest.id, guest.opts)).id).toBe(guest.id);
    const mine = await h.client.orders.create(createReq([TEA()], 25), newKey());
    expect((await h.client.orders.get(mine.order.id)).id).toBe(mine.order.id);
    await h.client.auth.logout();
    expect((await rejection(h.client.orders.get(mine.order.id))).status).toBe(404);
  });

  it('DemoControl.act 的狀態機：不合法的轉換被拒（409）；外送才有 DISPATCH', async () => {
    h = setup({ demo: { autoSimulate: false } });
    const { id } = await cashOrder();
    expect((await rejection(h.client.demo.act(id, 'READY'))).code).toBe('ORDER_STATE_CONFLICT');
    expect((await rejection(h.client.demo.act(id, 'COMPLETE'))).status).toBe(409);
    await h.client.demo.act(id, 'ACCEPT');
    await h.client.demo.act(id, 'READY');
    expect((await rejection(h.client.demo.act(id, 'DISPATCH'))).status).toBe(409); // 自取不經外送中
    const done = await h.client.demo.act(id, 'COMPLETE');
    expect(done.status).toBe('COMPLETED');
  });
});
