// 路徑 / 方法 / 標頭 / body / 查詢字串（06 §2、§5；07 §5）
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateOrderRequest, CreateOrderResponse, QuoteRequest } from '@/domain/types';
import { createHttpApiClient, createHttpClient } from '../createHttpClient';
import type { HttpApiClient } from '../createHttpClient';
import {
  BASE_URL,
  jsonResponse,
  memorySession,
  OLD_TOKENS,
  STORE_SLUG,
  stubFetch,
} from './helpers';
import type { FetchStub, MemorySession } from './helpers';

const S = `${BASE_URL}/stores/${STORE_SLUG}`;

/** 回應一律為 `200 {}`；`session` 省略即不接 Session 埠 */
function setup(opts: { session?: MemorySession } = {}): { api: HttpApiClient; stub: FetchStub } {
  const stub = stubFetch(() => jsonResponse(200, {}));
  const api = createHttpApiClient({
    baseUrl: BASE_URL,
    storeSlug: STORE_SLUG,
    session: opts.session,
    retry: { baseDelayMs: 1 },
  });
  return { api, stub };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createHttpClient 公開型別', () => {
  it('回傳 ApiClient（可只給 baseUrl 與 storeSlug，供 createApiClient 呼叫）', () => {
    const client = createHttpClient({ baseUrl: BASE_URL, storeSlug: STORE_SLUG });
    expect(typeof client.orders.create).toBe('function');
    expect(typeof client.me.addresses.list).toBe('function');
  });
});

describe('認證端點（公開：不帶 Authorization）', () => {
  it('sendOtp / verifyOtp', async () => {
    const { api, stub } = setup({ session: memorySession() });
    await api.auth.sendOtp('0912345678');
    await api.auth.verifyOtp('0912345678', '123456');

    expect(stub.calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', `${BASE_URL}/auth/otp/send`, { phone: '0912345678' }],
      ['POST', `${BASE_URL}/auth/otp/verify`, { phone: '0912345678', code: '123456' }],
    ]);
    for (const c of stub.calls) {
      expect(c.headers.authorization).toBeUndefined();
      expect(c.headers['content-type']).toBe('application/json');
    }
  });

  it('Body 模式的 refresh / logout 帶 refreshToken', async () => {
    const stub = stubFetch((call) =>
      call.url.endsWith('/auth/refresh')
        ? jsonResponse(200, { tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 900 } })
        : jsonResponse(204),
    );
    const api = createHttpApiClient({ baseUrl: BASE_URL, storeSlug: STORE_SLUG });

    const refreshed = await api.auth.refresh('rt-1');
    await api.auth.logout('rt-1');

    expect(refreshed.tokens.accessToken).toBe('a');
    expect(stub.calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', `${BASE_URL}/auth/refresh`, { refreshToken: 'rt-1' }],
      ['POST', `${BASE_URL}/auth/logout`, { refreshToken: 'rt-1' }],
    ]);
  });

  it('Cookie 模式的 refresh / logout 不帶 body，且以 credentials: include 送出', async () => {
    const stub = stubFetch((call) =>
      call.url.endsWith('/auth/refresh')
        ? jsonResponse(200, { tokens: { accessToken: 'a', expiresIn: 900 } })
        : jsonResponse(204),
    );
    const api = createHttpApiClient({ baseUrl: BASE_URL, storeSlug: STORE_SLUG });

    await api.auth.refresh();
    await api.auth.logout();

    for (const c of stub.calls) {
      expect(c.method).toBe('POST');
      expect(c.body).toBeUndefined();
      expect(c.credentials).toBe('include');
    }
  });

  it('logout 回 204 時解析為 undefined', async () => {
    const stub = stubFetch(() => jsonResponse(204));
    const api = createHttpApiClient({ baseUrl: BASE_URL, storeSlug: STORE_SLUG });
    await expect(api.auth.logout('rt')).resolves.toBeUndefined();
    expect(stub.calls).toHaveLength(1);
  });
});

describe('店家與菜單（公開 GET：不帶 Authorization，即使已登入）', () => {
  it('路徑與查詢字串', async () => {
    const { api, stub } = setup({ session: memorySession(OLD_TOKENS) });

    await api.store.getInfo();
    await api.store.getStatus();
    await api.store.getMenu();
    await api.store.getProduct('prd_lurou');
    await api.store.getBanners();
    await api.store.getPickupSlots({ orderType: 'DELIVERY', zipCode: '106' });
    await api.store.getPickupSlots({ orderType: 'PICKUP' });
    await api.store.getDeliveryZones();
    await api.store.checkDelivery('106');
    await api.store.resolveTable('tbl_qr_01');

    expect(stub.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${S}`,
      `GET ${S}/status`,
      `GET ${S}/menu`,
      `GET ${S}/products/prd_lurou`,
      `GET ${S}/banners`,
      `GET ${S}/pickup-slots?orderType=DELIVERY&zipCode=106`,
      `GET ${S}/pickup-slots?orderType=PICKUP`,
      `GET ${S}/delivery-zones`,
      `GET ${S}/delivery-check?zipCode=106`,
      `GET ${S}/tables/tbl_qr_01`,
    ]);
    for (const c of stub.calls) {
      expect(c.headers.authorization).toBeUndefined();
      expect(c.body).toBeUndefined();
    }
  });

  it('路徑區段與查詢值都會編碼；baseUrl 結尾斜線被忽略', async () => {
    const stub = stubFetch(() => jsonResponse(200, {}));
    const api = createHttpApiClient({
      baseUrl: 'https://api.example.com/api/v1/',
      storeSlug: 'a b',
    });

    await api.store.resolveTable('x/y?z');
    await api.store.checkDelivery('1 6');

    expect(stub.calls.map((c) => c.url)).toEqual([
      'https://api.example.com/api/v1/stores/a%20b/tables/x%2Fy%3Fz',
      'https://api.example.com/api/v1/stores/a%20b/delivery-check?zipCode=1+6',
    ]);
  });
});

describe('訂單', () => {
  const quoteReq: QuoteRequest = {
    orderType: 'PICKUP',
    items: [{ productId: 'prd_lurou', quantity: 2, optionIds: ['opt_bowl_l'] }],
    scheduledAt: null,
    couponCode: 'WELCOME50',
  };
  const createReq: CreateOrderRequest = {
    orderType: 'PICKUP',
    items: [{ productId: 'prd_lurou', quantity: 1, optionIds: [], note: '不要蔥' }],
    scheduledAt: null,
    contact: { name: '王小明', phone: '0912345678' },
    paymentMethod: 'CASH',
    invoice: { type: 'PAPER' },
    needUtensils: false,
    expectedTotal: 92,
  };

  it('quote：POST，有權杖時附 Bearer', async () => {
    const { api, stub } = setup({ session: memorySession(OLD_TOKENS) });
    await api.orders.quote(quoteReq);

    const [c] = stub.calls;
    expect(c?.method).toBe('POST');
    expect(c?.url).toBe(`${S}/orders/quote`);
    expect(c?.body).toEqual(quoteReq);
    expect(c?.headers.authorization).toBe('Bearer at-old');
    expect(c?.headers['idempotency-key']).toBeUndefined();
  });

  it('create：帶 Idempotency-Key；訪客不附 Authorization', async () => {
    const { api, stub } = setup({ session: memorySession(null) });
    await api.orders.create(createReq, 'idem-0001');

    const [c] = stub.calls;
    expect(c?.method).toBe('POST');
    expect(c?.url).toBe(`${S}/orders`);
    expect(c?.body).toEqual(createReq);
    expect(c?.headers['idempotency-key']).toBe('idem-0001');
    expect(c?.headers.authorization).toBeUndefined();
  });

  it('create：會員附 Bearer（訂單歸屬會員）', async () => {
    const { api, stub } = setup({ session: memorySession(OLD_TOKENS) });
    await api.orders.create(createReq, 'idem-0002');
    expect(stub.calls[0]?.headers.authorization).toBe('Bearer at-old');
  });

  it('create：replayed 以回應 body 為準，原樣回傳（不被標頭覆寫）', async () => {
    const body = {
      order: { id: 'ord_1' },
      trackingToken: 'trk_2',
      nextAction: 'TRACK',
      replayed: true,
    };
    stubFetch(
      () =>
        new Response(JSON.stringify(body), {
          status: 201,
          headers: { 'Content-Type': 'application/json', 'Idempotent-Replayed': 'false' },
        }),
    );
    const api = createHttpApiClient({ baseUrl: BASE_URL, storeSlug: STORE_SLUG });

    const res: CreateOrderResponse = await api.orders.create(createReq, 'idem-0003');
    expect(res.replayed).toBe(true);
    expect(res.trackingToken).toBe('trk_2');

    stubFetch(() => jsonResponse(201, { order: { id: 'ord_2' }, nextAction: 'PAY' }));
    const first = await api.orders.create(createReq, 'idem-0004');
    expect(first.replayed).toBeUndefined();
  });

  it('list：tab / limit / cursor 查詢字串（未提供者省略）', async () => {
    const { api, stub } = setup({ session: memorySession(OLD_TOKENS) });
    await api.orders.list({ tab: 'active' });
    await api.orders.list({ tab: 'completed', limit: 10, cursor: 'abc=' });

    expect(stub.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${BASE_URL}/orders?tab=active`,
      `GET ${BASE_URL}/orders?tab=completed&limit=10&cursor=abc%3D`,
    ]);
    expect(stub.calls[0]?.headers.authorization).toBe('Bearer at-old');
  });

  it('get：訪客以 X-Tracking-Token 存取；會員不帶', async () => {
    const { api, stub } = setup({ session: memorySession(null) });
    await api.orders.get('ord_1', { trackingToken: 'trk_abc' });
    await api.orders.get('ord_1');

    expect(stub.calls[0]?.url).toBe(`${BASE_URL}/orders/ord_1`);
    expect(stub.calls[0]?.headers['x-tracking-token']).toBe('trk_abc');
    expect(stub.calls[1]?.headers['x-tracking-token']).toBeUndefined();
  });

  it('cancel：POST /cancel，body 為 { reason }，帶追蹤權杖', async () => {
    const { api, stub } = setup({ session: memorySession(null) });
    await api.orders.cancel('ord_1', '不小心點錯了', { trackingToken: 'trk_abc' });
    await api.orders.cancel('ord_1');

    expect(stub.calls[0]?.method).toBe('POST');
    expect(stub.calls[0]?.url).toBe(`${BASE_URL}/orders/ord_1/cancel`);
    expect(stub.calls[0]?.body).toEqual({ reason: '不小心點錯了' });
    expect(stub.calls[0]?.headers['x-tracking-token']).toBe('trk_abc');
    expect(stub.calls[1]?.body).toEqual({});
  });

  it('lookup：GET /orders/lookup?orderNo&phone，公開（不帶 Authorization）', async () => {
    const { api, stub } = setup({ session: memorySession(OLD_TOKENS) });
    await api.orders.lookup('ZO261014K7M3QX', '0912345678');

    expect(stub.calls[0]?.method).toBe('GET');
    expect(stub.calls[0]?.url).toBe(
      `${BASE_URL}/orders/lookup?orderNo=ZO261014K7M3QX&phone=0912345678`,
    );
    expect(stub.calls[0]?.headers.authorization).toBeUndefined();
  });

  it('pay：POST /payments，帶追蹤權杖', async () => {
    const { api, stub } = setup({ session: memorySession(null) });
    await api.orders.pay(
      'ord_1',
      { method: 'LINE_PAY', returnUrl: 'https://x/y' },
      {
        trackingToken: 'trk_abc',
      },
    );

    expect(stub.calls[0]?.method).toBe('POST');
    expect(stub.calls[0]?.url).toBe(`${BASE_URL}/orders/ord_1/payments`);
    expect(stub.calls[0]?.body).toEqual({ method: 'LINE_PAY', returnUrl: 'https://x/y' });
    expect(stub.calls[0]?.headers['x-tracking-token']).toBe('trk_abc');
  });
});

describe('會員（附 Bearer）', () => {
  it('個人資料', async () => {
    const { api, stub } = setup({ session: memorySession(OLD_TOKENS) });
    await api.me.get();
    await api.me.update({ name: '王小明', marketingOptIn: true });
    await api.me.remove();

    expect(stub.calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['GET', `${BASE_URL}/me`, undefined],
      ['PATCH', `${BASE_URL}/me`, { name: '王小明', marketingOptIn: true }],
      ['DELETE', `${BASE_URL}/me`, undefined],
    ]);
    for (const c of stub.calls) expect(c.headers.authorization).toBe('Bearer at-old');
  });

  it('地址簿', async () => {
    const { api, stub } = setup({ session: memorySession(OLD_TOKENS) });
    const input = {
      label: '家',
      recipientName: '王小明',
      recipientPhone: '0912345678',
      city: '臺北市',
      district: '大安區',
      zipCode: '106',
      line: '示範路 100 號',
      isDefault: true,
    };
    await api.me.addresses.list();
    await api.me.addresses.create(input);
    await api.me.addresses.update('adr_1', { isDefault: true });
    await api.me.addresses.remove('adr_1');

    expect(stub.calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['GET', `${BASE_URL}/me/addresses`, undefined],
      ['POST', `${BASE_URL}/me/addresses`, input],
      ['PATCH', `${BASE_URL}/me/addresses/adr_1`, { isDefault: true }],
      ['DELETE', `${BASE_URL}/me/addresses/adr_1`, undefined],
    ]);
  });

  it('收藏、優惠券、常點', async () => {
    const { api, stub } = setup({ session: memorySession(OLD_TOKENS) });
    await api.me.favorites.list();
    await api.me.favorites.add('prd_lurou');
    await api.me.favorites.remove('prd_lurou');
    await api.me.coupons.list();
    await api.me.coupons.list('AVAILABLE');
    await api.me.frequentItems();
    await api.me.frequentItems(20);

    expect(stub.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${BASE_URL}/me/favorites`,
      `PUT ${BASE_URL}/me/favorites/prd_lurou`,
      `DELETE ${BASE_URL}/me/favorites/prd_lurou`,
      `GET ${BASE_URL}/me/coupons`,
      `GET ${BASE_URL}/me/coupons?status=AVAILABLE`,
      `GET ${BASE_URL}/me/frequent-items`,
      `GET ${BASE_URL}/me/frequent-items?limit=20`,
    ]);
  });
});

describe('204 與空本文', () => {
  it('204 的 void 端點解析為 undefined', async () => {
    const stub = stubFetch(() => jsonResponse(204));
    const api = createHttpApiClient({
      baseUrl: BASE_URL,
      storeSlug: STORE_SLUG,
      session: memorySession(OLD_TOKENS),
    });

    await expect(api.me.remove()).resolves.toBeUndefined();
    await expect(api.me.favorites.add('prd_1')).resolves.toBeUndefined();
    await expect(api.me.favorites.remove('prd_1')).resolves.toBeUndefined();
    await expect(api.me.addresses.remove('adr_1')).resolves.toBeUndefined();
    expect(stub.calls).toHaveLength(4);
  });

  it('void 端點回 200 與本文時忽略本文', async () => {
    stubFetch(() => jsonResponse(200, { ok: true }));
    const api = createHttpApiClient({
      baseUrl: BASE_URL,
      storeSlug: STORE_SLUG,
      session: memorySession(OLD_TOKENS),
    });
    await expect(api.me.favorites.add('prd_1')).resolves.toBeUndefined();
  });
});
