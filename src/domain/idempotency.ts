// src/domain/idempotency.ts
import type { CreateOrderRequest, OrderLineInput, OrderStatus } from './types';

// ───────── 請求指紋（06 §1.4、BR-27） ─────────

/** 以鍵排序的穩定 JSON：略過 undefined，陣列保留順序 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function normalizeLine(l: OrderLineInput): OrderLineInput {
  const note = l.note?.trim();
  const line: OrderLineInput = {
    productId: l.productId,
    quantity: l.quantity,
    optionIds: [...l.optionIds].sort(),
  };
  if (note) line.note = note;
  return line;
}

/**
 * 正規化後的請求內容：每行 optionIds 排序、note 去前後空白（空白視同未填）、移除 expectedTotal。
 * items 順序保留（順序決定同商品多行的配置，BR-40）。欄位順序無關。
 */
export function canonicalRequest(req: CreateOrderRequest): string {
  const { expectedTotal: _omit, ...rest } = req;
  return stableJson({ ...rest, items: req.items.map(normalizeLine) });
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 後備雜湊（8 輪種子不同的 FNV-1a，64 碼 hex）：不具密碼學強度，只用於 Mock 比對「內容是否相同」。
 * crypto.subtle 只在安全環境（https 或 localhost）可用；以區網 IP 的 http 預覽（08 §1）時改走此路徑。
 */
export function fallbackFingerprint(req: CreateOrderRequest): string {
  const text = canonicalRequest(req);
  let out = '';
  for (let seed = 0; seed < 8; seed++) {
    let h = (0x811c9dc5 ^ Math.imul(seed + 1, 0x9e3779b1)) >>> 0;
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, '0');
  }
  return out;
}

/**
 * SHA-256（hex，64 碼）：與 05 的 orders.idempotency_request_hash 同格式；於 Mock 臨界區之外計算。
 * crypto.subtle 不可用（非安全環境）時改用 fallbackFingerprint：格式相同，Mock 只比對同一環境內計算的值。
 */
export async function requestFingerprint(req: CreateOrderRequest): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) return fallbackFingerprint(req);
  const bytes = new TextEncoder().encode(canonicalRequest(req));
  return toHex(await subtle.digest('SHA-256', bytes));
}

/** 兩次送出內容是否相同（忽略 expectedTotal 與欄位順序） */
export function isSameContent(a: CreateOrderRequest, b: CreateOrderRequest): boolean {
  return canonicalRequest(a) === canonicalRequest(b);
}

/**
 * 被重放的訂單內容是否與目前購物車一致（BR-41）：以 productId + 排序後選項 + 備註為鍵比對份數，與順序無關。
 * 只比對品項；訂單層級欄位（訂單備註、時段、付款方式）不參與（FLOW-24）。replayedItems 取被重放的那次請求的 items
 * （記下的送出內容或當次送出內容），不是 Order.items（其選項只有名稱快照、沒有 optionId，productId 也可能為 null）。
 * 一致才清除購物車；不一致則保留並提示，避免清掉顧客剛改好的內容。
 */
export function cartMatchesOrder(
  replayedItems: ReadonlyArray<OrderLineInput>,
  cartItems: ReadonlyArray<OrderLineInput>,
): boolean {
  const tally = (items: ReadonlyArray<OrderLineInput>): Map<string, number> => {
    const m = new Map<string, number>();
    for (const l of items) {
      const n = normalizeLine(l);
      const key = stableJson({ p: n.productId, o: n.optionIds, n: n.note ?? '' });
      m.set(key, (m.get(key) ?? 0) + n.quantity);
    }
    return m;
  };
  const a = tally(replayedItems);
  const b = tally(cartItems);
  if (a.size !== b.size) return false;
  for (const [k, q] of a) if (b.get(k) !== q) return false;
  return true;
}

// ───────── Key 生命週期（BR-41、FLOW-24；存於 checkoutDraft） ─────────

export interface CheckoutKeyState {
  /** 首次按下送出時產生；到 2xx 才作廢 */
  idempotencyKey: string | null;
  /** 結果未知時記下的送出內容（依送出順序，相同內容只記一次）；含個資，與草稿同敏感度 */
  unknownBodies: CreateOrderRequest[];
}

/** 初始與作廢後的狀態；觸控面板閒置重置時整份回到此值（丟棄 Key 與記下的送出內容，FLOW-21） */
export const EMPTY_KEY_STATE: CheckoutKeyState = { idempotencyKey: null, unknownBodies: [] };

/** 首次送出才產生 Key；422、PRICE_CHANGED、400 與結果未知後再送一律沿用 */
export function ensureKey(state: CheckoutKeyState, makeKey: () => string): CheckoutKeyState {
  return state.idempotencyKey === null ? { ...state, idempotencyKey: makeKey() } : state;
}

export type SubmitResult =
  /** 201 且非重放 */
  | { type: 'CREATED' }
  /**
   * 201 且 replayed = true（含 IDEMPOTENCY_CONFLICT 後以同 Key 重放取回）。
   * sameAsCart：被重放的那次請求內容（不是 Order.items）是否與目前購物車一致；
   * orderStatus：取回的原訂單目前狀態（可為 CANCELLED，回應前已先 expireIfDue）
   */
  | { type: 'REPLAYED'; sameAsCart: boolean; orderStatus: OrderStatus }
  /** 確定未建立：422、409 PRICE_CHANGED、400 */
  | { type: 'REJECTED' }
  /** 確定未建立且需稍後重送：429，或附 retryAfterSeconds 的 503（建單鎖等待逾時）；不記下送出內容（FLOW-24） */
  | { type: 'NOT_CREATED' }
  /** 無回應、逾時、5xx（含未附 retryAfterSeconds 的 503，例如維護、閘道，或 Mock 的 failNext BEFORE） */
  | { type: 'UNKNOWN' }
  /** 409 IDEMPOTENCY_CONFLICT：先前某次未知的送出其實已成立 */
  | { type: 'CONFLICT' };

/**
 * 沒有 2xx 回應時的結果判別（FLOW-24）；status = 0 代表無回應、逾時或斷線。
 * 503 以「是否附 retryAfterSeconds」區分「確定未建立」與「結果未知」（06 §3.2）。
 */
export function classifyFailedSubmit(f: {
  status: number;
  code?: string;
  retryAfterSeconds?: number;
}): Exclude<SubmitResult['type'], 'CREATED' | 'REPLAYED'> {
  if (f.status === 409 && f.code === 'IDEMPOTENCY_CONFLICT') return 'CONFLICT';
  if (f.status === 429) return 'NOT_CREATED';
  if (f.status === 503 && typeof f.retryAfterSeconds === 'number') return 'NOT_CREATED';
  if (f.status >= 400 && f.status < 500) return 'REJECTED';
  return 'UNKNOWN';
}

export interface KeyTransition {
  state: CheckoutKeyState;
  /** 是否清除購物車：201 非重放一律清除；重放僅在原訂單未取消且內容一致時清除（BR-41） */
  clearCart: boolean;
  /**
   * CONFLICT 時依序以同一把 Key 重放的內容（先前未知的送出內容，依送出順序）；
   * 為空代表無從取回，改走「結果未知」（再試一次、致電店家確認）。不得換新 Key。
   */
  replay: CreateOrderRequest[];
}

/** 一次送出得到結果後的 Key 與草稿狀態轉換（純函式；不含導向與通報） */
export function afterSubmit(
  state: CheckoutKeyState,
  body: CreateOrderRequest,
  result: SubmitResult,
): KeyTransition {
  switch (result.type) {
    case 'CREATED':
      return { state: EMPTY_KEY_STATE, clearCart: true, replay: [] };
    case 'REPLAYED':
      return {
        state: EMPTY_KEY_STATE,
        clearCart: result.sameAsCart && result.orderStatus !== 'CANCELLED',
        replay: [],
      };
    case 'REJECTED':
    case 'NOT_CREATED':
      return { state, clearCart: false, replay: [] };
    case 'UNKNOWN': {
      const known = state.unknownBodies.some((b) => isSameContent(b, body));
      return {
        state: known ? state : { ...state, unknownBodies: [...state.unknownBodies, body] },
        clearCart: false,
        replay: [],
      };
    }
    case 'CONFLICT':
      return { state, clearCart: false, replay: [...state.unknownBodies] };
  }
}
