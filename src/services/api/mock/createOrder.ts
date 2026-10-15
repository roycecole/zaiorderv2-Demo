// src/services/api/mock/createOrder.ts
import type {
  CreateOrderRequest, CreateOrderResponse, ErrorCode, QuoteResponse,
} from '@/domain/types';

export type FailPhase = 'BEFORE' | 'AFTER_COMMIT';

/** 單次驗證結果：與 quote 同一份（evaluateOrder 為單一實作） */
export interface Evaluation {
  quote: QuoteResponse;
  /** 依 06 §3.2 優先序取最高者；沒有業務 ERROR 時為 null */
  topError: ErrorCode | null;
}

/** 已綁定 Idempotency-Key 的訂單 */
export interface KeyBinding {
  /** 綁定當時的請求指紋；舊資料缺值（null）視為內容相同，避免誤報衝突 */
  fingerprint: string | null;
  /** 原訂單「目前狀態」的重放回應：replayed = true、重新簽發 trackingToken；不重驗、不重複計入 */
  replay(): CreateOrderResponse;
}

/** Mock 的狀態與副作用，由 createMockClient 注入；管線本身不碰 I/O，順序規則可獨立測試 */
export interface CreateOrderPorts {
  simulateLatency(): Promise<void>;
  /** 命中 DemoState.failNext：BEFORE 丟 503（不附 retryAfterSeconds；請求未處理，前端依 FLOW-24 判別為結果未知）；AFTER_COMMIT 丟網路層錯誤（訂單已建立、回應遺失） */
  failIfInjected(phase: FailPhase): void;
  fingerprint(req: CreateOrderRequest): Promise<string>;
  /** 臨界區（Web Locks）：fn 內不得 await */
  withDbLock<T>(fn: () => T): Promise<T>;
  /** 重讀 db，取得其他分頁寫入的訂單 */
  reload(): void;
  /** 逾時先結算（05 §6.3）：付款與接單逾時的狀態轉換與後處理（FLOW-14 的 T → X）在同一臨界區內完成；先於查 Key，重放回應因此以結算後狀態計算 */
  settleExpired(): void;
  findByKey(key: string): KeyBinding | null;
  /** 套用 raceOnNextCreate：他人先買走、時段補滿、設為售完（一次性） */
  applyRace(): void;
  /** 與 quote 同一份驗證；loadWorld 於此合成 DemoState 的售完、調價與限量覆寫 */
  evaluate(req: CreateOrderRequest): Evaluation;
  /**
   * 同步寫入 orders、items、options、logs，綁定 Key 與指紋，並取得 pickup_no；
   * payments 只寫現金單的 PENDING 現金交易，線上付款交易不在建單時建立（由 orders.pay 於鎖外建立，05 §6.3 ⑧、FLOW-22 步驟 9）
   */
  commit(req: CreateOrderRequest, key: string, fingerprint: string, ev: Evaluation): CreateOrderResponse;
  /** 同步寫回 localStorage（db 不使用 debounce）；鎖內任何路徑結束前都會呼叫（含被拒與重放） */
  flush(): void;
  /** 丟出 422（業務錯誤）或 409 PRICE_CHANGED，error.quote 為最新報價；不寫入 */
  reject(status: 409 | 422, code: ErrorCode, quote: QuoteResponse): never;
  /** 丟出 409 IDEMPOTENCY_CONFLICT */
  conflict(): never;
}

/** orders.create 的 Mock 管線（FLOW-22 的 Mock 臨界區）：步驟順序即契約 */
export async function createOrder(
  ports: CreateOrderPorts,
  req: CreateOrderRequest,
  key: string,
): Promise<CreateOrderResponse> {
  await ports.simulateLatency(); // 延遲在臨界區之外
  ports.failIfInjected('BEFORE'); // 請求未被處理：不進臨界區、不消耗預備情境
  const fingerprint = await ports.fingerprint(req); // 雜湊在臨界區之外

  const result = await ports.withDbLock((): { done: CreateOrderResponse; created: boolean } => {
    // ── 臨界區：內部不得 await ──
    ports.reload();
    try {
      ports.settleExpired();

      const bound = ports.findByKey(key);
      if (bound !== null) {
        if (bound.fingerprint !== null && bound.fingerprint !== fingerprint) return ports.conflict();
        return { done: bound.replay(), created: false }; // 重放：不重驗、不套用預備情境
      }

      ports.applyRace();
      const ev = ports.evaluate(req);
      if (ev.topError !== null) return ports.reject(422, ev.topError, ev.quote);
      if (req.expectedTotal !== ev.quote.total) return ports.reject(409, 'PRICE_CHANGED', ev.quote);

      return { done: ports.commit(req, key, fingerprint, ev), created: true };
    } finally {
      ports.flush(); // 鎖內的寫入（逾時結算、他人訂單、本單）一律在釋放鎖之前同步寫回
    }
  });

  if (result.created) ports.failIfInjected('AFTER_COMMIT'); // 訂單已建立，回應遺失
  return result.done;
}
