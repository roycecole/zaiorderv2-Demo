// src/services/api/mock/handlers/orders.ts —— 報價、建單、列表、詳情、取消、查詢與付款（06 §5.8～§5.14；FLOW-22）
import { formatMonthDayWeek } from '@/domain/format';
import { requestFingerprint } from '@/domain/idempotency';
import { customerCanCancel } from '@/domain/orderStateMachine';
import { addDays, toIsoTaipei } from '@/domain/taipeiTime';
import { paymentDeadlineMs } from '@/domain/timeouts';
import { PHONE_RE, normalizePhone } from '@/domain/validation';
import type {
  ApiErrorResponse, CreateOrderRequest, CreateOrderResponse, CreatePaymentResponse, ErrorCode, ID,
  OrderStatus, QuoteRequest, QuoteResponse,
} from '@/domain/types';
import type { ApiClient, TrackingOpts } from '../../ApiClient';
import { createOrder } from '../createOrder';
import type { CreateOrderPorts, Evaluation } from '../createOrder';
import type { OrderRow } from '../dbTypes';
import { InjectedFailure, apiError, notFound, stateConflict, unauthorized, validationFailed } from '../errors';
import { evaluateOrder, summarizeChecks } from '../evaluateOrder';
import type { EvaluationRequest, EvaluationResult } from '../evaluateOrder';
import { hashToken, newOrderNo, newTrackingToken, newUlid } from '../ids';
import { nextPickupNo } from '../inject';
import { fillSlotRows, injectOtherOrderRow } from '../otherOrders';
import {
  addPayment, applyPaymentSuccess, cancelOrderRow, displayStatus, isOtherOrder,
  isPayable, logCreated, refreshOrder, settleExpiredOrders, supersedePendingPayments, toOrderDto,
  toOrderSummary, transition,
} from '../orderModel';
import type { OrderCtx } from '../orderModel';
import { appendCreateLog } from '../requestLog';
import type { CreateLogEntry } from '../requestLog';
import type { MockRuntime } from '../runtime';
import { STORE_ID } from '../seed/store';
import { validateCreateRequest, validateQuoteRequest } from './validate';

const LOOKUP_WINDOW_MS = 10 * 60_000;
const LOOKUP_MAX_ATTEMPTS = 5;
const PAY_REDIRECT_PREFIX = '/payment';

// ───────── 存取控制 ─────────

/** 會員本人，或持有有效追蹤權杖者；他人訂單（X 前綴）與無權存取一律回 404，避免洩漏訂單是否存在 */
function findAuthorized(ctx: OrderCtx, orderId: ID, opts: TrackingOpts | undefined): OrderRow {
  const o = ctx.data.orders.find((x) => x.id === orderId);
  if (o === undefined || isOtherOrder(o)) throw notFound('找不到訂單，請確認編號與手機');
  const sessionUser = ctx.data.session?.user_id ?? null;
  const owner = sessionUser !== null && o.user_id === sessionUser;
  const token = opts?.trackingToken;
  const holder =
    token !== undefined && o.tracking_token_hash !== null && hashToken(token) === o.tracking_token_hash;
  if (!owner && !holder) throw notFound('找不到訂單，請確認編號與手機');
  return o;
}

// ───────── 建單的 ports ─────────

function toEvalRequest(req: QuoteRequest | CreateOrderRequest): EvaluationRequest {
  const out: EvaluationRequest = {
    orderType: req.orderType,
    items: req.items,
    scheduledAt: req.scheduledAt ?? null,
  };
  if ('paymentMethod' in req) {
    const phone = normalizePhone(req.contact?.phone ?? '');
    if (req.delivery?.zipCode !== undefined) out.zipCode = req.delivery.zipCode;
    if (req.couponCode !== undefined) out.couponCode = req.couponCode;
    out.create = {
      contactPhone: phone === '' ? null : phone,
      paymentMethod: req.paymentMethod,
      invoice: req.invoice,
    };
    if (req.dineIn !== undefined) out.create.dineIn = req.dineIn;
  } else {
    if (req.zipCode !== undefined) out.zipCode = req.zipCode;
    if (req.couponCode !== undefined) out.couponCode = req.couponCode;
  }
  return out;
}

function asResult(ev: Evaluation): EvaluationResult {
  if (!('detail' in ev)) throw new Error('evaluate 必須回傳 EvaluationResult');
  return ev as EvaluationResult;
}

/** 03 §9 的異動文案：取餐營業日非今日時，「今日」改為「明天（M/D）」或「M/D」 */
function dayWord(currentDate: string, targetDate: string): string {
  if (targetDate === currentDate) return '今日';
  const noon = (d: string): number => Date.parse(`${d}T12:00:00+08:00`);
  const md = formatMonthDayWeek(noon(targetDate)).replace(/（.）/, '');
  return targetDate === addDays(currentDate, 1) ? `明天（${md}）` : md;
}

/** 被拒時寫入「最近送出紀錄」的一句摘要：品名與原因（不含個資） */
function summarizeRejection(quote: QuoteResponse, word: string): string {
  const parts: string[] = [];
  for (const c of quote.checks) {
    if (c.severity !== 'ERROR') continue;
    const line = c.lineIndex === undefined ? undefined : quote.items[c.lineIndex];
    const name = line?.name ?? '';
    switch (c.code) {
      case 'ITEM_SOLD_OUT':
        parts.push(`${name}${word}售完`);
        break;
      case 'ITEM_STOCK_INSUFFICIENT':
        parts.push(
          line?.availableQuantity === 0
            ? `${name}已被同商品其他行占用`
            : `${name}${word}只剩 ${line?.remaining ?? line?.availableQuantity ?? 0} 份`,
        );
        break;
      case 'ITEM_UNLISTED':
        parts.push(`${name}已下架`);
        break;
      default:
        parts.push(c.message);
    }
  }
  return parts.join('；');
}

function appendLog(rt: MockRuntime, entry: Omit<CreateLogEntry, 'at'>): void {
  const data = rt.db.data;
  data.demo_request_log = appendCreateLog(data.demo_request_log, {
    ...entry,
    at: toIsoTaipei(rt.nowMs()),
  });
}

function makeCreatePorts(
  rt: MockRuntime,
  req: CreateOrderRequest,
  key: string,
): CreateOrderPorts {
  const scheduledMs = req.scheduledAt === null ? null : Date.parse(req.scheduledAt);

  return {
    simulateLatency: () => rt.latency(),
    failIfInjected: (phase) => rt.failCreate(phase),
    fingerprint: (r) => requestFingerprint(r),
    withDbLock: (fn) => rt.lock(fn),
    reload: () => {
      rt.db.reload();
      rt.demo.reload();
    },
    settleExpired: () => {
      settleExpiredOrders(rt.ctx());
    },

    findByKey(k) {
      const o = rt.db.data.orders.find((x) => x.idempotency_key === k);
      if (o === undefined) return null;
      return {
        fingerprint: o.idempotency_request_hash,
        replay(): CreateOrderResponse {
          const ctx = rt.ctx();
          let token: string | undefined;
          if (o.user_id === null) {
            // 重放時重新簽發權杖，舊權杖失效（BR-27）
            token = newTrackingToken();
            o.tracking_token_hash = hashToken(token);
          }
          appendLog(rt, { idempotencyKey: k, outcome: 'REPLAYED', orderNo: o.order_no });
          const res: CreateOrderResponse = {
            order: toOrderDto(ctx, o),
            nextAction: isPayable(ctx, o) ? 'PAY' : 'TRACK',
            replayed: true,
          };
          if (token !== undefined) res.trackingToken = token;
          return res;
        },
      };
    },

    applyRace() {
      const race = rt.demo.get().raceOnNextCreate;
      if (race === null) return;
      const ctx = rt.ctx();
      const targetDate = rt.world().businessDateOf(
        scheduledMs !== null && Number.isFinite(scheduledMs) ? scheduledMs : null,
      );
      // 1) 他人先買走（份數夾在剩餘內）
      for (const b of race.buy ?? []) {
        injectOtherOrderRow(ctx, {
          productId: b.productId,
          quantity: b.quantity,
          status: 'ACCEPTED',
          scheduledAtMs: null,
          businessDate: targetDate,
        });
      }
      // 2) 時段補滿 / 只剩 1 個名額
      for (const f of race.fillSlots ?? []) {
        const t = Date.parse(f.startAt);
        if (Number.isFinite(t)) fillSlotRows(ctx, t, f.leave);
      }
      // 3) 設為手動售完：寫入 DemoState 並保留，需於面板恢復上架或重置 Demo 資料
      const soldOut = race.soldOutProductIds ?? [];
      const merged = [...new Set([...rt.demo.get().soldOutProductIds, ...soldOut])];
      rt.demo.set({ soldOutProductIds: merged, raceOnNextCreate: null });
    },

    evaluate: (r) => evaluateOrder(rt.world(), toEvalRequest(r)),

    commit(r, k, fingerprint, ev0) {
      const ev = asResult(ev0);
      const ctx = rt.ctx();
      const world = rt.world();
      const now = ctx.nowMs;
      const d = ev.detail;
      const q = ev.quote;
      const user = world.user;
      const online = r.paymentMethod !== 'CASH';
      const prefix = r.orderType === 'PICKUP' ? 'A' : r.orderType === 'DELIVERY' ? 'D' : 'T';
      const pickupNo = nextPickupNo(
        ctx.data.orders.map((o) => ({ businessDate: o.business_date, pickupNo: o.pickup_no })),
        d.businessDate,
        prefix,
      );
      const token = user === null ? newTrackingToken() : null;
      const phone = normalizePhone(r.contact?.phone ?? '');
      const name = r.contact?.name?.trim() ?? '';
      const orderNote = r.note?.trim() ?? '';
      const deliveryNote = r.delivery?.note?.trim() ?? '';
      const id = newUlid(now);

      const row: OrderRow = {
        id,
        order_no: newOrderNo(now),
        store_id: STORE_ID,
        user_id: user?.id ?? null,
        order_type: r.orderType,
        status: online ? 'PENDING_PAYMENT' : 'PENDING',
        payment_status: 'UNPAID',
        payment_method: r.paymentMethod,
        business_date: d.businessDate,
        pickup_no: pickupNo,
        customer_name: name === '' ? null : name,
        customer_phone: phone === '' ? null : phone,
        scheduled_at: d.scheduledAtMs,
        estimated_ready_at: d.scheduledAtMs ?? now + d.leadMinutes * 60_000,
        table_no: d.table?.tableNo ?? null,
        delivery_city: r.orderType === 'DELIVERY' ? (r.delivery?.city ?? null) : null,
        delivery_district: r.orderType === 'DELIVERY' ? (r.delivery?.district ?? null) : null,
        delivery_zip_code: r.orderType === 'DELIVERY' ? (r.delivery?.zipCode ?? null) : null,
        delivery_address_line: r.orderType === 'DELIVERY' ? (r.delivery?.line.trim() ?? null) : null,
        delivery_note: deliveryNote === '' ? null : deliveryNote,
        subtotal_amount: q.subtotal,
        delivery_fee: q.deliveryFee,
        discount_amount: q.discount,
        total_amount: q.total,
        coupon_id: d.coupon?.applied === true ? d.coupon.seed.id : null,
        coupon_code: d.coupon?.applied === true ? d.coupon.seed.code : null,
        need_utensils: r.needUtensils === true,
        note: orderNote === '' ? null : orderNote,
        marketing_opt_in: r.marketingOptIn === true,
        cancelled_by: null,
        cancel_reason: null,
        placed_at: now,
        // 線上付款：保留至 placed_at + payment_timeout_minutes；現金：pending_at = 建單時間（BR-17）
        payment_expires_at: online ? paymentDeadlineMs(now, ctx.seed.settings.paymentTimeoutMinutes) : null,
        pending_at: online ? null : now,
        accepted_at: null,
        ready_at: null,
        completed_at: null,
        cancelled_at: null,
        refund_started_at: null,
        idempotency_key: k,
        idempotency_request_hash: fingerprint,
        tracking_token_hash: token === null ? null : hashToken(token),
      };
      ctx.data.orders.push(row);

      d.lines.forEach((line, i) => {
        if (line.product === null) return;
        const itemId = newUlid(now);
        const optionsPrice = line.selected.reduce((s, o) => s + o.priceDelta, 0);
        ctx.data.order_items.push({
          id: itemId,
          order_id: id,
          product_id: line.productId,
          product_name: line.product.name,
          base_price: line.product.basePrice,
          options_price: optionsPrice,
          quantity: line.quantity,
          line_total: line.unitPrice * line.quantity,
          note: line.note,
          sort_order: i,
        });
        line.selected.forEach((o, j) => {
          ctx.data.order_item_options.push({
            id: newUlid(now),
            order_item_id: itemId,
            option_group_id: o.groupId,
            option_group_name: o.groupName,
            option_id: o.optionId,
            option_name: o.name,
            price_delta: o.priceDelta,
            sort_order: j,
          });
        });
      });

      ctx.data.order_invoices.push({
        order_id: id,
        invoice_type: r.invoice.type,
        carrier_code: r.invoice.carrierCode?.trim() || null,
        tax_id: r.invoice.taxId?.trim() || null,
        buyer_name: r.invoice.buyerName?.trim() || null,
        donate_code: r.invoice.donateCode?.trim() || null,
        status: 'PENDING',
        invoice_no: null,
        issued_at: null,
      });
      logCreated(ctx, row, now);

      // 現金單只寫 PENDING 現金交易；線上付款交易不在建單時建立（由 orders.pay 於鎖外建立，05 §6.3 ⑧）
      if (!online) addPayment(ctx, row, 'CASH', null);

      // 優惠券：used_count + 1；會員標記其持有的券為 USED（無持有列的公開折扣碼新增一筆 USED）
      if (d.coupon?.applied === true) {
        const cid = d.coupon.seed.id;
        ctx.data.coupon_usage[cid] = (ctx.data.coupon_usage[cid] ?? 0) + 1;
        if (user !== null) {
          const held = ctx.data.user_coupons.find(
            (uc) => uc.user_id === user.id && uc.coupon_id === cid && uc.status === 'AVAILABLE',
          );
          if (held !== undefined) {
            held.status = 'USED';
            held.used_at = now;
            held.order_id = id;
          } else {
            ctx.data.user_coupons.push({
              id: newUlid(now),
              user_id: user.id,
              coupon_id: cid,
              status: 'USED',
              claimed_at: now,
              used_at: now,
              order_id: id,
            });
          }
        }
      }
      if (user !== null && r.marketingOptIn !== undefined) user.marketing_opt_in = r.marketingOptIn;

      appendLog(rt, { idempotencyKey: k, outcome: 'CREATED', orderNo: row.order_no });

      const res: CreateOrderResponse = {
        order: toOrderDto(ctx, row),
        nextAction: online ? 'PAY' : 'TRACK',
      };
      if (token !== null) res.trackingToken = token;
      return res;
    },

    flush: () => rt.db.flush(),

    reject(status, code, quote) {
      const world = rt.world();
      const word = dayWord(
        world.currentBusinessDate,
        world.businessDateOf(scheduledMs !== null && Number.isFinite(scheduledMs) ? scheduledMs : null),
      );
      const summary =
        code === 'PRICE_CHANGED' ? '價格已更新' : summarizeRejection(quote, word);
      appendLog(rt, { idempotencyKey: key, outcome: 'REJECTED', code, summary });

      const message = code === 'PRICE_CHANGED' ? '部分商品價格已更新，請確認後再送出' : summarizeChecks(quote.checks);
      const extra: Partial<ApiErrorResponse['error']> = { quote };
      if (status === 422) {
        extra.details = quote.checks
          .filter((c) => c.severity === 'ERROR')
          .map((c) => {
            const detail: { field?: string; code?: ErrorCode; message: string } = { code: c.code, message: c.message };
            if (c.field !== undefined) detail.field = c.field;
            return detail;
          });
      }
      throw apiError(status, code, message, extra);
    },

    conflict() {
      appendLog(rt, { idempotencyKey: key, outcome: 'REJECTED', code: 'IDEMPOTENCY_CONFLICT' });
      throw apiError(409, 'IDEMPOTENCY_CONFLICT', '這把送出鍵已建立過訂單，內容與這次不同');
    },
  };
}

// ───────── handlers ─────────

export function createOrderHandlers(rt: MockRuntime): ApiClient['orders'] {
  return {
    async quote(req) {
      await rt.begin('orders.quote', false);
      validateQuoteRequest(req);
      return evaluateOrder(rt.read(), toEvalRequest(req)).quote;
    },

    async create(req, idempotencyKey) {
      validateCreateRequest(req, idempotencyKey);
      try {
        return await createOrder(makeCreatePorts(rt, req, idempotencyKey), req, idempotencyKey);
      } catch (e) {
        if (e instanceof InjectedFailure) {
          // 失敗注入發生在臨界區之外：另以一個臨界區寫入「最近送出紀錄」
          if (e.phase === 'BEFORE') {
            await rt.tx(() => {
              appendLog(rt, { idempotencyKey, outcome: 'FAILED_BEFORE', code: 'SERVICE_UNAVAILABLE' });
            });
          } else if (e.phase === 'AFTER_COMMIT') {
            await rt.tx(() => {
              // 訂單已建立、回應遺失：把該次的 CREATED 紀錄改記為 RESPONSE_LOST（08 S24）
              const entry = [...rt.db.data.demo_request_log]
                .reverse()
                .find((x) => x.idempotencyKey === idempotencyKey && x.outcome === 'CREATED');
              if (entry !== undefined) {
                entry.outcome = 'RESPONSE_LOST';
                entry.code = 'SERVICE_UNAVAILABLE';
              } else {
                appendLog(rt, { idempotencyKey, outcome: 'RESPONSE_LOST', code: 'SERVICE_UNAVAILABLE' });
              }
            });
          }
        }
        throw e;
      }
    },

    async list(params) {
      await rt.begin('other', false);
      const world = rt.read();
      const user = world.user;
      if (user === null) throw unauthorized();
      const ctx = rt.ctx();
      const limit = Math.min(50, Math.max(1, Math.floor(params.limit ?? 10)));
      const inTab = (s: OrderStatus): boolean =>
        params.tab === 'active'
          ? s !== 'COMPLETED' && s !== 'CANCELLED'
          : params.tab === 'completed'
            ? s === 'COMPLETED'
            : s === 'CANCELLED';
      const sorted = ctx.data.orders
        .filter((o) => o.user_id === user.id && !isOtherOrder(o) && inTab(displayStatus(ctx, o)))
        .sort((a, b) => b.placed_at - a.placed_at || (a.id < b.id ? 1 : -1));

      let start = 0;
      if (params.cursor !== undefined && params.cursor !== '') {
        const at = sorted.findIndex((o) => `${o.placed_at}:${o.id}` === params.cursor);
        start = at < 0 ? sorted.length : at + 1;
      }
      const page = sorted.slice(start, start + limit);
      const last = page[page.length - 1];
      const hasMore = start + limit < sorted.length;
      return {
        items: page.map((o) => toOrderSummary(ctx, o)),
        nextCursor: hasMore && last !== undefined ? `${last.placed_at}:${last.id}` : null,
      };
    },

    async get(orderId, opts) {
      await rt.begin('other', false);
      // 讀取時結算逾期並惰性推進模擬（FLOW-14）：寫入路徑，經 withDbLock
      return rt.tx((ctx) => {
        const o = findAuthorized(ctx, orderId, opts);
        refreshOrder(ctx, o);
        return toOrderDto(ctx, o);
      });
    },

    async cancel(orderId, reason, opts) {
      await rt.begin('other', true);
      const text = reason?.trim() ?? '';
      if (text.length > 100) throw validationFailed([{ field: 'reason', message: '取消原因最多 100 字' }]);
      return rt.tx((ctx) => {
        const o = findAuthorized(ctx, orderId, opts);
        refreshOrder(ctx, o);
        if (o.status === 'CANCELLED') return toOrderDto(ctx, o); // 冪等：不重複返還優惠券、不重複退款
        if (!customerCanCancel(o.status)) {
          throw stateConflict('店家已接單，無法自行取消，請致電店家');
        }
        cancelOrderRow(ctx, o, 'CUSTOMER', text === '' ? '顧客自行取消' : text);
        return toOrderDto(ctx, o);
      });
    },

    async lookup(orderNo, phone) {
      await rt.begin('other', true);
      const normalized = normalizePhone(phone);
      if (!PHONE_RE.test(normalized)) {
        throw validationFailed([{ field: 'phone', message: '請輸入正確的手機號碼（09 開頭，共 10 碼）' }]);
      }
      return rt.tx((ctx) => {
        const now = ctx.nowMs;
        const attempts = (ctx.data.lookup_attempts[normalized] ?? []).filter((t) => now - t < LOOKUP_WINDOW_MS);
        if (attempts.length >= LOOKUP_MAX_ATTEMPTS) {
          const oldest = attempts[0] ?? now;
          ctx.data.lookup_attempts[normalized] = attempts;
          throw apiError(429, 'RATE_LIMITED', '查詢太頻繁，請稍後再試', {
            retryAfterSeconds: Math.max(1, Math.ceil((oldest + LOOKUP_WINDOW_MS - now) / 1000)),
          });
        }
        attempts.push(now);
        ctx.data.lookup_attempts[normalized] = attempts;

        const code = orderNo.trim().toUpperCase();
        const o = ctx.data.orders.find(
          (x) => x.order_no === code && x.customer_phone === normalized && !isOtherOrder(x),
        );
        if (o === undefined) throw notFound('找不到訂單，請確認編號與手機');
        // 新簽發並覆寫雜湊，舊權杖失效（與冪等重放相同）；不回狀態、不結算
        const token = newTrackingToken();
        o.tracking_token_hash = hashToken(token);
        return { orderId: o.id, trackingToken: token };
      });
    },

    async pay(orderId, req, opts) {
      await rt.begin('orders.pay', true);
      const method = req.method;
      if (!['CASH', 'CREDIT_CARD', 'LINE_PAY', 'JKOPAY'].includes(method)) {
        throw validationFailed([{ field: 'method', message: '請選擇付款方式' }]);
      }
      return rt.tx((ctx): CreatePaymentResponse => {
        const o = findAuthorized(ctx, orderId, opts);
        // 寫入路徑：先結算逾期（等同後端的 expireIfDue）；付款階段不重驗庫存與店家狀態（BR-38）
        refreshOrder(ctx, o);
        if (!isPayable(ctx, o)) {
          throw stateConflict(
            o.status === 'PENDING_PAYMENT' || o.status === 'CANCELLED'
              ? '已超過付款時間，保留的餐點與時段已釋出，可按「再來一單」'
              : '訂單目前無法付款',
          );
        }

        supersedePendingPayments(ctx, o.id);
        if (method === 'CASH') {
          // 改用現金：條件式轉為 PENDING，接單期限自此起算（BR-17）
          const txn = addPayment(ctx, o, 'CASH', null);
          o.payment_method = 'CASH';
          transition(ctx, o, 'PENDING', 'CUSTOMER', { note: '改用現金' });
          return { paymentId: txn.id, status: txn.status, order: toOrderDto(ctx, o) };
        }

        const txn = addPayment(ctx, o, method, 'mock');
        txn.provider_txn_id = `mock_${txn.id}`;
        o.payment_method = method;

        // 下一次付款結果：使用一次後自動回到 MANUAL（07 §6.5）
        const mode = ctx.demo.nextPaymentResult;
        if (mode !== 'MANUAL') rt.demo.set({ nextPaymentResult: 'MANUAL' });
        if (mode === 'SUCCESS') {
          applyPaymentSuccess(ctx, o, txn);
        } else if (mode === 'FAILED') {
          txn.status = 'FAILED';
          txn.failure_code = 'DECLINED';
          txn.failure_message = '付款未完成，可重新付款或改用現金';
        }
        // MANUAL：PENDING 交易，由 demo.settlePayment 結算；TIMEOUT：維持 PENDING 直到付款期限到期
        const query = new URLSearchParams({ method });
        if (mode === 'TIMEOUT') query.set('sim', 'timeout');
        const res: CreatePaymentResponse = {
          paymentId: txn.id,
          status: txn.status,
          redirectUrl: `${PAY_REDIRECT_PREFIX}/${o.id}?${query.toString()}`,
          order: toOrderDto(ctx, o),
        };
        if (o.payment_expires_at !== null && o.status === 'PENDING_PAYMENT') {
          res.expiresAt = toIsoTaipei(o.payment_expires_at);
        }
        return res;
      });
    },
  };
}
