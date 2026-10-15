// 異動項 → 清單卡片與「全部套用建議」（CMP-40、FLOW-23、03 §9 文案）
import { describe, expect, it } from 'vitest';
import { deriveCheckoutIssues } from '@/domain/availability';
import type { QuotedLine, QuoteResponse } from '@/domain/types';
import { buildIssueCards, planApplyAll } from '../issueViews';
import type { IssueViewContext, SlotContext } from '../issueViews';
import { COMBO, LUROU, TEA, okQuote, quoteLike } from './fixtures';

const slot: SlotContext = {
  nearest: { startAt: '2026-10-14T17:15:00+08:00', status: 'AVAILABLE' },
  asapAvailable: true,
  scheduledStatus: 'FULL',
  tomorrow: null,
};

const ctx = (over: Partial<IssueViewContext> = {}): IssueViewContext => ({
  cartLines: [LUROU, TEA, COMBO],
  quote: null,
  dayWord: '今日',
  kiosk: false,
  orderType: 'PICKUP',
  scheduledAt: '2026-10-14T17:00:00+08:00',
  slot,
  alternativeOrderType: 'DINE_IN',
  pickupAvailable: true,
  couponCode: '',
  maxLines: 30,
  maxPerItem: 20,
  ...over,
});

function issuesOf(q: QuoteResponse) {
  const lines = [LUROU, TEA, COMBO];
  return deriveCheckoutIssues(
    q,
    lines.map((l) => l.lineId),
    lines,
  ).issues;
}

/** 古早味紅茶售完、雙人分享餐只剩 2 份（已選 3 份）、17:00 時段額滿 */
function threeIssues(): QuoteResponse {
  const base = okQuote([LUROU, TEA, COMBO]);
  const items: QuotedLine[] = base.items.map((i) => {
    if (i.index === 1)
      return { ...i, available: false, availableQuantity: 0, lineTotal: 0, issue: 'ITEM_SOLD_OUT' };
    if (i.index === 2) {
      return {
        ...i,
        available: false,
        availableQuantity: 2,
        lineTotal: 598,
        remaining: 2,
        issue: 'ITEM_STOCK_INSUFFICIENT',
      };
    }
    return i;
  });
  return {
    ...base,
    valid: false,
    items,
    checks: [
      {
        code: 'SLOT_UNAVAILABLE',
        severity: 'ERROR',
        message: '17:00 這個時段已額滿',
        field: 'scheduledAt',
      },
    ],
  };
}

describe('buildIssueCards：文案依錯誤碼與份數組成', () => {
  it('售完、數量不足、時段額滿，依類別順序', () => {
    const cards = buildIssueCards(issuesOf(threeIssues()), ctx());
    expect(cards.map((c) => c.kind)).toEqual(['UNAVAILABLE', 'QUANTITY', 'SLOT']);
    expect(cards[0]).toMatchObject({ heading: '古早味紅茶', body: '今日售完', tone: 'danger' });
    expect(cards[0]?.actions.map((a) => a.label)).toEqual(['移除']);
    expect(cards[1]).toMatchObject({ heading: '雙人分享餐', body: '今日只剩 2 份（已選 3 份）' });
    expect(cards[1]?.actions.map((a) => a.label)).toEqual(['改為 2 份', '移除']);
    expect(cards[1]?.actions[0]?.ariaLabel).toBe('將雙人分享餐改為 2 份');
    expect(cards[2]).toMatchObject({ heading: '取餐時段 17:00', body: '17:00 這個時段已額滿' });
    expect(cards[2]?.actions.map((a) => a.label)).toEqual(['改選 17:15', '選其他時段', '改為盡快']);
  });

  it('送出被退回且該品原本可買：剛剛被訂走了；限量用盡補充說明', () => {
    const q = soldOutRemaining0();
    const lines = [LUROU, TEA, COMBO];
    const previous = okQuote(lines);
    const issues = deriveCheckoutIssues(
      q,
      lines.map((l) => l.lineId),
      lines,
      undefined,
      previous,
    ).issues;
    const card = buildIssueCards(issues, ctx())[0];
    expect(card?.body).toBe('剛剛被訂走了');
    expect(card?.note).toContain('份數可能釋出');
    expect(card?.note).toContain('逾時未付款');
    // 觸控面板不顯示「付款期限」類字樣
    const kiosk = buildIssueCards(issues, ctx({ kiosk: true }))[0];
    expect(kiosk?.note).not.toContain('未付款');
  });

  it('取餐日非今日：「今日」改寫為「明天（M/D）」', () => {
    const cards = buildIssueCards(issuesOf(threeIssues()), ctx({ dayWord: '明天（10/15）' }));
    expect(cards[0]?.body).toBe('明天（10/15）售完');
    expect(cards[1]?.body).toBe('明天（10/15）只剩 2 份（已選 3 份）');
  });

  it('同商品多行：以商品分組，組標題顯示合計，各行顯示自己的建議', () => {
    const a = {
      ...COMBO,
      lineId: 'c1',
      quantity: 2,
      snapshot: { ...COMBO.snapshot, optionLabels: ['滷肉飯'] },
    };
    const b = {
      ...COMBO,
      lineId: 'c2',
      quantity: 2,
      snapshot: { ...COMBO.snapshot, optionLabels: ['雞肉飯'] },
    };
    const base = okQuote([a, b]);
    const q: QuoteResponse = {
      ...base,
      valid: false,
      items: [
        { ...base.items[0]!, availableQuantity: 2, remaining: 3 },
        {
          ...base.items[1]!,
          available: false,
          availableQuantity: 1,
          lineTotal: 299,
          remaining: 3,
          issue: 'ITEM_STOCK_INSUFFICIENT',
        },
      ],
    };
    // 第 0 行配置後仍可購買，第 1 行被縮減；用 availableQuantity < quantity 推導（第 0 行 = quantity）
    const issues = deriveCheckoutIssues(q, ['c1', 'c2'], [a, b]).issues;
    const cards = buildIssueCards(issues, ctx({ cartLines: [a, b] }));
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ heading: '雙人分享餐', body: '合計已選 4 份，今日只剩 3 份' });
    expect(cards[0]?.rows?.map((r) => [r.label, r.body, r.actions.map((x) => x.label)])).toEqual([
      ['滷肉飯', '2 份', []],
      ['雞肉飯', '改為 1 份', ['改為 1 份', '移除']],
    ]);
  });

  it('同商品其他行已用完（配置為 0）：已被同商品其他行占用', () => {
    const base = okQuote([LUROU]);
    const q: QuoteResponse = {
      ...base,
      valid: false,
      items: [
        {
          ...base.items[0]!,
          available: false,
          availableQuantity: 0,
          lineTotal: 0,
          remaining: 1,
          issue: 'ITEM_STOCK_INSUFFICIENT',
        },
      ],
    };
    const issues = deriveCheckoutIssues(q, ['l1'], [LUROU]).issues;
    const card = buildIssueCards(issues, ctx({ cartLines: [LUROU] }))[0];
    expect(card?.body).toBe('已被同商品其他行占用');
    expect(card?.actions.map((a) => a.label)).toEqual(['移除']);
  });

  it('折扣碼類、會員專屬、最低消費、付款 / 發票 / 桌號的落點與動作', () => {
    const q = quoteLike({
      items: okQuote([LUROU]).items,
      subtotal: 67,
      total: 67,
      minOrderShortfall: 33,
      checks: [
        { code: 'COUPON_EXPIRED', severity: 'ERROR', message: 'x', field: 'couponCode' },
        { code: 'LOGIN_REQUIRED', severity: 'ERROR', message: 'x', field: 'couponCode' },
        { code: 'MIN_ORDER_NOT_MET', severity: 'ERROR', message: 'x', field: 'items' },
        {
          code: 'OUT_OF_DELIVERY_AREA',
          severity: 'ERROR',
          message: 'x',
          field: 'delivery.zipCode',
        },
        {
          code: 'PAYMENT_METHOD_NOT_ALLOWED',
          severity: 'ERROR',
          message: 'x',
          field: 'paymentMethod',
        },
        { code: 'INVOICE_INVALID', severity: 'ERROR', message: 'x', field: 'invoice' },
        { code: 'TABLE_NOT_FOUND', severity: 'ERROR', message: 'x', field: 'dineIn.tableNo' },
      ],
    });
    const issues = deriveCheckoutIssues(q, ['l1'], [LUROU]).issues;
    const cards = buildIssueCards(
      issues,
      ctx({ cartLines: [LUROU], quote: q, orderType: 'DELIVERY', couponCode: 'OLD2025' }),
    );
    const byHeading = (h: string) => cards.filter((c) => c.heading === h);
    expect(byHeading('折扣碼')[0]?.body).toBe('這個折扣碼已過期或尚未生效');
    const member = byHeading('折扣碼')[1];
    expect(member?.body).toBe('此折扣碼僅限會員');
    expect(member?.actions.map((a) => a.label)).toEqual(['移除折扣碼', '登入（可略過）']);
    expect(byHeading('餐點')[0]?.body).toBe('還差 NT$ 33 可外送');
    expect(byHeading('餐點')[0]?.actions.map((a) => a.label)).toEqual(['繼續點餐']);
    expect(byHeading('外送地址')[0]?.actions.map((a) => a.label)).toEqual([
      '改為自取',
      '修改外送地址',
    ]);
    expect(byHeading('付款方式')[0]?.actions.map((a) => a.label)).toEqual(['重新選擇付款方式']);
    expect(byHeading('發票')[0]?.actions.map((a) => a.label)).toEqual(['修正發票資料']);
    expect(byHeading('桌號')[0]?.actions.map((a) => a.label)).toEqual(['確認桌號']);
    expect(cards.every((c) => c.blocking)).toBe(true);
  });

  it('價格更新不阻擋，固定排在最後', () => {
    const q = okQuote([LUROU, TEA]);
    const changed = {
      ...q,
      items: q.items.map((i) => (i.index === 0 ? { ...i, unitPrice: 72, lineTotal: 72 } : i)),
      subtotal: 97,
      total: 97,
    };
    const issues = deriveCheckoutIssues(changed, ['l1', 'l2'], [LUROU, TEA]).issues;
    const cards = buildIssueCards(issues, ctx({ cartLines: [LUROU, TEA] }));
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      kind: 'PRICE',
      blocking: false,
      body: '價格已更新：NT$ 67 → NT$ 72',
    });
  });
});

describe('planApplyAll', () => {
  it('無法購買者移除、數量不足者改量、時段改選最近時段；折扣與價格更新不在其中', () => {
    const issues = issuesOf(threeIssues());
    const plan = planApplyAll(issues, slot);
    expect(plan.fits).toEqual([
      { lineId: 'l2', quantity: 0 },
      { lineId: 'l3', quantity: 2 },
    ]);
    expect(plan.slot?.startAt).toBe('2026-10-14T17:15:00+08:00');
    expect(plan.summary).toBe('移除 1 項、1 項改為 2 份、時段改為 17:15');
    expect(plan.count).toBe(3);
  });

  it('沒有可自動處理的項目時 count 為 0', () => {
    expect(planApplyAll([], slot).count).toBe(0);
  });
});

function soldOutRemaining0(): QuoteResponse {
  const base = okQuote([LUROU, TEA, COMBO]);
  return {
    ...base,
    valid: false,
    items: base.items.map((i) =>
      i.index === 1
        ? {
            ...i,
            available: false,
            availableQuantity: 0,
            lineTotal: 0,
            remaining: 0,
            issue: 'ITEM_SOLD_OUT' as const,
          }
        : i,
    ),
  };
}
