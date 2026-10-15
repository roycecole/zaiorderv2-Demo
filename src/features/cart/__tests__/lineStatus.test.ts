// 購物車逐行可購買狀態（FR-CT-05、CMP-17、BR-40）：quote 預檢只標示，不阻擋
import { describe, expect, it } from 'vitest';
import type { CartLine } from '@/domain/cart';
import type { QuoteCheck, QuoteResponse, QuotedLine } from '@/domain/types';
import { deriveLineStatuses } from '../lineStatus';

const line = (lineId: string, productId: string, quantity: number, name = productId): CartLine => ({
  lineId,
  productId,
  quantity,
  optionIds: [],
  snapshot: { name, unitPrice: 50, optionLabels: [] },
});

const quoted = (index: number, l: CartLine, extra: Partial<QuotedLine> = {}): QuotedLine => ({
  index,
  productId: l.productId,
  name: l.snapshot.name,
  optionLabels: [],
  unitPrice: 50,
  quantity: l.quantity,
  lineTotal: 50 * l.quantity,
  available: true,
  availableQuantity: l.quantity,
  ...extra,
});

const quote = (items: QuotedLine[], checks: QuoteCheck[] = []): QuoteResponse => ({
  valid: checks.every((c) => c.severity !== 'ERROR'),
  items,
  subtotal: items.reduce((n, i) => n + i.lineTotal, 0),
  deliveryFee: 0,
  discount: 0,
  total: 0,
  checks,
});

describe('deriveLineStatuses', () => {
  it('沒有 quote：只依菜單剩餘份數標示「今日剩 n 份」（≤ 10 才揭露）', () => {
    const lines = [line('a', 'p1', 1), line('b', 'p2', 1)];
    const result = deriveLineStatuses(undefined, lines, (id) => (id === 'p1' ? 5 : 30));
    expect(result.byLineId.get('a')?.limited).toBe(5);
    expect(result.byLineId.get('b')?.limited).toBeUndefined();
    expect(result.problemCount).toBe(0);
  });

  it('售完 / 下架 / 選項暫無供應：標為 UNAVAILABLE，不計入「今日剩 n 份」', () => {
    const lines = [line('a', 'p1', 1), line('b', 'p2', 1), line('c', 'p3', 1)];
    const q = quote(
      [
        quoted(0, lines[0] as CartLine, {
          available: false,
          availableQuantity: 0,
          lineTotal: 0,
          issue: 'ITEM_SOLD_OUT',
          remaining: 0,
        }),
        quoted(1, lines[1] as CartLine, {
          available: false,
          availableQuantity: 0,
          lineTotal: 0,
          issue: 'ITEM_UNLISTED',
        }),
        quoted(2, lines[2] as CartLine, {
          available: false,
          availableQuantity: 0,
          lineTotal: 0,
          issue: 'OPTION_UNAVAILABLE',
        }),
      ],
      [
        { code: 'ITEM_SOLD_OUT', severity: 'ERROR', message: 'x', field: 'items', lineIndex: 0 },
        { code: 'ITEM_UNLISTED', severity: 'ERROR', message: 'x', field: 'items', lineIndex: 1 },
        {
          code: 'OPTION_UNAVAILABLE',
          severity: 'ERROR',
          message: 'x',
          field: 'items',
          lineIndex: 2,
        },
      ],
    );
    const result = deriveLineStatuses({ quote: q, lineIds: ['a', 'b', 'c'] }, lines);
    expect(result.byLineId.get('a')?.issue).toEqual({ kind: 'UNAVAILABLE', code: 'ITEM_SOLD_OUT' });
    expect(result.byLineId.get('b')?.issue).toEqual({ kind: 'UNAVAILABLE', code: 'ITEM_UNLISTED' });
    expect(result.byLineId.get('c')?.issue).toEqual({
      kind: 'UNAVAILABLE',
      code: 'OPTION_UNAVAILABLE',
    });
    expect(result.byLineId.get('a')?.limited).toBeUndefined();
    expect(result.problemCount).toBe(3);
  });

  it('數量不足：帶可購買份數、商品剩餘與同商品合計；配置為 0 者視為被同商品其他行占用', () => {
    const lines = [line('a', 'p1', 3), line('b', 'p1', 2)];
    const q = quote(
      [
        quoted(0, lines[0] as CartLine, {
          availableQuantity: 1,
          available: false,
          lineTotal: 50,
          issue: 'ITEM_STOCK_INSUFFICIENT',
          remaining: 1,
        }),
        quoted(1, lines[1] as CartLine, {
          availableQuantity: 0,
          available: false,
          lineTotal: 0,
          issue: 'ITEM_STOCK_INSUFFICIENT',
          remaining: 1,
        }),
      ],
      [
        {
          code: 'ITEM_STOCK_INSUFFICIENT',
          severity: 'ERROR',
          message: 'x',
          field: 'items',
          lineIndex: 0,
        },
        {
          code: 'ITEM_STOCK_INSUFFICIENT',
          severity: 'ERROR',
          message: 'x',
          field: 'items',
          lineIndex: 1,
        },
      ],
    );
    const { byLineId } = deriveLineStatuses({ quote: q, lineIds: ['a', 'b'] }, lines);
    expect(byLineId.get('a')?.issue).toEqual({
      kind: 'INSUFFICIENT',
      requested: 3,
      available: 1,
      remaining: 1,
      groupSize: 2,
      groupRequested: 5,
    });
    expect(byLineId.get('b')?.issue).toMatchObject({
      kind: 'INSUFFICIENT',
      available: 0,
      remaining: 1,
    });
  });

  it('超過單行上限（QUANTITY_EXCEEDED）：可購買份數為單行上限', () => {
    const l = line('a', 'p1', 25);
    const q = quote(
      [
        quoted(0, l, {
          availableQuantity: 20,
          available: false,
          lineTotal: 1000,
          issue: 'QUANTITY_EXCEEDED',
        }),
      ],
      [
        {
          code: 'QUANTITY_EXCEEDED',
          severity: 'ERROR',
          message: 'x',
          field: 'items',
          lineIndex: 0,
        },
      ],
    );
    const { byLineId } = deriveLineStatuses({ quote: q, lineIds: ['a'] }, [l]);
    expect(byLineId.get('a')?.issue).toEqual({ kind: 'EXCEEDED', requested: 25, available: 20 });
  });

  it('單價與購物車快照不同：標示價格更新（不阻擋、不計入有問題的行）', () => {
    const l = line('a', 'p1', 1);
    const q = quote([quoted(0, l, { unitPrice: 55, lineTotal: 55 })]);
    const result = deriveLineStatuses({ quote: q, lineIds: ['a'] }, [l]);
    expect(result.byLineId.get('a')?.price).toEqual({ from: 50, to: 55 });
    expect(result.byLineId.get('a')?.unitPrice).toBe(55);
    expect(result.problemCount).toBe(0);
  });

  it('quote 回報的剩餘份數 ≤ 10：標示「今日剩 n 份」，優先於菜單', () => {
    const l = line('a', 'p1', 1);
    const q = quote([quoted(0, l, { remaining: 4 })]);
    const result = deriveLineStatuses({ quote: q, lineIds: ['a'] }, [l], () => 9);
    expect(result.byLineId.get('a')?.limited).toBe(4);
  });

  it('quote 請求後使用者改了份數：該行不套用過期的狀態（避免作用在已改變的內容）', () => {
    const before = line('a', 'p1', 3);
    const q = quote(
      [
        quoted(0, before, {
          availableQuantity: 1,
          available: false,
          lineTotal: 50,
          issue: 'ITEM_STOCK_INSUFFICIENT',
          remaining: 1,
        }),
      ],
      [
        {
          code: 'ITEM_STOCK_INSUFFICIENT',
          severity: 'ERROR',
          message: 'x',
          field: 'items',
          lineIndex: 0,
        },
      ],
    );
    const changed = { ...before, quantity: 1 };
    const result = deriveLineStatuses({ quote: q, lineIds: ['a'] }, [changed]);
    expect(result.byLineId.get('a')?.issue).toBeUndefined();
    expect(result.problemCount).toBe(0);
  });

  it('已被移除的行與商品不一致者略過，不指到別的品項（R-Y）', () => {
    const l = line('b', 'p9', 1);
    const gone = line('a', 'p1', 1);
    const q = quote(
      [
        quoted(0, gone, {
          available: false,
          availableQuantity: 0,
          lineTotal: 0,
          issue: 'ITEM_SOLD_OUT',
        }),
      ],
      [{ code: 'ITEM_SOLD_OUT', severity: 'ERROR', message: 'x', field: 'items', lineIndex: 0 }],
    );
    // 快照的 lineId 'a' 已不在購物車
    expect(
      deriveLineStatuses({ quote: q, lineIds: ['a'] }, [l]).byLineId.get('b')?.issue,
    ).toBeUndefined();
    // lineId 對得到，但商品不同
    expect(
      deriveLineStatuses({ quote: q, lineIds: ['b'] }, [l]).byLineId.get('b')?.issue,
    ).toBeUndefined();
  });

  it('店家休息 / 暫停不進行狀態，以 storeIssue 回傳', () => {
    const l = line('a', 'p1', 1);
    const q = quote([quoted(0, l)], [{ code: 'STORE_CLOSED', severity: 'ERROR', message: 'x' }]);
    const result = deriveLineStatuses({ quote: q, lineIds: ['a'] }, [l]);
    expect(result.storeIssue).toBe('STORE_CLOSED');
    expect(result.byLineId.get('a')?.issue).toBeUndefined();
  });
});
