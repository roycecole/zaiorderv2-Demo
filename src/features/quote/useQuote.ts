// src/features/quote/useQuote.ts —— 報價查詢（購物車頁與結帳頁共用；07 §7.1「報價」列）
//
// 策略：staleTime 0；內容變動時 250ms debounce 並取消舊請求；視窗取得焦點重打；不輪詢；
// 回應與「請求當下的 lineId 快照」一併保存，供 deriveCheckoutIssues 以 lineId 對應目前購物車（避免套到之後已變動的購物車）。
// 逾時或 5xx 不阻擋送出（POST /orders 完整重驗，BR-39），故 retry 只重試一次且錯誤交由呼叫端降級。
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { CartLine } from '@/domain/cart';
import type { ISODateTime, OrderType, QuoteRequest, QuoteResponse } from '@/domain/types';
import { useApi } from '@/hooks/useApi';
import { qk } from '@/services/api/queryKeys';

export const QUOTE_DEBOUNCE_MS = 250;

export interface QuoteInput {
  orderType: OrderType;
  lines: ReadonlyArray<Pick<CartLine, 'lineId' | 'productId' | 'quantity' | 'optionIds' | 'note'>>;
  /** null = 盡快 */
  scheduledAt: ISODateTime | null;
  /** DELIVERY 必填 */
  zipCode?: string;
  couponCode?: string;
  /** 例如結帳頁尚未選好外送區時為 false */
  enabled?: boolean;
}

export interface QuoteResult {
  quote: QuoteResponse;
  /** 該次請求當時各行的 lineId（與 quote.items 以 index 對應） */
  lineIds: string[];
}

export function toQuoteRequest(i: QuoteInput): QuoteRequest {
  const req: QuoteRequest = {
    orderType: i.orderType,
    items: i.lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      optionIds: [...l.optionIds],
      ...(l.note !== undefined && l.note.trim() !== '' ? { note: l.note.trim() } : {}),
    })),
    scheduledAt: i.scheduledAt,
  };
  if (i.orderType === 'DELIVERY' && i.zipCode) req.zipCode = i.zipCode;
  if (i.couponCode) req.couponCode = i.couponCode;
  return req;
}

/**
 * 回傳 TanStack Query 結果（`data` 為 `{ quote, lineIds }`）。
 * `isStale` 表示目前輸入尚未取得對應報價（debounce 中或重新計價中）；此時 `data` 仍保留上一份供畫面沿用。
 */
export function useQuote(input: QuoteInput) {
  const api = useApi();
  const lineIds = useMemo(() => input.lines.map((l) => l.lineId), [input.lines]);
  const request = useMemo(() => toQuoteRequest(input), [input]);
  // lineId 一併納入鍵：同內容但不同行（刪除後重加）的快取不可混用 lineIds
  const key = JSON.stringify({ request, lineIds });

  const [debouncedKey, setDebouncedKey] = useState(key);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKey(key), QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key]);

  const enabled = (input.enabled ?? true) && input.lines.length > 0;
  const query = useQuery<QuoteResult>({
    queryKey: qk.quote(debouncedKey),
    queryFn: async () => {
      const snapshot = JSON.parse(debouncedKey) as { request: QuoteRequest; lineIds: string[] };
      const quote = await api.orders.quote(snapshot.request);
      return { quote, lineIds: snapshot.lineIds };
    },
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    retry: 1,
  });

  return { ...query, isStale: enabled && debouncedKey !== key, request };
}
