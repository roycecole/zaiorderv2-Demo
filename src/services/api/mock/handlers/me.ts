// src/services/api/mock/handlers/me.ts —— 會員資料、地址簿、我的最愛、優惠券與常點（06 §5.15、§5.15a）
import { toIsoTaipei } from '@/domain/taipeiTime';
import { PHONE_RE, normalizePhone } from '@/domain/validation';
import type {
  Address, ApiErrorDetail, Coupon, FrequentItem, ID, UserCoupon, UserCouponStatus,
} from '@/domain/types';
import type { ApiClient } from '../../ApiClient';
import type { AddressRow } from '../dbTypes';
import { notFound, validationFailed } from '../errors';
import { newUlid } from '../ids';
import type { MockRuntime } from '../runtime';
import type { CouponSeed } from '../seed/store';
import { requireUser, toUserProfile } from './auth';

const FREQUENT_WINDOW_MS = 180 * 24 * 3_600_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toAddress(a: AddressRow): Address {
  const out: Address = {
    id: a.id,
    label: a.label,
    recipientName: a.recipient_name,
    recipientPhone: a.recipient_phone,
    city: a.city,
    district: a.district,
    zipCode: a.zip_code,
    line: a.address_line,
    isDefault: a.is_default,
  };
  if (a.note !== null) out.note = a.note;
  return out;
}

function toCoupon(c: CouponSeed): Coupon {
  const out: Coupon = {
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description,
    discountType: c.discountType,
    discountValue: c.discountValue,
    minOrderAmount: c.minOrderAmount,
    applicableOrderTypes: [...c.applicableOrderTypes],
    memberOnly: c.memberOnly,
    startsAt: toIsoTaipei(c.startsAt),
    endsAt: toIsoTaipei(c.endsAt),
  };
  if (c.maxDiscountAmount !== null) out.maxDiscountAmount = c.maxDiscountAmount;
  return out;
}

function addressDetails(input: Partial<Omit<Address, 'id'>>, partial: boolean): ApiErrorDetail[] {
  const d: ApiErrorDetail[] = [];
  const need = (v: unknown): boolean => !partial || v !== undefined;
  if (need(input.label) && (typeof input.label !== 'string' || input.label.trim() === '' || input.label.length > 10)) {
    d.push({ field: 'label', message: '標籤請輸入 1～10 字' });
  }
  if (
    need(input.recipientName) &&
    (typeof input.recipientName !== 'string' || input.recipientName.trim() === '' || input.recipientName.length > 20)
  ) {
    d.push({ field: 'recipientName', message: '請輸入收件人姓名（最多 20 字）' });
  }
  if (need(input.recipientPhone) && !PHONE_RE.test(normalizePhone(input.recipientPhone ?? ''))) {
    d.push({ field: 'recipientPhone', message: '請輸入正確的手機號碼（09 開頭，共 10 碼）' });
  }
  if (need(input.city) && (typeof input.city !== 'string' || input.city === '')) {
    d.push({ field: 'city', message: '請選擇縣市' });
  }
  if (need(input.district) && (typeof input.district !== 'string' || input.district === '')) {
    d.push({ field: 'district', message: '請選擇行政區' });
  }
  if (need(input.zipCode) && !/^\d{3}$/.test(input.zipCode ?? '')) {
    d.push({ field: 'zipCode', message: '郵遞區號為 3 碼數字' });
  }
  if (need(input.line) && ((input.line?.trim().length ?? 0) < 5 || (input.line?.trim().length ?? 0) > 100)) {
    d.push({ field: 'line', message: '請輸入詳細地址（5～100 字）' });
  }
  if (input.note !== undefined && input.note.length > 50) {
    d.push({ field: 'note', message: '備註最多 50 字' });
  }
  return d;
}

export function createMeHandlers(rt: MockRuntime): ApiClient['me'] {
  return {
    async get() {
      await rt.begin('other', false);
      rt.read();
      return toUserProfile(requireUser(rt.db.data));
    },

    async update(patch) {
      await rt.begin('other', true);
      const details: ApiErrorDetail[] = [];
      if (patch.name !== undefined && (patch.name.trim().length < 1 || patch.name.trim().length > 20)) {
        details.push({ field: 'name', message: '請輸入姓名（最多 20 字）' });
      }
      if (patch.email !== undefined && patch.email !== '' && (!EMAIL_RE.test(patch.email) || patch.email.length > 100)) {
        details.push({ field: 'email', message: '請輸入正確的 Email' });
      }
      if (details.length > 0) throw validationFailed(details);
      return rt.tx((ctx) => {
        const user = requireUser(ctx.data);
        if (patch.name !== undefined) user.name = patch.name.trim();
        if (patch.email !== undefined) user.email = patch.email === '' ? null : patch.email;
        if (patch.marketingOptIn !== undefined) user.marketing_opt_in = patch.marketingOptIn;
        return toUserProfile(user);
      });
    },

    async remove() {
      await rt.begin('other', true);
      await rt.tx((ctx) => {
        const user = requireUser(ctx.data);
        const d = ctx.data;
        // 05 §7.2：軟刪除並去識別化；地址、最愛、優惠券實體刪除；訂單保留金額、品項與時間
        user.deleted_at = ctx.nowMs;
        user.phone = `X${newUlid(ctx.nowMs).slice(-9)}`;
        user.name = null;
        user.email = null;
        d.user_addresses = d.user_addresses.filter((a) => a.user_id !== user.id);
        d.favorites = d.favorites.filter((f) => f.user_id !== user.id);
        d.user_coupons = d.user_coupons.filter((c) => c.user_id !== user.id);
        for (const o of d.orders) {
          if (o.user_id !== user.id) continue;
          o.user_id = null;
          o.customer_name = null;
          o.customer_phone = null;
          if (o.delivery_address_line !== null) o.delivery_address_line = '（已去識別化）';
          o.delivery_note = null;
          o.idempotency_request_hash = null;
          o.tracking_token_hash = null;
        }
        for (const t of d.refresh_tokens) {
          if (t.user_id === user.id && t.revoked_at === null) t.revoked_at = ctx.nowMs;
        }
        d.session = null;
      });
    },

    addresses: {
      async list() {
        await rt.begin('other', false);
        rt.read();
        const user = requireUser(rt.db.data);
        const items = rt.db.data.user_addresses
          .filter((a) => a.user_id === user.id)
          .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.created_at - b.created_at)
          .map(toAddress);
        return { items };
      },

      async create(input) {
        await rt.begin('other', true);
        const details = addressDetails(input, false);
        if (details.length > 0) throw validationFailed(details);
        return rt.tx((ctx) => {
          const user = requireUser(ctx.data);
          const mine = ctx.data.user_addresses.filter((a) => a.user_id === user.id);
          const makeDefault = input.isDefault || mine.length === 0;
          if (makeDefault) for (const a of mine) a.is_default = false;
          const row: AddressRow = {
            id: newUlid(ctx.nowMs),
            user_id: user.id,
            label: input.label.trim(),
            recipient_name: input.recipientName.trim(),
            recipient_phone: normalizePhone(input.recipientPhone),
            city: input.city,
            district: input.district,
            zip_code: input.zipCode,
            address_line: input.line.trim(),
            note: input.note === undefined || input.note === '' ? null : input.note,
            is_default: makeDefault,
            created_at: ctx.nowMs,
          };
          ctx.data.user_addresses.push(row);
          return toAddress(row);
        });
      },

      async update(id, patch) {
        await rt.begin('other', true);
        const details = addressDetails(patch, true);
        if (details.length > 0) throw validationFailed(details);
        return rt.tx((ctx) => {
          const user = requireUser(ctx.data);
          const row = ctx.data.user_addresses.find((a) => a.id === id && a.user_id === user.id);
          if (row === undefined) throw notFound('找不到這筆地址');
          if (patch.label !== undefined) row.label = patch.label.trim();
          if (patch.recipientName !== undefined) row.recipient_name = patch.recipientName.trim();
          if (patch.recipientPhone !== undefined) row.recipient_phone = normalizePhone(patch.recipientPhone);
          if (patch.city !== undefined) row.city = patch.city;
          if (patch.district !== undefined) row.district = patch.district;
          if (patch.zipCode !== undefined) row.zip_code = patch.zipCode;
          if (patch.line !== undefined) row.address_line = patch.line.trim();
          if (patch.note !== undefined) row.note = patch.note === '' ? null : patch.note;
          if (patch.isDefault === true) {
            // 每位會員至多一筆預設：其他地址自動取消預設
            for (const a of ctx.data.user_addresses) if (a.user_id === user.id) a.is_default = false;
            row.is_default = true;
          } else if (patch.isDefault === false) {
            row.is_default = false;
          }
          return toAddress(row);
        });
      },

      async remove(id) {
        await rt.begin('other', true);
        await rt.tx((ctx) => {
          const user = requireUser(ctx.data);
          const row = ctx.data.user_addresses.find((a) => a.id === id && a.user_id === user.id);
          if (row === undefined) return;
          ctx.data.user_addresses = ctx.data.user_addresses.filter((a) => a !== row);
          if (row.is_default) {
            const next = ctx.data.user_addresses.find((a) => a.user_id === user.id);
            if (next !== undefined) next.is_default = true;
          }
        });
      },
    },

    favorites: {
      async list() {
        await rt.begin('other', false);
        rt.read();
        const user = requireUser(rt.db.data);
        const productIds = rt.db.data.favorites
          .filter((f) => f.user_id === user.id)
          .sort((a, b) => a.created_at - b.created_at)
          .map((f) => f.product_id);
        return { productIds };
      },

      async add(productId) {
        await rt.begin('other', true);
        await rt.tx((ctx) => {
          const user = requireUser(ctx.data);
          if (!rt.seed.products.some((p) => p.id === productId)) throw notFound('找不到這項商品');
          const exists = ctx.data.favorites.some((f) => f.user_id === user.id && f.product_id === productId);
          if (!exists) ctx.data.favorites.push({ user_id: user.id, product_id: productId, created_at: ctx.nowMs });
        });
      },

      async remove(productId) {
        await rt.begin('other', true);
        await rt.tx((ctx) => {
          const user = requireUser(ctx.data);
          ctx.data.favorites = ctx.data.favorites.filter(
            (f) => !(f.user_id === user.id && f.product_id === productId),
          );
        });
      },
    },

    coupons: {
      async list(status?: UserCouponStatus) {
        await rt.begin('other', false);
        rt.read();
        const user = requireUser(rt.db.data);
        const now = rt.nowMs();
        const items: UserCoupon[] = [];
        for (const uc of rt.db.data.user_coupons.filter((x) => x.user_id === user.id)) {
          const seed = rt.seed.coupons.find((c) => c.id === uc.coupon_id);
          if (seed === undefined) continue;
          // 顯示修正：未使用且已過期者顯示為 EXPIRED
          const shown: UserCouponStatus = uc.status === 'AVAILABLE' && seed.endsAt < now ? 'EXPIRED' : uc.status;
          if (status !== undefined && shown !== status) continue;
          const out: UserCoupon = {
            id: uc.id,
            coupon: toCoupon(seed),
            status: shown,
            claimedAt: toIsoTaipei(uc.claimed_at),
          };
          if (uc.used_at !== null) out.usedAt = toIsoTaipei(uc.used_at);
          items.push(out);
        }
        const rank: Record<UserCouponStatus, number> = { AVAILABLE: 0, USED: 1, EXPIRED: 2 };
        items.sort((a, b) => rank[a.status] - rank[b.status] || a.coupon.endsAt.localeCompare(b.coupon.endsAt));
        return { items };
      },
    },

    async frequentItems(limit) {
      await rt.begin('other', false);
      rt.read();
      const user = requireUser(rt.db.data);
      const cap = Math.min(100, Math.max(1, Math.floor(limit ?? 50)));
      const since = rt.nowMs() - FREQUENT_WINDOW_MS;
      const data = rt.db.data;
      // 近 180 天內非取消訂單的品項；每商品取最近一次的選項與備註
      const orders = data.orders
        .filter((o) => o.user_id === user.id && o.status !== 'CANCELLED' && o.placed_at >= since)
        .sort((a, b) => b.placed_at - a.placed_at);
      const byProduct = new Map<ID, FrequentItem>();
      for (const o of orders) {
        for (const it of data.order_items.filter((x) => x.order_id === o.id)) {
          if (it.product_id === null) continue;
          const seen = byProduct.get(it.product_id);
          if (seen !== undefined) {
            seen.orderCount += 1;
            continue;
          }
          const opts = data.order_item_options
            .filter((x) => x.order_item_id === it.id)
            .sort((a, b) => a.sort_order - b.sort_order);
          const item: FrequentItem = {
            productId: it.product_id,
            optionIds: opts.flatMap((x) => (x.option_id === null ? [] : [x.option_id])),
            optionLabels: opts.map((x) => x.option_name),
            lastOrderedAt: toIsoTaipei(o.placed_at),
            orderCount: 1,
          };
          if (it.note !== null) item.note = it.note;
          byProduct.set(it.product_id, item);
        }
      }
      return { items: [...byProduct.values()].slice(0, cap) };
    },
  };
}
