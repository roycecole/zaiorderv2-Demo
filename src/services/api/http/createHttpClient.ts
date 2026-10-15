// src/services/api/http/createHttpClient.ts —— HTTP Adapter（07 §5；06 §2、§5）
//
// 組裝：endpoints（路徑）→ interceptors（Bearer / 401 換發 / GET 重試 / 錯誤正規化）→ request.ts（fetch、逾時）。
// 所有非 2xx 都以 `ApiError` 丟出；呼叫端主動取消丟 AbortError（不是錯誤）；POST 不重試（含 POST /orders，FLOW-24）。
import type { ApiClient, TrackingOpts } from '../ApiClient';
import type { StoreStatus } from '@/domain/types';
import { createRefreshCoordinator } from './auth';
import { createClockSync } from './clockSync';
import {
  AUTH_PATHS,
  buildUrl,
  IDEMPOTENCY_KEY_HEADER,
  ME_PATHS,
  ORDER_PATHS,
  storePaths,
  TRACKING_TOKEN_HEADER,
} from './endpoints';
import type { QueryValue } from './endpoints';
import { ApiError } from './request';
import { createTransport } from './interceptors';
import type { AuthMode, RetryPolicy } from './interceptors';
import type { SessionPort } from './sessionPort';

export type { SessionPort } from './sessionPort';
export type { RetryPolicy } from './interceptors';

export interface HttpClientOptions {
  /** API 根網址（`VITE_API_BASE_URL`），例：`/api/v1` 或 `https://api.example.com/api/v1`；結尾斜線會被忽略 */
  baseUrl: string;
  /** 店家識別（`VITE_STORE_SLUG`）：位於路徑 `/stores/{storeSlug}`（06 §1.1） */
  storeSlug: string;
  /**
   * Session 存取埠（由 app 層接 sessionStore）。省略時所有請求匿名送出，401 不換發。
   * Cookie 模式（06 §1.3）同樣經由此埠保存記憶體中的 Access Token。
   */
  session?: SessionPort;
  /** GET 重試策略（預設 2 次、300ms 起指數退避）；測試可縮短等待 */
  retry?: Partial<RetryPolicy>;
}

/** 每個呼叫可選的附加參數；放在原有參數之後（最後一個位置） */
export interface CallOptions {
  /** 取消訊號（例如 quote 被新請求取代、離開頁面）。取消時丟出 AbortError，不轉為 ApiError、不重試 */
  signal?: AbortSignal;
}

type WithCallOptions<T> = T extends (...args: infer A) => infer R
  ? (...args: [...A, call?: CallOptions]) => R
  : { [K in keyof T]: WithCallOptions<T[K]> };

/** `ApiClient` 的超集：每個方法多一個選用的尾端 `CallOptions`（目前只有 `signal`）。可直接當 `ApiClient` 使用 */
export type HttpApiClient = WithCallOptions<ApiClient>;

type Query = Record<string, QueryValue>;

/**
 * 建立可傳入 `signal` 的 HTTP 用戶端。一般情況使用 {@link createHttpClient}（回傳型別為 `ApiClient`）。
 */
export function createHttpApiClient(options: HttpClientOptions): HttpApiClient {
  const { baseUrl, storeSlug, session, retry } = options;

  const refreshCoordinator = createRefreshCoordinator({ baseUrl, session });
  const transport = createTransport({ session, refresh: refreshCoordinator, retry });
  const clockSync = createClockSync();
  const store = storePaths(storeSlug);

  interface CallInit {
    query?: Query;
    body?: unknown;
    headers?: Record<string, string>;
    auth?: AuthMode;
    call?: CallOptions;
  }

  const spec = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    init: CallInit,
  ) => ({
    method,
    url: buildUrl(baseUrl, path, init.query),
    body: init.body,
    headers: init.headers,
    auth: init.auth ?? ('none' as AuthMode),
    signal: init.call?.signal,
  });

  const json = <T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    init: CallInit = {},
  ): Promise<T> => transport.json<T>(spec(method, path, init));

  const none = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    init: CallInit = {},
  ): Promise<void> => transport.none(spec(method, path, init));

  /** 擁有者存取訂單：會員以 Bearer，訪客以追蹤權杖標頭（06 §1.3） */
  const tracking = (opts: TrackingOpts | undefined): Record<string, string> | undefined =>
    opts?.trackingToken === undefined ? undefined : { [TRACKING_TOKEN_HEADER]: opts.trackingToken };

  return {
    auth: {
      sendOtp: (phone, call) => json('POST', AUTH_PATHS.sendOtp, { body: { phone }, call }),
      verifyOtp: (phone, code, call) =>
        json('POST', AUTH_PATHS.verifyOtp, { body: { phone, code }, call }),
      // 與 401 攔截器共用同一個 in-flight refresh（Token 輪替：重複使用舊 Token 會被視為遭竊，06 §5.2a）。
      // 不接受 signal：共用的換發不因單一呼叫端取消而中斷。
      refresh: (refreshToken) => refreshCoordinator.refresh(refreshToken),
      logout: async (refreshToken, call) => {
        // 第一次送出用呼叫端給的 Token；若因 401 先換發過，Session 內才是輪替後仍有效的那把
        let sends = 0;
        const body = (): unknown => {
          const stored = session?.getTokens()?.refreshToken;
          const token = sends === 0 ? (refreshToken ?? stored) : (stored ?? refreshToken);
          sends += 1;
          return token === undefined ? undefined : { refreshToken: token };
        };
        try {
          await none('POST', AUTH_PATHS.logout, { auth: 'bearer', body, call });
        } catch (e) {
          // 登出冪等：Session 本來就失效（換發被拒、Token 已撤銷）即達成目的
          if (e instanceof ApiError && e.status === 401) return;
          throw e;
        }
      },
    },

    store: {
      getInfo: (call) => json('GET', store.info, { call }),
      getStatus: async (call) => {
        const status = await json<StoreStatus>('GET', store.status, { call });
        clockSync.sync(status.serverTime);
        return status;
      },
      getMenu: (call) => json('GET', store.menu, { call }),
      getProduct: (productId, call) => json('GET', store.product(productId), { call }),
      getBanners: (call) => json('GET', store.banners, { call }),
      getPickupSlots: (params, call) =>
        json('GET', store.pickupSlots, {
          query: { orderType: params.orderType, zipCode: params.zipCode },
          call,
        }),
      getDeliveryZones: (call) => json('GET', store.deliveryZones, { call }),
      checkDelivery: (zipCode, call) =>
        json('GET', store.deliveryCheck, { query: { zipCode }, call }),
      resolveTable: (qrToken, call) => json('GET', store.table(qrToken), { call }),
    },

    orders: {
      // 會員身分會影響報價（會員限定券：LOGIN_REQUIRED）與訂單歸屬，因此有權杖就附 Bearer
      quote: (req, call) => json('POST', store.quote, { body: req, auth: 'bearer', call }),
      // POST 不重試：無回應 / 逾時 / 5xx 一律原樣丟出，由結帳流程依 FLOW-24 處理。
      // 重放（replayed）以回應 body 為準，原樣回傳，不另行推斷。
      create: (req, idempotencyKey, call) =>
        json('POST', store.createOrder, {
          body: req,
          headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
          auth: 'bearer',
          call,
        }),
      list: (params, call) =>
        json('GET', ORDER_PATHS.list, {
          query: { tab: params.tab, limit: params.limit, cursor: params.cursor },
          auth: 'bearer',
          call,
        }),
      // ETag / If-None-Match（06 §1.4）交給瀏覽器的 HTTP 快取：304 會被透明地還原為 200，這裡不手動帶條件標頭
      get: (orderId, opts, call) =>
        json('GET', ORDER_PATHS.byId(orderId), { headers: tracking(opts), auth: 'bearer', call }),
      cancel: (orderId, reason, opts, call) =>
        json('POST', ORDER_PATHS.cancel(orderId), {
          body: { reason },
          headers: tracking(opts),
          auth: 'bearer',
          call,
        }),
      // 公開、嚴格限流（06 §1.6）；429 的 retryAfterSeconds 留在 ApiError.body
      lookup: (orderNo, phone, call) =>
        json('GET', ORDER_PATHS.lookup, { query: { orderNo, phone }, call }),
      pay: (orderId, req, opts, call) =>
        json('POST', ORDER_PATHS.payments(orderId), {
          body: req,
          headers: tracking(opts),
          auth: 'bearer',
          call,
        }),
    },

    me: {
      get: (call) => json('GET', ME_PATHS.root, { auth: 'bearer', call }),
      update: (patch, call) => json('PATCH', ME_PATHS.root, { body: patch, auth: 'bearer', call }),
      remove: (call) => none('DELETE', ME_PATHS.root, { auth: 'bearer', call }),
      addresses: {
        list: (call) => json('GET', ME_PATHS.addresses, { auth: 'bearer', call }),
        create: (input, call) =>
          json('POST', ME_PATHS.addresses, { body: input, auth: 'bearer', call }),
        update: (id, patch, call) =>
          json('PATCH', ME_PATHS.address(id), { body: patch, auth: 'bearer', call }),
        remove: (id, call) => none('DELETE', ME_PATHS.address(id), { auth: 'bearer', call }),
      },
      favorites: {
        list: (call) => json('GET', ME_PATHS.favorites, { auth: 'bearer', call }),
        add: (productId, call) =>
          none('PUT', ME_PATHS.favorite(productId), { auth: 'bearer', call }),
        remove: (productId, call) =>
          none('DELETE', ME_PATHS.favorite(productId), { auth: 'bearer', call }),
      },
      coupons: {
        list: (status, call) =>
          json('GET', ME_PATHS.coupons, { query: { status }, auth: 'bearer', call }),
      },
      frequentItems: (limit, call) =>
        json('GET', ME_PATHS.frequentItems, { query: { limit }, auth: 'bearer', call }),
    },
  };
}

/**
 * 建立 HTTP Adapter（`VITE_DATA_SOURCE=http`）。
 * `createApiClient` 以 `{ baseUrl, storeSlug }` 呼叫即可運作；要支援會員登入，另傳入 `session`（見 {@link SessionPort}）。
 */
export function createHttpClient(options: HttpClientOptions): ApiClient {
  return createHttpApiClient(options);
}
