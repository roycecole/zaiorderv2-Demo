// 菜單 / 購物車測試共用的假資料與假 ApiClient（未被 *.test.* 收錄）
import { createFakeApi } from '@/test/fakeApi';
import type { ApiClient } from '@/services/api/ApiClient';
import type {
  Banner,
  FrequentItem,
  Menu,
  MenuCategory,
  OptionGroup,
  ProductDetail,
  ProductSummary,
  QuoteRequest,
  QuoteResponse,
  QuotedLine,
  StoreInfo,
  StoreStatus,
} from '@/domain/types';

export const OPEN_STATUS: StoreStatus = {
  status: 'OPEN',
  todayHours: [{ open: '11:00', close: '21:00' }],
  serverTime: '2026-10-14T12:00:00+08:00',
};

export const CLOSED_STATUS: StoreStatus = {
  status: 'CLOSED',
  closedReason: 'OUT_OF_HOURS',
  nextOpenAt: '2026-10-14T17:00:00+08:00',
  todayHours: [{ open: '11:00', close: '14:00' }],
  serverTime: '2026-10-14T15:00:00+08:00',
};

export const PAUSED_STATUS: StoreStatus = {
  status: 'PAUSED',
  todayHours: [{ open: '11:00', close: '21:00' }],
  serverTime: '2026-10-14T12:00:00+08:00',
};

export function storeInfo(overrides: Partial<StoreInfo> = {}): StoreInfo {
  return {
    id: 'store_1',
    slug: 'demo',
    name: '巷仔內小吃部',
    phone: '02-0000-0000',
    address: { city: '臺北市', district: '大安區', zipCode: '106', line: '示範路 100 號' },
    timezone: 'Asia/Taipei',
    services: { pickup: true, delivery: true, dineIn: true },
    paymentMethods: ['CASH'],
    businessHours: [],
    specialDays: [],
    display: { brandColor: null, menuLayout: 'AUTO' },
    limits: {
      minOrderAmount: 0,
      maxQuantityPerItem: 20,
      maxLines: 30,
      maxAdvanceDays: 7,
      slotIntervalMinutes: 15,
      pickupLeadMinutes: 15,
      deliveryLeadMinutes: 30,
    },
    status: OPEN_STATUS,
    ...overrides,
  };
}

export function product(
  overrides: Partial<ProductSummary> & Pick<ProductSummary, 'id' | 'name'>,
): ProductSummary {
  return {
    categoryId: 'cat_rice',
    basePrice: 35,
    displayPrice: 35,
    isPriceFrom: false,
    tags: [],
    allergens: [],
    isSoldOut: false,
    hasRequiredOptions: false,
    ...overrides,
  };
}

export const SIZE_GROUP: OptionGroup = {
  id: 'og_size',
  name: '份量',
  selectionType: 'SINGLE',
  required: true,
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: 'opt_s', name: '小碗', priceDelta: 0, isDefault: true, isAvailable: true },
    { id: 'opt_l', name: '大碗', priceDelta: 20, isDefault: false, isAvailable: true },
  ],
};

export const TOPPING_GROUP: OptionGroup = {
  id: 'og_topping',
  name: '加料',
  selectionType: 'MULTIPLE',
  required: false,
  minSelect: 0,
  maxSelect: 2,
  options: [
    { id: 'opt_egg', name: '滷蛋', priceDelta: 12, isDefault: false, isAvailable: true },
    { id: 'opt_tofu', name: '滷豆干', priceDelta: 10, isDefault: false, isAvailable: true },
    { id: 'opt_meat', name: '加肉燥', priceDelta: 10, isDefault: false, isAvailable: true },
  ],
};

/** 招牌滷肉飯：必選份量 + 選填加料（對應 08 §3 的種子商品） */
export const LUROU: ProductSummary = product({
  id: 'prd_lurou',
  name: '招牌滷肉飯',
  description: '古早味滷肉燥，肥瘦比例剛剛好',
  imageUrl: '/images/lurou.svg',
  displayPrice: 35,
  isPriceFrom: true,
  tags: ['HOT'],
  allergens: ['SOY'],
  hasRequiredOptions: true,
});

export function detailOf(summary: ProductSummary, optionGroups: OptionGroup[] = []): ProductDetail {
  return { ...summary, optionGroups };
}

export const LUROU_DETAIL: ProductDetail = detailOf(LUROU, [SIZE_GROUP, TOPPING_GROUP]);

export function menuOf(
  ...categories: Array<Partial<MenuCategory> & Pick<MenuCategory, 'id' | 'name' | 'products'>>
): Menu {
  return {
    categories: categories.map((c) => ({ ...c })),
    generatedAt: '2026-10-14T12:00:00+08:00',
  };
}

/** 菜單內商品的依賴關係：商品詳情由 details 提供 */
export interface FakeApiOptions {
  menu?: Menu;
  details?: ProductDetail[];
  status?: StoreStatus;
  info?: StoreInfo;
  banners?: Banner[];
  quote?: (req: QuoteRequest) => QuoteResponse | Promise<QuoteResponse>;
  frequent?: FrequentItem[];
  favorites?: string[];
  /** 覆寫「加入我的最愛」的 API（測試失敗回復） */
  favoriteAdd?: (productId: string) => Promise<void>;
  /** QR 桌號解析（`GET /tables/{qrToken}`）；省略時未提供（未掃 QR 的測試不應呼叫） */
  resolveTable?: (qrToken: string) => Promise<{ tableNo: string; seats?: number }>;
}

export function fakeApi(options: FakeApiOptions = {}): ApiClient {
  const {
    menu = menuOf({ id: 'cat_rice', name: '飯類', icon: '🍚', products: [LUROU] }),
    details = [LUROU_DETAIL],
    status = OPEN_STATUS,
    info = storeInfo({ status }),
    banners = [],
    quote,
    frequent,
    favorites = [],
    favoriteAdd,
    resolveTable,
  } = options;
  const favoriteIds = [...favorites];
  return createFakeApi({
    store: {
      getInfo: async () => info,
      getStatus: async () => status,
      getMenu: async () => menu,
      getBanners: async () => ({ items: banners }),
      getProduct: async (id: string) => {
        const hit = details.find((d) => d.id === id);
        if (hit === undefined) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' });
        return hit;
      },
      ...(resolveTable === undefined ? {} : { resolveTable }),
    },
    orders: quote === undefined ? {} : { quote: async (req: QuoteRequest) => quote(req) },
    me: {
      frequentItems: async () => ({ items: frequent ?? [] }),
      favorites: {
        list: async () => ({ productIds: [...favoriteIds] }),
        add: async (id: string) => {
          await favoriteAdd?.(id);
          favoriteIds.push(id);
        },
        remove: async (id: string) => {
          const i = favoriteIds.indexOf(id);
          if (i >= 0) favoriteIds.splice(i, 1);
        },
      },
    },
  });
}

/** 依請求內容產生一份「全部可購買」的 quote；overrides 可針對索引改寫單行 */
export function quoteFor(
  req: QuoteRequest,
  priceOf: (productId: string) => number,
  overrides: Record<number, Partial<QuotedLine>> = {},
): QuoteResponse {
  const items: QuotedLine[] = req.items.map((item, index) => {
    const unit = priceOf(item.productId);
    const line: QuotedLine = {
      index,
      productId: item.productId,
      name: item.productId,
      optionLabels: [],
      unitPrice: unit,
      quantity: item.quantity,
      lineTotal: unit * item.quantity,
      available: true,
      availableQuantity: item.quantity,
      ...overrides[index],
    };
    if (overrides[index] !== undefined && line.available === false) {
      line.lineTotal = line.unitPrice * line.availableQuantity;
    }
    return line;
  });
  const subtotal = items.reduce((sum, l) => sum + l.lineTotal, 0);
  return { valid: true, items, subtotal, deliveryFee: 0, discount: 0, total: subtotal, checks: [] };
}
