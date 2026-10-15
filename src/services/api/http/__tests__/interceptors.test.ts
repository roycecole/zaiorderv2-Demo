// 錯誤正規化、GET 重試 / POST 不重試、逾時、取消（07 §5.4、§10；FLOW-15、FLOW-24）
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateOrderRequest, QuoteResponse } from '@/domain/types';
import { createHttpApiClient } from '../createHttpClient';
import type { HttpApiClient } from '../createHttpClient';
import { ApiError, REQUEST_TIMEOUT_MS } from '../request';
import {
  BASE_URL,
  errorResponse,
  htmlResponse,
  jsonResponse,
  memorySession,
  never,
  networkFailure,
  OLD_TOKENS,
  STORE_SLUG,
  stubFetch,
} from './helpers';
import type { Handler } from './helpers';

const createReq: CreateOrderRequest = {
  orderType: 'PICKUP',
  items: [{ productId: 'prd_lurou', quantity: 1, optionIds: [] }],
  scheduledAt: null,
  contact: { name: '王小明', phone: '0912345678' },
  paymentMethod: 'CASH',
  invoice: { type: 'PAPER' },
  needUtensils: false,
  expectedTotal: 92,
};

function client(handler: Handler, opts: { baseDelayMs?: number } = {}) {
  const stub = stubFetch(handler);
  const api: HttpApiClient = createHttpApiClient({
    baseUrl: BASE_URL,
    storeSlug: STORE_SLUG,
    session: memorySession(OLD_TOKENS),
    retry: { baseDelayMs: opts.baseDelayMs ?? 1 },
  });
  return { api, stub };
}

/** 捕捉 rejection 的 ApiError，便於逐欄斷言 */
async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('預期丟出 ApiError，但呼叫成功');
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('錯誤正規化（所有非 2xx 轉為 ApiError）', () => {
  it('保留伺服器的 status / code / message，body 即 error 物件', async () => {
    const { api } = client(() =>
      errorResponse(404, 'NOT_FOUND', { requestId: 'req_1', message: '找不到訂單' }),
    );
    const err = await failure(api.orders.get('ord_x'));
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('找不到訂單');
    expect(err.body?.requestId).toBe('req_1');
  });

  it('400 VALIDATION_FAILED 的 details 與 OTP_INVALID 的 remainingAttempts 留在 body', async () => {
    const { api } = client((call) =>
      call.url.endsWith('/otp/verify')
        ? errorResponse(400, 'OTP_INVALID', { remainingAttempts: 2 })
        : errorResponse(400, 'VALIDATION_FAILED', {
            details: [{ field: 'contact.phone', message: '手機格式不正確' }],
          }),
    );
    const otp = await failure(api.auth.verifyOtp('0912345678', '000000'));
    expect(otp.code).toBe('OTP_INVALID');
    expect(otp.body?.remainingAttempts).toBe(2);

    const validation = await failure(api.orders.create(createReq, 'k1'));
    expect(validation.code).toBe('VALIDATION_FAILED');
    expect(validation.body?.details?.[0]?.field).toBe('contact.phone');
  });

  it('POST /orders 的 422 與 409 PRICE_CHANGED 帶 body.quote', async () => {
    const quote = { valid: false, checks: [], total: 0 } as unknown as QuoteResponse;
    const { api } = client(() => errorResponse(422, 'ITEM_SOLD_OUT', { quote }));
    const err = await failure(api.orders.create(createReq, 'k2'));
    expect(err.status).toBe(422);
    expect(err.code).toBe('ITEM_SOLD_OUT');
    expect(err.body?.quote).toEqual(quote);
  });

  it('429 / 503 的 retryAfterSeconds 保留於 ApiError.body', async () => {
    const { api } = client((call) =>
      call.url.endsWith('/otp/send')
        ? errorResponse(429, 'OTP_RATE_LIMITED', { retryAfterSeconds: 45 })
        : errorResponse(503, 'SERVICE_UNAVAILABLE', { retryAfterSeconds: 3 }),
    );
    const limited = await failure(api.auth.sendOtp('0912345678'));
    expect(limited.status).toBe(429);
    expect(limited.code).toBe('OTP_RATE_LIMITED');
    expect(limited.body?.retryAfterSeconds).toBe(45);

    const busy = await failure(api.orders.create(createReq, 'k3'));
    expect(busy.status).toBe(503);
    expect(busy.body?.retryAfterSeconds).toBe(3);
  });

  it('沒有 JSON 錯誤本文（閘道 HTML 頁）時依狀態碼補上錯誤碼', async () => {
    for (const [status, code] of [
      [502, 'SERVICE_UNAVAILABLE'],
      [503, 'SERVICE_UNAVAILABLE'],
      [504, 'SERVICE_UNAVAILABLE'],
      [500, 'INTERNAL_ERROR'],
      [404, 'NOT_FOUND'],
      [429, 'RATE_LIMITED'],
    ] as const) {
      const { api } = client(() => htmlResponse(status));
      // 用 POST 避免 GET 的重試干擾；quote 為 POST
      const err = await failure(
        api.orders.quote({ orderType: 'PICKUP', items: [], scheduledAt: null }),
      );
      expect(err.status).toBe(status);
      expect(err.code).toBe(code);
      expect(err.body).toBeUndefined();
    }
  });

  it('2xx 但本文不是 JSON（例如 API 網址設錯被 SPA fallback）：視為伺服器錯誤，不回傳 undefined', async () => {
    const { api } = client(
      () =>
        new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    const err = await failure(api.orders.create(createReq, 'k4'));
    expect(err.status).toBe(502);
    expect(err.code).toBe('INTERNAL_ERROR');
  });
});

describe('GET 自動重試（網路中斷 / 5xx，最多 2 次）', () => {
  it('網路中斷兩次後成功：共 3 次請求，回傳最終結果', async () => {
    const { api, stub } = client((_call, i) => {
      if (i < 2) return networkFailure();
      return jsonResponse(200, { items: [] });
    });
    await expect(api.store.getBanners()).resolves.toEqual({ items: [] });
    expect(stub.calls).toHaveLength(3);
  });

  it('5xx 重試；仍失敗時丟出最後一次的錯誤（共 3 次）', async () => {
    const { api, stub } = client(() => errorResponse(500, 'INTERNAL_ERROR', { requestId: 'r' }));
    const err = await failure(api.store.getMenu());
    expect(err.status).toBe(500);
    expect(err.body?.requestId).toBe('r');
    expect(stub.calls).toHaveLength(3);
  });

  it('持續無回應：丟出 status 0 的 SERVICE_UNAVAILABLE（共 3 次）', async () => {
    const { api, stub } = client(() => networkFailure());
    const err = await failure(api.store.getInfo());
    expect(err.status).toBe(0);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
    expect(stub.calls).toHaveLength(3);
  });

  it('4xx、429 與附 retryAfterSeconds 的 503 不重試', async () => {
    for (const response of [
      () => errorResponse(404, 'NOT_FOUND'),
      () => errorResponse(429, 'RATE_LIMITED', { retryAfterSeconds: 10 }),
      () => errorResponse(503, 'SERVICE_UNAVAILABLE', { retryAfterSeconds: 10 }),
    ]) {
      const { api, stub } = client(() => response());
      await failure(api.store.getMenu());
      expect(stub.calls).toHaveLength(1);
    }
  });

  it('指數退避：300ms、600ms', async () => {
    vi.useFakeTimers();
    const stub = stubFetch(() => networkFailure());
    const api = createHttpApiClient({ baseUrl: BASE_URL, storeSlug: STORE_SLUG });

    const settled = failure(api.store.getMenu());
    await vi.advanceTimersByTimeAsync(0);
    expect(stub.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(299);
    expect(stub.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); // 300ms：第 1 次重試
    expect(stub.calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(599);
    expect(stub.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); // 再 600ms：第 2 次重試
    expect(stub.calls).toHaveLength(3);

    const err = await settled;
    expect(err.status).toBe(0);
  });
});

describe('POST 不重試（POST /orders 結果未知須原樣丟出，FLOW-24）', () => {
  it('無回應：丟出 status 0 的 SERVICE_UNAVAILABLE，只送一次', async () => {
    const { api, stub } = client(() => networkFailure());
    const err = await failure(api.orders.create(createReq, 'k5'));
    expect(err.status).toBe(0);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
    expect(stub.calls).toHaveLength(1);
  });

  it('5xx：原樣丟出，只送一次', async () => {
    const { api, stub } = client(() => errorResponse(500, 'INTERNAL_ERROR'));
    const err = await failure(api.orders.create(createReq, 'k6'));
    expect(err.status).toBe(500);
    expect(stub.calls).toHaveLength(1);
  });

  it('quote、cancel、pay、sendOtp 等其他 POST 同樣不重試', async () => {
    const { api, stub } = client(() => networkFailure());
    await failure(api.orders.quote({ orderType: 'PICKUP', items: [], scheduledAt: null }));
    await failure(api.orders.cancel('ord_1'));
    await failure(api.orders.pay('ord_1', { method: 'CASH' }));
    await failure(api.auth.sendOtp('0912345678'));
    expect(stub.calls).toHaveLength(4);
  });

  it('非 GET（PATCH / PUT / DELETE）也不重試', async () => {
    const { api, stub } = client(() => networkFailure());
    await failure(api.me.update({ name: 'x' }));
    await failure(api.me.favorites.add('prd_1'));
    await failure(api.me.addresses.remove('adr_1'));
    expect(stub.calls).toHaveLength(3);
  });
});

describe('逾時', () => {
  it(`${REQUEST_TIMEOUT_MS / 1000} 秒無回應視為 status 0 的 SERVICE_UNAVAILABLE（POST 不重試）`, async () => {
    vi.useFakeTimers();
    const stub = stubFetch(() => never());
    const api = createHttpApiClient({ baseUrl: BASE_URL, storeSlug: STORE_SLUG });

    const settled = failure(api.orders.create(createReq, 'k7'));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(stub.calls[0]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const err = await settled;
    expect(err.status).toBe(0);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
    expect(stub.calls).toHaveLength(1);
  });

  it('GET 逾時同樣會重試（每次各自 10 秒）', async () => {
    vi.useFakeTimers();
    const stub = stubFetch(() => never());
    const api = createHttpApiClient({
      baseUrl: BASE_URL,
      storeSlug: STORE_SLUG,
      retry: { baseDelayMs: 100 },
    });

    const settled = failure(api.store.getMenu());
    // 3 次請求 × 10s ＋ 退避 100ms、200ms
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 3 + 300);

    const err = await settled;
    expect(err.status).toBe(0);
    expect(stub.calls).toHaveLength(3);
  });
});

describe('呼叫端取消（AbortSignal）不是錯誤', () => {
  it('請求進行中取消：丟出 AbortError，不是 ApiError，也不重試', async () => {
    const stub = stubFetch(() => never());
    const api = createHttpApiClient({
      baseUrl: BASE_URL,
      storeSlug: STORE_SLUG,
      session: memorySession(OLD_TOKENS),
      retry: { baseDelayMs: 1 },
    });
    const controller = new AbortController();

    const pending = api.orders.quote(
      { orderType: 'PICKUP', items: [], scheduledAt: null },
      { signal: controller.signal },
    );
    const settled = pending.then(
      () => null,
      (e: unknown) => e,
    );
    await Promise.resolve();
    controller.abort();

    const error = await settled;
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as DOMException).name).toBe('AbortError');
    expect(stub.calls).toHaveLength(1);
  });

  it('送出前已取消：不發出請求就以 AbortError 結束', async () => {
    const stub = stubFetch(() => jsonResponse(200, {}));
    const api = createHttpApiClient({ baseUrl: BASE_URL, storeSlug: STORE_SLUG });
    const controller = new AbortController();
    controller.abort();

    const error = await api.store.getMenu({ signal: controller.signal }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as DOMException).name).toBe('AbortError');
    expect(stub.calls.length).toBeLessThanOrEqual(1);
  });

  it('GET 在重試退避期間取消：立刻以 AbortError 結束，不再重試', async () => {
    const stub = stubFetch(() => networkFailure());
    const api = createHttpApiClient({
      baseUrl: BASE_URL,
      storeSlug: STORE_SLUG,
      retry: { baseDelayMs: 60_000 },
    });
    const controller = new AbortController();

    const settled = api.store.getMenu({ signal: controller.signal }).then(
      () => null,
      (e: unknown) => e,
    );
    // 等第一次失敗、進入退避
    await vi.waitFor(() => expect(stub.calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();

    const error = await settled;
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as DOMException).name).toBe('AbortError');
    expect(stub.calls).toHaveLength(1);
  });

  it('取消不會使 Session 被清除', async () => {
    const session = memorySession(OLD_TOKENS);
    stubFetch(() => never());
    const api = createHttpApiClient({ baseUrl: BASE_URL, storeSlug: STORE_SLUG, session });
    const controller = new AbortController();

    const settled = api.me.get({ signal: controller.signal }).catch(() => undefined);
    await Promise.resolve();
    controller.abort();
    await settled;

    expect(session.clearSession).not.toHaveBeenCalled();
    expect(session.tokens).toEqual(OLD_TOKENS);
  });
});
