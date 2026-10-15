// 結帳測試共用的固定資料：店家資訊、時段、報價、訂單與購物車
import type { CartLine } from '@/domain/cart';
import type {
  CreateOrderResponse,
  Order,
  PickupSlotsResponse,
  QuoteResponse,
  QuotedLine,
  StoreInfo,
} from '@/domain/types';

export const NOW_ISO = '2026-10-14T12:00:00+08:00';
export const NOW_MS = Date.parse(NOW_ISO);

export const INFO: StoreInfo = {
  id: 'store1',
  slug: 'demo-snack',
  name: '巷仔內小吃部',
  phone: '02-0000-0000',
  address: { city: '臺北市', district: '大安區', zipCode: '106', line: '示範路 100 號' },
  timezone: 'Asia/Taipei',
  services: { pickup: true, delivery: true, dineIn: true },
  paymentMethods: ['CASH', 'CREDIT_CARD', 'LINE_PAY', 'JKOPAY'],
  businessHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday: weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    open: '11:00',
    close: '21:00',
  })),
  specialDays: [],
  display: { brandColor: null, menuLayout: 'AUTO' },
  limits: {
    minOrderAmount: 0,
    maxQuantityPerItem: 20,
    maxLines: 30,
    maxAdvanceDays: 1,
    slotIntervalMinutes: 15,
    pickupLeadMinutes: 15,
    deliveryLeadMinutes: 40,
  },
  status: { status: 'OPEN', todayHours: [{ open: '11:00', close: '21:00' }], serverTime: NOW_ISO },
};

export const SLOTS: PickupSlotsResponse = {
  orderType: 'PICKUP',
  asap: { available: true, etaMinutes: { min: 15, max: 20 } },
  days: [
    {
      date: '2026-10-14',
      label: '今天',
      slots: [
        { startAt: '2026-10-14T12:30:00+08:00', status: 'AVAILABLE' },
        { startAt: '2026-10-14T12:45:00+08:00', status: 'FULL' },
        { startAt: '2026-10-14T13:00:00+08:00', status: 'AVAILABLE' },
      ],
    },
  ],
};

export const line = (
  over: Partial<CartLine> & Pick<CartLine, 'lineId' | 'productId'>,
): CartLine => ({
  quantity: 1,
  optionIds: [],
  snapshot: { name: '品項', unitPrice: 50, optionLabels: [] },
  ...over,
});

export const LUROU = line({
  lineId: 'l1',
  productId: 'prd_lurou',
  quantity: 1,
  optionIds: ['opt_bowl_l'],
  snapshot: { name: '招牌滷肉飯', unitPrice: 67, optionLabels: ['大碗'] },
});
export const TEA = line({
  lineId: 'l2',
  productId: 'prd_tea',
  quantity: 1,
  snapshot: { name: '古早味紅茶', unitPrice: 25, optionLabels: ['中杯'] },
});
export const COMBO = line({
  lineId: 'l3',
  productId: 'prd_combo',
  quantity: 3,
  snapshot: { name: '雙人分享餐', unitPrice: 299, optionLabels: [] },
});

/** 依購物車行建立「全部可購買」的報價 */
export function okQuote(
  lines: ReadonlyArray<CartLine>,
  over: Partial<QuoteResponse> = {},
): QuoteResponse {
  const items: QuotedLine[] = lines.map((l, index) => ({
    index,
    productId: l.productId,
    name: l.snapshot.name,
    optionLabels: l.snapshot.optionLabels,
    unitPrice: l.snapshot.unitPrice,
    quantity: l.quantity,
    lineTotal: l.snapshot.unitPrice * l.quantity,
    available: true,
    availableQuantity: l.quantity,
    remaining: null,
  }));
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  return {
    valid: true,
    items,
    subtotal,
    deliveryFee: 0,
    discount: 0,
    total: subtotal,
    checks: [],
    ...over,
  };
}

/** 把第 index 行標為售完 */
export function soldOutQuote(lines: ReadonlyArray<CartLine>, index: number): QuoteResponse {
  const base = okQuote(lines);
  const items = base.items.map((i) =>
    i.index === index
      ? {
          ...i,
          available: false,
          availableQuantity: 0,
          lineTotal: 0,
          issue: 'ITEM_SOLD_OUT' as const,
        }
      : i,
  );
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  return {
    ...base,
    valid: false,
    items,
    subtotal,
    total: subtotal,
    checks: [
      {
        code: 'ITEM_SOLD_OUT',
        severity: 'ERROR',
        message: '已售完',
        field: 'items',
        lineIndex: index,
      },
    ],
  };
}

export function orderOf(over: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    orderNo: 'ZO261014ABC123',
    storeId: 'store1',
    orderType: 'PICKUP',
    status: 'PENDING',
    pickupNo: 'A001',
    businessDate: '2026-10-14',
    customer: { name: '王小明', phone: '0912345678' },
    scheduledAt: null,
    estimatedReadyAt: null,
    items: [],
    amounts: { subtotal: 92, deliveryFee: 0, discount: 0, total: 92 },
    needUtensils: false,
    invoice: { type: 'PAPER', status: 'PENDING' },
    payment: { method: 'CASH', status: 'UNPAID', expiresAt: null },
    timeline: [],
    placedAt: NOW_ISO,
    permissions: { canCancel: true, canPay: false, canReorder: true, canReview: false },
    ...over,
  };
}

export function createdResponse(over: Partial<CreateOrderResponse> = {}): CreateOrderResponse {
  return { order: orderOf(), trackingToken: 'trk_abc', nextAction: 'TRACK', ...over };
}

/** 與 http 層的 ApiError 同形（features 測試不得 import http / mock 內部） */
export class FakeApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 只需要是一份報價的最小物件（測試錯誤主體用） */
export function quoteLike(over: Partial<QuoteResponse> = {}): QuoteResponse {
  return {
    valid: false,
    items: [],
    subtotal: 0,
    deliveryFee: 0,
    discount: 0,
    total: 0,
    checks: [],
    ...over,
  };
}
