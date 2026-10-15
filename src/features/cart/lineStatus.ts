// src/features/cart/lineStatus.ts —— 購物車逐行的可購買狀態（FR-CT-05、CMP-17；PG-03「品項狀態」）
//
// 進入購物車時以 quote 背景預檢，結果只「標示」並提供就地動作，不阻擋前往結帳（阻擋與異動清單由結帳頁負責）。
// 與結帳頁共用 domain 的 deriveCheckoutIssues：以 quote 請求當時的 lineId 快照對應目前購物車行（R-Y）。
import { deriveCheckoutIssues, disclosedRemaining } from '@/domain/availability';
import type { StoreIssue } from '@/domain/availability';
import type { CartLine } from '@/domain/cart';
import type { ID, QuoteResponse } from '@/domain/types';

export type UnavailableCode =
  'ITEM_UNLISTED' | 'ITEM_SOLD_OUT' | 'OPTION_UNAVAILABLE' | 'OPTION_INVALID';

export type BlockingIssue =
  /** 無法購買：下架、售完、選項失效（動作：移除；選項類另有「重新選擇」） */
  | { kind: 'UNAVAILABLE'; code: UnavailableCode }
  /**
   * 數量不足（ITEM_STOCK_INSUFFICIENT）：available 為這一行最多可購買份數；
   * available = 0 代表剩餘份數已被同商品其他行占用（BR-40）。
   * groupSize / groupRequested 為同商品在購物車內的行數與合計份數（多行時顯示「合計已選 m 份」）。
   */
  | {
      kind: 'INSUFFICIENT';
      requested: number;
      available: number;
      remaining: number | null;
      groupSize: number;
      groupRequested: number;
    }
  /** 超過單行上限（QUANTITY_EXCEEDED） */
  | { kind: 'EXCEEDED'; requested: number; available: number };

export interface LineStatus {
  issue?: BlockingIssue;
  /** 單價與購物車快照不同（不阻擋，由結帳確認） */
  price?: { from: number; to: number };
  /** 剩餘份數 ≤ 10 時的「今日剩 n 份」（只在沒有阻擋原因時才有意義） */
  limited?: number;
  /** quote 的現價；不可購買的行省略 */
  unitPrice?: number;
  /** 取餐營業日的商品層級剩餘份數；null = 不限量；省略 = 未提供 */
  remaining?: number | null;
}

export interface CartAvailability {
  byLineId: ReadonlyMap<string, LineStatus>;
  /** 店家休息 / 暫停（不進行狀態；呼叫端顯示說明） */
  storeIssue: StoreIssue | null;
  /** 有幾行無法依原內容成立（供摘要文字） */
  problemCount: number;
}

export interface QuotePair {
  quote: QuoteResponse;
  lineIds: ReadonlyArray<string>;
}

const UNAVAILABLE: ReadonlySet<string> = new Set<UnavailableCode>([
  'ITEM_UNLISTED',
  'ITEM_SOLD_OUT',
  'OPTION_UNAVAILABLE',
  'OPTION_INVALID',
]);

/**
 * @param data quote 與其 lineId 快照；尚未取得時傳 undefined（只依 fallbackRemaining 標示「今日剩 n 份」）
 * @param lines 目前購物車
 * @param fallbackRemaining 菜單提供的 remainingToday（quote 尚未回來時使用）
 */
export function deriveLineStatuses(
  data: QuotePair | undefined,
  lines: ReadonlyArray<CartLine>,
  fallbackRemaining?: (productId: ID) => number | null | undefined,
): CartAvailability {
  const byLineId = new Map<string, LineStatus>();
  const statusOf = (lineId: string): LineStatus => {
    let s = byLineId.get(lineId);
    if (s === undefined) {
      s = {};
      byLineId.set(lineId, s);
    }
    return s;
  };

  let storeIssue: StoreIssue | null = null;
  let problemCount = 0;

  if (data !== undefined) {
    const { quote, lineIds } = data;
    const byId = new Map(lines.map((l) => [l.lineId, l]));
    const groupOf = (productId: ID): { size: number; requested: number } => {
      const same = lines.filter((l) => l.productId === productId);
      return { size: same.length, requested: same.reduce((n, l) => n + l.quantity, 0) };
    };

    // 現價與剩餘份數：只掛在「快照的 lineId 仍在購物車、商品與份數一致」的行上；
    // 使用者剛改過的行在新 quote 回來前不顯示過期的狀態（避免「改為 n 份」作用在已改變的內容）
    const trusted = new Set<string>();
    for (const item of quote.items) {
      const lineId = lineIds[item.index];
      const line = lineId === undefined ? undefined : byId.get(lineId);
      if (line === undefined || line.productId !== item.productId) continue;
      if (line.quantity !== item.quantity) continue;
      trusted.add(line.lineId);
      const s = statusOf(line.lineId);
      if (item.availableQuantity > 0) s.unitPrice = item.unitPrice;
      if (item.remaining !== undefined) s.remaining = item.remaining;
    }

    const result = deriveCheckoutIssues(quote, lineIds, lines);
    storeIssue = result.storeIssue;
    for (const issue of result.issues) {
      if (issue.lineId === undefined || !trusted.has(issue.lineId)) continue;
      const line = byId.get(issue.lineId);
      if (line === undefined) continue;
      const s = statusOf(issue.lineId);
      if (issue.kind === 'PRICE') {
        if (issue.from !== undefined && issue.to !== undefined)
          s.price = { from: issue.from, to: issue.to };
        continue;
      }
      if (s.issue !== undefined) continue; // 一行只標示優先序最高者
      if (issue.kind === 'UNAVAILABLE' && UNAVAILABLE.has(issue.code)) {
        s.issue = { kind: 'UNAVAILABLE', code: issue.code as UnavailableCode };
      } else if (issue.kind === 'QUANTITY') {
        const available = issue.availableQuantity ?? 0;
        const requested = issue.requestedQuantity ?? line.quantity;
        if (issue.code === 'QUANTITY_EXCEEDED') {
          s.issue = { kind: 'EXCEEDED', requested, available };
        } else {
          const group = groupOf(line.productId);
          s.issue = {
            kind: 'INSUFFICIENT',
            requested,
            available,
            remaining: issue.remaining ?? s.remaining ?? null,
            groupSize: group.size,
            groupRequested: group.requested,
          };
        }
      }
    }
  }

  for (const line of lines) {
    const s = statusOf(line.lineId);
    if (s.issue !== undefined) {
      problemCount += 1;
      continue;
    }
    const remaining = s.remaining !== undefined ? s.remaining : fallbackRemaining?.(line.productId);
    const limited = disclosedRemaining(remaining);
    if (limited !== null) s.limited = limited;
  }

  return { byLineId, storeIssue, problemCount };
}
