import type { Address, Coupon, DeliveryZone, Menu, ProductSummary, UserCoupon, UserProfile } from '@/domain/types';

export const profile: UserProfile = {
  id: 'usr_1',
  phone: '0912345678',
  name: '王小明',
  email: 'ming@example.com',
  marketingOptIn: false,
  createdAt: '2026-10-01T00:00:00+08:00',
};

export const tokens = { accessToken: 'acc', refreshToken: 'ref', expiresIn: 900 };

export const zones: DeliveryZone[] = [
  { zipCode: '106', city: '臺北市', district: '大安區', deliveryFee: 30, minOrderAmount: 200, freeDeliveryThreshold: 500, estimatedMinutes: 40 },
  { zipCode: '104', city: '臺北市', district: '中山區', deliveryFee: 40, minOrderAmount: 250, freeDeliveryThreshold: null, estimatedMinutes: 45 },
  { zipCode: '220', city: '新北市', district: '板橋區', deliveryFee: 60, minOrderAmount: 300, freeDeliveryThreshold: null, estimatedMinutes: 50 },
];

export const address = (over: Partial<Address> = {}): Address => ({
  id: 'adr_1',
  label: '家',
  recipientName: '王小明',
  recipientPhone: '0912345678',
  city: '臺北市',
  district: '大安區',
  zipCode: '106',
  line: '示範路 100 號 3 樓',
  isDefault: true,
  ...over,
});

export const product = (over: Partial<ProductSummary> & { id: string; name: string }): ProductSummary => ({
  categoryId: 'cat_1',
  basePrice: 50,
  displayPrice: 50,
  isPriceFrom: false,
  tags: [],
  allergens: [],
  isSoldOut: false,
  hasRequiredOptions: false,
  ...over,
});

export const menuOf = (...products: ProductSummary[]): Menu => ({
  categories: [{ id: 'cat_1', name: '飯類', icon: '🍚', products }],
  generatedAt: '2026-10-14T12:00:00+08:00',
});

export const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  id: 'cpn_1',
  code: 'LUNCH10',
  name: '午餐 9 折',
  description: '小計滿 $150 享 9 折，最高折 $40',
  discountType: 'PERCENT',
  discountValue: 10,
  maxDiscountAmount: 40,
  minOrderAmount: 150,
  applicableOrderTypes: ['PICKUP', 'DELIVERY', 'DINE_IN'],
  memberOnly: false,
  startsAt: '2026-10-01T00:00:00+08:00',
  endsAt: '2026-10-31T23:59:59+08:00',
  ...over,
});

export const userCoupon = (over: Partial<UserCoupon> = {}): UserCoupon => ({
  id: 'uc_1',
  coupon: coupon(),
  status: 'AVAILABLE',
  claimedAt: '2026-10-02T10:00:00+08:00',
  ...over,
});
