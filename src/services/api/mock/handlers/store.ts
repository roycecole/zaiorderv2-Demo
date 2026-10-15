// src/services/api/mock/handlers/store.ts —— 店家資訊、營業狀態、菜單、商品、Banner、時段、外送範圍與桌號（06 §5.2b～§5.7）
// 全部為唯讀路徑：不結算、不寫入，只以 countsTowardStock 排除逾期的待付款單（BR-38）。
import { asapAvailability, generateSlotDays } from '@/domain/slots';
import { addDays, dateOfMs, toIsoTaipei } from '@/domain/taipeiTime';
import type {
  DeliveryZone, OrderType, PickupSlotsResponse, StoreInfo, StoreStatus,
} from '@/domain/types';
import type { ApiClient } from '../../ApiClient';
import { apiError, notFound, validationFailed } from '../errors';
import { applyDetailProfile, applyMenuProfile } from '../menuProfile';
import type { MockRuntime } from '../runtime';
import { imageUrl } from '../seed';
import { buildFullMenu, containingCloseMs, toProductDetail } from '../world';
import type { World } from '../world';

export function toStoreStatus(world: World): StoreStatus {
  const s = world.status;
  const out: StoreStatus = {
    status: s.code,
    todayHours: s.todayHours,
    serverTime: toIsoTaipei(world.nowMs),
  };
  if (s.closedReason !== undefined) out.closedReason = s.closedReason;
  if (s.nextOpenAtMs !== undefined) out.nextOpenAt = toIsoTaipei(s.nextOpenAtMs);
  if (s.pausedUntilMs !== undefined) out.pausedUntil = toIsoTaipei(s.pausedUntilMs);
  return out;
}

function toDeliveryZone(z: World['seed']['zones'][number]): DeliveryZone {
  return {
    zipCode: z.zipCode,
    city: z.city,
    district: z.district,
    deliveryFee: z.deliveryFee,
    minOrderAmount: z.minOrderAmount,
    freeDeliveryThreshold: z.freeDeliveryThreshold,
    estimatedMinutes: z.estimatedMinutes ?? 0,
  };
}

function buildInfo(world: World): StoreInfo {
  const { store, settings } = world.seed;
  const today = dateOfMs(world.nowMs);
  const horizon = addDays(today, 30);
  const info: StoreInfo = {
    id: store.id,
    slug: store.slug,
    name: store.name,
    tagline: store.tagline,
    description: store.description,
    logoUrl: imageUrl(store.logoPath),
    coverUrl: imageUrl(store.coverPath),
    phone: store.phone,
    email: store.email,
    address: { city: store.city, district: store.district, zipCode: store.zipCode, line: store.addressLine },
    announcement: store.announcement,
    timezone: store.timezone,
    services: { pickup: settings.allowPickup, delivery: settings.allowDelivery, dineIn: settings.allowDineIn },
    paymentMethods: [...world.seed.paymentMethods],
    businessHours: world.seed.businessHours.map((h) => ({ ...h })),
    specialDays: world.seed.specialDays
      .filter((d) => d.date >= today && d.date <= horizon)
      .map((d) => ({ ...d })),
    display: { brandColor: store.brandColor, menuLayout: settings.menuLayout },
    limits: {
      minOrderAmount: settings.minOrderAmount,
      maxQuantityPerItem: settings.maxQuantityPerItem,
      maxLines: settings.maxLines,
      maxAdvanceDays: settings.maxAdvanceDays,
      slotIntervalMinutes: settings.slotIntervalMinutes,
      pickupLeadMinutes: settings.pickupLeadMinutes,
      deliveryLeadMinutes: settings.deliveryLeadMinutes,
    },
    status: toStoreStatus(world),
  };
  return info;
}

const ORDER_TYPES: ReadonlyArray<OrderType> = ['PICKUP', 'DELIVERY', 'DINE_IN'];

export function createStoreHandlers(rt: MockRuntime): ApiClient['store'] {
  return {
    async getInfo() {
      await rt.begin('other', false);
      return buildInfo(rt.read());
    },

    async getStatus() {
      await rt.begin('other', false);
      return toStoreStatus(rt.read());
    },

    async getMenu() {
      await rt.begin('store.getMenu', false);
      const world = rt.read();
      return applyMenuProfile(buildFullMenu(world), world.demo.menuProfile);
    },

    async getProduct(productId) {
      await rt.begin('other', false);
      const world = rt.read();
      const product = world.products.get(productId);
      if (product === undefined || !product.listed) throw notFound('找不到這項商品');
      return applyDetailProfile(toProductDetail(world, product), world.demo.menuProfile);
    },

    async getBanners() {
      await rt.begin('other', false);
      const world = rt.read();
      return {
        items: world.seed.banners.map((b) => {
          const out: { id: string; title: string; imageUrl: string; linkType: typeof b.linkType; linkValue?: string } = {
            id: b.id,
            title: b.title,
            imageUrl: imageUrl(b.imagePath),
            linkType: b.linkType,
          };
          if (b.linkValue !== undefined) out.linkValue = b.linkValue;
          return out;
        }),
      };
    },

    async getPickupSlots(params) {
      await rt.begin('other', false);
      if (!ORDER_TYPES.includes(params.orderType)) {
        throw validationFailed([{ field: 'orderType', message: '請選擇取餐方式' }]);
      }
      const world = rt.read();
      const settings = world.seed.settings;
      // zipCode 缺值時以店家預設外送前置計算（寬鬆處理；後端契約要求 DELIVERY 必填）
      const lead = world.leadMinutes(params.orderType, params.zipCode);
      const asap = asapAvailability({
        status: world.status.code,
        nowMs: world.nowMs,
        leadMinutes: lead,
        containingCloseMs: containingCloseMs(world),
      });
      const days =
        params.orderType === 'DINE_IN'
          ? []
          : generateSlotDays({
              nowMs: world.nowMs,
              leadMinutes: lead,
              businessHours: world.hours.businessHours,
              specialDays: world.hours.specialDays,
              rules: {
                intervalMinutes: settings.slotIntervalMinutes,
                maxAdvanceDays: settings.maxAdvanceDays,
                lastOrderOffsetMinutes: settings.lastOrderOffsetMinutes,
                maxOrdersPerSlot: settings.maxOrdersPerSlot,
              },
              bookedAt: (t) => world.bookedAt(t),
            });
      const res: PickupSlotsResponse = { orderType: params.orderType, asap, days };
      return res;
    },

    async getDeliveryZones() {
      await rt.begin('other', false);
      const world = rt.read();
      return { items: world.seed.zones.filter((z) => z.isActive).map(toDeliveryZone) };
    },

    async checkDelivery(zipCode) {
      await rt.begin('other', false);
      if (!/^\d{3}$/.test(zipCode)) {
        throw validationFailed([{ field: 'zipCode', message: '請輸入 3 碼郵遞區號' }]);
      }
      const world = rt.read();
      if (!world.seed.settings.allowDelivery) {
        return { deliverable: false, reason: 'SERVICE_NOT_AVAILABLE' as const };
      }
      const zone = world.zone(zipCode);
      if (zone === null) return { deliverable: false, reason: 'OUT_OF_DELIVERY_AREA' as const };
      return { deliverable: true, zone: toDeliveryZone(zone) };
    },

    async resolveTable(qrToken) {
      await rt.begin('other', false);
      const world = rt.read();
      const token = qrToken.trim().toUpperCase();
      const table = world.seed.tables.find((t) => t.isActive && t.qrToken.toUpperCase() === token);
      if (table === undefined) throw apiError(422, 'TABLE_NOT_FOUND', '找不到這個桌號，請洽店員');
      return { tableNo: table.tableNo, seats: table.seats };
    },
  };
}
