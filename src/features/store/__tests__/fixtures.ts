// 測試用店家資料：每週一至週日 11:00–14:00、17:00–21:00（週一公休），台北時間
import type { BusinessHour, StoreInfo, StoreStatus, Weekday } from '@/domain/types';

const weekdays: Weekday[] = [0, 2, 3, 4, 5, 6];

export const BUSINESS_HOURS: BusinessHour[] = weekdays.flatMap((weekday) => [
  { weekday, open: '11:00', close: '14:00' },
  { weekday, open: '17:00', close: '21:00' },
]);

export function makeStoreInfo(overrides: Partial<StoreInfo> = {}): StoreInfo {
  return {
    id: 'store-1',
    slug: 'demo-snack',
    name: '巷仔內小吃部',
    tagline: '古早味・現點現做',
    description: '三十年老店，主打滷肉飯與各式小菜。',
    phone: '02-0000-0000',
    email: 'hello@example.com',
    address: { city: '臺北市', district: '大安區', zipCode: '106', line: '示範路 100 號' },
    announcement: '本週五提早 20:00 打烊',
    timezone: 'Asia/Taipei',
    services: { pickup: true, delivery: true, dineIn: true },
    paymentMethods: ['CASH', 'LINE_PAY'],
    businessHours: BUSINESS_HOURS,
    specialDays: [],
    display: { brandColor: '#D93A22', menuLayout: 'AUTO' },
    limits: {
      minOrderAmount: 0,
      maxQuantityPerItem: 20,
      maxLines: 30,
      maxAdvanceDays: 7,
      slotIntervalMinutes: 15,
      pickupLeadMinutes: 15,
      deliveryLeadMinutes: 40,
    },
    status: { status: 'OPEN', todayHours: [], serverTime: '2026-10-14T12:00:00+08:00' },
    ...overrides,
  };
}

export function makeStatus(overrides: Partial<StoreStatus> = {}): StoreStatus {
  return {
    status: 'OPEN',
    todayHours: [
      { open: '11:00', close: '14:00' },
      { open: '17:00', close: '21:00' },
    ],
    serverTime: '2026-10-14T12:00:00+08:00',
    ...overrides,
  };
}

/** 2026-10-14（週三）12:00 台北時間 */
export const NOON_MS = Date.parse('2026-10-14T12:00:00+08:00');
