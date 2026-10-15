// UAT-24 付款期間保留與逾時釋放（BR-38、PY-03、EC-17/34、NFR-17）
// LINE Pay 送出雙人分享餐 ×3 並停在付款頁 → 菜單剩 2 份 → 快轉 +15 分鐘 → 剩 5 份、訂單已取消（付款逾時）並說明已釋出；
// 另：店家拒單時份數立即回補。以 page.clock.setFixedTime 固定時間（台北 12:00）。
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  addComboShare,
  closeDemoPanel,
  fillContact,
  goToCheckout,
  openApp,
  openDemoPanel,
  openDemoSection,
  ownOrders,
  waitCheckoutSettled,
} from './helpers/b-app';

test.use({ viewport: { width: 1440, height: 900 } });

const FIXED = new Date('2026-10-14T12:00:00+08:00');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED);
});

/** 菜單上雙人分享餐卡片的庫存標示 */
function comboCard(page: Page) {
  return page.getByRole('article', { name: '雙人分享餐' });
}

async function placeComboOrder(page: Page, method: 'LINE Pay' | '現金'): Promise<void> {
  await openApp(page, '/', { demo_clock: undefined });
  await addComboShare(page, 3);
  await goToCheckout(page);
  await fillContact(page);
  await page.getByRole('radio', { name: method }).check();
  await waitCheckoutSettled(page);
  await page.getByRole('button', { name: /^送出訂單/ }).click();
}

test('UAT-24 LINE Pay 保留 3 份 → 菜單剩 2 份 → 快轉 +15 分鐘 → 剩 5 份、訂單已取消（付款逾時）', async ({
  page,
}) => {
  await placeComboOrder(page, 'LINE Pay');

  // 付款頁：保留說明與倒數
  await page.waitForURL('**/payment/**');
  await expect(page.getByText(/已保留餐點與取餐時段，請於 12:15 前完成付款/)).toBeVisible();
  await expect(page.getByText('剩餘付款時間')).toBeVisible();
  const orders = await ownOrders(page);
  expect(orders).toHaveLength(1);
  expect(orders[0]?.status).toBe('PENDING_PAYMENT');
  const orderId = orders[0]?.id ?? '';

  // 查看菜單：剩 2 份；面板讀數：已售 0・待付款保留 3・剩 2 份
  await openApp(page, '/', { demo_clock: undefined });
  await expect(comboCard(page)).toContainText('剩 2 份');
  const panel = await openDemoPanel(page);
  await openDemoSection(panel, '庫存與時段情境');
  await expect(panel.getByText('今日已售 0・待付款保留 3・剩 2 份')).toBeVisible();

  // 快轉 +15 分鐘
  await openDemoSection(panel, '店家與時間');
  await panel.getByRole('button', { name: '快轉 +15 分鐘' }).click();
  await expect(panel.getByText('今日已售 0・待付款保留 0・剩 5 份')).toBeVisible();
  await closeDemoPanel(page);
  await expect(comboCard(page)).toContainText('剩 5 份');

  // 訂單頁：已取消（付款逾時），說明已釋出並提供「再來一單」
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('已取消').first()).toBeVisible();
  await expect(page.getByText(/付款逾時|超過付款時間/).first()).toBeVisible();
  await expect(page.getByText(/保留的餐點與時段已釋出/)).toBeVisible();
  await expect(page.getByRole('button', { name: /再來一單/ })).toBeVisible();
  const after = await ownOrders(page);
  expect(after[0]?.status).toBe('CANCELLED');
});

test('UAT-24 變體：現金單保留 3 份 → 店家拒單後份數立即回補（剩 5 份）', async ({ page }) => {
  // 先關閉自動模擬（否則約 5 秒自動接單，拒單不合法）
  await openApp(page, '/', { demo_clock: undefined });
  let panel = await openDemoPanel(page);
  await panel.getByRole('switch', { name: '自動模擬訂單' }).uncheck();
  await closeDemoPanel(page);

  await placeComboOrder(page, '現金');
  await page.waitForURL('**/orders/**');
  expect((await ownOrders(page))[0]?.status).toBe('PENDING');

  await openApp(page, '/', { demo_clock: undefined });
  await expect(comboCard(page)).toContainText('剩 2 份');

  // 面板：手動店家動作「拒單」
  panel = await openDemoPanel(page);
  await panel.getByRole('button', { name: '拒單', exact: true }).click();
  await closeDemoPanel(page);
  await expect(comboCard(page)).toContainText('剩 5 份');
  expect((await ownOrders(page))[0]?.status).toBe('CANCELLED');
});
