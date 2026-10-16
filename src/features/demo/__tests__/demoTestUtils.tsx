// Demo 面板測試共用：假的 DemoControl 與包含它的 ApiClient、頂部列入口 + DemoRoot 的組合
//
// 使用這裡的 `DemoHarness`（或單獨渲染 `DemoTrigger`）的測試檔必須自行 mock `@/config/env`（vi.mock 只對宣告它的測試檔生效）：
//   vi.mock('@/config/env', async (importOriginal) => ({
//     env: { ...(await importOriginal<{ env: object }>()).env, demoMode: true },
//   }));
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Menu, Order, OrderSummary, PickupSlotsResponse, StoreInfo } from '@/domain/types';
import type { ApiClient } from '@/services/api/ApiClient';
import { DEFAULT_DEMO_STATE } from '@/services/api/mock/demoControl';
import type { DemoControl, DemoState, StockSnapshot } from '@/services/api/mock/demoControl';
import type { CreateLogEntry } from '@/services/api/mock/requestLog';
import DemoRoot from '../DemoRoot';
import { DemoTrigger } from '../DemoTrigger';

/** 正式環境的組合：頂部列的入口（DemoTrigger，主 bundle）+ 外殼底下的 DemoRoot（延後載入） */
export function DemoHarness() {
  return (
    <>
      <DemoTrigger />
      <DemoRoot />
    </>
  );
}

export interface FakeDemo extends DemoControl {
  /** 目前狀態（直接改它可模擬「外部變更」，例如失敗注入被消耗） */
  current: DemoState;
  getState: Mock<() => DemoState>;
  setState: Mock<(patch: Partial<DemoState>) => void>;
  act: Mock<DemoControl['act']>;
  loginAsDemoUser: Mock<DemoControl['loginAsDemoUser']>;
  resetAll: Mock<DemoControl['resetAll']>;
  getStock: Mock<(productId: string) => StockSnapshot>;
  setLimit: Mock<DemoControl['setLimit']>;
  setRemaining: Mock<DemoControl['setRemaining']>;
  injectOtherOrder: Mock<DemoControl['injectOtherOrder']>;
  fillSlot: Mock<DemoControl['fillSlot']>;
  armRace: Mock<DemoControl['armRace']>;
  disarmRace: Mock<DemoControl['disarmRace']>;
  clearOtherOrders: Mock<DemoControl['clearOtherOrders']>;
  getCreateLog: Mock<DemoControl['getCreateLog']>;
}

export function createFakeDemo(initial: Partial<DemoState> = {}): FakeDemo {
  const fake = {
    current: { ...DEFAULT_DEMO_STATE, ...initial } as DemoState,
  } as FakeDemo;
  fake.getState = vi.fn(() => JSON.parse(JSON.stringify(fake.current)) as DemoState);
  fake.setState = vi.fn((patch: Partial<DemoState>) => {
    fake.current = { ...fake.current, ...patch };
  });
  fake.act = vi.fn(async (orderId) => ({ id: orderId }) as Order);
  fake.loginAsDemoUser = vi.fn(async () => undefined);
  fake.settlePayment = vi.fn() as unknown as FakeDemo['settlePayment'];
  fake.resetAll = vi.fn();
  fake.getStock = vi.fn(() => ({ dailyLimit: 5, sold: 1, held: 0, remaining: 4 }));
  fake.setLimit = vi.fn();
  fake.setRemaining = vi.fn();
  fake.injectOtherOrder = vi.fn(async (spec) => ({ added: spec.quantity }));
  fake.fillSlot = vi.fn(async () => ({ added: 2 }));
  fake.armRace = vi.fn((spec) => {
    fake.current = { ...fake.current, raceOnNextCreate: spec };
  });
  fake.disarmRace = vi.fn(() => {
    fake.current = { ...fake.current, raceOnNextCreate: null };
  });
  fake.clearOtherOrders = vi.fn(() => 2);
  fake.getCreateLog = vi.fn((): CreateLogEntry[] => []);
  return fake;
}

export const TEST_MENU: Menu = {
  generatedAt: '2026-10-14T12:00:00+08:00',
  categories: [
    {
      id: 'cat_combo',
      name: '套餐',
      products: [
        {
          id: 'prd_combo_share',
          categoryId: 'cat_combo',
          name: '雙人分享餐',
          basePrice: 299,
          displayPrice: 299,
          isPriceFrom: false,
          tags: [],
          allergens: [],
          isSoldOut: false,
          remainingToday: 5,
          hasRequiredOptions: false,
        },
        {
          id: 'prd_lurou',
          categoryId: 'cat_combo',
          name: '招牌滷肉飯',
          basePrice: 35,
          displayPrice: 35,
          isPriceFrom: false,
          tags: [],
          allergens: [],
          isSoldOut: false,
          remainingToday: null,
          hasRequiredOptions: false,
        },
      ],
    },
  ],
};

export const TEST_SLOTS: PickupSlotsResponse = {
  orderType: 'PICKUP',
  asap: { available: true },
  days: [
    {
      date: '2026-10-14',
      label: '今天',
      slots: [
        { startAt: '2026-10-14T12:30:00+08:00', status: 'AVAILABLE' },
        { startAt: '2026-10-14T13:00:00+08:00', status: 'FULL' },
      ],
    },
  ],
};

export const TEST_STORE_INFO = {
  businessHours: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: '11:00', close: '21:00' })),
  specialDays: [],
  display: { brandColor: '#D93A22', menuLayout: 'AUTO' },
} as unknown as StoreInfo;

export interface TestApiOptions {
  orders?: Order[];
  summaries?: OrderSummary[];
}

/** 含 DemoControl 的最小 ApiClient（只實作面板會呼叫的方法） */
export function createDemoApi(demo: DemoControl | null, options: TestApiOptions = {}) {
  const orders = options.orders ?? [];
  const api = {
    ...(demo !== null ? { demo } : {}),
    auth: {
      refresh: vi.fn(async () => ({
        tokens: { accessToken: 'acc', refreshToken: 'ref', expiresIn: 900 },
      })),
      verifyOtp: vi.fn(async () => ({
        tokens: { accessToken: 'acc2', refreshToken: 'ref2', expiresIn: 900 },
        user: {
          id: 'usr_demo',
          phone: '0900000000',
          marketingOptIn: false,
          createdAt: '2026-10-01T00:00:00+08:00',
        },
        isNewUser: false,
      })),
      logout: vi.fn(async () => undefined),
    },
    me: {
      get: vi.fn(async () => ({
        id: 'usr_demo',
        phone: '0900000000',
        name: '示範會員',
        marketingOptIn: false,
        createdAt: '2026-10-01T00:00:00+08:00',
      })),
    },
    store: {
      getInfo: vi.fn(async () => TEST_STORE_INFO),
      getMenu: vi.fn(async () => TEST_MENU),
      getPickupSlots: vi.fn(async () => TEST_SLOTS),
    },
    orders: {
      get: vi.fn(async (id: string) => {
        const found = orders.find((o) => o.id === id);
        if (found === undefined) throw new Error('not found');
        return found;
      }),
      list: vi.fn(async () => ({ items: options.summaries ?? [], nextCursor: null })),
    },
  };
  return api as unknown as ApiClient & {
    auth: { refresh: Mock; verifyOtp: Mock; logout: Mock };
    me: { get: Mock };
    store: { getInfo: Mock; getMenu: Mock; getPickupSlots: Mock };
    orders: { get: Mock; list: Mock };
  };
}

export function order(partial: Partial<Order> & Pick<Order, 'id' | 'status'>): Order {
  return {
    orderNo: `ZO${partial.id}`,
    pickupNo: 'A001',
    orderType: 'PICKUP',
    placedAt: '2026-10-14T12:00:00+08:00',
    ...partial,
  } as Order;
}
