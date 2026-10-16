// e2e/helpers/app.ts —— E2E 共用輔助：開啟應用程式、加入商品、結帳、讀取 Mock 資料庫
//
// 時間：以 `?demo_clock=<ISO>` 作為「現在」的起點並繼續走時（07 §6.3、08 §4）。每個測試都使用乾淨的
// browser context（localStorage 為空），因此不需要手動清除狀態。
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { DbData, OrderRow } from '../../src/services/api/mock/dbTypes';

/** 週三（營業日）午餐營業 12:00；`demo_clock` 之後繼續走時 */
export const NOON = '2026-10-14T12:00:00+08:00';
/** 同一天的午休 14:30（休息中，可預約 17:00） */
export const BREAK_TIME = '2026-10-14T14:30:00+08:00';

export interface GotoAppOptions {
  /** 預設 '/'；可含查詢字串以外的路徑 */
  path?: string;
  /** `demo_clock` 起點；`null` 表示不帶（使用實際時間） */
  clock?: string | null;
  /** 其他查詢參數（`table`、`mode`、`demo_fail`…） */
  params?: Record<string, string>;
  /** true：不關閉 Demo 橫幅（它會浮在左下角、底部 Tab / CartBar 之上，可能遮住底部的商品卡按鈕；任務型頁面不顯示橫幅） */
  keepBanner?: boolean;
}

/** 開啟應用程式並等待主要內容；預設關閉 Demo 橫幅 */
export async function gotoApp(page: Page, options: GotoAppOptions = {}): Promise<void> {
  const { path = '/', clock = NOON, params = {}, keepBanner = false } = options;
  const query = new URLSearchParams();
  if (clock !== null) query.set('demo_clock', clock);
  for (const [key, value] of Object.entries(params)) query.set(key, value);
  const qs = query.toString();
  await page.goto(qs === '' ? path : `${path}?${qs}`);
  await expect(page.getByRole('main')).toBeVisible();
  if (!keepBanner) await dismissDemoBanner(page);
}

/** 關閉 Demo 橫幅（第一次進站才會出現；觸控面板模式與任務型頁面沒有橫幅） */
export async function dismissDemoBanner(page: Page): Promise<void> {
  // Demo 入口在頂部列（主 bundle），早於延後載入的 DemoRoot（橫幅與面板）出現：
  // 先等入口，再等 DemoRoot 的就緒標記，才能確定橫幅有無
  await expect(page.getByRole('button', { name: /^Demo 工具/ })).toBeVisible();
  await expect(page.locator('[data-zo-demo-root]')).toBeAttached();
  const dismiss = page.getByRole('button', { name: '關閉提示' });
  if (await dismiss.isVisible()) {
    await dismiss.click();
    await expect(dismiss).toBeHidden();
  }
}

/** 商品卡（由 `data-product-card` 屬性定位，id 為種子商品 ID，例：`prd_lurou`） */
export function productCard(page: Page, productId: string): Locator {
  return page.locator(`[data-product-card="${productId}"]`);
}

export interface SheetPicks {
  /** 單選群組的選項標籤（例：'大碗'） */
  radios?: string[];
  /** 複選群組的選項標籤（例：'滷蛋'） */
  checks?: string[];
  quantity?: number;
  note?: string;
}

/** 開啟商品面板（點商品卡的「加入 / ＋」），依序選擇選項後「加入購物車」 */
export async function addViaSheet(
  page: Page,
  productName: string,
  picks: SheetPicks = {},
): Promise<void> {
  await page
    .getByRole('button', { name: new RegExp(`^加入 ${escapeRegExp(productName)}`) })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: productName });
  await expect(dialog).toBeVisible();
  for (const label of picks.radios ?? []) await dialog.getByRole('radio', { name: label }).check();
  for (const label of picks.checks ?? [])
    await dialog.getByRole('checkbox', { name: label }).check();
  if (picks.note !== undefined)
    await dialog.getByRole('textbox', { name: /備註/ }).fill(picks.note);
  for (let n = 1; n < (picks.quantity ?? 1); n++) {
    await dialog.getByRole('button', { name: '增加數量' }).click();
  }
  if (picks.quantity !== undefined && picks.quantity > 1) {
    await expect(dialog.getByRole('spinbutton', { name: '數量' })).toHaveText(
      String(picks.quantity),
    );
  }
  await dialog.getByRole('button', { name: /^加入購物車/ }).click();
  await expect(dialog).toBeHidden();
}

/** 不需要選項的商品：卡片的「加入」直接加入購物車（不開面板） */
export async function quickAdd(page: Page, productName: string): Promise<void> {
  await page
    .getByRole('button', { name: new RegExp(`^加入 ${escapeRegExp(productName)}`) })
    .first()
    .click();
}

/**
 * 購物車的品項列：≥ 1024 在右側「我的訂單」面板（`/cart` 會導回首頁），< 1024 在購物車頁。
 * 呼叫前請先確認目前頁面已顯示其中之一。
 */
export function cartLines(page: Page): Locator {
  return page.locator('aside[aria-label="我的訂單"] li, [aria-label="購物車品項"] > li');
}

/** 從菜單頁（或任何有購物車入口的頁）前往結帳；< 1024 先經購物車頁 */
export async function openCheckout(page: Page): Promise<void> {
  const cta = page.getByRole('link', { name: /^前往結帳/ });
  if (!(await cta.isVisible())) {
    await page.getByRole('link', { name: /查看購物車/ }).click();
  }
  await cta.click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByRole('heading', { level: 1, name: '結帳' })).toBeVisible();
}

export interface ContactInfo {
  name?: string;
  phone?: string;
}

export const DEFAULT_CONTACT = { name: '王小明', phone: '0912345678' } as const;

/** 填寫結帳頁的聯絡資訊 */
export async function fillContact(page: Page, info: ContactInfo = {}): Promise<void> {
  const { name, phone } = { ...DEFAULT_CONTACT, ...info };
  await page.getByRole('textbox', { name: /^姓名/ }).fill(name);
  await page.getByRole('textbox', { name: /^手機/ }).fill(phone);
}

/** 結帳頁的送出鈕（名稱含金額：「送出訂單 · NT$ 92」或「確認新價格並送出 · …」） */
export function submitButton(page: Page): Locator {
  return page.getByRole('button', { name: /^(送出訂單|確認新價格並送出)/ });
}

/** 送出訂單並等待導向訂單頁（現金）或付款頁（線上付款） */
export async function submitAndWaitForOrder(page: Page): Promise<string> {
  await submitButton(page).click();
  await page.waitForURL(/\/(orders|payment)\/[^/]+$/);
  const id = new URL(page.url()).pathname.split('/').pop();
  if (id === undefined || id === '') throw new Error('無法由網址取得訂單 ID');
  return id;
}

/** 訂單頁的取餐號碼（h1，可見文字，例：`A001`） */
export function pickupNo(page: Page): Locator {
  return page.locator('#order-pickup-no');
}

/** 訂單頁的目前進度（狀態徽章文字，例：`等待店家確認`） */
export function orderStatusText(page: Page): Locator {
  return page.getByRole('region', { name: /^取餐號碼/ });
}

// ── Mock 資料庫（localStorage 的 `zaiorder:v1:db`）──────────────────────────────

/** 讀取 Mock 資料庫的快照（供斷言用；不得用於操作）。時間欄位為 epoch ms */
export async function readDb(page: Page): Promise<DbData> {
  const raw = await page.evaluate(() => window.localStorage.getItem('zaiorder:v1:db'));
  if (raw === null) throw new Error('尚未建立 Mock 資料庫（zaiorder:v1:db）');
  return JSON.parse(raw) as DbData;
}

/** 測試中由使用者建立的訂單：排除種子歷史訂單（`ord_hist_*`）與他人訂單（取餐號碼前綴 `X`） */
export async function ownOrders(page: Page): Promise<OrderRow[]> {
  const db = await readDb(page);
  return db.orders.filter((o) => !o.id.startsWith('ord_hist_') && !o.pickup_no.startsWith('X'));
}

/** 文件水平捲動檢查：`scrollWidth <= innerWidth`（UAT-11） */
export async function horizontalOverflow(
  page: Page,
): Promise<{ scrollWidth: number; innerWidth: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
    innerWidth: window.innerWidth,
  }));
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
