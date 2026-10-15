// src/services/api/mock/settle.ts
import type { OrderStatus } from '@/domain/types';

export type ExpiryReason = 'PAYMENT_TIMEOUT' | 'ACCEPT_TIMEOUT';

export interface SettleCandidate {
  id: string;
  status: OrderStatus;
  /** payment.expiresAt（epoch ms）；僅 PENDING_PAYMENT 有值 */
  paymentExpiresAtMs: number | null;
  /**
   * acceptDeadlineMs（domain/timeouts.ts，BR-17，自 pending_at 起算）；只對 PENDING 有意義，且 PENDING 必有值：
   * pending_at 於建單（現金）、付款成功與改用現金時寫入，05 §5.4 以 CHECK 擋下缺值
   */
  acceptDeadlineMs: number | null;
  /**
   * 自動模擬開啟時，模擬器接單的時點（simulator.autoAcceptAtMs：pending_at + 5 秒 ÷ 速度）；自動模擬關閉為 null（R-V）。
   * 非 null 且不晚於接單期限時，惰性推進必須先以 min(now, 接單期限) 為時間點補寫 ACCEPTED（時間戳取此值）再判斷逾時，
   * 該單不會被判接單逾時（FLOW-14 的 S；自動模擬關閉才走接單逾時判斷 TA）
   */
  autoAcceptAtMs: number | null;
}

/**
 * 訂單此刻是否已逾時。半開區間，與 countsTowardStock 一致：付款期限當下即逾時（付款 / 改現金一律 409）。
 * 付款逾時不受「自動模擬」開關影響；接單逾時只在自動模擬關閉、店家端未接單時發生：
 * 自動模擬開啟時 pending_at + 5 秒即接單，早於（或同時於）任何接單期限，因此離頁、分頁被背景節流或時間穿梭快轉
 * 超過期限之後才讀取，仍由模擬器補寫 ACCEPTED 與其後的轉換，不會被判逾時（FLOW-14）。
 * settleExpiredOrders 對每筆命中者做條件式轉 CANCELLED（cancelled_by = SYSTEM，cancel_reason 於同一次寫入），
 * 並在同一個臨界區（等同後端的同一交易）內完成與 FLOW-14 的 T → X 相同的後處理
 * （作廢進行中交易、返還優惠券、狀態紀錄、必要時進入 REFUNDING），不存在「稍後補做」；
 * 影響 0 列即視為已處理，因此可重複呼叫（冪等）。僅在寫入路徑（建單、取消、付款、GET /orders/{id}）呼叫；
 * 唯讀路徑（菜單、商品、時段、quote、訂單列表）不結算，只以 countsTowardStock 排除逾期的待付款單。
 */
export function expiryOf(o: SettleCandidate, nowMs: number): ExpiryReason | null {
  if (o.status === 'PENDING_PAYMENT' && o.paymentExpiresAtMs !== null && o.paymentExpiresAtMs <= nowMs) {
    return 'PAYMENT_TIMEOUT';
  }
  if (o.status === 'PENDING' && o.acceptDeadlineMs !== null && o.acceptDeadlineMs <= nowMs) {
    // 自動模擬開啟：模擬器已在期限前（或同時）接單，補寫 ACCEPTED 之後不再是 PENDING
    if (o.autoAcceptAtMs !== null && o.autoAcceptAtMs <= o.acceptDeadlineMs) return null;
    return 'ACCEPT_TIMEOUT';
  }
  return null;
}

/**
 * 寫入路徑（鎖內）要結算的訂單：付款逾時一律結算；接單逾時只對自動模擬關閉者結算（autoAcceptAtMs 為 null）。
 * Mock 因此比後端的排程更精確（06 §7 差異表，契約測試不斷言接單逾時的釋放時點）。
 */
export function findExpired(
  orders: ReadonlyArray<SettleCandidate>,
  nowMs: number,
): Array<{ id: string; reason: ExpiryReason }> {
  const out: Array<{ id: string; reason: ExpiryReason }> = [];
  for (const o of orders) {
    const reason = expiryOf(o, nowMs);
    if (reason !== null) out.push({ id: o.id, reason });
  }
  return out;
}
