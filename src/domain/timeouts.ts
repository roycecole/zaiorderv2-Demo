// src/domain/timeouts.ts
import type { OrderType } from './types';

const MIN = 60_000;

/** 前置分鐘所需的店家設定（store_settings） */
export interface LeadSettings {
  /** store_settings.pickup_lead_minutes */
  pickupLeadMinutes: number;
  /** store_settings.delivery_lead_minutes：該單配送區沒有 estimated_minutes 時的預設 */
  deliveryLeadMinutes: number;
}

/**
 * 訂單的前置分鐘 lead（BR-08；接單期限與製作基準共用）：
 * 外送 = 該單配送區的 delivery_zones.estimated_minutes（以 orders.delivery_zip_code 對應），缺值才用 deliveryLeadMinutes；
 * 其餘取餐方式（自取、內用）= pickupLeadMinutes。與 05 §6.4 對帳 4 的 COALESCE 同一規則；
 * Mock 的 AcceptDeadlineInput.leadMinutes 與 SimulationInput.leadMinutes 一律取自本函式，不直接讀店家層級的 delivery_lead_minutes。
 */
export function leadMinutesFor(
  orderType: OrderType,
  zoneEstimatedMinutes: number | null | undefined,
  settings: LeadSettings,
): number {
  if (orderType !== 'DELIVERY') return settings.pickupLeadMinutes;
  return zoneEstimatedMinutes ?? settings.deliveryLeadMinutes;
}

export interface AcceptDeadlineInput {
  /** 進入 PENDING 的時間（orders.pending_at）：現金單為建單時間；線上付款單為付款成功或改用現金的時間（05 §5.4） */
  pendingAtMs: number;
  scheduledAtMs: number | null;   // null = 即時單
  /** 前置分鐘，同 BR-08（leadMinutesFor）：外送取該單配送區的 estimated_minutes，缺值才用 delivery_lead_minutes；其餘 pickup_lead_minutes */
  leadMinutes: number;
  acceptTimeoutMinutes: number;   // store_settings.accept_timeout_minutes
}

/** BR-17：付款期限 = 下單時間 + payment_timeout_minutes */
export function paymentDeadlineMs(placedAtMs: number, paymentTimeoutMinutes: number): number {
  return placedAtMs + paymentTimeoutMinutes * MIN;
}

/**
 * BR-17：店家接單期限，自「進入 PENDING 的時間」（pending_at）起算，不是下單時間：
 * 線上付款者可在 15 分鐘的付款期限內才付款成功，若以下單時間起算，進入 PENDING 時就可能已逾時。
 * 即時單：pending_at + acceptTimeoutMinutes；
 * 預約單：max(pending_at + acceptTimeoutMinutes, scheduledAt − lead)，不早於「開始製作時間」，避免休息時段下的預約單被誤判逾時；
 * lead 同 BR-08（leadMinutesFor），與 API 的 acceptBy 及 05 §6.4 的排程、對帳 4 使用同一個值。
 * 即 API 的 Order.acceptBy（僅 PENDING 有值，06 §4.4）。
 */
export function acceptDeadlineMs(i: AcceptDeadlineInput): number {
  const base = i.pendingAtMs + i.acceptTimeoutMinutes * MIN;
  if (i.scheduledAtMs === null) return base;
  return Math.max(base, i.scheduledAtMs - i.leadMinutes * MIN);
}
