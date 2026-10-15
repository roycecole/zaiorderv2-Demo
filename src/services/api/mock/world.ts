// src/services/api/mock/world.ts —— loadWorld：db 與 DemoState 覆寫的唯一合成處（07 §6.8 步驟 1）
// menu、product、pickup-slots、quote 與 create 共用；覆寫（售完、調價、限量）只在這裡與 db 合成，
// 因此面板的覆寫同時作用於試算與送出。World 為唯讀快照：不碰 I/O，時間由參數傳入。
import { countsTowardStock, remainingOf, targetBusinessDate } from '@/domain/availability';
import type { BusinessCalendar } from '@/domain/availability';
import { computeStoreStatus, nextOpenAfter, spanContaining } from '@/domain/storeStatus';
import type { HoursSource } from '@/domain/storeStatus';
import { TAIPEI_OFFSET_MINUTES, toIsoTaipei } from '@/domain/taipeiTime';
import { leadMinutesFor } from '@/domain/timeouts';
import type {
  ClosedReason, HHmm, ID, ISODate, Menu, MenuCategory, OptionGroup, OrderType, ProductDetail,
  ProductSummary, StoreStatusCode,
} from '@/domain/types';
import type { DemoState } from './demoControl';
import type { DbData, UserRow } from './dbTypes';
import { imageUrl } from './seed';
import type { StaticSeed } from './seed';
import type { CouponSeed, ZoneSeed } from './seed/store';

export interface WorldProduct {
  id: ID;
  categoryId: ID;
  name: string;
  description?: string;
  imageUrl?: string;
  /** 已套用 DemoState.priceOverrides */
  basePrice: number;
  tags: ProductSummary['tags'];
  allergens: ProductSummary['allergens'];
  listed: boolean;
  /** 已套用 DemoState.limitOverrides；null = 不限量 */
  dailyLimit: number | null;
  /** DemoState.soldOutProductIds 含此商品（僅約束當前營業日，BR-40） */
  manualSoldOut: boolean;
  groups: OptionGroup[];
}

export interface WorldStatus {
  code: StoreStatusCode;
  closedReason?: ClosedReason;
  nextOpenAtMs?: number;
  pausedUntilMs?: number;
  todayHours: Array<{ open: HHmm; close: HHmm }>;
}

export interface StockParts {
  /** 計入集合內已成立（非待付款保留）的份數 */
  sold: number;
  /** 待付款保留中的份數 */
  held: number;
}

export interface World {
  nowMs: number;
  seed: StaticSeed;
  demo: DemoState;
  user: UserRow | null;
  userId: ID | null;
  /** 當前營業日（手動售完旗標與菜單的 remainingToday 以此為準） */
  currentBusinessDate: ISODate;
  status: WorldStatus;
  hours: HoursSource;
  calendar: BusinessCalendar;
  products: Map<ID, WorldProduct>;
  /** 依分類與分類內順序排列的商品 */
  productList: WorldProduct[];
  couponByCode(code: string): { seed: CouponSeed; usedCount: number } | null;
  couponById(id: ID): { seed: CouponSeed; usedCount: number } | null;
  /**
   * 折扣碼的個人使用次數（per_user_limit 判斷）：會員以帳號（user_coupons 的 USED 筆數），
   * 訪客以訂單聯絡手機（未取消的訂單數）計算（08 §2.4）
   */
  couponUsesBy(couponId: ID, who: { userId: ID | null; phone: string | null }): number;
  /** 取餐營業日 date 內該商品已計入的份數 */
  stock(date: ISODate, productId: ID): StockParts;
  /** 取餐營業日的剩餘份數；null = 不限量（BR-38、BR-40） */
  remaining(date: ISODate, product: WorldProduct): number | null;
  /** 該預約時段已計入的預約單數（即時單暫不計入，Q-11） */
  bookedAt(startMs: number): number;
  zone(zipCode: string): ZoneSeed | null;
  /** 前置分鐘（BR-08）：外送取配送區預估分鐘，缺值才用店家預設 */
  leadMinutes(orderType: OrderType, zipCode?: string): number;
  /** 取餐營業日（BR-23、BR-40）：即時單為現在所屬營業日，預約單為 scheduledAt 所屬營業日 */
  businessDateOf(scheduledAtMs: number | null): ISODate;
}

export interface LoadWorldInput {
  seed: StaticSeed;
  data: DbData;
  demo: DemoState;
  nowMs: number;
}

function buildGroups(seed: StaticSeed, groupIds: ReadonlyArray<ID>): OptionGroup[] {
  const out: OptionGroup[] = [];
  for (const gid of groupIds) {
    const g = seed.optionGroups.find((x) => x.id === gid);
    if (g === undefined) continue;
    out.push({
      id: g.id,
      name: g.name,
      selectionType: g.selectionType,
      required: g.minSelect >= 1,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      options: g.options.map((o) => ({
        id: o.id,
        name: o.name,
        priceDelta: o.priceDelta,
        isDefault: o.isDefault,
        isAvailable: o.isAvailable,
      })),
    });
  }
  return out;
}

function resolveStatus(seed: StaticSeed, demo: DemoState, nowMs: number): WorldStatus {
  const s = seed.settings;
  const computed = computeStoreStatus({
    nowMs,
    businessHours: seed.businessHours,
    specialDays: seed.specialDays,
    lastOrderOffsetMinutes: s.lastOrderOffsetMinutes,
    isAcceptingOrders: s.isAcceptingOrders,
    pausedUntilMs: s.pausedUntil,
  });
  const fromComputed = (): WorldStatus => {
    const out: WorldStatus = { code: computed.status, todayHours: computed.todayHours };
    if (computed.closedReason !== undefined) out.closedReason = computed.closedReason;
    if (computed.nextOpenAtMs !== undefined) out.nextOpenAtMs = computed.nextOpenAtMs;
    if (computed.pausedUntilMs !== undefined) out.pausedUntilMs = computed.pausedUntilMs;
    return out;
  };
  switch (demo.storeOverride) {
    case 'OPEN':
      return { code: 'OPEN', todayHours: computed.todayHours };
    case 'PAUSED':
      return { code: 'PAUSED', todayHours: computed.todayHours };
    case 'CLOSED': {
      const out: WorldStatus = {
        code: 'CLOSED',
        closedReason: 'OUT_OF_HOURS',
        todayHours: computed.todayHours,
      };
      const next = nextOpenAfter(nowMs, seed, s.lastOrderOffsetMinutes);
      if (next !== null) out.nextOpenAtMs = next;
      return out;
    }
    case 'AUTO':
      return fromComputed();
  }
}

export function loadWorld(input: LoadWorldInput): World {
  const { seed, data, demo, nowMs } = input;
  const settings = seed.settings;
  const hours: HoursSource = { businessHours: seed.businessHours, specialDays: seed.specialDays };
  const calendar: BusinessCalendar = {
    utcOffsetMinutes: TAIPEI_OFFSET_MINUTES,
    businessHours: seed.businessHours,
    specialDays: seed.specialDays,
  };
  const currentBusinessDate = targetBusinessDate(nowMs, null, calendar);

  // ── 商品：種子 + DemoState 覆寫（售完、調價、限量） ──
  const catOrder = new Map(seed.categories.map((c, i) => [c.id, i] as const));
  const products = new Map<ID, WorldProduct>();
  const soldOut = new Set(demo.soldOutProductIds);
  for (const sp of seed.products) {
    const priceOverride = demo.priceOverrides[sp.id];
    const limitOverride = demo.limitOverrides[sp.id];
    const wp: WorldProduct = {
      id: sp.id,
      categoryId: sp.categoryId,
      name: sp.name,
      basePrice: priceOverride ?? sp.basePrice,
      tags: [...sp.tags],
      allergens: [...sp.allergens],
      listed: true,
      dailyLimit: limitOverride === undefined ? sp.dailyLimit : limitOverride,
      manualSoldOut: soldOut.has(sp.id),
      groups: buildGroups(seed, sp.groupIds),
    };
    if (sp.description !== undefined) wp.description = sp.description;
    if (sp.image !== undefined) wp.imageUrl = imageUrl(sp.image);
    products.set(sp.id, wp);
  }
  const productList = [...products.values()].sort(
    (a, b) => (catOrder.get(a.categoryId) ?? 0) - (catOrder.get(b.categoryId) ?? 0),
  );

  // ── 計入集合：份數（取餐營業日 × 商品）與時段已訂數（BR-38） ──
  const itemsByOrder = new Map<ID, typeof data.order_items>();
  for (const it of data.order_items) {
    const list = itemsByOrder.get(it.order_id);
    if (list === undefined) itemsByOrder.set(it.order_id, [it]);
    else list.push(it);
  }
  const soldMap = new Map<string, number>();
  const heldMap = new Map<string, number>();
  const bookedMap = new Map<number, number>();
  for (const o of data.orders) {
    if (!countsTowardStock({ status: o.status, paymentExpiresAtMs: o.payment_expires_at }, nowMs)) continue;
    const target = o.status === 'PENDING_PAYMENT' ? heldMap : soldMap;
    for (const it of itemsByOrder.get(o.id) ?? []) {
      if (it.product_id === null) continue;
      const key = `${o.business_date}|${it.product_id}`;
      target.set(key, (target.get(key) ?? 0) + it.quantity);
    }
    if (o.scheduled_at !== null) bookedMap.set(o.scheduled_at, (bookedMap.get(o.scheduled_at) ?? 0) + 1);
  }

  const couponView = (c: CouponSeed): { seed: CouponSeed; usedCount: number } => ({
    seed: c,
    usedCount: Math.max(0, c.usedCount + (data.coupon_usage[c.id] ?? 0)),
  });

  const user = data.session === null
    ? null
    : (data.users.find((u) => u.id === data.session?.user_id && u.deleted_at === null) ?? null);

  const stock = (date: ISODate, productId: ID): StockParts => ({
    sold: soldMap.get(`${date}|${productId}`) ?? 0,
    held: heldMap.get(`${date}|${productId}`) ?? 0,
  });

  const zone = (zipCode: string): ZoneSeed | null =>
    seed.zones.find((z) => z.zipCode === zipCode && z.isActive) ?? null;

  return {
    nowMs,
    seed,
    demo,
    user,
    userId: user?.id ?? null,
    currentBusinessDate,
    status: resolveStatus(seed, demo, nowMs),
    hours,
    calendar,
    products,
    productList,
    couponByCode(code) {
      const c = seed.coupons.find((x) => x.code === code);
      return c === undefined ? null : couponView(c);
    },
    couponById(id) {
      const c = seed.coupons.find((x) => x.id === id);
      return c === undefined ? null : couponView(c);
    },
    couponUsesBy(couponId, who) {
      if (who.userId !== null) {
        return data.user_coupons.filter(
          (uc) => uc.user_id === who.userId && uc.coupon_id === couponId && uc.status === 'USED',
        ).length;
      }
      if (who.phone === null) return 0;
      return data.orders.filter(
        (o) =>
          o.user_id === null && o.coupon_id === couponId && o.customer_phone === who.phone &&
          o.status !== 'CANCELLED',
      ).length;
    },
    stock,
    remaining(date, product) {
      const s = stock(date, product.id);
      return remainingOf(product.dailyLimit, s.sold + s.held);
    },
    bookedAt: (startMs) => bookedMap.get(startMs) ?? 0,
    zone,
    leadMinutes(orderType, zipCode) {
      const z = orderType === 'DELIVERY' && zipCode !== undefined ? zone(zipCode) : null;
      return leadMinutesFor(orderType, z?.estimatedMinutes ?? null, {
        pickupLeadMinutes: settings.pickupLeadMinutes,
        deliveryLeadMinutes: settings.deliveryLeadMinutes,
      });
    },
    businessDateOf: (scheduledAtMs) =>
      targetBusinessDate(
        nowMs,
        scheduledAtMs === null ? null : toIsoTaipei(scheduledAtMs),
        calendar,
      ),
  };
}

/** 現在所處營業時段的收店時間（含跨午夜延伸）；不在任何時段為 null */
export function containingCloseMs(world: World): number | null {
  const span = spanContaining(world.nowMs, world.hours, world.seed.settings.lastOrderOffsetMinutes);
  return span === null ? null : span.closeMs;
}

// ───────── DTO 組裝（呈現層轉換另見 menuProfile.ts） ─────────

/** 必選群組的最低加價合計（displayPrice）與價格是否因選項而異（isPriceFrom） */
function requiredPricing(groups: ReadonlyArray<OptionGroup>): { minDelta: number; varies: boolean } {
  let minDelta = 0;
  let varies = false;
  for (const g of groups) {
    if (!g.required) continue;
    const deltas = g.options.filter((o) => o.isAvailable).map((o) => o.priceDelta).sort((a, b) => a - b);
    if (deltas.length === 0) continue;
    minDelta += deltas.slice(0, Math.max(1, g.minSelect)).reduce((s, d) => s + d, 0);
    if (deltas.length > g.minSelect && deltas[0] !== deltas[deltas.length - 1]) varies = true;
  }
  return { minDelta, varies };
}

export function toProductSummary(world: World, p: WorldProduct): ProductSummary {
  const { minDelta, varies } = requiredPricing(p.groups);
  const remaining = world.remaining(world.currentBusinessDate, p);
  const out: ProductSummary = {
    id: p.id,
    categoryId: p.categoryId,
    name: p.name,
    basePrice: p.basePrice,
    displayPrice: Math.max(0, p.basePrice + minDelta),
    isPriceFrom: varies,
    tags: [...p.tags],
    allergens: [...p.allergens],
    isSoldOut: p.manualSoldOut || remaining === 0,
    remainingToday: remaining,
    hasRequiredOptions: p.groups.some((g) => g.minSelect >= 1),
  };
  if (p.description !== undefined) out.description = p.description;
  if (p.imageUrl !== undefined) out.imageUrl = p.imageUrl;
  return out;
}

export function toProductDetail(world: World, p: WorldProduct): ProductDetail {
  return { ...toProductSummary(world, p), optionGroups: p.groups.map((g) => ({ ...g, options: g.options.map((o) => ({ ...o })) })) };
}

/** 完整（未經 menuProfile 轉換）的菜單；上架且分類可見者 */
export function buildFullMenu(world: World): Menu {
  const categories: MenuCategory[] = [];
  for (const c of world.seed.categories) {
    const items = world.productList.filter((p) => p.categoryId === c.id && p.listed);
    if (items.length === 0) continue;
    const cat: MenuCategory = {
      id: c.id,
      name: c.name,
      products: items.map((p) => toProductSummary(world, p)),
    };
    if (c.description !== undefined) cat.description = c.description;
    cat.icon = c.icon;
    categories.push(cat);
  }
  return { categories, generatedAt: toIsoTaipei(world.nowMs) };
}
