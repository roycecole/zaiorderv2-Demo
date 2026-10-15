// src/services/api/mock/seed/store.ts —— 店家、營運設定、營業時間、外送範圍、桌位、Banner、優惠券（08 §2、§3.3）
import { addDays, dateOfMs, dayStartMs } from '@/domain/taipeiTime';
import type {
  Banner, BusinessHour, DiscountType, ID, MenuLayout, OrderType, PaymentMethod, SpecialDay, Weekday,
} from '@/domain/types';

export const STORE_ID: ID = '01JAXN0000000000000000STORE';

/** 設計參考的預設品牌色（辣椒紅） */
export const DEFAULT_BRAND_COLOR = '#D93A22';

export interface StoreSeed {
  id: ID;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  logoPath: string;
  coverPath: string;
  phone: string;
  email: string;
  city: string;
  district: string;
  zipCode: string;
  addressLine: string;
  announcement: string;
  timezone: string;
  brandColor: string | null;
}

export interface SettingsSeed {
  isAcceptingOrders: boolean;
  pausedUntil: number | null;
  allowPickup: boolean;
  allowDelivery: boolean;
  allowDineIn: boolean;
  pickupLeadMinutes: number;
  deliveryLeadMinutes: number;
  slotIntervalMinutes: number;
  maxAdvanceDays: number;
  /** null = 不限 */
  maxOrdersPerSlot: number | null;
  lastOrderOffsetMinutes: number;
  minOrderAmount: number;
  paymentTimeoutMinutes: number;
  acceptTimeoutMinutes: number;
  menuLayout: MenuLayout;
  maxQuantityPerItem: number;
  maxLines: number;
}

export interface ZoneSeed {
  zipCode: string;
  city: string;
  district: string;
  deliveryFee: number;
  minOrderAmount: number;
  freeDeliveryThreshold: number | null;
  estimatedMinutes: number | null;
  isActive: boolean;
}

export interface TableSeed {
  tableNo: string;
  /** Demo 的 qr_token 直接等於桌號（08 §2.5）；正式環境為不可猜測權杖 */
  qrToken: string;
  seats: number;
  isActive: boolean;
}

export interface BannerSeed {
  id: ID;
  title: string;
  imagePath: string;
  linkType: Banner['linkType'];
  linkValue?: string;
}

export interface CouponSeed {
  id: ID;
  code: string;
  name: string;
  description: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  applicableOrderTypes: OrderType[];
  memberOnly: boolean;
  totalQuota: number | null;
  /** 種子的已使用次數；db 另以 coupon_usage 記錄增量 */
  usedCount: number;
  perUserLimit: number | null;
  startsAt: number;
  endsAt: number;
  isActive: boolean;
}

export const ALL_ORDER_TYPES: OrderType[] = ['PICKUP', 'DELIVERY', 'DINE_IN'];

export function buildStoreSeed(slug: string): StoreSeed {
  return {
    id: STORE_ID,
    slug,
    name: '巷仔內小吃部',
    tagline: '三十年老味道',
    description: '滷肉飯、牛肉麵、蚵仔煎、手搖古早味，三十年來堅持現做現煮。（示範資料，皆為虛構）',
    logoPath: 'store/logo.svg',
    coverPath: 'store/cover.svg',
    phone: '02-0000-0000',
    email: 'hello@example.com',
    city: '臺北市',
    district: '大安區',
    zipCode: '106',
    addressLine: '示範路 100 號',
    announcement: '本週日公休，歡迎提前預約',
    timezone: 'Asia/Taipei',
    brandColor: DEFAULT_BRAND_COLOR,
  };
}

export const SETTINGS_SEED: SettingsSeed = {
  isAcceptingOrders: true,
  pausedUntil: null,
  allowPickup: true,
  allowDelivery: true,
  allowDineIn: true,
  pickupLeadMinutes: 15,
  deliveryLeadMinutes: 40,
  slotIntervalMinutes: 15,
  maxAdvanceDays: 1,
  maxOrdersPerSlot: 8,
  lastOrderOffsetMinutes: 15,
  minOrderAmount: 0,
  paymentTimeoutMinutes: 15,
  acceptTimeoutMinutes: 10,
  menuLayout: 'AUTO',
  maxQuantityPerItem: 20,
  maxLines: 30,
};

/** 週一至週六 11:00–14:00、17:00–21:00；週日公休（08 §2.2） */
export const BUSINESS_HOURS: BusinessHour[] = ([1, 2, 3, 4, 5, 6] as Weekday[]).flatMap((weekday) => [
  { weekday, open: '11:00', close: '14:00' },
  { weekday, open: '17:00', close: '21:00' },
]);

/** 特殊公休：播種當下的「今日 + 3 日」（相對日期，確保 Demo 隨時有可展示的公休日；備註「店休日」） */
export function buildSpecialDays(anchorMs: number): SpecialDay[] {
  return [{ date: addDays(dateOfMs(anchorMs), 3), type: 'CLOSED', note: '店休日' }];
}

/** 08 §2.3 */
export const DELIVERY_ZONES: ZoneSeed[] = [
  {
    zipCode: '106', city: '臺北市', district: '大安區',
    deliveryFee: 30, minOrderAmount: 150, freeDeliveryThreshold: 400, estimatedMinutes: 35, isActive: true,
  },
  {
    zipCode: '100', city: '臺北市', district: '中正區',
    deliveryFee: 40, minOrderAmount: 200, freeDeliveryThreshold: 500, estimatedMinutes: 45, isActive: true,
  },
  {
    zipCode: '110', city: '臺北市', district: '信義區',
    deliveryFee: 60, minOrderAmount: 300, freeDeliveryThreshold: 600, estimatedMinutes: 55, isActive: true,
  },
];

/** 桌號 A1～A6（08 §2.5） */
export const TABLES: TableSeed[] = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((tableNo, i) => ({
  tableNo,
  qrToken: tableNo,
  seats: i % 2 === 0 ? 2 : 4,
  isActive: true,
}));

/** 店家啟用的付款方式（依顯示順序） */
export const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'CREDIT_CARD', 'LINE_PAY', 'JKOPAY'];

/** 08 §3.3 */
export const BANNERS: BannerSeed[] = [
  {
    id: 'bnr_aiyu',
    title: '新品上市：愛玉檸檬',
    imagePath: 'banners/aiyu.svg',
    linkType: 'PRODUCT',
    linkValue: 'prd_aiyu',
  },
  {
    id: 'bnr_combo',
    title: '雙人分享餐 限量供應',
    imagePath: 'banners/combo.svg',
    linkType: 'PRODUCT',
    linkValue: 'prd_combo_share',
  },
  {
    id: 'bnr_lunch10',
    title: '午餐 9 折（代碼 LUNCH10）',
    imagePath: 'banners/lunch10.svg',
    linkType: 'NONE',
  },
];

const DAY = 86_400_000;

/** 08 §2.4；有效期間相對於播種時間，確保 Demo 隨時有可用的優惠券 */
export function buildCoupons(anchorMs: number): CouponSeed[] {
  const startsAt = dayStartMs(addDays(dateOfMs(anchorMs), -30));
  const endsAt = dayStartMs(addDays(dateOfMs(anchorMs), 120));
  /** 已於 2025-12-31 到期；時鐘早於該日時改為「昨日」到期，確保永遠展示 COUPON_EXPIRED */
  const expiredEnd = Math.min(
    Date.parse('2025-12-31T23:59:59+08:00'),
    dayStartMs(dateOfMs(anchorMs)) - 1000,
  );
  const base = {
    maxDiscountAmount: null,
    applicableOrderTypes: ALL_ORDER_TYPES,
    memberOnly: false,
    totalQuota: null,
    usedCount: 0,
    perUserLimit: null,
    startsAt,
    endsAt,
    isActive: true,
  } satisfies Partial<CouponSeed>;
  return [
    {
      ...base,
      id: 'cpn_welcome50',
      code: 'WELCOME50',
      name: '新朋友折 $50',
      description: '小計滿 $250 折 $50，每人限用 1 次',
      discountType: 'FIXED_AMOUNT',
      discountValue: 50,
      minOrderAmount: 250,
      perUserLimit: 1,
    },
    {
      ...base,
      id: 'cpn_lunch10',
      code: 'LUNCH10',
      name: '午餐 9 折',
      description: '小計滿 $150 享 9 折，最高折 $40',
      discountType: 'PERCENT',
      discountValue: 10,
      maxDiscountAmount: 40,
      minOrderAmount: 150,
    },
    {
      ...base,
      id: 'cpn_freeship',
      code: 'FREESHIP',
      name: '外送免運',
      description: '外送小計滿 $300 免運費',
      discountType: 'FREE_DELIVERY',
      discountValue: 0,
      minOrderAmount: 300,
      applicableOrderTypes: ['DELIVERY'],
    },
    {
      ...base,
      id: 'cpn_member20',
      code: 'MEMBER20',
      name: '會員專屬折 $20',
      description: '小計滿 $100 折 $20，僅限會員',
      discountType: 'FIXED_AMOUNT',
      discountValue: 20,
      minOrderAmount: 100,
      memberOnly: true,
    },
    {
      ...base,
      id: 'cpn_old2025',
      code: 'OLD2025',
      name: '2025 年末優惠',
      description: '已於 2025-12-31 到期',
      discountType: 'FIXED_AMOUNT',
      discountValue: 30,
      minOrderAmount: 0,
      startsAt: expiredEnd - 365 * DAY,
      endsAt: expiredEnd,
    },
    {
      ...base,
      id: 'cpn_usedup',
      code: 'USEDUP',
      name: '限量折 $10',
      description: '總量 1 張，已被領完',
      discountType: 'FIXED_AMOUNT',
      discountValue: 10,
      minOrderAmount: 0,
      totalQuota: 1,
      usedCount: 1,
    },
  ];
}
