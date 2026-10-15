// 送出管線（FLOW-22、FLOW-24；BR-27、BR-41）：Key 生命週期、結果判別與 IDEMPOTENCY_CONFLICT 的重放取回
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_KEY_STATE } from '@/domain/idempotency';
import type { CheckoutKeyState } from '@/domain/idempotency';
import type { CreateOrderRequest, OrderLineInput } from '@/domain/types';
import { createFakeApi } from '@/test/fakeApi';
import { submitOrder } from '../submitPipeline';
import type { SubmitPorts } from '../submitPipeline';
import { FakeApiError, createdResponse, orderOf, quoteLike } from './fixtures';

const body = (over: Partial<CreateOrderRequest> = {}): CreateOrderRequest => ({
  orderType: 'PICKUP',
  items: [{ productId: 'p1', quantity: 1, optionIds: [] }],
  scheduledAt: null,
  contact: { name: '王小明', phone: '0912345678' },
  paymentMethod: 'CASH',
  invoice: { type: 'PAPER' },
  needUtensils: false,
  expectedTotal: 50,
  ...over,
});

const CART: OrderLineInput[] = [{ productId: 'p1', quantity: 1, optionIds: [] }];

function ports(create: (req: CreateOrderRequest, key: string) => Promise<unknown>, cart = CART) {
  const calls: Array<{ req: CreateOrderRequest; key: string }> = [];
  const api = createFakeApi({
    orders: {
      create: async (req: CreateOrderRequest, key: string) => {
        calls.push({ req, key });
        return create(req, key);
      },
    },
  } as never);
  let n = 0;
  const p: SubmitPorts = {
    api,
    makeKey: () => `key-${++n}`,
    getCartItems: () => cart,
  };
  return { p, calls };
}

describe('Key 生命週期', () => {
  it('首次送出才產生 Key；201 非重放後作廢（回到空狀態）', async () => {
    const { p, calls } = ports(async () => createdResponse());
    const onKeyReady = vi.fn();
    const out = await submitOrder({ ...p, onKeyReady }, body(), EMPTY_KEY_STATE);
    expect(out.kind).toBe('CREATED');
    expect(calls[0]?.key).toBe('key-1');
    expect(onKeyReady).toHaveBeenCalledWith({ idempotencyKey: 'key-1', unknownBodies: [] });
    expect(out.keyState).toEqual(EMPTY_KEY_STATE);
  });

  it('既有 Key 沿用，不再產生也不重複通知', async () => {
    const { p, calls } = ports(async () => createdResponse());
    const onKeyReady = vi.fn();
    const state: CheckoutKeyState = { idempotencyKey: 'existing', unknownBodies: [] };
    await submitOrder({ ...p, onKeyReady }, body(), state);
    expect(calls[0]?.key).toBe('existing');
    expect(onKeyReady).not.toHaveBeenCalled();
  });

  it.each([
    ['422', new FakeApiError(422, 'ITEM_SOLD_OUT', 'x', { quote: quoteLike() })],
    ['409 PRICE_CHANGED', new FakeApiError(409, 'PRICE_CHANGED', 'x', { quote: quoteLike() })],
    ['400', new FakeApiError(400, 'VALIDATION_FAILED', 'x')],
  ])('%s：確定未建立，沿用 Key、不記下送出內容', async (_n, err) => {
    const { p } = ports(async () => {
      throw err;
    });
    const out = await submitOrder(p, body(), { idempotencyKey: 'k', unknownBodies: [] });
    expect(out.kind).toBe('REJECTED');
    expect(out.keyState).toEqual({ idempotencyKey: 'k', unknownBodies: [] });
  });

  it.each([
    ['429', new FakeApiError(429, 'RATE_LIMITED', 'x', { retryAfterSeconds: 12 }), 12],
    [
      '503 附 retryAfterSeconds',
      new FakeApiError(503, 'SERVICE_UNAVAILABLE', 'x', { retryAfterSeconds: 3 }),
      3,
    ],
  ])('%s：確定未建立、依秒數冷卻、不記下送出內容', async (_n, err, seconds) => {
    const { p } = ports(async () => {
      throw err;
    });
    const out = await submitOrder(p, body(), EMPTY_KEY_STATE);
    expect(out.kind).toBe('NOT_CREATED');
    if (out.kind === 'NOT_CREATED') expect(out.retryAfterSeconds).toBe(seconds);
    expect(out.keyState.unknownBodies).toEqual([]);
    expect(out.keyState.idempotencyKey).toBe('key-1');
  });

  it.each([
    ['無回應', new FakeApiError(0, 'SERVICE_UNAVAILABLE', 'x')],
    ['未附 retryAfterSeconds 的 503', new FakeApiError(503, 'SERVICE_UNAVAILABLE', 'x')],
    ['500', new FakeApiError(500, 'INTERNAL_ERROR', 'x')],
    ['非 API 錯誤（網路層）', new TypeError('Failed to fetch')],
  ])('%s：結果未知，沿用 Key 並記下送出內容（相同內容只記一次）', async (_n, err) => {
    const { p } = ports(async () => {
      throw err;
    });
    const first = await submitOrder(p, body(), EMPTY_KEY_STATE);
    expect(first.kind).toBe('UNKNOWN');
    expect(first.keyState.unknownBodies).toHaveLength(1);
    const second = await submitOrder(p, body({ expectedTotal: 999 }), first.keyState);
    expect(second.keyState.unknownBodies).toHaveLength(1); // 忽略 expectedTotal：視為相同內容
    expect(second.keyState.idempotencyKey).toBe('key-1');
  });
});

describe('結果未知後重送', () => {
  it('同一把 Key 重送，重放（replayed）取回原訂單：Key 作廢、內容一致可清購物車', async () => {
    let n = 0;
    const { p, calls } = ports(async () => {
      n += 1;
      if (n === 1) throw new FakeApiError(0, 'SERVICE_UNAVAILABLE', 'x');
      return createdResponse({ replayed: true });
    });
    const first = await submitOrder(p, body(), EMPTY_KEY_STATE);
    const second = await submitOrder(p, body(), first.keyState);
    expect(calls.map((c) => c.key)).toEqual(['key-1', 'key-1']);
    expect(second.kind).toBe('REPLAYED');
    if (second.kind === 'REPLAYED') {
      expect(second.sameAsCart).toBe(true);
      expect(second.clearCart).toBe(true);
      expect(second.cancelled).toBe(false);
    }
    expect(second.keyState).toEqual(EMPTY_KEY_STATE);
  });

  it('重放回來的原訂單已取消：Key 作廢但不清購物車', async () => {
    const { p } = ports(async () =>
      createdResponse({
        replayed: true,
        nextAction: 'TRACK',
        order: orderOf({ status: 'CANCELLED' }),
      }),
    );
    const out = await submitOrder(p, body(), { idempotencyKey: 'k', unknownBodies: [body()] });
    expect(out.kind).toBe('REPLAYED');
    if (out.kind === 'REPLAYED') {
      expect(out.cancelled).toBe(true);
      expect(out.clearCart).toBe(false);
    }
    expect(out.keyState).toEqual(EMPTY_KEY_STATE);
  });
});

describe('409 IDEMPOTENCY_CONFLICT：不得換新 Key，以同 Key 重放記下的內容', () => {
  it('依序重放記下的內容；取回後視為 REPLAYED（內容與購物車不同時保留購物車）', async () => {
    const original = body({ items: [{ productId: 'p1', quantity: 1, optionIds: [] }] });
    const edited = body({ items: [{ productId: 'p1', quantity: 2, optionIds: [] }] });
    const { p, calls } = ports(async (req) => {
      if (req === edited) throw new FakeApiError(409, 'IDEMPOTENCY_CONFLICT', 'x');
      return createdResponse({ replayed: true });
    });
    const cartNow: OrderLineInput[] = [{ productId: 'p1', quantity: 2, optionIds: [] }];
    const out = await submitOrder({ ...p, getCartItems: () => cartNow }, edited, {
      idempotencyKey: 'k',
      unknownBodies: [original],
    });
    expect(calls.map((c) => c.key)).toEqual(['k', 'k']);
    expect(calls[1]?.req).toBe(original);
    expect(out.kind).toBe('REPLAYED');
    if (out.kind === 'REPLAYED') {
      expect(out.sameAsCart).toBe(false);
      expect(out.clearCart).toBe(false);
    }
    expect(out.keyState).toEqual(EMPTY_KEY_STATE);
  });

  it('沒有記下的內容可重放：走結果未知，Key 不變、不產生新 Key', async () => {
    const { p, calls } = ports(async () => {
      throw new FakeApiError(409, 'IDEMPOTENCY_CONFLICT', 'x');
    });
    const out = await submitOrder(p, body(), { idempotencyKey: 'k', unknownBodies: [] });
    expect(out.kind).toBe('UNKNOWN');
    expect(calls).toHaveLength(1);
    expect(out.keyState.idempotencyKey).toBe('k');
  });

  it('重放的內容也不符（再次 409）：換下一個記下的內容；全部不符則結果未知', async () => {
    const a = body({ note: 'a' });
    const b = body({ note: 'b' });
    const { p, calls } = ports(async (req) => {
      if (req.note === 'b') return createdResponse({ replayed: true });
      throw new FakeApiError(409, 'IDEMPOTENCY_CONFLICT', 'x');
    });
    const out = await submitOrder(p, body({ note: 'c' }), {
      idempotencyKey: 'k',
      unknownBodies: [a, b],
    });
    expect(calls.map((c) => c.req.note)).toEqual(['c', 'a', 'b']);
    expect(out.kind).toBe('REPLAYED');
  });

  it('重放時網路又失敗：結果未知，仍沿用同一把 Key 與已記下的內容', async () => {
    const a = body({ note: 'a' });
    const { p } = ports(async (req) => {
      if (req.note === 'a') throw new FakeApiError(0, 'SERVICE_UNAVAILABLE', 'x');
      throw new FakeApiError(409, 'IDEMPOTENCY_CONFLICT', 'x');
    });
    const out = await submitOrder(p, body({ note: 'c' }), {
      idempotencyKey: 'k',
      unknownBodies: [a],
    });
    expect(out.kind).toBe('UNKNOWN');
    expect(out.keyState).toEqual({ idempotencyKey: 'k', unknownBodies: [a] });
  });
});
