// e2e/helpers/demo.ts —— 以 Demo 工具面板預備情境（08 §4；07 §6.5）
//
// 面板結構：浮動按鈕「Demo 工具」→ 對話框「Demo 工具」→ 可收合區塊（h3 內的 aria-expanded 按鈕）
// → fieldset / legend 分組的單選群組（原生 radio）。≥ 768 為非 modal 浮動面板，< 768 為底部 Sheet。
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export const DEMO_SECTION = {
  simulation: '訂單模擬',
  storeTime: '店家與時間',
  network: '付款與網路',
  menu: '菜單與外觀',
  stock: '庫存與時段情境',
  submit: '送出結果',
  account: '帳號與資料',
} as const;

export type DemoSectionTitle = (typeof DEMO_SECTION)[keyof typeof DEMO_SECTION];

/** 開啟 Demo 面板（已開啟則直接回傳） */
export async function openDemoPanel(page: Page): Promise<Locator> {
  const panel = page.getByRole('dialog', { name: 'Demo 工具' });
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: /^Demo 工具/ }).click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

/** 收合 Demo 面板（讓出鍵盤提醒與版面） */
export async function closeDemoPanel(page: Page): Promise<void> {
  const panel = page.getByRole('dialog', { name: 'Demo 工具' });
  if (!(await panel.isVisible())) return;
  await panel.getByRole('button', { name: /^(收合 Demo 工具|關閉)$/ }).click();
  await expect(panel).toBeHidden();
}

/** 展開面板內的區塊（已展開則略過）並回傳該區塊的內容範圍 */
export async function expandSection(panel: Locator, title: DemoSectionTitle): Promise<Locator> {
  const header = panel.getByRole('button', { name: title, exact: true });
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  return panel.getByRole('group', { name: title, exact: true });
}

/** 開啟面板 → 展開區塊 → 執行 → 收合面板 */
export async function withDemoSection<T>(
  page: Page,
  title: DemoSectionTitle,
  action: (section: Locator, panel: Locator) => Promise<T>,
): Promise<T> {
  const panel = await openDemoPanel(page);
  const section = await expandSection(panel, title);
  try {
    return await action(section, panel);
  } finally {
    await closeDemoPanel(page);
  }
}

/** 在區塊內的單選群組（以 legend 命名）選取一個選項 */
export async function pickChoice(section: Locator, legend: string, label: string): Promise<void> {
  const radio = section
    .getByRole('group', { name: legend })
    .getByRole('radio', { name: label, exact: true });
  await radio.check();
  await expect(radio).toBeChecked();
}

// ── 常用情境 ─────────────────────────────────────────────────────────────────

/** 店家狀態：自動 / 強制營業 / 強制休息 / 暫停接單 */
export async function setStoreStatus(
  page: Page,
  label: '自動' | '強制營業' | '強制休息' | '暫停接單',
): Promise<void> {
  await withDemoSection(page, DEMO_SECTION.storeTime, (s) => pickChoice(s, '店家狀態', label));
}

/** 時間穿梭預設：'實際時間' | '開店前 10:30' | '午餐營業 12:00' | '午休 14:30' | '即將停止接單 20:40' | '已打烊 21:30' | '週日 12:00' */
export async function setTimePreset(page: Page, label: string): Promise<void> {
  await withDemoSection(page, DEMO_SECTION.storeTime, async (s) => {
    await s.getByRole('button', { name: label, exact: true }).click();
  });
}

/** 快轉：'快轉 +15 分鐘' | '快轉 +24 小時' */
export async function fastForward(
  page: Page,
  label: '快轉 +15 分鐘' | '快轉 +24 小時',
): Promise<void> {
  await withDemoSection(page, DEMO_SECTION.storeTime, async (s) => {
    await s.getByRole('button', { name: label, exact: true }).click();
  });
}

/** 下一次付款結果：手動 / 成功 / 失敗 / 逾時（套用一次後自動回到手動） */
export async function setNextPaymentResult(
  page: Page,
  label: '手動' | '成功' | '失敗' | '逾時',
): Promise<void> {
  await withDemoSection(page, DEMO_SECTION.network, (s) => pickChoice(s, '下一次付款結果', label));
}

/** 菜單資料完整度：完整 / 部分缺圖 / 無圖片 / 精簡 */
export async function setMenuProfile(
  page: Page,
  label: '完整' | '部分缺圖' | '無圖片' | '精簡',
): Promise<void> {
  await withDemoSection(page, DEMO_SECTION.menu, (s) => pickChoice(s, '菜單資料完整度', label));
}

/** 主題色：店家設定、辣椒紅、抹茶綠、咖啡棕、活力橘、海洋藍、極簡黑、檸檬黃 */
export async function setThemeColor(page: Page, label: string): Promise<void> {
  await withDemoSection(page, DEMO_SECTION.menu, (s) => pickChoice(s, '主題色', label));
}

/** 自動模擬訂單開關 */
export async function setAutoSimulate(page: Page, on: boolean): Promise<void> {
  await withDemoSection(page, DEMO_SECTION.simulation, async (s) => {
    const toggle = s.getByRole('switch', { name: /自動模擬訂單/ });
    if ((await toggle.isChecked()) !== on) await toggle.click();
    if (on) await expect(toggle).toBeChecked();
    else await expect(toggle).not.toBeChecked();
  });
}

/** 對「我的訂單」執行店家動作：接單 / 出餐 / 出發 / 完成 / 拒單 */
export async function storeAction(
  page: Page,
  label: '接單' | '出餐' | '出發' | '完成' | '拒單',
): Promise<void> {
  await withDemoSection(page, DEMO_SECTION.simulation, async (s) => {
    await s.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByText(`已執行：${label}`)).toBeVisible();
  });
}

/** 快速登入示範會員 */
export async function quickLoginDemoUser(page: Page): Promise<void> {
  await withDemoSection(page, DEMO_SECTION.account, async (s) => {
    await s.getByRole('button', { name: '快速登入示範會員' }).click();
    await expect(page.getByText('已登入示範會員')).toBeVisible();
  });
}

/** 載入「點餐記憶」範例（訪客；08 §2.5） */
export async function loadRememberedSample(page: Page): Promise<void> {
  await withDemoSection(page, DEMO_SECTION.menu, async (s) => {
    await s.getByRole('button', { name: '載入範例' }).click();
  });
}

/** 在「庫存與時段情境」選商品（以名稱） */
async function selectStockProduct(section: Locator, productName: string): Promise<void> {
  await section.getByRole('combobox', { name: '商品' }).selectOption({ label: productName });
}

/** 手動售完旗標（商品售完 / 調價） */
export async function setManualSoldOut(
  page: Page,
  productName: string,
  soldOut: boolean,
): Promise<void> {
  await withDemoSection(page, DEMO_SECTION.stock, async (s) => {
    await selectStockProduct(s, productName);
    const toggle = s.getByRole('switch', { name: /手動售完/ });
    if ((await toggle.isChecked()) !== soldOut) await toggle.click();
    if (soldOut) await expect(toggle).toBeChecked();
    else await expect(toggle).not.toBeChecked();
  });
}

/** 暫時基本價（NT$）：商品調價 */
export async function setBasePrice(page: Page, productName: string, price: number): Promise<void> {
  await withDemoSection(page, DEMO_SECTION.stock, async (s) => {
    await selectStockProduct(s, productName);
    await s.getByRole('textbox', { name: /暫時基本價/ }).fill(String(price));
    await s.getByRole('button', { name: '套用價格' }).click();
    await expect(s.getByRole('button', { name: '恢復原價' })).toBeVisible();
  });
}
