// 401 → refresh → 重送一次；併發共用同一個 refresh（06 §1.3、§5.2a；FLOW-15）
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpApiClient } from '../createHttpClient';
import type { HttpApiClient } from '../createHttpClient';
import { ApiError } from '../request';
import {
  BASE_URL,
  deferred,
  errorResponse,
  jsonResponse,
  memorySession,
  networkFailure,
  NEW_TOKENS,
  OLD_TOKENS,
  STORE_SLUG,
  stubFetch,
} from './helpers';
import type { MemorySession, RecordedCall } from './helpers';

const REFRESH_URL = `${BASE_URL}/auth/refresh`;
const PROFILE = {
  id: 'usr_1',
  phone: '0912345678',
  marketingOptIn: false,
  createdAt: '2026-10-14T12:00:00+08:00',
};

const isRefresh = (call: RecordedCall): boolean => call.url === REFRESH_URL;
const bearer = (call: RecordedCall): string | undefined => call.headers.authorization;

function make(session: MemorySession | undefined): HttpApiClient {
  return createHttpApiClient({
    baseUrl: BASE_URL,
    storeSlug: STORE_SLUG,
    session,
    retry: { baseDelayMs: 1 },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Authorization 標頭', () => {
  it('有權杖時以 Bearer 附帶；換發後重送改用新權杖', async () => {
    const session = memorySession(OLD_TOKENS);
    const stub = stubFetch((call) => {
      if (isRefresh(call)) return jsonResponse(200, { tokens: NEW_TOKENS });
      return bearer(call) === 'Bearer at-new'
        ? jsonResponse(200, PROFILE)
        : errorResponse(401, 'UNAUTHORIZED');
    });

    await expect(make(session).me.get()).resolves.toEqual(PROFILE);

    expect(stub.calls.map((c) => bearer(c))).toEqual(['Bearer at-old', undefined, 'Bearer at-new']);
  });

  it('Cookie 模式：只有 accessToken 時一樣附 Bearer；refresh 不帶 body', async () => {
    const session = memorySession({ accessToken: 'at-cookie', expiresIn: 900 });
    const stub = stubFetch((call) => {
      if (isRefresh(call)) {
        return jsonResponse(200, { tokens: { accessToken: 'at-cookie-2', expiresIn: 900 } });
      }
      return bearer(call) === 'Bearer at-cookie-2'
        ? jsonResponse(200, PROFILE)
        : errorResponse(401, 'UNAUTHORIZED');
    });

    await make(session).me.get();

    expect(stub.calls[0]?.headers.authorization).toBe('Bearer at-cookie');
    const refresh = stub.calls[1];
    expect(refresh?.url).toBe(REFRESH_URL);
    expect(refresh?.body).toBeUndefined();
    expect(refresh?.credentials).toBe('include');
    expect(session.tokens).toEqual({ accessToken: 'at-cookie-2', expiresIn: 900 });
  });
});

describe('401 → refresh → 重送一次', () => {
  it('成功：以 Session 內的 Refresh Token 換發（無 Authorization）、寫回新權杖、重送原請求', async () => {
    const session = memorySession(OLD_TOKENS);
    const stub = stubFetch((call) => {
      if (isRefresh(call)) return jsonResponse(200, { tokens: NEW_TOKENS });
      return bearer(call) === 'Bearer at-new'
        ? jsonResponse(200, PROFILE)
        : errorResponse(401, 'UNAUTHORIZED');
    });

    const profile = await make(session).me.get();

    expect(profile).toEqual(PROFILE);
    expect(stub.calls).toHaveLength(3);
    const refresh = stub.calls[1];
    expect(refresh?.method).toBe('POST');
    expect(refresh?.body).toEqual({ refreshToken: 'rt-old' });
    expect(refresh?.headers.authorization).toBeUndefined();
    expect(session.setTokens).toHaveBeenCalledWith(NEW_TOKENS);
    expect(session.clearSession).not.toHaveBeenCalled();
  });

  it('重送的請求內容（方法、路徑、body、標頭）與原請求相同', async () => {
    const session = memorySession(OLD_TOKENS);
    const stub = stubFetch((call) => {
      if (isRefresh(call)) return jsonResponse(200, { tokens: NEW_TOKENS });
      return bearer(call) === 'Bearer at-new'
        ? jsonResponse(201, { order: { id: 'ord_1' }, nextAction: 'TRACK' })
        : errorResponse(401, 'UNAUTHORIZED');
    });

    await make(session).orders.create(
      {
        orderType: 'PICKUP',
        items: [],
        scheduledAt: null,
        contact: {},
        paymentMethod: 'CASH',
        invoice: { type: 'PAPER' },
        needUtensils: false,
        expectedTotal: 0,
      },
      'idem-1',
    );

    const [first, , retried] = stub.calls;
    expect(retried?.method).toBe(first?.method);
    expect(retried?.url).toBe(first?.url);
    expect(retried?.body).toEqual(first?.body);
    expect(retried?.headers['idempotency-key']).toBe('idem-1');
    expect(first?.headers['idempotency-key']).toBe('idem-1');
  });

  it('refresh 被拒（401）：清除 Session 並丟出 UNAUTHORIZED，不重送原請求', async () => {
    const session = memorySession(OLD_TOKENS);
    const stub = stubFetch((call) =>
      isRefresh(call)
        ? errorResponse(401, 'UNAUTHORIZED', { message: 'refresh token 已失效' })
        : errorResponse(401, 'UNAUTHORIZED'),
    );

    const err = await make(session)
      .me.get()
      .then(
        () => null,
        (e: unknown) => e as ApiError,
      );

    expect(err).toBeInstanceOf(ApiError);
    expect(err?.status).toBe(401);
    expect(err?.code).toBe('UNAUTHORIZED');
    expect(session.clearSession).toHaveBeenCalledTimes(1);
    expect(session.tokens).toBeNull();
    expect(stub.calls).toHaveLength(2); // 原請求 + refresh；沒有第二次原請求
  });

  it('refresh 被其他 4xx 拒絕（如 403 帳號停用）：同樣清除 Session，丟出 UNAUTHORIZED', async () => {
    const session = memorySession(OLD_TOKENS);
    stubFetch((call) =>
      isRefresh(call) ? errorResponse(403, 'FORBIDDEN') : errorResponse(401, 'UNAUTHORIZED'),
    );

    const err = await make(session)
      .me.get()
      .then(
        () => null,
        (e: unknown) => e as ApiError,
      );
    expect(err?.code).toBe('UNAUTHORIZED');
    expect(err?.status).toBe(401);
    expect(err?.body?.code).toBe('FORBIDDEN'); // 原因保留於 body
    expect(session.clearSession).toHaveBeenCalledTimes(1);
  });

  it('refresh 遇暫時性失敗（網路 / 5xx）：保留 Session，丟出該錯誤而不是 UNAUTHORIZED', async () => {
    for (const handler of [
      (call: RecordedCall) =>
        isRefresh(call) ? networkFailure() : errorResponse(401, 'UNAUTHORIZED'),
      (call: RecordedCall) =>
        isRefresh(call)
          ? errorResponse(503, 'SERVICE_UNAVAILABLE')
          : errorResponse(401, 'UNAUTHORIZED'),
    ]) {
      const session = memorySession(OLD_TOKENS);
      stubFetch(handler);

      const err = await make(session)
        .me.get()
        .then(
          () => null,
          (e: unknown) => e as ApiError,
        );

      expect(err?.code).toBe('SERVICE_UNAVAILABLE');
      expect(session.clearSession).not.toHaveBeenCalled();
      expect(session.tokens).toEqual(OLD_TOKENS);
    }
  });

  it('換發成功但重送仍 401：只重送一次，清除 Session 並丟出 UNAUTHORIZED', async () => {
    const session = memorySession(OLD_TOKENS);
    const stub = stubFetch((call) =>
      isRefresh(call)
        ? jsonResponse(200, { tokens: NEW_TOKENS })
        : errorResponse(401, 'UNAUTHORIZED'),
    );

    const err = await make(session)
      .me.get()
      .then(
        () => null,
        (e: unknown) => e as ApiError,
      );

    expect(err?.code).toBe('UNAUTHORIZED');
    expect(stub.calls).toHaveLength(3); // 原請求、refresh、重送；不會無限迴圈
    expect(session.clearSession).toHaveBeenCalledTimes(1);
  });

  it('伺服器的 401 沒有 JSON 本文時仍正規化為 UNAUTHORIZED', async () => {
    const stub = stubFetch(() => new Response('', { status: 401 }));
    const err = await make(undefined)
      .me.get()
      .then(
        () => null,
        (e: unknown) => e as ApiError,
      );
    expect(err?.code).toBe('UNAUTHORIZED');
    expect(stub.calls).toHaveLength(1);
  });

  it('未接 Session 埠：401 直接丟出，不嘗試 refresh', async () => {
    const stub = stubFetch(() => errorResponse(401, 'UNAUTHORIZED'));
    await expect(make(undefined).me.get()).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
    expect(stub.calls).toHaveLength(1);
  });

  it('訪客（無權杖，Cookie 模式重新整理後）：401 先以 Cookie 嘗試 refresh，成功即還原登入並重送', async () => {
    const session = memorySession(null);
    const stub = stubFetch((call) => {
      if (isRefresh(call))
        return jsonResponse(200, { tokens: { accessToken: 'at-c', expiresIn: 900 } });
      return bearer(call) === 'Bearer at-c'
        ? jsonResponse(200, PROFILE)
        : errorResponse(401, 'UNAUTHORIZED');
    });

    await expect(make(session).me.get()).resolves.toEqual(PROFILE);
    expect(stub.calls[0]?.headers.authorization).toBeUndefined();
    expect(stub.calls[1]?.body).toBeUndefined();
  });

  it('公開端點（店家、菜單）的 401 不觸發 refresh、也不清除 Session', async () => {
    const session = memorySession(OLD_TOKENS);
    const stub = stubFetch(() => errorResponse(401, 'UNAUTHORIZED'));

    await expect(make(session).store.getMenu()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(stub.calls).toHaveLength(1);
    expect(session.clearSession).not.toHaveBeenCalled();
  });
});

describe('併發 refresh', () => {
  it('多個請求同時 401：只打一次 /auth/refresh，全部以新權杖重送成功', async () => {
    const session = memorySession(OLD_TOKENS);
    const gate = deferred();
    const stub = stubFetch(async (call) => {
      if (isRefresh(call)) {
        await gate.promise; // 讓 refresh 停住，確保另外兩個請求都已碰到 401
        return jsonResponse(200, { tokens: NEW_TOKENS });
      }
      return bearer(call) === 'Bearer at-new'
        ? jsonResponse(200, { path: call.url })
        : errorResponse(401, 'UNAUTHORIZED');
    });
    const api = make(session);

    const all = Promise.all([api.me.get(), api.me.addresses.list(), api.me.favorites.list()]);
    await vi.waitFor(() => expect(stub.calls.filter(isRefresh)).toHaveLength(1));
    await vi.waitFor(() =>
      expect(stub.calls.filter((c) => bearer(c) === 'Bearer at-old')).toHaveLength(3),
    );
    gate.resolve();
    await all;

    expect(stub.calls.filter(isRefresh)).toHaveLength(1);
    expect(stub.calls.filter((c) => bearer(c) === 'Bearer at-new')).toHaveLength(3);
    expect(stub.calls).toHaveLength(7);
    expect(session.setTokens).toHaveBeenCalledTimes(1);
  });

  it('併發 refresh 失敗：只打一次、全部丟出 UNAUTHORIZED、Session 只清一次', async () => {
    const session = memorySession(OLD_TOKENS);
    const gate = deferred();
    const stub = stubFetch(async (call) => {
      if (isRefresh(call)) {
        await gate.promise;
        return errorResponse(401, 'UNAUTHORIZED');
      }
      return errorResponse(401, 'UNAUTHORIZED');
    });
    const api = make(session);

    const results = Promise.allSettled([
      api.me.get(),
      api.me.coupons.list(),
      api.me.favorites.list(),
    ]);
    await vi.waitFor(() => expect(stub.calls.filter((c) => !isRefresh(c))).toHaveLength(3));
    gate.resolve();
    const settled = await results;

    expect(settled.every((r) => r.status === 'rejected')).toBe(true);
    for (const r of settled) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      });
    }
    expect(stub.calls.filter(isRefresh)).toHaveLength(1);
    expect(session.clearSession).toHaveBeenCalledTimes(1);
    expect(stub.calls).toHaveLength(4); // 3 個原請求 + 1 次 refresh；沒有重送
  });

  it('refresh 完成「之後」才收到 401 的舊權杖請求：直接以新權杖重送，不再 refresh', async () => {
    const session = memorySession(OLD_TOKENS);
    const slow = deferred<Response>();
    let profileCalls = 0;
    const stub = stubFetch((call) => {
      if (isRefresh(call)) return jsonResponse(200, { tokens: NEW_TOKENS });
      if (call.url.endsWith('/me/addresses')) {
        // 舊權杖的慢請求：等 refresh 都結束了才回 401
        return bearer(call) === 'Bearer at-old' ? slow.promise : jsonResponse(200, { items: [] });
      }
      profileCalls += 1;
      return bearer(call) === 'Bearer at-new'
        ? jsonResponse(200, PROFILE)
        : errorResponse(401, 'UNAUTHORIZED');
    });
    const api = make(session);

    const slowCall = api.me.addresses.list();
    await vi.waitFor(() => expect(stub.calls).toHaveLength(1));
    await api.me.get(); // 這個請求 401 → refresh → 重送，全部完成
    expect(session.tokens).toEqual(NEW_TOKENS);

    slow.resolve(errorResponse(401, 'UNAUTHORIZED'));
    await expect(slowCall).resolves.toEqual({ items: [] });

    expect(stub.calls.filter(isRefresh)).toHaveLength(1);
    expect(profileCalls).toBe(2);
  });

  it('明確呼叫 auth.refresh() 與 401 攔截器共用同一個 in-flight refresh', async () => {
    const session = memorySession(OLD_TOKENS);
    const gate = deferred();
    const stub = stubFetch(async (call) => {
      if (isRefresh(call)) {
        await gate.promise;
        return jsonResponse(200, { tokens: NEW_TOKENS });
      }
      return bearer(call) === 'Bearer at-new'
        ? jsonResponse(200, PROFILE)
        : errorResponse(401, 'UNAUTHORIZED');
    });
    const api = make(session);

    const viaInterceptor = api.me.get();
    await vi.waitFor(() => expect(stub.calls.filter(isRefresh)).toHaveLength(1));
    const explicit = api.auth.refresh('rt-old');
    gate.resolve();

    const [profile, refreshed] = await Promise.all([viaInterceptor, explicit]);
    expect(profile).toEqual(PROFILE);
    expect(refreshed.tokens).toEqual(NEW_TOKENS);
    expect(stub.calls.filter(isRefresh)).toHaveLength(1);
  });

  it('refresh 結束後 in-flight 會釋放：下一次 401 可再次換發', async () => {
    const session = memorySession(OLD_TOKENS);
    let generation = 0;
    const stub = stubFetch((call) => {
      if (isRefresh(call)) {
        generation += 1;
        return jsonResponse(200, {
          tokens: {
            accessToken: `at-${generation}`,
            refreshToken: `rt-${generation}`,
            expiresIn: 900,
          },
        });
      }
      // 只有「剛換發的權杖」有效；每次換發後再用一次就過期
      return bearer(call) === `Bearer at-${generation}` && generation > 0
        ? jsonResponse(200, PROFILE)
        : errorResponse(401, 'UNAUTHORIZED');
    });
    const api = make(session);

    await api.me.get();
    expect(session.tokens?.accessToken).toBe('at-1');

    // 模擬 Access Token 過期：Session 內是失效的權杖，Refresh Token 仍是上次輪替後的 rt-1
    session.setTokens({ accessToken: 'stale', refreshToken: 'rt-1', expiresIn: 900 });
    await api.me.get();

    expect(stub.calls.filter(isRefresh)).toHaveLength(2);
    expect(stub.calls.filter(isRefresh)[1]?.body).toEqual({ refreshToken: 'rt-1' });
  });
});

describe('logout', () => {
  it('帶目前的 Refresh Token 與 Bearer，204 解析為 undefined', async () => {
    const session = memorySession(OLD_TOKENS);
    const stub = stubFetch(() => jsonResponse(204));

    await expect(make(session).auth.logout('rt-old')).resolves.toBeUndefined();

    expect(stub.calls[0]?.url).toBe(`${BASE_URL}/auth/logout`);
    expect(stub.calls[0]?.body).toEqual({ refreshToken: 'rt-old' });
    expect(stub.calls[0]?.headers.authorization).toBe('Bearer at-old');
  });

  it('Access Token 已過期：先換發再登出，且改帶輪替後的新 Refresh Token', async () => {
    const session = memorySession(OLD_TOKENS);
    const stub = stubFetch((call) => {
      if (isRefresh(call)) return jsonResponse(200, { tokens: NEW_TOKENS });
      return bearer(call) === 'Bearer at-new'
        ? jsonResponse(204)
        : errorResponse(401, 'UNAUTHORIZED');
    });

    await make(session).auth.logout('rt-old');

    const logouts = stub.calls.filter((c) => c.url.endsWith('/auth/logout'));
    expect(logouts.map((c) => c.body)).toEqual([
      { refreshToken: 'rt-old' },
      { refreshToken: 'rt-new' },
    ]);
  });

  it('冪等：Session 早已失效（401、換發被拒）仍視為登出成功', async () => {
    const session = memorySession(OLD_TOKENS);
    stubFetch(() => errorResponse(401, 'UNAUTHORIZED'));

    await expect(make(session).auth.logout('rt-old')).resolves.toBeUndefined();
    expect(session.clearSession).toHaveBeenCalled();
  });

  it('網路中斷：照實丟出（呼叫端可重試），不吞掉', async () => {
    stubFetch(() => networkFailure());
    await expect(make(memorySession(OLD_TOKENS)).auth.logout('rt-old')).rejects.toMatchObject({
      status: 0,
      code: 'SERVICE_UNAVAILABLE',
    });
  });
});

describe('auth.refresh（明確呼叫）', () => {
  it('成功：寫回 Session 並回傳 { tokens }', async () => {
    const session = memorySession(OLD_TOKENS);
    const stub = stubFetch(() => jsonResponse(200, { tokens: NEW_TOKENS }));

    const res = await make(session).auth.refresh();

    expect(res).toEqual({ tokens: NEW_TOKENS });
    expect(stub.calls[0]?.body).toEqual({ refreshToken: 'rt-old' });
    expect(session.tokens).toEqual(NEW_TOKENS);
  });

  it('明確傳入的 refreshToken 優先於 Session 內的值', async () => {
    const stub = stubFetch(() => jsonResponse(200, { tokens: NEW_TOKENS }));
    await make(memorySession(OLD_TOKENS)).auth.refresh('rt-explicit');
    expect(stub.calls[0]?.body).toEqual({ refreshToken: 'rt-explicit' });
  });

  it('本文缺少 tokens 視為伺服器錯誤（不寫入 Session）', async () => {
    const session = memorySession(OLD_TOKENS);
    stubFetch(() => jsonResponse(200, {}));
    await expect(make(session).auth.refresh()).rejects.toMatchObject({ status: 502 });
    expect(session.setTokens).not.toHaveBeenCalled();
    expect(session.tokens).toEqual(OLD_TOKENS);
  });
});
