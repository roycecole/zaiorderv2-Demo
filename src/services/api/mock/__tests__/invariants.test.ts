// 庫存-8（error.quote 與 quote 逐欄一致）與屬性測試 I1～I6（07 §13）
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreateOrderRequest, OrderLineInput } from '@/domain/types';
import type { DemoState } from '../demoControl';
import { COMBO, LUROU, TEA, createReq, line, newKey, quoteReq, rejection, setup } from './harness';
import type { Harness } from './harness';

let h: Harness;
afterEach(() => h?.cleanup());

describe('庫存-8：quote 與 create 共用同一份驗證', () => {
  const scenarios: Array<{
    name: string;
    demo?: Partial<DemoState>;
    prepare?: (h: Harness) => Promise<void> | void;
    items: OrderLineInput[];
    over?: Partial<CreateOrderRequest>;
    expected: string;
  }> = [
    { name: '手動售完', demo: { soldOutProductIds: ['prd_black_tea'] }, items: [LUROU(), TEA()], expected: 'ITEM_SOLD_OUT' },
    {
      name: '數量不足',
      prepare: (x) => x.client.demo.setRemaining('prd_combo_share', 2),
      items: [COMBO(3)],
      expected: 'ITEM_STOCK_INSUFFICIENT',
    },
    {
      name: '內用沒有桌號 + 手動售完',
      demo: { soldOutProductIds: ['prd_black_tea'] },
      items: [LUROU(), TEA()],
      over: { orderType: 'DINE_IN', contact: {} },
      expected: 'ITEM_SOLD_OUT',
    },
    { name: '選項無效', items: [line('prd_lurou', 1, [])], expected: 'OPTION_INVALID' },
    { name: '下架 / 不存在', items: [line('prd_ghost', 1)], expected: 'ITEM_UNLISTED' },
    { name: '單行超量', items: [line('prd_danzai', 21)], expected: 'QUANTITY_EXCEEDED' },
    { name: '暫停接單', demo: { storeOverride: 'PAUSED' }, items: [LUROU()], expected: 'STORE_PAUSED' },
    {
      name: '超出外送範圍',
      items: [LUROU(3)],
      over: {
        orderType: 'DELIVERY',
        delivery: { city: '新北市', district: '板橋區', zipCode: '220', line: '示範路 100 號' },
      },
      expected: 'OUT_OF_DELIVERY_AREA',
    },
    {
      name: '未達最低消費',
      items: [LUROU()],
      over: {
        orderType: 'DELIVERY',
        delivery: { city: '臺北市', district: '大安區', zipCode: '106', line: '示範路 5 號 3 樓' },
      },
      expected: 'MIN_ORDER_NOT_MET',
    },
    { name: '折扣碼不存在', items: [LUROU()], over: { couponCode: 'HELLO1234' }, expected: 'COUPON_NOT_FOUND' },
    { name: '會員限定券未登入', items: [LUROU(2)], over: { couponCode: 'MEMBER20' }, expected: 'LOGIN_REQUIRED' },
    {
      name: '時段額滿',
      prepare: async (x) => {
        await x.client.demo.fillSlot('2026-10-14T12:30:00+08:00', 0);
      },
      items: [LUROU()],
      over: { scheduledAt: '2026-10-14T12:30:00+08:00' },
      expected: 'SLOT_UNAVAILABLE',
    },
  ];

  for (const sc of scenarios) {
    it(`${sc.name}：error.quote 的 items、金額與 checks 與同一請求的 quote 逐欄相同`, async () => {
      h = setup(sc.demo === undefined ? {} : { demo: sc.demo });
      await sc.prepare?.(h);
      const total = (await h.client.orders.quote(quoteReq(sc.items))).total;
      const req = createReq(sc.items, total, sc.over ?? {});
      const err = await rejection(h.client.orders.create(req, newKey()));
      expect(err.status).toBe(422);
      expect(err.code).toBe(sc.expected);
      const q = await h.client.orders.quote(
        quoteReq(req.items, {
          orderType: req.orderType,
          scheduledAt: req.scheduledAt,
          ...(req.delivery === undefined ? {} : { zipCode: req.delivery.zipCode }),
          ...(req.couponCode === undefined ? {} : { couponCode: req.couponCode }),
        }),
      );
      expect(err.body?.quote).toEqual(q);
      // 每個 422 錯誤碼都有對應 details 投影
      const errors = q.checks.filter((c) => c.severity === 'ERROR');
      expect(err.body?.details?.map((d) => d.code)).toEqual(errors.map((c) => c.code));
    });
  }
});

// ───────── 屬性測試：隨機操作序列下的不變式 ─────────

type Op =
  | { t: 'create'; combo: number; tea: number; online: boolean; slot: number | null; reuseKey: boolean }
  | { t: 'cancel'; pick: number }
  | { t: 'reject'; pick: number }
  | { t: 'inject'; qty: number; pending: boolean }
  | { t: 'fill'; slot: number; leave: 0 | 1 }
  | { t: 'advance'; minutes: number }
  | { t: 'quote'; combo: number };

const SLOT_STARTS = ['12:15', '12:30', '12:45', '13:00'].map((x) => `2026-10-14T${x}:00+08:00`);

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    t: fc.constant('create' as const),
    combo: fc.integer({ min: 0, max: 3 }),
    tea: fc.integer({ min: 0, max: 2 }),
    online: fc.boolean(),
    slot: fc.option(fc.integer({ min: 0, max: SLOT_STARTS.length - 1 }), { nil: null }),
    reuseKey: fc.boolean(),
  }),
  fc.record({ t: fc.constant('cancel' as const), pick: fc.nat(9) }),
  fc.record({ t: fc.constant('reject' as const), pick: fc.nat(9) }),
  fc.record({ t: fc.constant('inject' as const), qty: fc.integer({ min: 1, max: 3 }), pending: fc.boolean() }),
  fc.record({
    t: fc.constant('fill' as const),
    slot: fc.integer({ min: 0, max: SLOT_STARTS.length - 1 }),
    leave: fc.constantFrom(0 as const, 1 as const),
  }),
  fc.record({ t: fc.constant('advance' as const), minutes: fc.integer({ min: 0, max: 20 }) }),
  fc.record({ t: fc.constant('quote' as const), combo: fc.integer({ min: 1, max: 5 }) }),
);

describe('屬性測試（I1～I6）', () => {
  it('隨機序列下：份數與時段不超賣（I1、I2、I6）、quote 無副作用（I5）、同 Key 重放不改變計數（I4）、釋放單調（I3）', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 25 }), async (ops) => {
        h = setup({ demo: { autoSimulate: false } });
        try {
          let last: { key: string; req: CreateOrderRequest } | null = null;
          const mine: Array<{ id: string; token: string }> = [];
          const maxSlot = 8;

          const check = (): void => {
            const s = h.client.demo.getStock('prd_combo_share');
            // I6：剩餘份數不為負；I1：計入份數 ≤ 每日限量
            expect(s.remaining ?? 0).toBeGreaterThanOrEqual(0);
            expect(s.sold + s.held).toBeLessThanOrEqual(s.dailyLimit ?? Number.POSITIVE_INFINITY);
            const db = JSON.parse(h.storage.getItem('zaiorder:v1:db') ?? '{}') as {
              orders: Array<{ status: string; scheduled_at: number | null; payment_expires_at: number | null }>;
            };
            // I2：同時段計入的預約單數 ≤ max_orders_per_slot
            const counted = new Map<number, number>();
            for (const o of db.orders) {
              if (o.scheduled_at === null || o.status === 'CANCELLED') continue;
              if (o.status === 'PENDING_PAYMENT' && (o.payment_expires_at ?? 0) <= h.now()) continue;
              counted.set(o.scheduled_at, (counted.get(o.scheduled_at) ?? 0) + 1);
            }
            for (const n of counted.values()) expect(n).toBeLessThanOrEqual(maxSlot);
          };

          for (const op of ops) {
            switch (op.t) {
              case 'create': {
                const items: OrderLineInput[] = [];
                if (op.combo > 0) items.push(COMBO(op.combo));
                if (op.tea > 0) items.push(TEA(op.tea));
                if (items.length === 0) break;
                const total = op.combo * 299 + op.tea * 25;
                const req = createReq(items, total, {
                  paymentMethod: op.online ? 'LINE_PAY' : 'CASH',
                  scheduledAt: op.slot === null ? null : (SLOT_STARTS[op.slot] ?? null),
                });
                const previous = last;
                const key: string = op.reuseKey && previous !== null ? previous.key : newKey();
                const body: CreateOrderRequest = op.reuseKey && previous !== null ? previous.req : req;
                const before = h.client.demo.getStock('prd_combo_share');
                try {
                  const res = await h.client.orders.create(body, key);
                  if (res.trackingToken !== undefined) mine.push({ id: res.order.id, token: res.trackingToken });
                  if (res.replayed === true) {
                    // I4：同 Key 重放不改變任何計數
                    expect(h.client.demo.getStock('prd_combo_share')).toEqual(before);
                  }
                  last = { key, req: body };
                } catch {
                  // 422 / 409：未建立，計數不變
                  expect(h.client.demo.getStock('prd_combo_share')).toEqual(before);
                }
                break;
              }
              case 'cancel':
              case 'reject': {
                const target = mine[op.pick % Math.max(1, mine.length)];
                if (target === undefined) break;
                const before = h.client.demo.getStock('prd_combo_share');
                if (op.t === 'cancel') {
                  await h.client.orders.cancel(target.id, undefined, { trackingToken: target.token }).catch(() => undefined);
                } else {
                  await h.client.demo.act(target.id, 'REJECT').catch(() => undefined);
                }
                const after = h.client.demo.getStock('prd_combo_share');
                // I3：取消與拒單只讓計入集合變小
                expect(after.sold + after.held).toBeLessThanOrEqual(before.sold + before.held);
                break;
              }
              case 'inject':
                await h.client.demo.injectOtherOrder({
                  productId: 'prd_combo_share',
                  quantity: op.qty,
                  status: op.pending ? 'PENDING_PAYMENT' : 'ACCEPTED',
                });
                break;
              case 'fill':
                await h.client.demo.fillSlot(SLOT_STARTS[op.slot] ?? SLOT_STARTS[0] ?? '', op.leave);
                break;
              case 'advance': {
                const before = h.client.demo.getStock('prd_combo_share');
                h.advance(op.minutes * 60_000);
                const after = h.client.demo.getStock('prd_combo_share');
                // I3：時間前進只會因逾時釋放而讓計入集合變小
                expect(after.sold + after.held).toBeLessThanOrEqual(before.sold + before.held);
                break;
              }
              case 'quote': {
                // I5：quote 前後 db 深度相等
                const before = h.storage.getItem('zaiorder:v1:db');
                await h.client.orders.quote(quoteReq([COMBO(op.combo)]));
                expect(h.storage.getItem('zaiorder:v1:db')).toBe(before);
                break;
              }
            }
            check();
          }
        } finally {
          h.cleanup();
        }
      }),
      { numRuns: 60, seed: 20261014 },
    );
  });
});
