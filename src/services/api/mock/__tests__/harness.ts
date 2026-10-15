// Mock Adapter 測試用的共用工具：記憶體儲存、可控時鐘、請求建構
import { setClock, systemClock } from '@/services/clock';
import type {
  CreateOrderRequest, ID, OrderLineInput, PaymentMethod, QuoteRequest,
} from '@/domain/types';
import { ApiError } from '../../http/request';
import { createMockClient } from '../createMockClient';
import type { MockClient, MockClientOptions } from '../createMockClient';
import type { DemoState } from '../demoControl';

/** 2026-10-14（週三）12:00，午餐營業中 */
export const T0 = Date.parse('2026-10-14T12:00:00+08:00');

export function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

export interface Harness {
  client: MockClient;
  storage: Storage;
  /** 目前的模擬時間（epoch ms） */
  now(): number;
  /** 時間前進 ms（時鐘由測試控制，不依賴真實時間） */
  advance(ms: number): void;
  setNow(ms: number): void;
  /** 在同一個儲存上再開一個「分頁」（共用 localStorage，各自擁有 db 實例） */
  openTab(opts?: Partial<MockClientOptions>): MockClient;
  cleanup(): void;
}

export function setup(
  opts: { now?: number; demo?: Partial<DemoState>; client?: Partial<MockClientOptions> } = {},
): Harness {
  let nowMs = opts.now ?? T0;
  setClock({ now: () => new Date(nowMs) });
  const storage = opts.client?.storage ?? memoryStorage();
  const tabs: MockClient[] = [];
  const open = (extra: Partial<MockClientOptions> = {}): MockClient => {
    const c = createMockClient({
      storeSlug: 'demo-snack',
      storage,
      locks: null,
      demoMode: false,
      syncTabs: false,
      reloadPage: () => undefined,
      ...opts.client,
      ...extra,
    });
    tabs.push(c);
    return c;
  };
  const client = open();
  client.demo.setState({ latencyMs: 0, ...opts.demo });
  return {
    client,
    storage,
    now: () => nowMs,
    advance: (ms) => {
      nowMs += ms;
    },
    setNow: (ms) => {
      nowMs = ms;
    },
    openTab: (o) => open(o),
    cleanup() {
      for (const t of tabs) t.dispose();
      setClock(systemClock);
    },
  };
}

export const line = (
  productId: ID,
  quantity = 1,
  optionIds: ID[] = [],
  note?: string,
): OrderLineInput => {
  const l: OrderLineInput = { productId, quantity, optionIds };
  if (note !== undefined) l.note = note;
  return l;
};

/** 招牌滷肉飯（大碗・滷蛋）$67 */
export const LUROU = (qty = 1): OrderLineInput => line('prd_lurou', qty, ['opt_bowl_l', 'opt_egg']);
/** 古早味紅茶（中杯・半糖・微冰）$25 */
export const TEA = (qty = 1): OrderLineInput =>
  line('prd_black_tea', qty, ['opt_cup_m', 'opt_sugar_half', 'opt_ice_light']);
/** 雙人分享餐（滷肉飯 + 雞肉飯 / 蚵仔煎 / 燙青菜）$299 */
export const COMBO = (qty = 1): OrderLineInput =>
  line('prd_combo_share', qty, ['opt_sm_lurou', 'opt_sm_chicken', 'opt_ss_oyster', 'opt_sd_greens']);

export const quoteReq = (items: OrderLineInput[], over: Partial<QuoteRequest> = {}): QuoteRequest => ({
  orderType: 'PICKUP',
  items,
  scheduledAt: null,
  ...over,
});

export const createReq = (
  items: OrderLineInput[],
  expectedTotal: number,
  over: Partial<CreateOrderRequest> = {},
): CreateOrderRequest => ({
  orderType: 'PICKUP',
  items,
  scheduledAt: null,
  contact: { name: '王小明', phone: '0912345678' },
  paymentMethod: 'CASH' as PaymentMethod,
  invoice: { type: 'PAPER' },
  needUtensils: false,
  expectedTotal,
  ...over,
});

let keySeq = 0;
/** 測試用的 Idempotency-Key（UUID 形狀） */
export const newKey = (): string => {
  keySeq += 1;
  return `00000000-0000-4000-8000-${String(keySeq).padStart(12, '0')}`;
};

/** 取得被拒時的 ApiError（成功則失敗） */
export async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('預期 Promise 被拒絕，但成功了');
}
