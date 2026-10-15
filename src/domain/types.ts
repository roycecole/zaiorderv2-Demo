export interface ApiErrorResponse {
  error: {
    code: ErrorCode;
    message: string;               // 繁體中文訊息；異動清單的逐項文案由前端依 code 與份數組成（03 §9），此欄為降級顯示用，不含「今日」等相對日期用語（取餐營業日可能不是今日）
    details?: ApiErrorDetail[];    // 400 欄位錯誤；422 為 error.quote.checks 中 ERROR 項的 { field, code, message } 投影
    requestId?: string;
    retryAfterSeconds?: number;    // 429 / 423 / 503 時；POST /orders 的 429（專屬限流）與附此欄位的 503（建單互斥鎖等待逾時）皆為確定未建立
    remainingAttempts?: number;    // OTP_INVALID 時：剩餘嘗試次數
    /**
     * PRICE_CHANGED，以及 POST /orders 的所有 422 業務錯誤：交易回復當下的最新報價，
     * 結構與同一請求的 quote 回應相同（見 §3.2 註記）。IDEMPOTENCY_CONFLICT、ORDER_STATE_CONFLICT 與 400 不附
     */
    quote?: QuoteResponse;
  };
}

export type ID = string;
export type ISODateTime = string; // "2026-10-14T12:30:00+08:00"
export type ISODate = string;     // "2026-10-14"
export type HHmm = string;        // "11:00"（店家時區）
export type TWD = number;         // 新台幣整數（元）

export type OrderType = 'PICKUP' | 'DELIVERY' | 'DINE_IN';
export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PENDING'
  | 'ACCEPTED'
  | 'READY'
  | 'DELIVERING'
  | 'COMPLETED'
  | 'CANCELLED';
export type PaymentStatus = 'UNPAID' | 'PAID' | 'REFUNDING' | 'REFUNDED';
export type PaymentTxnStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';
export type PaymentMethod = 'CASH' | 'CREDIT_CARD' | 'LINE_PAY' | 'JKOPAY';
export type InvoiceType = 'PAPER' | 'MOBILE_BARCODE' | 'CITIZEN_CERT' | 'DONATION' | 'COMPANY';
export type InvoiceStatus = 'PENDING' | 'ISSUED' | 'VOIDED';
export type OperatorType = 'CUSTOMER' | 'STORE' | 'SYSTEM';
export type DiscountType = 'PERCENT' | 'FIXED_AMOUNT' | 'FREE_DELIVERY';
export type SelectionType = 'SINGLE' | 'MULTIPLE';
export type ProductTag = 'HOT' | 'NEW' | 'CHEF_PICK' | 'SPICY' | 'VEGETARIAN' | 'LIMITED';
export type Allergen =
  | 'CRUSTACEAN' | 'MOLLUSC' | 'PEANUT' | 'MILK' | 'EGG' | 'TREE_NUT'
  | 'SESAME' | 'GLUTEN' | 'SOY' | 'FISH' | 'MANGO' | 'SULFITE';
export type StoreStatusCode = 'OPEN' | 'CLOSED' | 'PAUSED';
export type ClosedReason = 'OUT_OF_HOURS' | 'HOLIDAY' | 'LAST_ORDER_PASSED';
export type UserCouponStatus = 'AVAILABLE' | 'USED' | 'EXPIRED';
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = 週日
export type MenuLayout = 'AUTO' | 'GRID' | 'LIST';

export type ErrorCode =
  | 'VALIDATION_FAILED' | 'OTP_INVALID' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'PRICE_CHANGED' | 'ORDER_STATE_CONFLICT' | 'IDEMPOTENCY_CONFLICT'
  | 'STORE_PAUSED' | 'STORE_CLOSED' | 'SERVICE_NOT_AVAILABLE'
  | 'ITEM_UNLISTED' | 'ITEM_SOLD_OUT' | 'ITEM_STOCK_INSUFFICIENT'
  | 'OPTION_INVALID' | 'OPTION_UNAVAILABLE' | 'QUANTITY_EXCEEDED'
  | 'MIN_ORDER_NOT_MET' | 'OUT_OF_DELIVERY_AREA' | 'SLOT_UNAVAILABLE' | 'TABLE_NOT_FOUND'
  | 'PAYMENT_METHOD_NOT_ALLOWED' | 'INVOICE_INVALID'
  | 'COUPON_NOT_FOUND' | 'COUPON_EXPIRED' | 'COUPON_NOT_APPLICABLE' | 'COUPON_MIN_NOT_MET'
  | 'COUPON_USED_UP' | 'LOGIN_REQUIRED'
  | 'OTP_LOCKED' | 'OTP_RATE_LIMITED' | 'RATE_LIMITED'
  | 'INTERNAL_ERROR' | 'SERVICE_UNAVAILABLE';

export interface ApiErrorDetail {
  field?: string;          // 例 "delivery.zipCode"
  code?: ErrorCode;
  message: string;
}

export interface BusinessHour { weekday: Weekday; open: HHmm; close: HHmm }
export interface SpecialDay {
  date: ISODate;
  type: 'CLOSED' | 'SPECIAL_HOURS';
  open?: HHmm;
  close?: HHmm;
  note?: string;
}

export interface StoreStatus {
  status: StoreStatusCode;
  closedReason?: ClosedReason;
  nextOpenAt?: ISODateTime;
  todayHours: { open: HHmm; close: HHmm }[];
  pausedUntil?: ISODateTime;    // PAUSED 時的預計恢復時間；省略 = 手動恢復
  serverTime: ISODateTime;      // 前端用以校正本機時鐘偏差
}

export interface StoreInfo {
  id: ID;
  slug: string;
  name: string;
  tagline?: string;
  description?: string;
  logoUrl?: string;
  coverUrl?: string;
  phone: string;
  email?: string;
  address: {
    city: string;
    district: string;
    zipCode: string;
    line: string;
    latitude?: number;
    longitude?: number;
  };
  announcement?: string;
  timezone: string;             // "Asia/Taipei"
  services: { pickup: boolean; delivery: boolean; dineIn: boolean };
  paymentMethods: PaymentMethod[];
  businessHours: BusinessHour[];
  specialDays: SpecialDay[];    // 今日起 30 天內
  /** 顯示設定：品牌主題色與菜單版面（03 §4.8、BR-31） */
  display: {
    brandColor: string | null;  // "#D93A22"；null = 使用系統預設色
    menuLayout: MenuLayout;
  };
  limits: {
    minOrderAmount: TWD;        // 自取 / 內用最低消費
    maxQuantityPerItem: number; // 單行數量上限：20（超過回 QUANTITY_EXCEEDED）
    maxLines: number;           // 品項行數上限：30（超過回整單 QUANTITY_EXCEEDED）
    maxAdvanceDays: number;
    slotIntervalMinutes: number;
    pickupLeadMinutes: number;
    deliveryLeadMinutes: number;
  };
  status: StoreStatus;
}

export interface Banner {
  id: ID;
  title: string;
  imageUrl: string;
  linkType: 'NONE' | 'PRODUCT' | 'CATEGORY' | 'URL';
  linkValue?: string;
}

export interface ProductOption {
  id: ID;
  name: string;
  priceDelta: number;           // 可為負
  isDefault: boolean;
  isAvailable: boolean;
}

export interface OptionGroup {
  id: ID;
  name: string;
  selectionType: SelectionType;
  required: boolean;            // = minSelect >= 1
  minSelect: number;
  maxSelect: number;
  options: ProductOption[];
}

/**
 * 商品摘要。必要欄位僅 id、categoryId、name、basePrice 與旗標；
 * description、imageUrl 可省略，tags / allergens 可為空陣列，前端必須優雅降級（03 §6.7）。
 */
export interface ProductSummary {
  id: ID;
  categoryId: ID;
  name: string;
  description?: string;       // 可省略
  imageUrl?: string;          // 可省略；無圖時前端以分類圖示佔位
  basePrice: TWD;
  displayPrice: TWD;            // 基本價 + 各必選群組最低加價
  isPriceFrom: boolean;         // 是否顯示「起」
  tags: ProductTag[];
  allergens: Allergen[];
  /** 不可加入：店家手動售完旗標（僅約束當前營業日）或可購買量為 0（含他人待付款訂單暫時占用）；前端判斷「不可加入」的依據 */
  isSoldOut: boolean;
  /**
   * 當前營業日還可購買份數（≥ 0）；null = 不限量；
   * 省略 = 未提供剩餘資訊（不等於保證不限量）：前端不顯示「剩 n 份」、不預先限制步進器，仍以 isSoldOut 與伺服器驗證為準
   */
  remainingToday?: number | null;
  hasRequiredOptions: boolean;  // true：快速加入需開啟客製化面板
}

export interface ProductDetail extends ProductSummary {
  optionGroups: OptionGroup[];  // 可為空陣列（無任何選項）
}

export interface MenuCategory {
  id: ID;
  name: string;
  description?: string;
  icon?: string;               // emoji 或圖示代碼；商品無圖時作為佔位圖的圖示
  products: ProductSummary[];
}

export interface Menu {
  categories: MenuCategory[];
  generatedAt: ISODateTime;
}

export interface Slot {
  startAt: ISODateTime;
  status: 'AVAILABLE' | 'FULL';
}
export interface SlotDay {
  date: ISODate;
  label: string;                // "今天" / "明天"
  slots: Slot[];
}
export interface PickupSlotsResponse {
  orderType: OrderType;
  asap: {
    available: boolean;
    etaMinutes?: { min: number; max: number };
    unavailableReason?: ErrorCode;  // STORE_PAUSED / STORE_CLOSED / SLOT_UNAVAILABLE（外送來不及在打烊前送達）
  };
  days: SlotDay[];
}

export interface DeliveryZone {
  zipCode: string;
  city: string;
  district: string;
  deliveryFee: TWD;
  minOrderAmount: TWD;
  freeDeliveryThreshold: TWD | null;
  estimatedMinutes: number;
}
export interface DeliveryCheckResponse {
  deliverable: boolean;
  zone?: DeliveryZone;
  reason?: 'OUT_OF_DELIVERY_AREA' | 'SERVICE_NOT_AVAILABLE';
}

export interface OrderLineInput {
  productId: ID;
  quantity: number;
  optionIds: ID[];              // 跨群組的選項 ID
  note?: string;
}

export interface QuoteRequest {
  orderType: OrderType;
  items: OrderLineInput[];
  scheduledAt: ISODateTime | null;  // null = 盡快
  zipCode?: string;                 // DELIVERY 必填
  couponCode?: string;
}

export interface QuotedLine {
  index: number;                    // 對應該次 request.items 的索引（與請求一一對應，productId 相同）；前端以送出該請求當下的購物車快照解讀，不套用到之後已變動的購物車
  productId: ID;
  name: string;
  imageUrl?: string;
  optionLabels: string[];
  unitPrice: TWD;
  quantity: number;                 // 請求的數量
  lineTotal: TWD;                   // = unitPrice × availableQuantity（不可購買行為 0）
  /** false = 此行無法依原數量成立（售完 / 下架 / 選項失效 / 數量不足 / 超過單行上限）；等同 availableQuantity < quantity */
  available: boolean;
  /**
   * 此行配置後最多可購買份數，0..quantity；available = true 時等於 quantity。
   * 只有可購買的行（未下架、選項有效）參與配置；同商品多行依請求順序配置，後面的行先被縮減（BR-40）；
   * 單行超過 limits.maxQuantityPerItem 者另受 min(quantity, 單行上限) 限制，與配置結果取較小者
   */
  availableQuantity: number;
  /** 取餐營業日該商品剩餘份數（同商品多行加總前）；null = 不限量；省略 = 不適用（如已下架） */
  remaining?: number | null;
  /**
   * 一行只回報優先序最高者：ITEM_UNLISTED > ITEM_SOLD_OUT > ITEM_STOCK_INSUFFICIENT > OPTION_INVALID > OPTION_UNAVAILABLE > QUANTITY_EXCEEDED，其餘見 checks[]。
   * ITEM_SOLD_OUT 僅限手動售完或商品層級 remaining = 0；未手動售完且 remaining > 0，
   * 但此行配置後為 0（剩餘已被同商品其他行占用）一律為 ITEM_STOCK_INSUFFICIENT；
   * QUANTITY_EXCEEDED 為單行數量超過 limits.maxQuantityPerItem，availableQuantity = min(quantity, 單行上限)
   */
  issue?: 'ITEM_UNLISTED' | 'ITEM_SOLD_OUT' | 'ITEM_STOCK_INSUFFICIENT'
        | 'OPTION_UNAVAILABLE' | 'OPTION_INVALID' | 'QUANTITY_EXCEEDED';
}

export interface QuoteCheck {
  code: ErrorCode;
  severity: 'ERROR' | 'WARNING';    // ERROR 會阻擋送出
  message: string;
  field?: string;
  lineIndex?: number;
}

export interface QuoteResponse {
  valid: boolean;                   // 無 ERROR 即為 true
  items: QuotedLine[];
  /**
   * 金額一律以「可成立內容」計算：subtotal = Σ lineTotal（BR-02），不可購買行為 0、數量不足行 × availableQuantity；
   * 最低消費、免運與折扣門檻以調整後小計判斷；全部不可購買時 subtotal、deliveryFee、discount、total 皆為 0
   */
  subtotal: TWD;
  deliveryFee: TWD;
  discount: TWD;
  total: TWD;
  coupon?: {
    code: string;
    name: string;
    discountType: DiscountType;
    applied: boolean;
  };
  minOrderShortfall?: TWD;          // 未達最低消費時的差額
  estimatedReadyAt?: ISODateTime;
  checks: QuoteCheck[];
}

export interface CreateOrderRequest {
  orderType: OrderType;
  items: OrderLineInput[];
  scheduledAt: ISODateTime | null;
  contact: { name?: string; phone?: string };   // PICKUP / DELIVERY 必填姓名與手機；DINE_IN 可省略
  delivery?: {
    addressId?: ID;
    city: string;
    district: string;
    zipCode: string;
    line: string;
    note?: string;
  };
  dineIn?: { tableNo: string; qrToken?: string };
  paymentMethod: PaymentMethod;
  invoice: {
    type: InvoiceType;
    carrierCode?: string;
    taxId?: string;
    buyerName?: string;
    donateCode?: string;
  };
  couponCode?: string;
  needUtensils: boolean;
  note?: string;
  marketingOptIn?: boolean;
  expectedTotal: TWD;                           // 前端顯示總額，供 PRICE_CHANGED 檢查
}

export interface OrderItemOption {
  groupName: string;
  name: string;
  priceDelta: number;
}
export interface OrderItem {
  id: ID;
  productId?: ID | null;
  name: string;
  quantity: number;
  unitPrice: TWD;                   // 含選項加價
  lineTotal: TWD;
  options: OrderItemOption[];
  note?: string;
}

export interface OrderStatusLog {
  status: OrderStatus;
  at: ISODateTime;
  by: OperatorType;
  note?: string;
}

export interface PaymentAttempt {
  id: ID;
  method: PaymentMethod;
  status: PaymentTxnStatus;
  amount: TWD;
  failureMessage?: string;
  createdAt: ISODateTime;
}

export interface OrderInvoice {
  type: InvoiceType;
  carrierCode?: string;
  taxId?: string;
  buyerName?: string;
  donateCode?: string;
  status: InvoiceStatus;
  invoiceNo?: string;
  issuedAt?: ISODateTime;
}

export interface Order {
  id: ID;
  orderNo: string;
  storeId: ID;
  orderType: OrderType;
  status: OrderStatus;
  pickupNo: string;
  businessDate: ISODate;
  customer?: { name?: string; phone?: string };
  scheduledAt: ISODateTime | null;
  estimatedReadyAt: ISODateTime | null;
  /**
   * 接單期限（BR-17）：僅 status = PENDING 有值，由伺服器計算，前端不自行推算（PG-06「店家將於 HH:mm 前確認」）。
   * 自進入 PENDING 起算（現金單 = 建單時間；線上付款 = 付款成功或改用現金的時間）：
   * 即時單 = 起算點 + accept_timeout_minutes；預約單 = max(起算點 + accept_timeout_minutes, scheduledAt − lead)；
   * lead 同 BR-08：外送 = 該單配送區的 estimated_minutes（以外送郵遞區號對應），缺值才用店家 delivery_lead_minutes；自取 = pickup_lead_minutes
   */
  acceptBy?: ISODateTime | null;
  table?: { tableNo: string };
  delivery?: { city: string; district: string; zipCode: string; line: string; note?: string };
  items: OrderItem[];
  amounts: { subtotal: TWD; deliveryFee: TWD; discount: TWD; total: TWD };
  couponCode?: string;
  needUtensils: boolean;
  note?: string;
  invoice: OrderInvoice;
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    expiresAt: ISODateTime | null;  // 僅 PENDING_PAYMENT
    latest?: PaymentAttempt;
  };
  cancellation?: { by: OperatorType; reason?: string; at: ISODateTime };
  timeline: OrderStatusLog[];
  placedAt: ISODateTime;
  acceptedAt?: ISODateTime;
  readyAt?: ISODateTime;
  completedAt?: ISODateTime;
  cancelledAt?: ISODateTime;
  /** 由伺服器計算的操作權限，前端不得自行推斷規則（例：已逾 payment.expiresAt 的待付款訂單，canPay 為 false） */
  permissions: { canCancel: boolean; canPay: boolean; canReorder: boolean; canReview: boolean };
}

export interface OrderSummary {
  id: ID;
  orderNo: string;
  orderType: OrderType;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  pickupNo: string;
  total: TWD;
  itemCount: number;
  itemsPreview: string;             // "招牌滷肉飯 等 3 項"
  placedAt: ISODateTime;
  scheduledAt: ISODateTime | null;
}

export interface CreateOrderResponse {
  order: Order;
  trackingToken?: string;           // 僅訪客訂單，且僅此次回傳（冪等重放時重新簽發，舊權杖失效）
  nextAction: 'TRACK' | 'PAY';      // PAY 僅限仍為 PENDING_PAYMENT 且未逾期；重放時依結算逾期後的目前狀態計算（已取消或已逾期為 TRACK）
  /** 冪等重放（同一 Idempotency-Key 取回原訂單）時為 true；省略 = 首次建立。以此欄位為準，標頭 Idempotent-Replayed 僅輔助 */
  replayed?: boolean;
}

export interface CreatePaymentRequest {
  method: PaymentMethod;
  returnUrl?: string;               // 線上付款完成後導回的前端網址
}
export interface CreatePaymentResponse {
  paymentId: ID;
  status: PaymentTxnStatus;
  redirectUrl?: string;             // method = CASH 時無
  expiresAt?: ISODateTime;
  order: Order;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;            // Cookie 模式下省略（§1.3）
  expiresIn: number;                // 秒
}
export interface UserProfile {
  id: ID;
  phone: string;
  name?: string;
  email?: string;
  marketingOptIn: boolean;
  createdAt: ISODateTime;
}
export interface OtpVerifyResponse {
  tokens: AuthTokens;
  user: UserProfile;
  isNewUser: boolean;
}

export interface Address {
  id: ID;
  label: string;
  recipientName: string;
  recipientPhone: string;
  city: string;
  district: string;
  zipCode: string;
  line: string;
  note?: string;
  isDefault: boolean;
}

export interface Coupon {
  id: ID;
  code: string;
  name: string;
  description?: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount?: TWD;
  minOrderAmount: TWD;
  applicableOrderTypes: OrderType[];
  memberOnly: boolean;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
}
/** 會員「上次點過」：由近 180 天內非取消訂單的品項推導，每商品取最近一次的選項與備註 */
export interface FrequentItem {
  productId: ID;
  optionIds: ID[];            // 最近一次點過的選項（跨群組）
  optionLabels: string[];     // 名稱快照，供卡片顯示「上次：大碗・滷蛋」
  note?: string;
  lastOrderedAt: ISODateTime;
  orderCount: number;         // 近 180 天內點過的次數
}
export interface FrequentItemsResponse {
  items: FrequentItem[];
}

export interface UserCoupon {
  id: ID;
  coupon: Coupon;
  status: UserCouponStatus;
  claimedAt: ISODateTime;
  usedAt?: ISODateTime;
}