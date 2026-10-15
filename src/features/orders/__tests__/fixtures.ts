// 測試用的訂單與商品資料建構器（不含 Mock Adapter）
import type {
  Order,
  OrderItem,
  OrderStatus,
  OrderStatusLog,
  OrderSummary,
  OrderType,
  ProductDetail,
} from '@/domain/types';

export function makeOrder(over: Partial<Order> = {}): Order {
  const status: OrderStatus = over.status ?? 'PENDING';
  const orderType: OrderType = over.orderType ?? 'PICKUP';
  const base: Order = {
    id: 'ord_1',
    orderNo: 'ZO261014K7M3QX',
    storeId: 'store_1',
    orderType,
    status,
    pickupNo: 'A027',
    businessDate: '2026-10-14',
    customer: { name: '王小明', phone: '0912345678' },
    scheduledAt: null,
    estimatedReadyAt: '2026-10-14T12:35:00+08:00',
    acceptBy: status === 'PENDING' ? '2026-10-14T12:30:00+08:00' : null,
    items: [
      {
        id: 'it_1',
        productId: 'prd_lurou',
        name: '招牌滷肉飯',
        quantity: 2,
        unitPrice: 55,
        lineTotal: 110,
        options: [
          { groupName: '份量', name: '大碗', priceDelta: 10 },
          { groupName: '加料', name: '滷蛋', priceDelta: 10 },
        ],
        note: '不要蔥',
      },
      {
        id: 'it_2',
        productId: 'prd_tea',
        name: '古早味紅茶',
        quantity: 1,
        unitPrice: 25,
        lineTotal: 25,
        options: [],
      },
    ],
    amounts: { subtotal: 135, deliveryFee: 0, discount: 0, total: 135 },
    needUtensils: true,
    invoice: { type: 'PAPER', status: 'PENDING' },
    payment: { method: 'CASH', status: 'UNPAID', expiresAt: null },
    timeline: [{ status: 'PENDING', at: '2026-10-14T12:20:00+08:00', by: 'CUSTOMER' }],
    placedAt: '2026-10-14T12:20:00+08:00',
    permissions: { canCancel: status === 'PENDING', canPay: false, canReorder: true, canReview: false },
  };
  return { ...base, ...over };
}

export const log = (status: OrderStatus, at: string, by: OrderStatusLog['by'] = 'STORE', note?: string): OrderStatusLog =>
  note === undefined ? { status, at, by } : { status, at, by, note };

export function makeSummary(over: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id: 'ord_1',
    orderNo: 'ZO261014K7M3QX',
    orderType: 'PICKUP',
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    pickupNo: 'A027',
    total: 135,
    itemCount: 3,
    itemsPreview: '招牌滷肉飯 等 2 項',
    placedAt: '2026-10-11T12:20:00+08:00',
    scheduledAt: null,
    ...over,
  };
}

export function makeDetail(over: Partial<ProductDetail> & { id: string; name: string }): ProductDetail {
  return {
    categoryId: 'cat_1',
    basePrice: 50,
    displayPrice: 50,
    isPriceFrom: false,
    tags: [],
    allergens: [],
    isSoldOut: false,
    hasRequiredOptions: false,
    optionGroups: [],
    ...over,
  };
}

export const lurouDetail = (over: Partial<ProductDetail> = {}): ProductDetail =>
  makeDetail({
    id: 'prd_lurou',
    name: '招牌滷肉飯',
    basePrice: 35,
    displayPrice: 35,
    hasRequiredOptions: true,
    remainingToday: null,
    optionGroups: [
      {
        id: 'g_size',
        name: '份量',
        selectionType: 'SINGLE',
        required: true,
        minSelect: 1,
        maxSelect: 1,
        options: [
          { id: 'o_small', name: '小碗', priceDelta: 0, isDefault: true, isAvailable: true },
          { id: 'o_large', name: '大碗', priceDelta: 10, isDefault: false, isAvailable: true },
        ],
      },
      {
        id: 'g_extra',
        name: '加料',
        selectionType: 'MULTIPLE',
        required: false,
        minSelect: 0,
        maxSelect: 3,
        options: [
          { id: 'o_egg', name: '滷蛋', priceDelta: 10, isDefault: false, isAvailable: true },
          { id: 'o_tofu', name: '豆干', priceDelta: 10, isDefault: false, isAvailable: true },
        ],
      },
    ],
    ...over,
  });

export const teaDetail = (over: Partial<ProductDetail> = {}): ProductDetail =>
  makeDetail({ id: 'prd_tea', name: '古早味紅茶', basePrice: 25, displayPrice: 25, remainingToday: null, ...over });

export const item = (over: Partial<OrderItem> & { name: string }): OrderItem => ({
  id: `it_${over.name}`,
  productId: 'prd_tea',
  quantity: 1,
  unitPrice: 25,
  lineTotal: 25,
  options: [],
  ...over,
});
