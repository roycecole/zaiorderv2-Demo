// src/features/demo/constants.ts —— Demo 面板用的常數（08 §2.5、§3.4、§5；03 §4.1）

/** 示範會員手機與固定 OTP（08 §2.5）：快速登入的備援路徑使用 */
export const DEMO_PHONE = '0900000000';
export const DEMO_OTP = '123456';

/** 庫存與時段區塊預設選取的商品（雙人分享餐，每日限量 5） */
export const DEFAULT_STOCK_PRODUCT_ID = 'prd_combo_share';

/** 面板輪詢 DemoState / 庫存讀數 / 送出紀錄的間隔 */
export const DEMO_POLL_MS = 1000;

/** `failNext.remaining` 的「持續失敗」值（與 demo_fail 啟動參數一致，07 §6.3） */
export const FAIL_CONTINUOUS = Number.MAX_SAFE_INTEGER;

/** 工具面板根元素的 id（浮動入口鈕的 `aria-controls` 與面板內焦點判斷共用） */
export const DEMO_PANEL_ID = 'zaiorder-demo-panel';
