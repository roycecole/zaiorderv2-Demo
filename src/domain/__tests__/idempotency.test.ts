// BR-27 請求指紋、BR-41 冪等鍵生命週期與結果未知、FLOW-24、O-03（cartMatchesOrder）
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  EMPTY_KEY_STATE,
  afterSubmit,
  canonicalRequest,
  cartMatchesOrder,
  classifyFailedSubmit,
  ensureKey,
  fallbackFingerprint,
  isSameContent,
  requestFingerprint,
} from '../idempotency';
import type { CheckoutKeyState, SubmitResult } from '../idempotency';
import type { CreateOrderRequest, OrderLineInput } from '../types';

const req = (o: Partial<CreateOrderRequest> = {}): CreateOrderRequest => ({
  orderType: 'PICKUP',
  items: [{ productId: 'lurou', quantity: 1, optionIds: ['opt_l', 'opt_egg'], note: '不要蔥' }],
  scheduledAt: null,
  contact: { name: '王小明', phone: '0912345678' },
  paymentMethod: 'CASH',
  invoice: { type: 'PAPER' },
  needUtensils: false,
  expectedTotal: 92,
  ...o,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ───────── 正規化與指紋 ─────────
describe('canonicalRequest', () => {
  it('排除 expectedTotal；optionIds 排序；備註去前後空白；欄位順序無關', () => {
    const a = canonicalRequest(req());
    expect(canonicalRequest(req({ expectedTotal: 999 }))).toBe(a);
    expect(
      canonicalRequest(
        req({
          items: [
            {
              productId: 'lurou',
              quantity: 1,
              optionIds: ['opt_egg', 'opt_l'],
              note: '  不要蔥  ',
            },
          ],
        }),
      ),
    ).toBe(a);
    const shuffled = {
      expectedTotal: 1,
      needUtensils: false,
      invoice: { type: 'PAPER' },
      paymentMethod: 'CASH',
      contact: { phone: '0912345678', name: '王小明' },
      scheduledAt: null,
      items: req().items,
      orderType: 'PICKUP',
    } as CreateOrderRequest;
    expect(canonicalRequest(shuffled)).toBe(a);
    expect(a).not.toContain('expectedTotal');
  });

  it('任一內容變更則不同', () => {
    const a = canonicalRequest(req());
    expect(canonicalRequest(req({ note: '加辣' }))).not.toBe(a);
    expect(canonicalRequest(req({ paymentMethod: 'LINE_PAY' }))).not.toBe(a);
    expect(canonicalRequest(req({ orderType: 'DINE_IN' }))).not.toBe(a);
    expect(canonicalRequest(req({ scheduledAt: '2026-10-14T17:00:00+08:00' }))).not.toBe(a);
    expect(canonicalRequest(req({ couponCode: 'LUNCH10' }))).not.toBe(a);
    expect(
      canonicalRequest(
        req({
          items: [
            { productId: 'lurou', quantity: 2, optionIds: ['opt_l', 'opt_egg'], note: '不要蔥' },
          ],
        }),
      ),
    ).not.toBe(a);
  });

  it('items 順序保留（順序決定同商品多行的配置，BR-40）', () => {
    const two: OrderLineInput[] = [
      { productId: 'a', quantity: 1, optionIds: [] },
      { productId: 'b', quantity: 1, optionIds: [] },
    ];
    expect(canonicalRequest(req({ items: two }))).not.toBe(
      canonicalRequest(req({ items: [...two].reverse() })),
    );
  });

  it('06 §1.4：整單 note、scheduledAt、paymentMethod、contact 等其餘欄位原樣納入（空白差異也視為不同內容）', () => {
    const a = canonicalRequest(req({ note: '請附筷子' }));
    expect(canonicalRequest(req({ note: ' 請附筷子 ' }))).not.toBe(a);
    expect(canonicalRequest(req({ contact: { name: '王小明 ', phone: '0912345678' } }))).not.toBe(
      canonicalRequest(req()),
    );
    expect(canonicalRequest(req({ needUtensils: true }))).not.toBe(canonicalRequest(req()));
  });

  it('空白備註視同未填；undefined 欄位與缺少欄位相同', () => {
    const blank: OrderLineInput[] = [{ productId: 'a', quantity: 1, optionIds: [], note: '   ' }];
    const none: OrderLineInput[] = [{ productId: 'a', quantity: 1, optionIds: [] }];
    expect(canonicalRequest(req({ items: blank }))).toBe(canonicalRequest(req({ items: none })));
    expect(canonicalRequest(req({ couponCode: undefined }))).toBe(canonicalRequest(req()));
  });

  it('不改動輸入（optionIds 排序在副本上進行）', () => {
    const r = req({ items: [{ productId: 'a', quantity: 1, optionIds: ['z', 'a'], note: ' x ' }] });
    canonicalRequest(r);
    expect(r.items[0]?.optionIds).toEqual(['z', 'a']);
    expect(r.items[0]?.note).toBe(' x ');
    expect(r.expectedTotal).toBe(92);
  });

  it('isSameContent：僅 expectedTotal 不同為相同；其餘內容不同為不同', () => {
    expect(isSameContent(req({ expectedTotal: 1 }), req({ expectedTotal: 2 }))).toBe(true);
    expect(isSameContent(req(), req({ note: 'x' }))).toBe(false);
  });
});

describe('requestFingerprint', () => {
  it('64 碼 SHA-256（hex），等於正規化內容的雜湊；expectedTotal 變動不改變指紋', async () => {
    const fp = await requestFingerprint(req());
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp).toBe(createHash('sha256').update(canonicalRequest(req()), 'utf8').digest('hex'));
    expect(await requestFingerprint(req({ expectedTotal: 1 }))).toBe(fp);
    expect(await requestFingerprint(req({ note: '改過' }))).not.toBe(fp);
  });

  it('crypto.subtle 不可用（http 區網預覽）時改用後備指紋：格式相同', async () => {
    vi.stubGlobal('crypto', {}); // 沒有 subtle
    const fp = await requestFingerprint(req());
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp).toBe(fallbackFingerprint(req()));
    vi.stubGlobal('crypto', undefined);
    expect(await requestFingerprint(req())).toBe(fallbackFingerprint(req()));
  });

  it('同一環境內計算的值穩定：同內容 → 同指紋', async () => {
    expect(await requestFingerprint(req())).toBe(await requestFingerprint(req()));
  });
});

describe('fallbackFingerprint', () => {
  it('64 碼 hex；內容相同才相同；expectedTotal 不影響', () => {
    const fp = fallbackFingerprint(req());
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fallbackFingerprint(req({ expectedTotal: 1 }))).toBe(fp);
    expect(fallbackFingerprint(req({ note: '改過' }))).not.toBe(fp);
    expect(
      new Set(['a', 'b', 'c', 'd'].map((n) => fallbackFingerprint(req({ note: n })))).size,
    ).toBe(4);
  });
});

// ───────── 性質測試：指紋穩定性（欄位順序無關） ─────────
describe('指紋性質', () => {
  const idArb = fc.stringMatching(/^[a-z_]{1,8}$/);
  const lineArb: fc.Arbitrary<OrderLineInput> = fc.record(
    {
      productId: idArb,
      quantity: fc.integer({ min: 1, max: 20 }),
      optionIds: fc.array(idArb, { maxLength: 4 }),
      note: fc.string({ maxLength: 8 }),
    },
    { requiredKeys: ['productId', 'quantity', 'optionIds'] },
  );
  const reqArb: fc.Arbitrary<CreateOrderRequest> = fc
    .record(
      {
        orderType: fc.constantFrom('PICKUP', 'DELIVERY', 'DINE_IN' as const),
        items: fc.array(lineArb, { minLength: 1, maxLength: 4 }),
        scheduledAt: fc.option(
          fc.constantFrom('2026-10-14T17:00:00+08:00', '2026-10-15T11:30:00+08:00'),
          { nil: null },
        ),
        contact: fc.record(
          { name: fc.string({ maxLength: 6 }), phone: fc.stringMatching(/^09[0-9]{8}$/) },
          { requiredKeys: [] },
        ),
        paymentMethod: fc.constantFrom('CASH', 'LINE_PAY', 'JKOPAY', 'CREDIT_CARD' as const),
        invoice: fc.record(
          {
            type: fc.constantFrom('PAPER', 'DONATION' as const),
            donateCode: fc.string({ maxLength: 4 }),
          },
          { requiredKeys: ['type'] },
        ),
        couponCode: fc.string({ maxLength: 8 }),
        needUtensils: fc.boolean(),
        note: fc.string({ maxLength: 10 }),
        expectedTotal: fc.integer({ min: 0, max: 5000 }),
      },
      {
        requiredKeys: [
          'orderType',
          'items',
          'scheduledAt',
          'contact',
          'paymentMethod',
          'invoice',
          'needUtensils',
          'expectedTotal',
        ],
      },
    )
    .map((r) => r as CreateOrderRequest);

  /** 遞迴地以相反的鍵順序重建物件（陣列順序保留） */
  const reorderKeys = (v: unknown, mode: 'reverse' | 'sortDesc'): unknown => {
    if (Array.isArray(v)) return v.map((x) => reorderKeys(x, mode));
    if (v !== null && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>);
      const ordered =
        mode === 'reverse'
          ? [...entries].reverse()
          : [...entries].sort(([a], [b]) => (a < b ? 1 : -1));
      return Object.fromEntries(ordered.map(([k, x]) => [k, reorderKeys(x, mode)]));
    }
    return v;
  };

  it('欄位順序無關：任意鍵順序的同一請求得到相同的正規化內容與指紋', async () => {
    await fc.assert(
      fc.asyncProperty(reqArb, async (r) => {
        const a = reorderKeys(r, 'reverse') as CreateOrderRequest;
        const b = reorderKeys(r, 'sortDesc') as CreateOrderRequest;
        expect(canonicalRequest(a)).toBe(canonicalRequest(r));
        expect(canonicalRequest(b)).toBe(canonicalRequest(r));
        expect(fallbackFingerprint(a)).toBe(fallbackFingerprint(r));
        expect(await requestFingerprint(b)).toBe(await requestFingerprint(r));
      }),
      { numRuns: 100 },
    );
  });

  it('expectedTotal、選項順序、備註前後空白不影響指紋', async () => {
    await fc.assert(
      fc.asyncProperty(reqArb, fc.integer({ min: 0, max: 99999 }), async (r, total) => {
        const variant: CreateOrderRequest = {
          ...r,
          expectedTotal: total,
          items: r.items.map((l) => ({
            ...l,
            optionIds: [...l.optionIds].reverse(),
            ...(l.note !== undefined ? { note: ` ${l.note}\t` } : {}),
          })),
        };
        expect(isSameContent(r, variant)).toBe(true);
        expect(await requestFingerprint(variant)).toBe(await requestFingerprint(r));
      }),
      { numRuns: 100 },
    );
  });

  it('改變數量即改變指紋（無碰撞）', async () => {
    await fc.assert(
      fc.asyncProperty(reqArb, async (r) => {
        const first = r.items[0] as OrderLineInput;
        const changed: CreateOrderRequest = {
          ...r,
          items: [{ ...first, quantity: first.quantity + 1 }, ...r.items.slice(1)],
        };
        expect(isSameContent(r, changed)).toBe(false);
        expect(await requestFingerprint(changed)).not.toBe(await requestFingerprint(r));
      }),
      { numRuns: 100 },
    );
  });

  it('cartMatchesOrder：自反、與順序無關；數量變動後不一致', () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1, maxLength: 5 }), (items) => {
        expect(cartMatchesOrder(items, items)).toBe(true);
        expect(cartMatchesOrder(items, [...items].reverse())).toBe(true);
        const first = items[0] as OrderLineInput;
        const changed = [{ ...first, quantity: first.quantity + 1 }, ...items.slice(1)];
        expect(cartMatchesOrder(items, changed)).toBe(false);
      }),
    );
  });
});

// ───────── cartMatchesOrder（O-03） ─────────
describe('cartMatchesOrder', () => {
  const o: OrderLineInput[] = [
    { productId: 'a', quantity: 2, optionIds: ['x', 'y'] },
    { productId: 'b', quantity: 1, optionIds: [], note: ' 少冰 ' },
  ];

  it('與順序無關、選項排序無關、備註去空白', () => {
    const same: OrderLineInput[] = [
      { productId: 'b', quantity: 1, optionIds: [], note: '少冰' },
      { productId: 'a', quantity: 2, optionIds: ['y', 'x'] },
    ];
    expect(cartMatchesOrder(o, same)).toBe(true);
  });

  it('份數、選項、品項數量不同即不一致', () => {
    expect(
      cartMatchesOrder(o, [
        { productId: 'a', quantity: 3, optionIds: ['x', 'y'] },
        o[1] as OrderLineInput,
      ]),
    ).toBe(false);
    expect(cartMatchesOrder(o, [o[0] as OrderLineInput])).toBe(false);
    expect(
      cartMatchesOrder(o, [
        { productId: 'a', quantity: 2, optionIds: ['x'] },
        o[1] as OrderLineInput,
      ]),
    ).toBe(false);
    expect(
      cartMatchesOrder(o, [
        o[0] as OrderLineInput,
        { productId: 'b', quantity: 1, optionIds: [], note: '多冰' },
      ]),
    ).toBe(false);
  });

  it('兩者皆空為一致', () => {
    expect(cartMatchesOrder([], [])).toBe(true);
    expect(cartMatchesOrder([], [o[0] as OrderLineInput])).toBe(false);
  });

  it('同商品兩行加總與單行相同視為一致（只比對內容）', () => {
    expect(
      cartMatchesOrder(
        [{ productId: 'a', quantity: 2, optionIds: [] }],
        [
          { productId: 'a', quantity: 1, optionIds: [] },
          { productId: 'a', quantity: 1, optionIds: [] },
        ],
      ),
    ).toBe(true);
  });
});

// ───────── Key 生命週期（BR-41、FLOW-24） ─────────
describe('ensureKey', () => {
  it('首次送出才產生，之後沿用（不再呼叫產生器）；不改動共用的空狀態', () => {
    let made = 0;
    const mk = (): string => `key-${++made}`;
    const s1 = ensureKey(EMPTY_KEY_STATE, mk);
    const s2 = ensureKey(s1, mk);
    expect(s1.idempotencyKey).toBe('key-1');
    expect(s2.idempotencyKey).toBe('key-1');
    expect(made).toBe(1);
    expect(EMPTY_KEY_STATE.idempotencyKey).toBeNull();
    expect(EMPTY_KEY_STATE.unknownBodies).toEqual([]);
  });

  it('產生 Key 時保留已記下的送出內容', () => {
    const state: CheckoutKeyState = { idempotencyKey: null, unknownBodies: [req()] };
    expect(ensureKey(state, () => 'k').unknownBodies).toHaveLength(1);
  });
});

describe('classifyFailedSubmit（FLOW-24）', () => {
  const c = classifyFailedSubmit;

  it('503 附 retryAfterSeconds → NOT_CREATED（確定未建立）；未附 → UNKNOWN', () => {
    expect(c({ status: 503, retryAfterSeconds: 3 })).toBe('NOT_CREATED');
    expect(c({ status: 503 })).toBe('UNKNOWN'); // 維護、閘道，或 Mock 的 failNext BEFORE
    expect(c({ status: 503, code: 'SERVICE_UNAVAILABLE' })).toBe('UNKNOWN');
  });

  it('無回應（status 0）與其他 5xx → UNKNOWN', () => {
    for (const status of [0, 500, 502, 504]) expect(c({ status }), String(status)).toBe('UNKNOWN');
  });

  it('429 → NOT_CREATED；4xx → REJECTED；409 PRICE_CHANGED → REJECTED；409 IDEMPOTENCY_CONFLICT → CONFLICT', () => {
    expect(c({ status: 429, retryAfterSeconds: 20 })).toBe('NOT_CREATED');
    expect(c({ status: 429 })).toBe('NOT_CREATED');
    for (const status of [400, 422, 403, 404])
      expect(c({ status }), String(status)).toBe('REJECTED');
    expect(c({ status: 409, code: 'PRICE_CHANGED' })).toBe('REJECTED');
    expect(c({ status: 409, code: 'IDEMPOTENCY_CONFLICT' })).toBe('CONFLICT');
    expect(c({ status: 409 })).toBe('REJECTED');
  });
});

describe('afterSubmit：Key 與草稿的狀態轉換（07 §7.6 表）', () => {
  const state = (o: Partial<CheckoutKeyState> = {}): CheckoutKeyState => ({
    idempotencyKey: 'k1',
    unknownBodies: [],
    ...o,
  });

  it("201 非重放（'CREATED'）：Key 作廢、清除購物車與 unknownBodies", () => {
    const r = afterSubmit(state({ unknownBodies: [req()] }), req(), { type: 'CREATED' });
    expect(r).toEqual({
      state: { idempotencyKey: null, unknownBodies: [] },
      clearCart: true,
      replay: [],
    });
  });

  it("422、409 PRICE_CHANGED、400（'REJECTED'）：沿用 Key、不記內容、保留購物車", () => {
    const s = state();
    expect(afterSubmit(s, req(), { type: 'REJECTED' })).toEqual({
      state: s,
      clearCart: false,
      replay: [],
    });
  });

  it("429、附 retryAfterSeconds 的 503（'NOT_CREATED'）：沿用 Key、不記下送出內容", () => {
    const s = state();
    expect(afterSubmit(s, req(), { type: 'NOT_CREATED' })).toEqual({
      state: s,
      clearCart: false,
      replay: [],
    });
  });

  it("結果未知（'UNKNOWN'）：保留 Key 並記下內容；改內容再送再記一份；相同內容（僅 expectedTotal 不同）只記一次", () => {
    let s = state();
    s = afterSubmit(s, req({ expectedTotal: 92 }), { type: 'UNKNOWN' }).state;
    expect(s.idempotencyKey).toBe('k1');
    expect(s.unknownBodies).toHaveLength(1);
    s = afterSubmit(s, req({ expectedTotal: 95 }), { type: 'UNKNOWN' }).state;
    expect(s.unknownBodies).toHaveLength(1);
    s = afterSubmit(s, req({ note: '改備註' }), { type: 'UNKNOWN' }).state;
    expect(s.unknownBodies).toHaveLength(2);
    expect(s.idempotencyKey).toBe('k1');
    expect(afterSubmit(s, req(), { type: 'UNKNOWN' }).clearCart).toBe(false);
  });

  it('結果未知不改動輸入狀態（不可變）', () => {
    const s = state();
    afterSubmit(s, req(), { type: 'UNKNOWN' });
    expect(s.unknownBodies).toEqual([]);
  });

  it("IDEMPOTENCY_CONFLICT（'CONFLICT'）：不換新 Key，依送出順序重放記下的內容；無記錄時 replay 為空", () => {
    const b1 = req();
    const b2 = req({ note: '改備註' });
    const s = state({ unknownBodies: [b1, b2] });
    const t1 = afterSubmit(s, req({ note: '又改' }), { type: 'CONFLICT' });
    expect(t1.state.idempotencyKey).toBe('k1');
    expect(t1.replay).toEqual([b1, b2]);
    expect(t1.clearCart).toBe(false);
    const t2 = afterSubmit(state(), req(), { type: 'CONFLICT' });
    expect(t2.replay).toEqual([]);
    expect(t2.state.idempotencyKey).toBe('k1');
  });

  it('O-03：任一次重放取回成功後 Key 立即作廢；購物車僅在內容一致時清除，不一致則保留', () => {
    const s = state({ unknownBodies: [req()] });
    const same = afterSubmit(s, req(), {
      type: 'REPLAYED',
      sameAsCart: true,
      orderStatus: 'PENDING',
    });
    expect(same).toEqual({ state: EMPTY_KEY_STATE, clearCart: true, replay: [] });
    const diff = afterSubmit(s, req(), {
      type: 'REPLAYED',
      sameAsCart: false,
      orderStatus: 'PENDING',
    });
    expect(diff).toEqual({ state: EMPTY_KEY_STATE, clearCart: false, replay: [] });
  });

  it('FLOW-24：重放取回的原訂單已 CANCELLED（付款逾時）→ Key 作廢但購物車保留（內容一致也不清除）', () => {
    const r = afterSubmit(state({ unknownBodies: [req()] }), req(), {
      type: 'REPLAYED',
      sameAsCart: true,
      orderStatus: 'CANCELLED',
    });
    expect(r).toEqual({ state: EMPTY_KEY_STATE, clearCart: false, replay: [] });
  });

  it('R-A：觸控面板閒置重置 = 回到 EMPTY_KEY_STATE，下一位顧客首次送出產生新 Key，不會以舊內容重放', () => {
    const unknown = afterSubmit(state(), req(), { type: 'UNKNOWN' }).state;
    expect([unknown.idempotencyKey, unknown.unknownBodies.length]).toEqual(['k1', 1]);
    const afterReset = EMPTY_KEY_STATE;
    expect(afterReset).toEqual({ idempotencyKey: null, unknownBodies: [] });
    expect(ensureKey(afterReset, () => 'k2').idempotencyKey).toBe('k2');
    expect(afterSubmit(afterReset, req(), { type: 'CONFLICT' }).replay).toEqual([]);
  });

  it('性質：無論結果為何，除 CREATED / REPLAYED 外 Key 永不被換掉或清空（不得換新 Key）', () => {
    const resultArb: fc.Arbitrary<SubmitResult> = fc.constantFrom<SubmitResult>(
      { type: 'REJECTED' },
      { type: 'NOT_CREATED' },
      { type: 'UNKNOWN' },
      { type: 'CONFLICT' },
    );
    fc.assert(
      fc.property(
        fc.array(resultArb, { minLength: 1, maxLength: 12 }),
        fc.array(fc.string({ maxLength: 4 }), { minLength: 1, maxLength: 12 }),
        (results, notes) => {
          let s = state();
          results.forEach((r, i) => {
            const t = afterSubmit(s, req({ note: notes[i % notes.length] as string }), r);
            expect(t.state.idempotencyKey).toBe('k1');
            expect(t.clearCart).toBe(false);
            s = t.state;
          });
          // unknownBodies 內沒有重複內容
          const keys = s.unknownBodies.map((b) => canonicalRequest(b));
          expect(new Set(keys).size).toBe(keys.length);
        },
      ),
    );
  });
});
