// src/services/api/mock/demoControlImpl.ts —— DemoControl 的實作（07 §6.5）
// 凡寫入 db 的動作（act、settlePayment、injectOtherOrder、fillSlot、loginAsDemoUser）一律經 withDbLock：鎖內先 reload 再變更再 flush。
import { remainingOf } from '@/domain/availability';
import { canTransition } from '@/domain/orderStateMachine';
import { setClock, systemClock } from '@/services/clock';
import type { ID, ISODate, OrderStatus } from '@/domain/types';
import type { DemoControl, StockSnapshot, StoreAction } from './demoControl';
import type { OrderRow } from './dbTypes';
import { notFound, stateConflict } from './errors';
import { loginWithPhone } from './handlers/auth';
import { clearOtherOrderRows, fillSlotRows, injectOtherOrderRow } from './otherOrders';
import {
  addPayment, applyPaymentSuccess, cancelOrderRow, isOtherOrder, refreshOrder, toOrderDto, transition,
} from './orderModel';
import type { OrderCtx } from './orderModel';
import { recentCreateLog } from './requestLog';
import type { MockRuntime } from './runtime';
import { DEMO_PHONE } from './seed';

export interface DemoControlDeps {
  /** 清除儲存後重新載入頁面（FR-DM-02）；測試可注入 */
  reloadPage: () => void;
  /** 需清除 zaiorder:v1:* 的儲存（localStorage 與 sessionStorage） */
  storages: Storage[];
}

const STORAGE_PREFIX = 'zaiorder:v1:';

const STORE_ACTION_TARGET: Record<Exclude<StoreAction, 'REJECT'>, Exclude<OrderStatus, 'CANCELLED' | 'PENDING_PAYMENT' | 'PENDING'>> = {
  ACCEPT: 'ACCEPTED',
  READY: 'READY',
  DISPATCH: 'DELIVERING',
  COMPLETE: 'COMPLETED',
};

export function createDemoControl(rt: MockRuntime, deps: DemoControlDeps): DemoControl {
  const findOrder = (ctx: OrderCtx, orderId: ID): OrderRow => {
    const o = ctx.data.orders.find((x) => x.id === orderId);
    // 不作用於他人訂單（pickup_no 前綴 X）
    if (o === undefined || isOtherOrder(o)) throw notFound('找不到訂單');
    return o;
  };

  return {
    getState() {
      rt.demo.reload();
      return rt.demo.get();
    },

    setState(patch) {
      rt.demo.set(patch);
    },

    async act(orderId, action) {
      return rt.tx((ctx) => {
        const o = findOrder(ctx, orderId);
        // 先結算逾期並補寫模擬轉換，避免作用於已經過時的狀態
        refreshOrder(ctx, o);
        if (action === 'REJECT') {
          if (!canTransition(o.status, 'CANCELLED', o.order_type) || o.status === 'PENDING_PAYMENT') {
            throw stateConflict('目前的訂單狀態無法拒單');
          }
          cancelOrderRow(
            ctx,
            o,
            'STORE',
            o.status === 'PENDING' ? '店家忙碌，無法接單' : '店家取消（無法出餐）',
          );
          return toOrderDto(ctx, o);
        }
        const to = STORE_ACTION_TARGET[action];
        if (!canTransition(o.status, to, o.order_type)) {
          throw stateConflict('目前的訂單狀態無法執行這個操作');
        }
        transition(ctx, o, to, 'STORE');
        return toOrderDto(ctx, o);
      });
    },

    async loginAsDemoUser() {
      await rt.tx((ctx) => {
        loginWithPhone(ctx.data, DEMO_PHONE, ctx.nowMs);
      });
    },

    async settlePayment(orderId, result, method) {
      return rt.tx((ctx) => {
        const o = findOrder(ctx, orderId);
        refreshOrder(ctx, o);
        const online = ctx.data.payments
          .filter((p) => p.order_id === o.id && p.method !== 'CASH')
          .sort((a, b) => a.created_at - b.created_at);
        const latest = online[online.length - 1];

        if (result === 'SUCCESS') {
          // 冪等：最新的線上交易已入帳（例如 orders.pay 依 nextPaymentResult 自動結算）
          if (latest !== undefined && (latest.status === 'SUCCESS' || latest.status === 'REFUNDED')) {
            return toOrderDto(ctx, o);
          }
          const txn =
            [...online].reverse().find((p) => p.status === 'PENDING') ??
            [...online].reverse().find((p) => p.status === 'FAILED') ??
            addPayment(ctx, o, method ?? (o.payment_method === 'CASH' ? 'LINE_PAY' : o.payment_method), 'mock');
          if (method !== undefined && txn.status === 'PENDING') txn.method = method;
          applyPaymentSuccess(ctx, o, txn);
          return toOrderDto(ctx, o);
        }

        // FAILED：交易失敗，訂單維持 PENDING_PAYMENT，可重新付款或改用現金（BR-28、FLOW-11）
        if (latest !== undefined && latest.status === 'FAILED') return toOrderDto(ctx, o);
        const txn = [...online].reverse().find((p) => p.status === 'PENDING');
        if (txn !== undefined) {
          txn.status = 'FAILED';
          txn.failure_code = 'DECLINED';
          txn.failure_message = '付款未完成，可重新付款或改用現金';
        }
        return toOrderDto(ctx, o);
      });
    },

    resetAll() {
      // 清除所有 zaiorder:v1:* 後重新載入頁面；先停止寫回，避免背景請求把舊資料寫回
      rt.db.suspend();
      rt.demo.suspend();
      for (const storage of deps.storages) {
        const keys: string[] = [];
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k !== null && k.startsWith(STORAGE_PREFIX)) keys.push(k);
        }
        for (const k of keys) storage.removeItem(k);
      }
      setClock(systemClock);
      deps.reloadPage();
    },

    getStock(productId, businessDate?: ISODate): StockSnapshot {
      const world = rt.read();
      const product = world.products.get(productId);
      if (product === undefined) throw notFound('找不到這項商品');
      const date = businessDate ?? world.currentBusinessDate;
      const s = world.stock(date, productId);
      return {
        dailyLimit: product.dailyLimit,
        sold: s.sold,
        held: s.held,
        remaining: remainingOf(product.dailyLimit, s.sold + s.held),
      };
    },

    setLimit(productId, limit) {
      const current = rt.demo.get().limitOverrides;
      rt.demo.set({ limitOverrides: { ...current, [productId]: limit === null ? null : Math.max(0, Math.floor(limit)) } });
    },

    setRemaining(productId, remaining) {
      const world = rt.read();
      const s = world.stock(world.currentBusinessDate, productId);
      const limit = s.sold + s.held + Math.max(0, Math.floor(remaining));
      const current = rt.demo.get().limitOverrides;
      rt.demo.set({ limitOverrides: { ...current, [productId]: limit } });
    },

    async injectOtherOrder(spec) {
      return rt.tx((ctx) => {
        const scheduled =
          spec.scheduledAt === undefined || spec.scheduledAt === null ? null : Date.parse(spec.scheduledAt);
        const added = injectOtherOrderRow(ctx, {
          productId: spec.productId,
          quantity: spec.quantity,
          status: spec.status ?? 'ACCEPTED',
          scheduledAtMs: scheduled !== null && Number.isFinite(scheduled) ? scheduled : null,
        });
        return { added };
      });
    },

    async fillSlot(startAt, leave) {
      return rt.tx((ctx) => {
        const t = Date.parse(startAt);
        if (!Number.isFinite(t)) return { added: 0 };
        return { added: fillSlotRows(ctx, t, leave) };
      });
    },

    armRace(spec) {
      rt.demo.set({ raceOnNextCreate: spec });
    },

    disarmRace() {
      rt.demo.set({ raceOnNextCreate: null });
    },

    clearOtherOrders() {
      // 介面為同步回傳筆數，無法持有 Web Lock：以同步的「重讀 → 變更 → 寫回」降低多分頁覆寫的機會
      rt.db.reload();
      const n = clearOtherOrderRows(rt.ctx());
      if (n > 0) rt.db.flush();
      return n;
    },

    getCreateLog(limit) {
      rt.db.reload();
      return recentCreateLog(rt.db.data.demo_request_log, limit ?? 5);
    },
  };
}
