// FLOW-22 / BR-39 / BR-40 / BR-41：Mock 建單管線（步驟順序即契約）。以假的 ports 驅動，不碰 I/O。
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { allocateByProduct, countsTowardStock, remainingOf } from '@/domain/availability';
import type { ProductFacts } from '@/domain/availability';
import { requestFingerprint } from '@/domain/idempotency';
import type {
  CreateOrderRequest,
  CreateOrderResponse,
  ErrorCode,
  ID,
  Order,
  OrderStatus,
  QuoteResponse,
  QuotedLine,
} from '@/domain/types';
import { createOrder } from '../../createOrder';
import type { CreateOrderPorts, Evaluation, FailPhase } from '../../createOrder';
import { clampInjection } from '../../inject';
import { withDbLock } from '../../lock';
import type { LockManagerLike } from '../../lock';
import { expiryOf } from '../../settle';

const NOW = Date.parse('2026-10-14T12:00:00+08:00');
const MIN = 60_000;

// ───────── 假世界：兩種商品（雙人餐限量 5、紅茶不限量） ─────────
const PRODUCTS = [
  { id: 'combo', price: 299, limit: 5 as number | null },
  { id: 'tea', price: 25, limit: null as number | null },
];

interface SimOrder {
  id: string;
  status: OrderStatus;
  paymentExpiresAtMs: number | null;
  pickupNo?: string;
  items: Array<{ productId: ID; quantity: number }>;
}
interface Binding {
  order: SimOrder;
  fingerprint: string | null;
}
interface FailNext {
  phase: FailPhase;
  remaining: number;
}
interface Race {
  buy?: Array<{ productId: ID; quantity: number }>;
  soldOutProductIds?: ID[];
}

class InjectedError extends Error {
  constructor(readonly injected: FailPhase) {
    super(`INJECTED_${injected}`);
  }
}
class RejectedError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly quote?: QuoteResponse,
  ) {
    super(code);
  }
}

/** 依 Web Locks 語意：同名鎖互斥，依序執行 */
function fakeLocks(): LockManagerLike {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request<T>(_name: string, cb: () => Promise<T> | T): Promise<T> {
      const run = tail.then(() => cb());
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

interface WorldOptions {
  race?: Race | null;
  failNext?: FailNext | null;
  limit?: number;
}

function mockWorld(opts: WorldOptions = {}) {
  const s = {
    now: NOW,
    orders: [] as SimOrder[],
    keys: new Map<string, Binding>(),
    seq: 0,
    calls: [] as string[],
    flushed: 0,
    soldOut: new Set<ID>(),
    race: opts.race ?? null,
    failNext: opts.failNext ?? null,
    locks: fakeLocks(),
    tokens: 0,
    limit: opts.limit ?? 5,
  };
  const counted = (): SimOrder[] =>
    s.orders.filter((o) =>
      countsTowardStock({ status: o.status, paymentExpiresAtMs: o.paymentExpiresAtMs }, s.now),
    );
  const consumed = (pid: ID): number =>
    counted().reduce(
      (sum, o) =>
        sum + o.items.filter((i) => i.productId === pid).reduce((a, i) => a + i.quantity, 0),
      0,
    );
  const remainingFor = (p: (typeof PRODUCTS)[number]): number | null =>
    remainingOf(p.id === 'combo' ? s.limit : p.limit, consumed(p.id));

  const evaluate = (req: CreateOrderRequest): Evaluation => {
    const f = new Map<ID, ProductFacts>(
      PRODUCTS.map((p) => [
        p.id,
        { listed: true, manualSoldOut: s.soldOut.has(p.id), remaining: remainingFor(p) },
      ]),
    );
    const alloc = allocateByProduct(
      req.items.map((l, index) => ({
        index,
        productId: l.productId,
        quantity: l.quantity,
        optionsValid: true,
      })),
      f,
    );
    const items: QuotedLine[] = alloc.map((a) => {
      const l = req.items[a.index];
      if (l === undefined) throw new Error('index out of range');
      const price = PRODUCTS.find((p) => p.id === l.productId)?.price ?? 0;
      const line: QuotedLine = {
        index: a.index,
        productId: l.productId,
        name: l.productId,
        optionLabels: [],
        unitPrice: price,
        quantity: l.quantity,
        lineTotal: price * a.availableQuantity,
        available: a.availableQuantity === l.quantity,
        availableQuantity: a.availableQuantity,
      };
      if (a.remaining !== undefined) line.remaining = a.remaining;
      if (a.issue !== undefined) line.issue = a.issue;
      return line;
    });
    const checks = items
      .filter((i) => i.issue !== undefined)
      .map((i) => ({
        code: i.issue as ErrorCode,
        severity: 'ERROR' as const,
        message: String(i.issue),
        field: 'items',
        lineIndex: i.index,
      }));
    const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
    const priority: ErrorCode[] = ['ITEM_UNLISTED', 'ITEM_SOLD_OUT', 'ITEM_STOCK_INSUFFICIENT'];
    const top = priority.find((c) => checks.some((k) => k.code === c)) ?? null;
    return {
      quote: {
        valid: top === null,
        items,
        subtotal,
        deliveryFee: 0,
        discount: 0,
        total: subtotal,
        checks,
      },
      topError: top,
    };
  };

  const ports: CreateOrderPorts = {
    simulateLatency: async () => {
      s.calls.push('latency');
    },
    failIfInjected: (phase) => {
      s.calls.push(`fail?${phase}`);
      if (s.failNext && s.failNext.phase === phase && s.failNext.remaining > 0) {
        s.failNext.remaining--;
        throw new InjectedError(phase);
      }
    },
    fingerprint: async (r) => {
      s.calls.push('fingerprint');
      return requestFingerprint(r);
    },
    withDbLock: (fn) => {
      s.calls.push('lock');
      return withDbLock(fn, s.locks);
    },
    reload: () => {
      s.calls.push('reload');
    },
    settleExpired: () => {
      s.calls.push('settle');
      for (const o of s.orders) {
        const cand = {
          id: o.id,
          status: o.status,
          paymentExpiresAtMs: o.paymentExpiresAtMs,
          acceptDeadlineMs: null,
          autoAcceptAtMs: null,
        };
        if (expiryOf(cand, s.now) !== null) o.status = 'CANCELLED';
      }
    },
    findByKey: (key) => {
      s.calls.push('findByKey');
      const b = s.keys.get(key);
      if (!b) return null;
      return {
        fingerprint: b.fingerprint,
        replay: () => {
          s.calls.push('replay');
          return {
            order: b.order as unknown as Order,
            nextAction: 'TRACK',
            replayed: true,
            trackingToken: `trk_${++s.tokens}`,
          } satisfies CreateOrderResponse;
        },
      };
    },
    applyRace: () => {
      s.calls.push('applyRace');
      if (!s.race) return;
      for (const b of s.race.buy ?? []) {
        const product = PRODUCTS.find((p) => p.id === b.productId);
        if (product === undefined) continue;
        s.orders.push({
          id: `X${++s.seq}`,
          status: 'ACCEPTED',
          paymentExpiresAtMs: null,
          pickupNo: `X${String(s.seq).padStart(3, '0')}`,
          items: [
            { productId: b.productId, quantity: clampInjection(b.quantity, remainingFor(product)) },
          ],
        });
      }
      for (const id of s.race.soldOutProductIds ?? []) s.soldOut.add(id);
      s.race = null;
    },
    evaluate: (r) => {
      s.calls.push('evaluate');
      return evaluate(r);
    },
    commit: (r, key, fp, ev) => {
      s.calls.push('commit');
      const cash = r.paymentMethod === 'CASH';
      const order: SimOrder = {
        id: `O${++s.seq}`,
        status: cash ? 'PENDING' : 'PENDING_PAYMENT',
        paymentExpiresAtMs: cash ? null : s.now + 15 * MIN,
        pickupNo: `A${String(s.seq).padStart(3, '0')}`,
        items: r.items.map((l, i) => ({
          productId: l.productId,
          quantity: ev.quote.items[i]?.availableQuantity ?? 0,
        })),
      };
      s.orders.push(order);
      s.keys.set(key, { order, fingerprint: fp });
      return {
        order: order as unknown as Order,
        nextAction: order.status === 'PENDING_PAYMENT' ? 'PAY' : 'TRACK',
        trackingToken: `trk_${++s.tokens}`,
      };
    },
    flush: () => {
      s.calls.push('flush');
      s.flushed++;
    },
    reject: (status, code, quote) => {
      s.calls.push(`reject:${status}:${code}`);
      throw new RejectedError(status, code, quote);
    },
    conflict: () => {
      s.calls.push('conflict');
      throw new RejectedError(409, 'IDEMPOTENCY_CONFLICT');
    },
  };
  return { s, ports, evaluate, remainingFor, counted };
}

const body = (
  items: Array<[ID, number]>,
  o: Partial<CreateOrderRequest> = {},
): CreateOrderRequest => ({
  orderType: 'PICKUP',
  items: items.map(([productId, quantity]) => ({ productId, quantity, optionIds: [] })),
  scheduledAt: null,
  contact: {},
  paymentMethod: 'CASH',
  invoice: { type: 'PAPER' },
  needUtensils: false,
  expectedTotal: items.reduce(
    (sum, [p, q]) => sum + (PRODUCTS.find((x) => x.id === p)?.price ?? 0) * q,
    0,
  ),
  ...o,
});
const combo = PRODUCTS[0] as (typeof PRODUCTS)[number];

/** 取得被拒的錯誤（若管線沒有被拒則測試失敗） */
async function rejection(p: Promise<unknown>): Promise<RejectedError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RejectedError) return e;
    throw e;
  }
  throw new Error('預期被拒，但管線成功了');
}

describe('createOrder 管線（FLOW-22 的 Mock 臨界區）', () => {
  it('成功：步驟順序即契約——延遲與雜湊在臨界區外，臨界區內 reload → settle → 查 Key → race → 驗證 → 寫入 → flush', async () => {
    const w = mockWorld();
    const res = await createOrder(w.ports, body([['combo', 2]]), 'k1');
    expect(res.replayed).toBeUndefined();
    expect(w.s.calls).toEqual([
      'latency',
      'fail?BEFORE',
      'fingerprint',
      'lock',
      'reload',
      'settle',
      'findByKey',
      'applyRace',
      'evaluate',
      'commit',
      'flush',
      'fail?AFTER_COMMIT',
    ]);
    expect(w.remainingFor(combo)).toBe(3);
  });

  it("failNext 'BEFORE'：請求未處理，不進臨界區、不消耗 raceOnNextCreate、不寫入", async () => {
    const w = mockWorld({
      race: { buy: [{ productId: 'combo', quantity: 5 }] },
      failNext: { phase: 'BEFORE', remaining: 1 },
    });
    await expect(createOrder(w.ports, body([['combo', 1]]), 'k1')).rejects.toMatchObject({
      injected: 'BEFORE',
    });
    for (const step of ['lock', 'applyRace', 'evaluate', 'fingerprint'])
      expect(w.s.calls).not.toContain(step);
    expect(w.s.race).not.toBeNull(); // 預備情境保留給下一次
    expect(w.s.orders).toHaveLength(0);
    const ok = await createOrder(w.ports, body([['tea', 1]]), 'k1'); // 下一次正常送出才套用
    expect(ok.order).toBeDefined();
    expect(w.s.race).toBeNull();
  });

  it('raceOnNextCreate：quote 通過、create 被拒（422 附 error.quote）；預備一次性；被拒不寫入、不綁定 Key，他人訂單照寫', async () => {
    const w = mockWorld({ race: { buy: [{ productId: 'combo', quantity: 5 }] } });
    const pre = w.evaluate(body([['combo', 3]]));
    expect(pre.topError).toBeNull(); // 預檢時仍可購買
    const rejected = await rejection(createOrder(w.ports, body([['combo', 3]]), 'k1'));
    expect(rejected).toBeInstanceOf(RejectedError);
    expect(rejected.status).toBe(422);
    expect(rejected.code).toBe('ITEM_SOLD_OUT');
    expect(rejected.quote?.items[0]?.availableQuantity).toBe(0);
    expect(w.s.keys.size).toBe(0);
    expect(w.s.orders.filter((o) => o.id.startsWith('O'))).toHaveLength(0); // 本單未寫入
    expect(w.s.orders.filter((o) => o.pickupNo?.startsWith('X'))).toHaveLength(1); // 他人訂單以真實列注入
    expect(w.s.race).toBeNull();
    expect(w.s.calls).toContain('flush'); // 被拒時仍把他人訂單同步寫回
    expect(w.evaluate(body([['combo', 1]])).topError).toBe('ITEM_SOLD_OUT'); // 之後的 quote 反映已被買光
  });

  it('全有或全無與庫存先於價格：一行售完 + 另一行可買 → 整單 422；有業務錯誤時不比對 expectedTotal', async () => {
    const w = mockWorld();
    w.s.soldOut.add('tea');
    const e = await rejection(
      createOrder(
        w.ports,
        body(
          [
            ['combo', 1],
            ['tea', 1],
          ],
          { expectedTotal: 1 },
        ),
        'k1',
      ),
    );
    expect(e.status).toBe(422);
    expect(e.code).toBe('ITEM_SOLD_OUT');
    expect(w.remainingFor(combo)).toBe(5); // 可買的那一行也不計入
    expect(w.s.orders).toHaveLength(0);
    expect(w.s.keys.size).toBe(0);
  });

  it('PRICE_CHANGED（409）僅在無任何業務錯誤時回傳，並附最新報價；不寫入', async () => {
    const w = mockWorld();
    const e = await rejection(
      createOrder(w.ports, body([['combo', 1]], { expectedTotal: 250 }), 'k1'),
    );
    expect(e.status).toBe(409);
    expect(e.code).toBe('PRICE_CHANGED');
    expect(e.quote?.total).toBe(299);
    expect(w.s.orders).toHaveLength(0);
    expect(w.s.keys.size).toBe(0);
  });

  it('數量不足（剩 2 要 3）→ 422 ITEM_STOCK_INSUFFICIENT；改為 2 重送成功（庫存-5、庫存-15：4xx 不綁定 Key）', async () => {
    const w = mockWorld({ limit: 2 });
    const e = await rejection(createOrder(w.ports, body([['combo', 3]]), 'k1'));
    expect([e.status, e.code]).toEqual([422, 'ITEM_STOCK_INSUFFICIENT']);
    expect(e.quote?.items[0]?.availableQuantity).toBe(2);
    // 同一把 Key、改內容重送：因 4xx 未綁定，視為新建立（不是 IDEMPOTENCY_CONFLICT）
    const ok = await createOrder(w.ports, body([['combo', 2]]), 'k1');
    expect(ok.replayed).toBeUndefined();
    expect(w.remainingFor(combo)).toBe(0);
  });

  it('冪等重放：同 Key 同內容回原訂單（replayed）；不重驗、不套用預備情境、不重複計入；expectedTotal 不同仍是重放', async () => {
    const w = mockWorld();
    const first = await createOrder(w.ports, body([['combo', 2]]), 'k1');
    w.s.race = { buy: [{ productId: 'combo', quantity: 3 }] };
    w.s.soldOut.add('combo'); // 建單之後才售完：重放不得因此失敗
    w.s.calls.length = 0;
    const again = await createOrder(w.ports, body([['combo', 2]], { expectedTotal: 12345 }), 'k1');
    expect(again.replayed).toBe(true);
    expect(again.order.id).toBe(first.order.id);
    expect(again.trackingToken).not.toBe(first.trackingToken); // 重新簽發 trackingToken
    for (const step of ['applyRace', 'evaluate', 'commit']) expect(w.s.calls).not.toContain(step);
    expect(w.s.race).not.toBeNull(); // 重放不消耗預備情境
    expect(w.s.orders).toHaveLength(1);
    expect(w.s.calls).toContain('flush'); // 重放也會 flush（finally）
  });

  it('IDEMPOTENCY_CONFLICT：同 Key 不同內容（指紋不同）→ 409，不寫入；舊資料缺指紋視為相同', async () => {
    const w = mockWorld();
    await createOrder(w.ports, body([['combo', 2]]), 'k1');
    const e = await rejection(createOrder(w.ports, body([['combo', 1]]), 'k1'));
    expect([e.status, e.code]).toEqual([409, 'IDEMPOTENCY_CONFLICT']);
    expect(w.s.orders).toHaveLength(1);
    const binding = w.s.keys.get('k1');
    if (binding === undefined) throw new Error('binding missing');
    binding.fingerprint = null; // 舊資料
    const legacy = await createOrder(w.ports, body([['combo', 1]]), 'k1');
    expect(legacy.replayed).toBe(true);
  });

  it("failNext 'AFTER_COMMIT'：訂單已建立、回應遺失；同 Key 重送取回原訂單，庫存只扣一次", async () => {
    const w = mockWorld({ failNext: { phase: 'AFTER_COMMIT', remaining: 1 } });
    await expect(createOrder(w.ports, body([['combo', 2]]), 'k1')).rejects.toMatchObject({
      injected: 'AFTER_COMMIT',
    });
    expect(w.s.orders).toHaveLength(1); // 訂單已建立
    expect(w.s.calls.indexOf('flush')).toBeLessThan(w.s.calls.lastIndexOf('fail?AFTER_COMMIT')); // 先同步寫回再丟錯
    const retry = await createOrder(w.ports, body([['combo', 2]]), 'k1');
    expect(retry.replayed).toBe(true);
    expect(w.s.orders).toHaveLength(1);
    expect(w.remainingFor(combo)).toBe(3);
    expect(w.s.failNext?.remaining).toBe(0); // AFTER_COMMIT 只對真正建立的那次生效；重放不再觸發
  });

  it('重放不觸發 AFTER_COMMIT（即使預備仍有次數）', async () => {
    const w = mockWorld();
    await createOrder(w.ports, body([['combo', 1]]), 'k1');
    w.s.failNext = { phase: 'AFTER_COMMIT', remaining: 1 };
    const again = await createOrder(w.ports, body([['combo', 1]]), 'k1');
    expect(again.replayed).toBe(true);
    expect(w.s.failNext.remaining).toBe(1);
  });

  it('逾時結算先於計數：待付款到期後立即釋放；過期的 Key 重放回傳目前狀態（CANCELLED、TRACK）', async () => {
    const w = mockWorld();
    const pay = body([['combo', 5]], { paymentMethod: 'LINE_PAY' });
    const first = await createOrder(w.ports, pay, 'k1');
    expect(first.nextAction).toBe('PAY');
    expect(w.remainingFor(combo)).toBe(0);
    const blocked = await rejection(createOrder(w.ports, body([['combo', 1]]), 'k2'));
    expect(blocked.code).toBe('ITEM_SOLD_OUT');
    w.s.now += 15 * MIN; // 到期當下即釋放（半開區間）
    const ok = await createOrder(w.ports, body([['combo', 5]]), 'k3');
    expect(ok.order).toBeDefined();
    expect(first.order.status).toBe('CANCELLED');
    const replay = await createOrder(w.ports, pay, 'k1');
    expect([replay.replayed, replay.order.status, replay.nextAction]).toEqual([
      true,
      'CANCELLED',
      'TRACK',
    ]);
  });

  it('R-T(4)：唯讀路徑（quote）不結算——逾期待付款單狀態不變、剩餘已回升；寫入路徑（建單）才在鎖內寫成 CANCELLED', async () => {
    const w = mockWorld();
    const first = await createOrder(
      w.ports,
      body([['combo', 5]], { paymentMethod: 'LINE_PAY' }),
      'k1',
    );
    expect(w.remainingFor(combo)).toBe(0);
    w.s.now += 15 * MIN;
    const snapshot = JSON.stringify(w.s.orders);
    const q = w.evaluate(body([['combo', 5]]));
    expect(q.topError).toBeNull(); // 到期當下即以 predicate 排除，剩餘回升
    expect(JSON.stringify(w.s.orders)).toBe(snapshot); // quote 前後 db 深度相等
    expect(first.order.status).toBe('PENDING_PAYMENT'); // 唯讀路徑不寫入 CANCELLED
    await createOrder(w.ports, body([['tea', 1]]), 'k2');
    expect(first.order.status).toBe('CANCELLED'); // 寫入路徑在鎖內結算
  });

  it('並行最後 1 份：20 個不同 Key 同時送出 → 恰 1 筆成功，其餘 ITEM_SOLD_OUT（臨界區序列化，庫存-10）', async () => {
    const w = mockWorld({ limit: 1 });
    const all = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        createOrder(w.ports, body([['combo', 1]]), `k${i}`).then(
          (r) => r as CreateOrderResponse | RejectedError,
          (e: unknown) => e as RejectedError,
        ),
      ),
    );
    const ok = all.filter((r): r is CreateOrderResponse => 'order' in r);
    const bad = all.filter((r): r is RejectedError => r instanceof RejectedError);
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(19);
    expect(bad.every((e) => e.code === 'ITEM_SOLD_OUT')).toBe(true);
    expect(w.remainingFor(combo)).toBe(0);
  });

  it('同 Key 並行 ×5（內容相同）→ 只建立 1 筆，其餘為重放；庫存只扣一次（庫存-12）', async () => {
    const w = mockWorld();
    const all = await Promise.all(
      Array.from({ length: 5 }, () => createOrder(w.ports, body([['combo', 2]]), 'same')),
    );
    expect(w.s.orders).toHaveLength(1);
    expect(all.filter((r) => r.replayed === true)).toHaveLength(4);
    expect(new Set(all.map((r) => r.order.id)).size).toBe(1);
    expect(w.remainingFor(combo)).toBe(3);
  });

  it('同商品多行（庫存-6）：剩 3、combo×4 與 combo×2 → 422，error.quote 兩行為 [3, 0]，第 2 行是數量不足而非售完', async () => {
    const w = mockWorld({ limit: 3 });
    const e = await rejection(
      createOrder(
        w.ports,
        body([
          ['combo', 4],
          ['combo', 2],
        ]),
        'k1',
      ),
    );
    expect(e.code).toBe('ITEM_STOCK_INSUFFICIENT');
    expect(e.quote?.items.map((i) => i.availableQuantity)).toEqual([3, 0]);
    expect(e.quote?.items.map((i) => i.issue)).toEqual([
      'ITEM_STOCK_INSUFFICIENT',
      'ITEM_STOCK_INSUFFICIENT',
    ]);
    expect(w.s.orders).toHaveLength(0);
  });

  it('臨界區內任何一步丟出非預期錯誤：鎖內的寫入仍在釋放鎖之前 flush，且不觸發 AFTER_COMMIT', async () => {
    const w = mockWorld();
    const boom = new Error('commit failed');
    w.ports.commit = () => {
      w.s.calls.push('commit');
      throw boom;
    };
    await expect(createOrder(w.ports, body([['tea', 1]]), 'k1')).rejects.toBe(boom);
    expect(w.s.calls.at(-1)).toBe('flush');
    expect(w.s.calls).not.toContain('fail?AFTER_COMMIT');
    expect(w.s.keys.size).toBe(0);

    const w2 = mockWorld();
    w2.ports.settleExpired = () => {
      w2.s.calls.push('settle');
      throw boom;
    };
    await expect(createOrder(w2.ports, body([['tea', 1]]), 'k1')).rejects.toBe(boom);
    expect(w2.s.calls).not.toContain('evaluate');
    expect(w2.s.calls.at(-1)).toBe('flush');
  });

  it('管線例外後鎖已釋放：之後的建單照常進行', async () => {
    const w = mockWorld();
    const ok = w.ports.commit;
    let first = true;
    w.ports.commit = (...args) => {
      if (first) {
        first = false;
        throw new Error('transient');
      }
      return ok(...args);
    };
    await expect(createOrder(w.ports, body([['tea', 1]]), 'k1')).rejects.toThrow('transient');
    const res = await createOrder(w.ports, body([['tea', 1]]), 'k1');
    expect(res.order).toBeDefined();
  });

  it('成功路徑不重複呼叫 commit；失敗路徑不呼叫 commit', async () => {
    const w = mockWorld();
    await createOrder(w.ports, body([['tea', 1]]), 'a');
    expect(w.s.calls.filter((c) => c === 'commit')).toHaveLength(1);
    w.s.calls.length = 0;
    await createOrder(w.ports, body([['combo', 9]]), 'b').catch(() => undefined);
    expect(w.s.calls).not.toContain('commit');
    expect(w.s.calls.at(-1)).toBe('flush');
  });
});

describe('createOrder 的屬性（07 §13：I1～I6，固定序列由 fast-check 產生）', () => {
  it('隨機送出序列下：不超賣、全有或全無（被拒不改變計入）、同 Key 重放不改變計數、剩餘非負', async () => {
    type Op =
      | { kind: 'create'; key: number; combo: number; tea: number; online: boolean }
      | { kind: 'tick'; minutes: number }
      | { kind: 'cancel'; pick: number };
    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.record({
        kind: fc.constant('create' as const),
        key: fc.integer({ min: 0, max: 7 }),
        combo: fc.integer({ min: 0, max: 4 }),
        tea: fc.integer({ min: 0, max: 3 }),
        online: fc.boolean(),
      }),
      fc.record({ kind: fc.constant('tick' as const), minutes: fc.integer({ min: 0, max: 20 }) }),
      fc.record({ kind: fc.constant('cancel' as const), pick: fc.nat() }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 25 }), async (ops) => {
        const w = mockWorld({ limit: 5 });
        for (const op of ops) {
          const before = w.counted().length;
          const soldBefore = PRODUCTS.map((p) => w.remainingFor(p));
          if (op.kind === 'tick') {
            w.s.now += op.minutes * MIN;
            // 時間前進只會讓計入集合變小（I3）
            expect(w.counted().length).toBeLessThanOrEqual(before);
            continue;
          }
          if (op.kind === 'cancel') {
            const mine = w.s.orders.filter(
              (o) =>
                o.id.startsWith('O') && (o.status === 'PENDING' || o.status === 'PENDING_PAYMENT'),
            );
            const target = mine[op.pick % Math.max(1, mine.length)];
            if (target !== undefined) {
              target.status = 'CANCELLED';
              expect(w.counted().length).toBeLessThanOrEqual(before);
            }
            continue;
          }
          const items: Array<[ID, number]> = [];
          if (op.combo > 0) items.push(['combo', op.combo]);
          if (op.tea > 0) items.push(['tea', op.tea]);
          if (items.length === 0) continue;
          const key = `k${op.key}`;
          const bound = w.s.keys.has(key);
          const req = body(items, { paymentMethod: op.online ? 'LINE_PAY' : 'CASH' });
          const result = await createOrder(w.ports, req, key).then(
            (r) => r,
            (e: unknown) => e as RejectedError,
          );
          if (result instanceof RejectedError) {
            // 被拒：不新增訂單、不綁定新 Key（逾時結算只會讓計入集合變小）
            expect(w.counted().length).toBeLessThanOrEqual(before);
            if (!bound) expect(w.s.keys.has(key)).toBe(false);
          } else if (bound) {
            expect(result.replayed).toBe(true); // I4：同 Key 重放不改變計數
            expect(w.counted().length).toBeLessThanOrEqual(before);
          } else {
            expect(result.replayed).toBeUndefined();
          }
          // I1：計入份數不超過限量；I6：剩餘非負
          expect(consumedOf(w, 'combo')).toBeLessThanOrEqual(5);
          for (const r of PRODUCTS.map((p) => w.remainingFor(p)))
            if (r !== null) expect(r).toBeGreaterThanOrEqual(0);
          // 售出量變化只來自成功建單（不會因被拒而增加）
          const soldAfter = PRODUCTS.map((p) => w.remainingFor(p));
          soldAfter.forEach((r, i) => {
            const prev = soldBefore[i];
            if (
              r !== null &&
              prev !== null &&
              prev !== undefined &&
              result instanceof RejectedError
            ) {
              expect(r).toBeGreaterThanOrEqual(prev);
            }
          });
        }
      }),
      { numRuns: 100 },
    );
  });
});

function consumedOf(w: ReturnType<typeof mockWorld>, pid: ID): number {
  return w
    .counted()
    .reduce(
      (sum, o) =>
        sum + o.items.filter((i) => i.productId === pid).reduce((a, i) => a + i.quantity, 0),
      0,
    );
}
