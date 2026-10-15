// src/services/api/ApiClient.ts
import type {
  Address, AuthTokens, Banner, CreateOrderRequest, CreateOrderResponse,
  CreatePaymentRequest, CreatePaymentResponse, DeliveryCheckResponse, DeliveryZone,
  FrequentItemsResponse,
  ID, Menu, Order, OrderSummary, OrderType, OtpVerifyResponse, PickupSlotsResponse,
  ProductDetail, QuoteRequest, QuoteResponse, StoreInfo, StoreStatus, UserCoupon,
  UserCouponStatus, UserProfile,
} from '@/domain/types';

/** 存取訪客訂單時附帶的追蹤權杖 */
export interface TrackingOpts { trackingToken?: string }

export interface ApiClient {
  auth: {
    sendOtp(phone: string): Promise<{ resendAfterSeconds: number }>;
    verifyOtp(phone: string, code: string): Promise<OtpVerifyResponse>;
    /** Cookie 模式（06 §1.3）不需傳入 refreshToken */
    refresh(refreshToken?: string): Promise<{ tokens: AuthTokens }>;
    logout(refreshToken?: string): Promise<void>;
  };
  store: {
    getInfo(): Promise<StoreInfo>;
    getStatus(): Promise<StoreStatus>;
    getMenu(): Promise<Menu>;
    getProduct(productId: ID): Promise<ProductDetail>;
    getBanners(): Promise<{ items: Banner[] }>;
    getPickupSlots(params: { orderType: OrderType; zipCode?: string }): Promise<PickupSlotsResponse>;
    getDeliveryZones(): Promise<{ items: DeliveryZone[] }>;
    checkDelivery(zipCode: string): Promise<DeliveryCheckResponse>;
    resolveTable(qrToken: string): Promise<{ tableNo: string; seats?: number }>;
  };
  orders: {
    quote(req: QuoteRequest): Promise<QuoteResponse>;
    /**
     * Idempotency-Key 由呼叫端（結帳送出流程）管理（BR-41、FLOW-24）：首次送出才產生並存入 checkoutDraft
     * （sessionStorage；觸控面板僅記憶體，閒置重置時連同記下的送出內容一併丟棄），到 2xx 才作廢。
     * 422、409 PRICE_CHANGED、400、429、附 retryAfterSeconds 的 503（確定未建立）與結果未知（無回應、逾時、
     * 其他 5xx）後修改內容再送一律沿用同一把；收到 IDEMPOTENCY_CONFLICT 不得換新 Key，改以同 Key 重放記下的內容取回原訂單。
     * 重放以回應 body 的 replayed 為準，標頭 Idempotent-Replayed 僅輔助。判別與狀態轉換見 domain/idempotency.ts。
     */
    create(req: CreateOrderRequest, idempotencyKey: string): Promise<CreateOrderResponse>;
    list(params: {
      tab: 'active' | 'completed' | 'cancelled';
      limit?: number;
      cursor?: string;
    }): Promise<{ items: OrderSummary[]; nextCursor: string | null }>;
    get(orderId: ID, opts?: TrackingOpts): Promise<Order>;
    cancel(orderId: ID, reason?: string, opts?: TrackingOpts): Promise<Order>;
    lookup(orderNo: string, phone: string): Promise<{ orderId: ID; trackingToken: string }>;
    pay(orderId: ID, req: CreatePaymentRequest, opts?: TrackingOpts): Promise<CreatePaymentResponse>;
  };
  me: {
    get(): Promise<UserProfile>;
    update(patch: Partial<Pick<UserProfile, 'name' | 'email' | 'marketingOptIn'>>): Promise<UserProfile>;
    remove(): Promise<void>;
    addresses: {
      list(): Promise<{ items: Address[] }>;
      create(input: Omit<Address, 'id'>): Promise<Address>;
      update(id: ID, patch: Partial<Omit<Address, 'id'>>): Promise<Address>;
      remove(id: ID): Promise<void>;
    };
    favorites: {
      list(): Promise<{ productIds: ID[] }>;
      add(productId: ID): Promise<void>;
      remove(productId: ID): Promise<void>;
    };
    coupons: {
      list(status?: UserCouponStatus): Promise<{ items: UserCoupon[] }>;
    };
    /** 會員常點 / 上次點過（訪客不呼叫，記憶僅存本機）；limit 預設 50、最大 100 */
    frequentItems(limit?: number): Promise<FrequentItemsResponse>;
  };
}
