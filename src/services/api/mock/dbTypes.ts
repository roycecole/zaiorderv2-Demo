// src/services/api/mock/dbTypes.ts —— Mock 資料庫的列型別（欄位同 05 §5，snake_case）
// 與 05 的差異：時間欄位一律存 epoch ms（number）；對外由 handlers 轉為 06 §4 的 DTO（ISO 8601 + 08:00）。
import type {
  ID, ISODate, InvoiceStatus, InvoiceType, OperatorType, OrderStatus, OrderType, PaymentMethod,
  PaymentStatus, PaymentTxnStatus, UserCouponStatus,
} from '@/domain/types';
import type { CreateLogEntry } from './requestLog';

export interface UserRow {
  id: ID;
  phone: string;
  name: string | null;
  email: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  marketing_opt_in: boolean;
  phone_verified_at: number | null;
  last_login_at: number | null;
  created_at: number;
  deleted_at: number | null;
}

export interface AddressRow {
  id: ID;
  user_id: ID;
  label: string;
  recipient_name: string;
  recipient_phone: string;
  city: string;
  district: string;
  zip_code: string;
  address_line: string;
  note: string | null;
  is_default: boolean;
  created_at: number;
}

export interface FavoriteRow {
  user_id: ID;
  product_id: ID;
  created_at: number;
}

export interface UserCouponRow {
  id: ID;
  user_id: ID;
  coupon_id: ID;
  status: UserCouponStatus;
  claimed_at: number;
  used_at: number | null;
  order_id: ID | null;
}

export interface OrderRow {
  id: ID;
  order_no: string;
  store_id: ID;
  /** null = 訪客訂單；他人訂單（pickup_no 前綴 X）亦為 null */
  user_id: ID | null;
  order_type: OrderType;
  status: OrderStatus;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod;
  business_date: ISODate;
  pickup_no: string;
  customer_name: string | null;
  customer_phone: string | null;
  scheduled_at: number | null;
  estimated_ready_at: number | null;
  table_no: string | null;
  delivery_city: string | null;
  delivery_district: string | null;
  delivery_zip_code: string | null;
  delivery_address_line: string | null;
  delivery_note: string | null;
  subtotal_amount: number;
  delivery_fee: number;
  discount_amount: number;
  total_amount: number;
  coupon_id: ID | null;
  coupon_code: string | null;
  need_utensils: boolean;
  note: string | null;
  marketing_opt_in: boolean;
  cancelled_by: OperatorType | null;
  cancel_reason: string | null;
  placed_at: number;
  payment_expires_at: number | null;
  pending_at: number | null;
  accepted_at: number | null;
  ready_at: number | null;
  completed_at: number | null;
  cancelled_at: number | null;
  /** Mock 專用：進入 REFUNDING 的時間（退款約 REFUND_SECONDS 後完成） */
  refund_started_at: number | null;
  idempotency_key: string | null;
  idempotency_request_hash: string | null;
  tracking_token_hash: string | null;
}

export interface OrderItemRow {
  id: ID;
  order_id: ID;
  product_id: ID | null;
  product_name: string;
  base_price: number;
  options_price: number;
  quantity: number;
  line_total: number;
  note: string | null;
  sort_order: number;
}

export interface OrderItemOptionRow {
  id: ID;
  order_item_id: ID;
  option_group_id: ID | null;
  option_group_name: string;
  option_id: ID | null;
  option_name: string;
  price_delta: number;
  sort_order: number;
}

export interface OrderStatusLogRow {
  id: ID;
  order_id: ID;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  operator_type: OperatorType;
  operator_id: ID | null;
  note: string | null;
  created_at: number;
}

export interface PaymentRow {
  id: ID;
  order_id: ID;
  method: PaymentMethod;
  provider: string | null;
  amount: number;
  status: PaymentTxnStatus;
  provider_txn_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
  paid_at: number | null;
  refunded_at: number | null;
  created_at: number;
}

export interface OrderInvoiceRow {
  order_id: ID;
  invoice_type: InvoiceType;
  carrier_code: string | null;
  tax_id: string | null;
  buyer_name: string | null;
  donate_code: string | null;
  status: InvoiceStatus;
  invoice_no: string | null;
  issued_at: number | null;
}

export interface RefreshTokenRow {
  token: string;
  user_id: ID;
  created_at: number;
  revoked_at: number | null;
}

/** 此瀏覽器目前的登入狀態（Mock 的 ApiClient 方法不帶權杖，由 Mock 自行記住「誰在用」） */
export interface SessionRow {
  user_id: ID;
  refresh_token: string;
}

export interface OtpStateRow {
  /** 近 24 小時內的發送時間（epoch ms，由舊到新） */
  sent_at: number[];
  /** 目前累計的驗證錯誤次數 */
  failed: number;
  locked_until: number | null;
}

export interface DbData {
  meta: { schemaVersion: number; createdAt: number };
  users: UserRow[];
  user_addresses: AddressRow[];
  favorites: FavoriteRow[];
  user_coupons: UserCouponRow[];
  orders: OrderRow[];
  order_items: OrderItemRow[];
  order_item_options: OrderItemOptionRow[];
  order_status_logs: OrderStatusLogRow[];
  payments: PaymentRow[];
  order_invoices: OrderInvoiceRow[];
  /** coupons.used_count 的增量（種子的 used_count 唯讀；訂單取消返還 −1，BR-29） */
  coupon_usage: Record<ID, number>;
  /** 最近送出紀錄（環形緩衝 20 筆；不屬 05 資料表） */
  demo_request_log: CreateLogEntry[];
  session: SessionRow | null;
  refresh_tokens: RefreshTokenRow[];
  /** 以手機為鍵 */
  otp_state: Record<string, OtpStateRow>;
  /** GET /orders/lookup 的嘗試時間（以手機為鍵，近 10 分鐘） */
  lookup_attempts: Record<string, number[]>;
}
