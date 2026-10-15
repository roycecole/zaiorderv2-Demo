// src/services/api/mock/demoControl.ts
import type { ID, ISODate, ISODateTime, Order, PaymentMethod } from '@/domain/types';
import type { MenuProfile } from './menuProfile';
import type { CreateLogEntry } from './requestLog';

export type PaymentResultMode = 'MANUAL' | 'SUCCESS' | 'FAILED' | 'TIMEOUT';

export interface FailNext {
  /** 指定要失敗的端點；'any' 為任一「使用者觸發」的請求（不含輪詢與背景更新） */
  target: 'any' | 'orders.quote' | 'orders.create' | 'orders.pay' | 'auth.verifyOtp' | 'store.getMenu';
  remaining: number;
  /**
   * 僅 target = 'orders.create'：'BEFORE' 請求未被處理（503，不附 retryAfterSeconds，前端依 FLOW-24 視為結果未知）；
   * 'AFTER_COMMIT' 訂單已建立並同步寫回後丟網路層錯誤（回應遺失，EC-05）。省略時為 'BEFORE'（FR-DM-13）
   */
  phase?: 'BEFORE' | 'AFTER_COMMIT';
}

/** 「下一次送出訂單」才發生的情境（一次性；不影響 quote）：他人搶購、商品售完、時段額滿（FR-DM-12） */
export interface RaceOnNextCreate {
  /** 送出時才變成手動售完的商品：寫入 DemoState.soldOutProductIds 並保留，需於面板恢復上架或重置 Demo 資料 */
  soldOutProductIds?: ID[];
  /** 他人先買走：寫入真實的他人訂單列，份數夾在剩餘內 */
  buy?: Array<{ productId: ID; quantity: number }>;
  /** 時段補到額滿（leave = 0）或只剩 1 個名額（leave = 1） */
  fillSlots?: Array<{ startAt: ISODateTime; leave: 0 | 1 }>;
}

/** 面板「庫存與時段情境」的讀數；與 loadWorld 同一份計算 */
export interface StockSnapshot {
  dailyLimit: number | null;     // null = 不限量
  sold: number;                  // 計入集合內已成立（非待付款保留）的份數
  held: number;                  // 待付款保留中的份數
  remaining: number | null;
}

export interface DemoState {
  autoSimulate: boolean;                         // 自動推進訂單
  speed: 1 | 2 | 5;                              // 模擬速度倍率
  storeOverride: 'AUTO' | 'OPEN' | 'CLOSED' | 'PAUSED';
  clockOverride: string | null;                  // ISO 時間；null = 使用實際時間
  soldOutProductIds: ID[];                       // 手動售完旗標（僅約束當前營業日）
  priceOverrides: Record<ID, number>;            // productId → 暫時基本價（展示價格異動）
  limitOverrides: Record<ID, number | null>;     // productId → 每日限量覆寫；null = 不限量（FR-DM-12）
  menuProfile: MenuProfile;                      // 菜單資料完整度（FR-DM-09）
  themeOverride: string | null;                  // 預覽用品牌色 #RRGGBB；null = 使用店家設定（FR-DM-10）
  inputMode: 'AUTO' | 'KIOSK' | 'KEYBOARD_HINTS'; // 輸入模式預覽（FR-DM-11）
  nextPaymentResult: PaymentResultMode;
  latencyMs: 0 | 300 | 1500;
  failNext: FailNext | null;
  raceOnNextCreate: RaceOnNextCreate | null;     // 預備在下一次送出才發生的情境（FR-DM-12）
}

export const DEFAULT_DEMO_STATE: DemoState = {
  autoSimulate: true,
  speed: 1,
  storeOverride: 'AUTO',
  clockOverride: null,
  soldOutProductIds: [],
  priceOverrides: {},
  limitOverrides: {},
  menuProfile: 'FULL',
  themeOverride: null,
  inputMode: 'AUTO',
  nextPaymentResult: 'MANUAL',
  latencyMs: 300,
  failNext: null,
  raceOnNextCreate: null,
};

export type StoreAction = 'ACCEPT' | 'READY' | 'DISPATCH' | 'COMPLETE' | 'REJECT';

/**
 * 凡寫入 db 的動作（act、settlePayment、injectOtherOrder、fillSlot、clearOtherOrders、loginAsDemoUser）
 * 一律經 withDbLock：鎖內先 reload 再變更再 flush（§6.8）。
 */
export interface DemoControl {
  getState(): DemoState;
  setState(patch: Partial<DemoState>): void;
  /** 對訂單執行「店家端」動作；不合法的轉換會被狀態機拒絕；不作用於他人訂單（pickup_no 前綴 X） */
  act(orderId: ID, action: StoreAction): Promise<Order>;
  /** 快速登入示範會員 */
  loginAsDemoUser(): Promise<void>;
  /** 供付款頁模擬結果使用 */
  settlePayment(orderId: ID, result: 'SUCCESS' | 'FAILED', method?: PaymentMethod): Promise<Order>;
  resetAll(): void;

  // ── 庫存與時段情境（FR-DM-12）；動作完成後 invalidate menu / product / pickup-slots / quote 查詢 ──
  /** 取餐營業日（預設為當前營業日）的庫存讀數 */
  getStock(productId: ID, businessDate?: ISODate): StockSnapshot;
  /** 覆寫每日限量（null = 不限量）；「恢復預設」以 setState 移除 limitOverrides 的該項（不清除已成立的訂單與他人訂單，要回到全新狀態請 resetAll） */
  setLimit(productId: ID, limit: number | null): void;
  /** 設為「剩 n 份」：每日限量 = 已售 + 保留 + n */
  setRemaining(productId: ID, remaining: number): void;
  /** 他人現在下單：以真實訂單列注入（pickup_no 前綴 X），份數夾在剩餘內；回傳實際注入的份數 */
  injectOtherOrder(spec: {
    productId: ID;
    quantity: number;
    status?: 'ACCEPTED' | 'PENDING_PAYMENT';
    scheduledAt?: ISODateTime | null;
  }): Promise<{ added: number }>;
  /** 讓時段額滿（leave = 0）或只剩 1 個名額（leave = 1）：以不限量商品 ×1 補單 */
  fillSlot(startAt: ISODateTime, leave: 0 | 1): Promise<{ added: number }>;
  /** 預備 / 取消預備「下一次送出訂單」才發生的情境 */
  armRace(spec: RaceOnNextCreate): void;
  disarmRace(): void;
  /** 清除所有他人訂單（X 前綴）並釋放其占用的份數與時段；回傳清除筆數 */
  clearOtherOrders(): number;
  /** 最近送出紀錄（最新在前；環形緩衝 20 筆，面板顯示 5 筆） */
  getCreateLog(limit?: number): CreateLogEntry[];
}
