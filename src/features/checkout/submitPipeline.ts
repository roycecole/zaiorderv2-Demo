// src/features/checkout/submitPipeline.ts —— 送出訂單管線（FLOW-22、FLOW-24；BR-27、BR-41）
//
// 純非同步函式（不含 React、導向與通報）：依 domain/idempotency 的 ensureKey / classifyFailedSubmit / afterSubmit
// 完成「產生 Key → POST /orders → 判別結果 → 狀態轉換」，並處理 409 IDEMPOTENCY_CONFLICT 的重放取回：
// 不得換新 Key，改以同一把 Key 依序重放先前記下的內容。
import {
  afterSubmit,
  cartMatchesOrder,
  classifyFailedSubmit,
  ensureKey,
} from '@/domain/idempotency';
import type { CheckoutKeyState, SubmitResult } from '@/domain/idempotency';
import type {
  ApiErrorDetail,
  CreateOrderRequest,
  CreateOrderResponse,
  ErrorCode,
  OrderLineInput,
  QuoteResponse,
} from '@/domain/types';
import type { ApiClient } from '@/services/api/ApiClient';

/** 無回應、逾時、5xx 的統一表示（status = 0 代表無回應） */
export interface SubmitFailure {
  status: number;
  code: ErrorCode | undefined;
  message: string;
  retryAfterSeconds: number | undefined;
  quote: QuoteResponse | undefined;
  details: ApiErrorDetail[] | undefined;
  requestId: string | undefined;
}

/**
 * 把任何被擲出的值轉成 SubmitFailure。features 不得依賴 http 層的 ApiError，因此以結構判斷：
 * 具數字 `status` 者視為 API 錯誤，其餘（TypeError、AbortError…）一律視為無回應。
 */
export function toSubmitFailure(error: unknown): SubmitFailure {
  if (typeof error === 'object' && error !== null) {
    const e = error as {
      status?: unknown;
      code?: unknown;
      message?: unknown;
      body?: {
        retryAfterSeconds?: unknown;
        quote?: QuoteResponse;
        details?: ApiErrorDetail[];
        requestId?: unknown;
      };
    };
    if (typeof e.status === 'number') {
      return {
        status: e.status,
        code: typeof e.code === 'string' ? (e.code as ErrorCode) : undefined,
        message: typeof e.message === 'string' ? e.message : '',
        retryAfterSeconds:
          typeof e.body?.retryAfterSeconds === 'number' ? e.body.retryAfterSeconds : undefined,
        quote: e.body?.quote,
        details: e.body?.details,
        requestId: typeof e.body?.requestId === 'string' ? e.body.requestId : undefined,
      };
    }
  }
  return {
    status: 0,
    code: undefined,
    message: '',
    retryAfterSeconds: undefined,
    quote: undefined,
    details: undefined,
    requestId: undefined,
  };
}

export type SubmitOutcome =
  /** 201 且非重放 */
  | {
      kind: 'CREATED';
      response: CreateOrderResponse;
      keyState: CheckoutKeyState;
      body: CreateOrderRequest;
    }
  /** 201 且 replayed = true（含 IDEMPOTENCY_CONFLICT 後以同 Key 重放取回） */
  | {
      kind: 'REPLAYED';
      response: CreateOrderResponse;
      keyState: CheckoutKeyState;
      /** 被重放的那次請求內容（不是 Order.items） */
      body: CreateOrderRequest;
      sameAsCart: boolean;
      clearCart: boolean;
      cancelled: boolean;
    }
  /** 確定未建立：422、409 PRICE_CHANGED、400 與其他 4xx */
  | {
      kind: 'REJECTED';
      failure: SubmitFailure;
      keyState: CheckoutKeyState;
      body: CreateOrderRequest;
    }
  /** 確定未建立且需稍後重送：429，或附 retryAfterSeconds 的 503；不記下送出內容 */
  | {
      kind: 'NOT_CREATED';
      failure: SubmitFailure;
      retryAfterSeconds: number;
      keyState: CheckoutKeyState;
      body: CreateOrderRequest;
    }
  /** 結果未知：無回應、逾時、其他 5xx（含未附 retryAfterSeconds 的 503），或重放無從取回 */
  | {
      kind: 'UNKNOWN';
      failure: SubmitFailure;
      keyState: CheckoutKeyState;
      body: CreateOrderRequest;
    };

export interface SubmitPorts {
  api: Pick<ApiClient, 'orders'>;
  makeKey: () => string;
  /** 回應回來「當下」的購物車品項（購物車可能在等待期間變動） */
  getCartItems: () => ReadonlyArray<OrderLineInput>;
  /** Key 產生後、送出前通知：呼叫端立即寫入草稿，重新整理後仍可沿用同一把 */
  onKeyReady?: (state: CheckoutKeyState) => void;
}

/** 重放時最多嘗試的記下內容數（避免異常資料造成大量請求） */
const MAX_REPLAYS = 5;

function replayed(
  response: CreateOrderResponse,
  keyState: CheckoutKeyState,
  body: CreateOrderRequest,
  cartItems: ReadonlyArray<OrderLineInput>,
): SubmitOutcome {
  const result: SubmitResult = {
    type: 'REPLAYED',
    sameAsCart: cartMatchesOrder(body.items, cartItems),
    orderStatus: response.order.status,
  };
  const t = afterSubmit(keyState, body, result);
  return {
    kind: 'REPLAYED',
    response,
    keyState: t.state,
    body,
    sameAsCart: result.sameAsCart,
    clearCart: t.clearCart,
    cancelled: response.order.status === 'CANCELLED',
  };
}

/**
 * 以同一把 Key 送出（或重送）一次訂單，回傳判別後的結果與轉換後的 Key 狀態。
 * - Key 首次送出才產生（ensureKey）並經 onKeyReady 通知；之後一律沿用，到 2xx 才作廢（回傳 EMPTY 狀態）。
 * - 409 IDEMPOTENCY_CONFLICT：依序以同 Key 重放記下的內容；取回成功視為 REPLAYED；全部失敗或無內容可重放則為 UNKNOWN。
 */
export async function submitOrder(
  ports: SubmitPorts,
  body: CreateOrderRequest,
  current: CheckoutKeyState,
): Promise<SubmitOutcome> {
  const keyState = ensureKey(current, ports.makeKey);
  const key = keyState.idempotencyKey;
  if (key === null) throw new Error('Idempotency-Key 產生失敗');
  if (keyState !== current) ports.onKeyReady?.(keyState);

  try {
    const response = await ports.api.orders.create(body, key);
    if (response.replayed === true) return replayed(response, keyState, body, ports.getCartItems());
    const t = afterSubmit(keyState, body, { type: 'CREATED' });
    return { kind: 'CREATED', response, keyState: t.state, body };
  } catch (error) {
    const failure = toSubmitFailure(error);
    const type = classifyFailedSubmit({
      status: failure.status,
      ...(failure.code !== undefined ? { code: failure.code } : {}),
      ...(failure.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: failure.retryAfterSeconds }
        : {}),
    });

    if (type === 'CONFLICT') {
      const transition = afterSubmit(keyState, body, { type: 'CONFLICT' });
      const state = transition.state;
      for (const candidate of transition.replay.slice(0, MAX_REPLAYS)) {
        try {
          const response = await ports.api.orders.create(candidate, key);
          if (response.replayed === true) {
            return replayed(response, state, candidate, ports.getCartItems());
          }
          // 以同 Key 取得非重放的 201：內容正好成立（不應發生；視為建立成功）
          const t = afterSubmit(state, candidate, { type: 'CREATED' });
          return { kind: 'CREATED', response, keyState: t.state, body: candidate };
        } catch (replayError) {
          const f = toSubmitFailure(replayError);
          const again = classifyFailedSubmit({
            status: f.status,
            ...(f.code !== undefined ? { code: f.code } : {}),
            ...(f.retryAfterSeconds !== undefined
              ? { retryAfterSeconds: f.retryAfterSeconds }
              : {}),
          });
          // 內容不同（再次 409）：換下一個記下的內容；其餘失敗（網路、5xx）改為結果未知。
          // 此次的 body 已確定未建立（409），不記入 unknownBodies
          if (again === 'CONFLICT') continue;
          return { kind: 'UNKNOWN', failure: f, keyState: state, body };
        }
      }
      // replay 為空或全部內容不符：無從取回，改走「結果未知」（再試一次、致電店家確認）；不換新 Key
      return { kind: 'UNKNOWN', failure, keyState: state, body };
    }

    if (type === 'NOT_CREATED') {
      const t = afterSubmit(keyState, body, { type: 'NOT_CREATED' });
      return {
        kind: 'NOT_CREATED',
        failure,
        retryAfterSeconds: Math.max(1, Math.ceil(failure.retryAfterSeconds ?? 5)),
        keyState: t.state,
        body,
      };
    }

    if (type === 'REJECTED') {
      const t = afterSubmit(keyState, body, { type: 'REJECTED' });
      return { kind: 'REJECTED', failure, keyState: t.state, body };
    }

    const t = afterSubmit(keyState, body, { type: 'UNKNOWN' });
    return { kind: 'UNKNOWN', failure, keyState: t.state, body };
  }
}
