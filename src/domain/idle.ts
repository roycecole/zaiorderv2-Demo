// src/domain/idle.ts
/** 觸控面板（Kiosk）閒置：先警示，再重置（WCAG 2.2.1 可調整時限：警示並可延長） */
export const KIOSK_IDLE_WARN_MS = 60_000;
export const KIOSK_IDLE_RESET_MS = 90_000;
/** 完成畫面自動回到首頁的秒數 */
export const KIOSK_DONE_RETURN_SECONDS = 30;
/** 警示後至少保留給使用者延長的時間（WCAG 2.2.1 要求至少 20 秒） */
export const KIOSK_MIN_WARNING_MS = 20_000;

export type IdlePhase = 'ACTIVE' | 'WARNING' | 'RESET';

export interface IdleConfig {
  warnMs: number;
  resetMs: number;
}

export const DEFAULT_IDLE_CONFIG: IdleConfig = {
  warnMs: KIOSK_IDLE_WARN_MS,
  resetMs: KIOSK_IDLE_RESET_MS,
};

export interface IdleState {
  phase: IdlePhase;
  /** 距離自動重置的剩餘秒數（所有階段皆同：ACTIVE 90→31、WARNING 30→1、RESET 0） */
  remainingSeconds: number;
}

/**
 * 任何指標、觸控、鍵盤、捲動操作都會更新 lastActivityMs；按「繼續點餐」亦視為操作。
 * lastActivityMs 與 nowMs 須取自單調時鐘（performance.now()），不使用 Clock（時間穿梭）或系統時間。
 * 重置（RESET）是邊界：購物車、結帳草稿、聯絡資訊、trackingToken 與 Idempotency-Key / 記下的送出內容一併丟棄
 * （idempotency.ts 的 EMPTY_KEY_STATE），下一位顧客一律使用新 Key；送出結果未知時警示照常出現、不延後重置（FLOW-21、FLOW-24）。
 */
export function idleState(
  lastActivityMs: number,
  nowMs: number,
  cfg: IdleConfig = DEFAULT_IDLE_CONFIG,
): IdleState {
  const resetMs = Math.max(0, cfg.resetMs);
  // 不合理的自訂值也要保證有 WARNING 階段，且警示後至少留 20 秒
  const warnMs = Math.min(cfg.warnMs, Math.max(0, resetMs - KIOSK_MIN_WARNING_MS));
  if (!Number.isFinite(lastActivityMs) || !Number.isFinite(nowMs)) {
    return { phase: 'ACTIVE', remainingSeconds: Math.ceil(resetMs / 1000) };
  }
  const idle = Math.max(0, nowMs - lastActivityMs);
  const remainingSeconds = Math.max(0, Math.ceil((resetMs - idle) / 1000));
  if (idle >= resetMs) return { phase: 'RESET', remainingSeconds: 0 };
  if (idle >= warnMs) return { phase: 'WARNING', remainingSeconds };
  return { phase: 'ACTIVE', remainingSeconds };
}

/**
 * 完成畫面：距離自動回到首頁的剩餘秒數；為 0 時導回首頁。
 * 完成畫面上的任何操作會更新 lastActivityMs，等同延長（WCAG 2.2.1）。
 */
export function doneCountdown(
  lastActivityMs: number,
  nowMs: number,
  seconds: number = KIOSK_DONE_RETURN_SECONDS,
): number {
  if (!Number.isFinite(lastActivityMs) || !Number.isFinite(nowMs)) return seconds;
  const idle = Math.max(0, nowMs - lastActivityMs);
  return Math.max(0, Math.ceil(seconds - idle / 1000));
}
