// src/services/api/mock/seed/members.ts —— 可變集合的初始內容：示範會員、地址簿、最愛、優惠券與 3 筆歷史訂單（08 §2.5）
import { addDays, dateOfMs, dayStartMs } from '@/domain/taipeiTime';
import type { ID, InvoiceType, OrderStatus, OrderType, PaymentMethod } from '@/domain/types';
import type {
  AddressRow, DbData, FavoriteRow, OrderInvoiceRow, OrderItemOptionRow, OrderItemRow, OrderRow,
  OrderStatusLogRow, PaymentRow, UserCouponRow, UserRow,
} from '../dbTypes';
import { OPTION_GROUPS, PRODUCTS } from './menu';
import { STORE_ID } from './store';

export const DB_SCHEMA_VERSION = 1;

export const DEMO_USER_ID: ID = 'usr_demo';
export const DEMO_PHONE = '0900000000';

const MIN = 60_000;
const HOUR = 3_600_000;

interface HistLine {
  productId: ID;
  quantity: number;
  optionIds: ID[];
  note?: string;
}

interface HistSpec {
  key: string;
  orderNo: string;
  daysAgo: number;
  /** 當日幾分鐘（店家時區）下單 */
  placedMinuteOfDay: number;
  orderType: OrderType;
  status: OrderStatus;
  pickupNo: string;
  lines: HistLine[];
  deliveryFee: number;
  discount: number;
  couponId?: ID;
  couponCode?: string;
  paymentMethod: PaymentMethod;
  invoiceType: InvoiceType;
  invoiceNo?: string;
  delivery?: { city: string; district: string; zipCode: string; line: string };
  cancelReason?: string;
}

function lookupOption(
  productId: ID,
  optionId: ID,
): { id: ID; groupId: ID; groupName: string; name: string; delta: number; order: number } {
  const product = PRODUCTS.find((x) => x.id === productId);
  if (product === undefined) throw new Error(`種子商品不存在：${productId}`);
  for (const [gi, gid] of product.groupIds.entries()) {
    const group = OPTION_GROUPS.find((g) => g.id === gid);
    const oi = group?.options.findIndex((o) => o.id === optionId) ?? -1;
    if (group !== undefined && oi >= 0) {
      const o = group.options[oi];
      if (o !== undefined) {
        return {
          id: o.id, groupId: group.id, groupName: group.name, name: o.name, delta: o.priceDelta, order: gi * 100 + oi,
        };
      }
    }
  }
  throw new Error(`種子選項不屬於商品：${productId} / ${optionId}`);
}

function buildHistoricOrder(spec: HistSpec, nowMs: number, userId: ID, user: UserRow) {
  const day = addDays(dateOfMs(nowMs), -spec.daysAgo);
  const placedAt = dayStartMs(day) + spec.placedMinuteOfDay * MIN;
  const orderId = `ord_hist_${spec.key}`;
  const yymmdd = `${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}`;

  const items: OrderItemRow[] = [];
  const options: OrderItemOptionRow[] = [];
  let subtotal = 0;
  for (const [i, line] of spec.lines.entries()) {
    const product = PRODUCTS.find((x) => x.id === line.productId);
    if (product === undefined) throw new Error(`種子商品不存在：${line.productId}`);
    const picked = line.optionIds
      .map((oid) => lookupOption(line.productId, oid))
      .sort((a, b) => a.order - b.order);
    const optionsPrice = picked.reduce((s, o) => s + o.delta, 0);
    const unit = Math.max(0, product.basePrice + optionsPrice);
    const itemId = `oi_hist_${spec.key}_${i + 1}`;
    items.push({
      id: itemId,
      order_id: orderId,
      product_id: product.id,
      product_name: product.name,
      base_price: product.basePrice,
      options_price: optionsPrice,
      quantity: line.quantity,
      line_total: unit * line.quantity,
      note: line.note ?? null,
      sort_order: i,
    });
    subtotal += unit * line.quantity;
    for (const [j, o] of picked.entries()) {
      options.push({
        id: `oio_hist_${spec.key}_${i + 1}_${j + 1}`,
        order_item_id: itemId,
        option_group_id: o.groupId,
        option_group_name: o.groupName,
        option_id: o.id,
        option_name: o.name,
        price_delta: o.delta,
        sort_order: j,
      });
    }
  }

  const total = Math.max(0, subtotal + spec.deliveryFee - spec.discount);
  const completed = spec.status === 'COMPLETED';
  const cancelled = spec.status === 'CANCELLED';
  const isDelivery = spec.orderType === 'DELIVERY';
  const acceptedAt = placedAt + 1 * MIN;
  const readyAt = placedAt + 10 * MIN;
  const deliveringAt = placedAt + 20 * MIN;
  const completedAt = placedAt + (isDelivery ? 35 : 15) * MIN;
  const cancelledAt = placedAt + 4 * MIN;

  const logs: OrderStatusLogRow[] = [];
  const log = (from: OrderStatus | null, to: OrderStatus, at: number, by: 'CUSTOMER' | 'STORE', note?: string) =>
    logs.push({
      id: `osl_hist_${spec.key}_${logs.length + 1}`,
      order_id: orderId,
      from_status: from,
      to_status: to,
      operator_type: by,
      operator_id: by === 'CUSTOMER' ? userId : null,
      note: note ?? null,
      created_at: at,
    });
  log(null, 'PENDING', placedAt, 'CUSTOMER');
  if (completed) {
    log('PENDING', 'ACCEPTED', acceptedAt, 'STORE');
    log('ACCEPTED', 'READY', readyAt, 'STORE');
    if (isDelivery) {
      log('READY', 'DELIVERING', deliveringAt, 'STORE');
      log('DELIVERING', 'COMPLETED', completedAt, 'STORE');
    } else {
      log('READY', 'COMPLETED', completedAt, 'STORE');
    }
  } else if (cancelled) {
    log('PENDING', 'CANCELLED', cancelledAt, 'CUSTOMER', spec.cancelReason);
  }

  const order: OrderRow = {
    id: orderId,
    order_no: `ZO${yymmdd}${spec.orderNo}`,
    store_id: STORE_ID,
    user_id: userId,
    order_type: spec.orderType,
    status: spec.status,
    payment_status: completed ? 'PAID' : 'UNPAID',
    payment_method: spec.paymentMethod,
    business_date: day,
    pickup_no: spec.pickupNo,
    customer_name: user.name,
    customer_phone: user.phone,
    scheduled_at: null,
    estimated_ready_at: placedAt + 15 * MIN,
    table_no: null,
    delivery_city: spec.delivery?.city ?? null,
    delivery_district: spec.delivery?.district ?? null,
    delivery_zip_code: spec.delivery?.zipCode ?? null,
    delivery_address_line: spec.delivery?.line ?? null,
    delivery_note: null,
    subtotal_amount: subtotal,
    delivery_fee: spec.deliveryFee,
    discount_amount: spec.discount,
    total_amount: total,
    coupon_id: spec.couponId ?? null,
    coupon_code: spec.couponCode ?? null,
    need_utensils: false,
    note: null,
    marketing_opt_in: false,
    cancelled_by: cancelled ? 'CUSTOMER' : null,
    cancel_reason: cancelled ? (spec.cancelReason ?? null) : null,
    placed_at: placedAt,
    payment_expires_at: null,
    pending_at: placedAt,
    accepted_at: completed ? acceptedAt : null,
    ready_at: completed ? readyAt : null,
    completed_at: completed ? completedAt : null,
    cancelled_at: cancelled ? cancelledAt : null,
    refund_started_at: null,
    idempotency_key: null,
    idempotency_request_hash: null,
    tracking_token_hash: null,
  };

  const payments: PaymentRow[] = [
    {
      id: `pay_hist_${spec.key}`,
      order_id: orderId,
      method: spec.paymentMethod,
      provider: null,
      amount: total,
      status: completed ? 'SUCCESS' : 'FAILED',
      provider_txn_id: null,
      failure_code: completed ? null : 'ORDER_CANCELLED',
      failure_message: null,
      paid_at: completed ? completedAt : null,
      refunded_at: null,
      created_at: placedAt,
    },
  ];

  const invoice: OrderInvoiceRow = {
    order_id: orderId,
    invoice_type: spec.invoiceType,
    carrier_code: null,
    tax_id: null,
    buyer_name: null,
    donate_code: null,
    status: completed ? 'ISSUED' : cancelled ? 'VOIDED' : 'PENDING',
    invoice_no: completed ? (spec.invoiceNo ?? null) : null,
    issued_at: completed ? completedAt : null,
  };

  return { order, items, options, logs, payments, invoice };
}

/**
 * 首次啟動（或重置後）的 db 初始內容；日期相對於 nowMs（08 §2.5「歷史訂單 3 筆（相對日期）」）。
 * 歷史訂單屬前幾個營業日，不影響今日取餐號碼從 A001 起算。
 */
export function createInitialDbData(nowMs: number): DbData {
  const user: UserRow = {
    id: DEMO_USER_ID,
    phone: DEMO_PHONE,
    name: '示範會員',
    email: 'demo@example.com',
    status: 'ACTIVE',
    marketing_opt_in: false,
    phone_verified_at: nowMs - 30 * 24 * HOUR,
    last_login_at: null,
    created_at: nowMs - 30 * 24 * HOUR,
    deleted_at: null,
  };

  const addresses: AddressRow[] = [
    {
      id: 'addr_home', user_id: DEMO_USER_ID, label: '家', recipient_name: '示範會員', recipient_phone: DEMO_PHONE,
      city: '臺北市', district: '大安區', zip_code: '106', address_line: '示範路 5 號 3 樓',
      note: null, is_default: true, created_at: nowMs - 29 * 24 * HOUR,
    },
    {
      id: 'addr_office', user_id: DEMO_USER_ID, label: '公司', recipient_name: '示範會員', recipient_phone: DEMO_PHONE,
      city: '臺北市', district: '信義區', zip_code: '110', address_line: '示範大道 88 號 12 樓',
      note: null, is_default: false, created_at: nowMs - 28 * 24 * HOUR,
    },
  ];

  const favorites: FavoriteRow[] = ['prd_lurou', 'prd_black_tea', 'prd_beef_noodle'].map((productId, i) => ({
    user_id: DEMO_USER_ID,
    product_id: productId,
    created_at: nowMs - (20 - i) * 24 * HOUR,
  }));

  const specs: HistSpec[] = [
    {
      key: '1', orderNo: 'HZ0001', daysAgo: 3, placedMinuteOfDay: 12 * 60 + 20, orderType: 'PICKUP',
      status: 'COMPLETED', pickupNo: 'A001',
      lines: [
        { productId: 'prd_lurou', quantity: 1, optionIds: ['opt_bowl_l', 'opt_egg'], note: '不要蔥' },
        { productId: 'prd_kong_rou', quantity: 1, optionIds: [] },
        { productId: 'prd_black_tea', quantity: 1, optionIds: ['opt_cup_m', 'opt_sugar_half', 'opt_ice_light'] },
      ],
      deliveryFee: 0, discount: 20, couponId: 'cpn_member20', couponCode: 'MEMBER20',
      paymentMethod: 'CASH', invoiceType: 'PAPER', invoiceNo: 'AB10000001',
    },
    {
      key: '2', orderNo: 'HZ0002', daysAgo: 7, placedMinuteOfDay: 12 * 60 + 20, orderType: 'DELIVERY',
      status: 'COMPLETED', pickupNo: 'D001',
      lines: [
        { productId: 'prd_beef_noodle', quantity: 2, optionIds: ['opt_noodle_thin', 'opt_spice_none'] },
        { productId: 'prd_danzai', quantity: 1, optionIds: [] },
      ],
      deliveryFee: 0, discount: 0,
      paymentMethod: 'CASH', invoiceType: 'PAPER', invoiceNo: 'AB10000002',
      delivery: { city: '臺北市', district: '大安區', zipCode: '106', line: '示範路 5 號 3 樓' },
    },
    {
      key: '3', orderNo: 'HZ0003', daysAgo: 10, placedMinuteOfDay: 12 * 60 + 5, orderType: 'PICKUP',
      status: 'CANCELLED', pickupNo: 'A001',
      lines: [{ productId: 'prd_oyster_omelet', quantity: 1, optionIds: ['opt_spice_none'] }],
      deliveryFee: 0, discount: 0,
      paymentMethod: 'CASH', invoiceType: 'PAPER', cancelReason: '不小心點錯了',
    },
  ];

  const orders: OrderRow[] = [];
  const items: OrderItemRow[] = [];
  const options: OrderItemOptionRow[] = [];
  const logs: OrderStatusLogRow[] = [];
  const payments: PaymentRow[] = [];
  const invoices: OrderInvoiceRow[] = [];
  for (const spec of specs) {
    const h = buildHistoricOrder(spec, nowMs, DEMO_USER_ID, user);
    orders.push(h.order);
    items.push(...h.items);
    options.push(...h.options);
    logs.push(...h.logs);
    payments.push(...h.payments);
    invoices.push(h.invoice);
  }

  const memberOrder = orders.find((o) => o.coupon_id === 'cpn_member20');
  const userCoupons: UserCouponRow[] = [
    {
      id: 'uc_welcome50', user_id: DEMO_USER_ID, coupon_id: 'cpn_welcome50', status: 'AVAILABLE',
      claimed_at: nowMs - 14 * 24 * HOUR, used_at: null, order_id: null,
    },
    {
      id: 'uc_lunch10', user_id: DEMO_USER_ID, coupon_id: 'cpn_lunch10', status: 'AVAILABLE',
      claimed_at: nowMs - 14 * 24 * HOUR, used_at: null, order_id: null,
    },
    {
      id: 'uc_member20', user_id: DEMO_USER_ID, coupon_id: 'cpn_member20', status: 'USED',
      claimed_at: nowMs - 14 * 24 * HOUR, used_at: memberOrder?.placed_at ?? nowMs - 3 * 24 * HOUR,
      order_id: memberOrder?.id ?? null,
    },
  ];

  return {
    meta: { schemaVersion: DB_SCHEMA_VERSION, createdAt: nowMs },
    users: [user],
    user_addresses: addresses,
    favorites,
    user_coupons: userCoupons,
    orders,
    order_items: items,
    order_item_options: options,
    order_status_logs: logs,
    payments,
    order_invoices: invoices,
    coupon_usage: { cpn_member20: 1 },
    demo_request_log: [],
    session: null,
    refresh_tokens: [],
    otp_state: {},
    lookup_attempts: {},
  };
}

/** 空白（無任何種子）的 db：測試與「清除全部」用 */
export function createEmptyDbData(nowMs: number): DbData {
  return {
    meta: { schemaVersion: DB_SCHEMA_VERSION, createdAt: nowMs },
    users: [],
    user_addresses: [],
    favorites: [],
    user_coupons: [],
    orders: [],
    order_items: [],
    order_item_options: [],
    order_status_logs: [],
    payments: [],
    order_invoices: [],
    coupon_usage: {},
    demo_request_log: [],
    session: null,
    refresh_tokens: [],
    otp_state: {},
    lookup_attempts: {},
  };
}
