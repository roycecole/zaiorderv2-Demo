// auth（OTP、換發、登出）與 me（資料、地址簿、最愛、優惠券、常點）（06 §5.1～§5.2a、§5.15）
import { afterEach, describe, expect, it } from 'vitest';
import { TEA, createReq, newKey, rejection, setup } from './harness';
import type { Harness } from './harness';

let h: Harness;
afterEach(() => h.cleanup());

const MIN = 60_000;
const SEC = 1000;
const PHONE = '0912345678';

describe('auth.sendOtp', () => {
  it('200：resendAfterSeconds = 60；格式錯誤 400', async () => {
    h = setup();
    expect(await h.client.auth.sendOtp('0912-345-678')).toEqual({ resendAfterSeconds: 60 });
    const err = await rejection(h.client.auth.sendOtp('12345'));
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.body?.details?.[0]?.field).toBe('phone');
  });

  it('同手機 60 秒內再送 → 429 OTP_RATE_LIMITED 並附 retryAfterSeconds；之後可再送', async () => {
    h = setup();
    await h.client.auth.sendOtp(PHONE);
    h.advance(20 * SEC);
    const err = await rejection(h.client.auth.sendOtp(PHONE));
    expect(err.status).toBe(429);
    expect(err.code).toBe('OTP_RATE_LIMITED');
    expect(err.body?.retryAfterSeconds).toBe(40);
    h.advance(41 * SEC);
    await h.client.auth.sendOtp(PHONE);
  });

  it('每日最多 10 次', async () => {
    h = setup();
    for (let i = 0; i < 10; i++) {
      await h.client.auth.sendOtp(PHONE);
      h.advance(61 * SEC);
    }
    const err = await rejection(h.client.auth.sendOtp(PHONE));
    expect(err.code).toBe('OTP_RATE_LIMITED');
    expect(err.body?.retryAfterSeconds).toBeGreaterThan(60);
  });
});

describe('auth.verifyOtp', () => {
  it('固定 123456：新手機即註冊（isNewUser）；示範會員為既有帳號', async () => {
    h = setup();
    const fresh = await h.client.auth.verifyOtp(PHONE, '123456');
    expect(fresh.isNewUser).toBe(true);
    expect(fresh.user).toMatchObject({ phone: PHONE, marketingOptIn: false });
    expect(fresh.tokens.expiresIn).toBe(900);
    expect(fresh.tokens.accessToken).toBeTruthy();
    expect(fresh.tokens.refreshToken).toBeTruthy();
    await h.client.auth.logout();

    const demo = await h.client.auth.verifyOtp('0900000000', '123456');
    expect(demo.isNewUser).toBe(false);
    expect(demo.user).toMatchObject({ name: '示範會員', email: 'demo@example.com' });
  });

  it('錯誤碼：OTP_INVALID 附剩餘次數；第 5 次錯誤鎖定 10 分鐘（423 OTP_LOCKED）；鎖定期間正確碼也拒絕', async () => {
    h = setup();
    for (const left of [4, 3, 2, 1]) {
      const err = await rejection(h.client.auth.verifyOtp(PHONE, '000000'));
      expect(err.status).toBe(400);
      expect(err.code).toBe('OTP_INVALID');
      expect(err.body?.remainingAttempts).toBe(left);
    }
    const locked = await rejection(h.client.auth.verifyOtp(PHONE, '000000'));
    expect(locked.status).toBe(423);
    expect(locked.code).toBe('OTP_LOCKED');
    expect(locked.body?.retryAfterSeconds).toBe(600);

    h.advance(5 * MIN);
    const still = await rejection(h.client.auth.verifyOtp(PHONE, '123456'));
    expect(still.code).toBe('OTP_LOCKED');
    expect(still.body?.retryAfterSeconds).toBe(300);
    h.advance(5 * MIN);
    expect((await h.client.auth.verifyOtp(PHONE, '123456')).user.phone).toBe(PHONE);
  });

  it('驗證碼須為 6 位數字（400）', async () => {
    h = setup();
    const err = await rejection(h.client.auth.verifyOtp(PHONE, '12'));
    expect(err.status).toBe(400);
    expect(err.body?.details?.[0]?.field).toBe('code');
  });

  it('failNext 指定 auth.verifyOtp 失敗', async () => {
    h = setup({ demo: { failNext: { target: 'auth.verifyOtp', remaining: 1 } } });
    expect((await rejection(h.client.auth.verifyOtp(PHONE, '123456'))).status).toBe(503);
    expect((await h.client.auth.verifyOtp(PHONE, '123456')).user.phone).toBe(PHONE);
  });
});

describe('auth.refresh / logout', () => {
  it('Refresh Token 輪替：舊 Token 失效；重複使用舊 Token 視為遭竊 → 401 並撤銷所有 Session', async () => {
    h = setup();
    const login = await h.client.auth.verifyOtp(PHONE, '123456');
    const first = login.tokens.refreshToken ?? '';
    const rotated = await h.client.auth.refresh(first);
    expect(rotated.tokens.refreshToken).not.toBe(first);
    expect((await h.client.me.get()).phone).toBe(PHONE);

    const reuse = await rejection(h.client.auth.refresh(first));
    expect(reuse.status).toBe(401);
    expect(reuse.code).toBe('UNAUTHORIZED');
    expect((await rejection(h.client.me.get())).status).toBe(401);
    expect((await rejection(h.client.auth.refresh(rotated.tokens.refreshToken))).status).toBe(401);
  });

  it('Cookie 模式：不傳 refreshToken 時以目前 Session 換發（loginAsDemoUser 後可取得 tokens）', async () => {
    h = setup();
    await h.client.demo.loginAsDemoUser();
    const { tokens } = await h.client.auth.refresh();
    expect(tokens.accessToken).toBeTruthy();
    expect((await h.client.me.get()).name).toBe('示範會員');
  });

  it('logout 冪等；登出後 me.* 回 401；未登入 refresh 回 401', async () => {
    h = setup();
    await h.client.demo.loginAsDemoUser();
    await h.client.auth.logout();
    await h.client.auth.logout();
    for (const call of [
      () => h.client.me.get(),
      () => h.client.me.addresses.list(),
      () => h.client.me.favorites.list(),
      () => h.client.me.coupons.list(),
      () => h.client.me.frequentItems(),
    ]) {
      expect((await rejection(call())).code).toBe('UNAUTHORIZED');
    }
    expect((await rejection(h.client.auth.refresh())).status).toBe(401);
  });
});

describe('me：資料與地址簿', () => {
  it('示範會員資料；PATCH 驗證與更新', async () => {
    h = setup();
    await h.client.demo.loginAsDemoUser();
    const me = await h.client.me.get();
    expect(me).toMatchObject({ phone: '0900000000', name: '示範會員', email: 'demo@example.com', marketingOptIn: false });
    const updated = await h.client.me.update({ name: '小明', marketingOptIn: true });
    expect(updated).toMatchObject({ name: '小明', marketingOptIn: true, email: 'demo@example.com' });
    expect((await rejection(h.client.me.update({ email: 'not-an-email' }))).status).toBe(400);
    expect((await rejection(h.client.me.update({ name: '' }))).status).toBe(400);
  });

  it('地址簿：預設在最前；新增預設地址會取消其他預設；刪除預設則遞補', async () => {
    h = setup();
    await h.client.demo.loginAsDemoUser();
    const list = await h.client.me.addresses.list();
    expect(list.items.map((a) => [a.label, a.isDefault])).toEqual([
      ['家', true],
      ['公司', false],
    ]);
    expect(list.items[0]).toMatchObject({ city: '臺北市', district: '大安區', zipCode: '106', line: '示範路 5 號 3 樓' });

    const created = await h.client.me.addresses.create({
      label: '朋友家', recipientName: '阿華', recipientPhone: '0922-333-444', city: '臺北市', district: '中正區',
      zipCode: '100', line: '示範街 12 號', isDefault: true,
    });
    expect(created).toMatchObject({ recipientPhone: '0922333444', isDefault: true });
    let after = await h.client.me.addresses.list();
    expect(after.items.filter((a) => a.isDefault).map((a) => a.label)).toEqual(['朋友家']);

    const patched = await h.client.me.addresses.update('addr_office', { isDefault: true, note: '管理室代收' });
    expect(patched).toMatchObject({ isDefault: true, note: '管理室代收' });
    after = await h.client.me.addresses.list();
    expect(after.items.filter((a) => a.isDefault)).toHaveLength(1);

    await h.client.me.addresses.remove('addr_office');
    after = await h.client.me.addresses.list();
    expect(after.items).toHaveLength(2);
    expect(after.items.filter((a) => a.isDefault)).toHaveLength(1); // 刪除預設後遞補
    expect((await rejection(h.client.me.addresses.update('nope', { label: 'x' }))).status).toBe(404);
    const bad = await rejection(
      h.client.me.addresses.create({
        label: '', recipientName: '', recipientPhone: '1', city: '', district: '', zipCode: '1', line: 'a',
        isDefault: false,
      }),
    );
    expect(bad.body?.details?.length).toBeGreaterThanOrEqual(6);
  });

  it('我的最愛：冪等新增與取消；不存在的商品 404', async () => {
    h = setup();
    await h.client.demo.loginAsDemoUser();
    expect((await h.client.me.favorites.list()).productIds).toEqual([
      'prd_lurou', 'prd_black_tea', 'prd_beef_noodle',
    ]);
    await h.client.me.favorites.add('prd_aiyu');
    await h.client.me.favorites.add('prd_aiyu');
    await h.client.me.favorites.remove('prd_lurou');
    await h.client.me.favorites.remove('prd_lurou');
    expect((await h.client.me.favorites.list()).productIds).toEqual(['prd_black_tea', 'prd_beef_noodle', 'prd_aiyu']);
    expect((await rejection(h.client.me.favorites.add('prd_ghost'))).status).toBe(404);
  });
});

describe('me.coupons 與 frequentItems', () => {
  it('優惠券：WELCOME50、LUNCH10 可用，一張已使用；status 篩選', async () => {
    h = setup();
    await h.client.demo.loginAsDemoUser();
    const all = await h.client.me.coupons.list();
    expect(all.items.map((c) => [c.coupon.code, c.status])).toEqual([
      ['WELCOME50', 'AVAILABLE'],
      ['LUNCH10', 'AVAILABLE'],
      ['MEMBER20', 'USED'],
    ]);
    expect(all.items[2]?.usedAt).toBeDefined();
    const welcome = all.items.find((c) => c.coupon.code === 'WELCOME50');
    expect(welcome?.coupon).toMatchObject({
      discountType: 'FIXED_AMOUNT', discountValue: 50, minOrderAmount: 250, memberOnly: false,
      applicableOrderTypes: ['PICKUP', 'DELIVERY', 'DINE_IN'],
    });
    expect((await h.client.me.coupons.list('USED')).items.map((c) => c.coupon.code)).toEqual(['MEMBER20']);
    expect((await h.client.me.coupons.list('EXPIRED')).items).toEqual([]);
  });

  it('使用持有的券後轉為 USED；取消訂單於有效期內回復 AVAILABLE（BR-29）', async () => {
    h = setup();
    await h.client.demo.loginAsDemoUser();
    const res = await h.client.orders.create(
      createReq([line299()], 249, { couponCode: 'WELCOME50' }),
      newKey(),
    );
    const used = await h.client.me.coupons.list('USED');
    expect(used.items.map((c) => c.coupon.code).sort()).toEqual(['MEMBER20', 'WELCOME50']);
    await h.client.orders.cancel(res.order.id, '改變心意');
    const available = await h.client.me.coupons.list('AVAILABLE');
    expect(available.items.map((c) => c.coupon.code).sort()).toEqual(['LUNCH10', 'WELCOME50']);
  });

  it('frequentItems：由近 180 天非取消訂單推導，每商品取最近一次的選項與備註（06 §5.15a）', async () => {
    h = setup();
    await h.client.demo.loginAsDemoUser();
    const { items } = await h.client.me.frequentItems();
    expect(items.map((i) => i.productId)).toEqual([
      'prd_lurou', 'prd_kong_rou', 'prd_black_tea', 'prd_beef_noodle', 'prd_danzai',
    ]);
    expect(items[0]).toMatchObject({
      productId: 'prd_lurou', optionIds: ['opt_bowl_l', 'opt_egg'], optionLabels: ['大碗', '滷蛋'],
      note: '不要蔥', orderCount: 1, lastOrderedAt: '2026-10-11T12:20:00+08:00',
    });
    expect(items[2]).toMatchObject({
      optionIds: ['opt_cup_m', 'opt_sugar_half', 'opt_ice_light'], optionLabels: ['中杯', '半糖', '微冰'],
    });
    expect(items[3]).toMatchObject({
      optionIds: ['opt_noodle_thin', 'opt_spice_none'], lastOrderedAt: '2026-10-07T12:20:00+08:00',
    });
    expect(items[4]).toMatchObject({ optionIds: [], optionLabels: [] });
    expect(items.some((i) => i.productId === 'prd_oyster_omelet')).toBe(false); // 已取消不列入
    expect((await h.client.me.frequentItems(2)).items).toHaveLength(2);
  });

  it('新下的訂單進入常點並以最近一次的選項為準；取消後不再列入', async () => {
    h = setup();
    await h.client.demo.loginAsDemoUser();
    const res = await h.client.orders.create(
      createReq([{ ...TEA(), optionIds: ['opt_cup_l', 'opt_sugar_none', 'opt_ice_hot'], note: '加吸管' }], 35),
      newKey(),
    );
    let tea = (await h.client.me.frequentItems()).items.find((i) => i.productId === 'prd_black_tea');
    expect(tea).toMatchObject({ optionLabels: ['大杯', '無糖', '熱'], note: '加吸管', orderCount: 2 });
    h.client.demo.setState({ autoSimulate: false });
    await h.client.orders.cancel(res.order.id);
    tea = (await h.client.me.frequentItems()).items.find((i) => i.productId === 'prd_black_tea');
    expect(tea).toMatchObject({ optionLabels: ['中杯', '半糖', '微冰'], orderCount: 1 });
  });
});

describe('me.remove（05 §7.2）', () => {
  it('帳號刪除：去識別化、實體刪除地址 / 最愛 / 優惠券；訂單保留金額與品項；Session 清除', async () => {
    h = setup();
    await h.client.demo.loginAsDemoUser();
    await h.client.me.remove();
    expect((await rejection(h.client.me.get())).status).toBe(401);
    // 同手機重新登入視為新帳號，沒有舊資料
    const again = await h.client.auth.verifyOtp('0900000000', '123456');
    expect(again.isNewUser).toBe(true);
    expect((await h.client.me.addresses.list()).items).toEqual([]);
    expect((await h.client.me.favorites.list()).productIds).toEqual([]);
    expect((await h.client.orders.list({ tab: 'completed' })).items).toEqual([]);
    const db = JSON.parse(h.storage.getItem('zaiorder:v1:db') ?? '{}') as {
      orders: Array<{ user_id: string | null; customer_phone: string | null; total_amount: number }>;
    };
    expect(db.orders.filter((o) => o.total_amount > 0)).toHaveLength(3);
    expect(db.orders.every((o) => o.user_id === null && o.customer_phone === null)).toBe(true);
  });
});

function line299() {
  return {
    productId: 'prd_combo_share',
    quantity: 1,
    optionIds: ['opt_sm_lurou', 'opt_sm_chicken', 'opt_ss_oyster', 'opt_sd_greens'],
  };
}
