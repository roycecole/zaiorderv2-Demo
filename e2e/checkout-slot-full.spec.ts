// UAT-23 送出時段額滿改選最近時段（FR-CK-16、VR-17、BR-09/38、EC-07、KPI-11）
// 已選預約今日 12:30，送出前該時段被補滿 → 被拒並提供「改選 12:45」，一鍵改選後送出成立（不靜默改選）；
// 另：時段只剩 1 個名額時可成功送出。
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  addProduct,
  closeDemoPanel,
  fillContact,
  goToCheckout,
  openApp,
  openDemoPanel,
  openDemoSection,
  ownOrders,
  readMockDb,
  waitCheckoutSettled,
} from './helpers/b-app';

test.use({ viewport: { width: 1440, height: 900 } });

/** 週三 12:00（台北）：固定 Date，計時器照常運作（營業時段與取餐時段可重現） */
const FIXED = new Date('2026-10-14T12:00:00+08:00');
const SLOT_1230 = '2026-10-14T12:30:00+08:00';
const SLOT_1245 = '2026-10-14T12:45:00+08:00';

async function selectScheduledSlot(page: Page, time: string): Promise<void> {
  await page.getByRole('radio', { name: /^預約/ }).check();
  await page.getByRole('radio', { name: new RegExp(`^${time}$`) }).check();
}

/** Demo 面板「預約時段」選今天的指定時段 */
async function pickPanelSlot(page: Page, time: string) {
  const panel = await openDemoPanel(page);
  await openDemoSection(panel, '庫存與時段情境');
  const select = panel.getByLabel('時段', { exact: true });
  const option = select
    .locator('option')
    .filter({ hasText: new RegExp(`^${time}`) })
    .first();
  await select.selectOption({ value: (await option.getAttribute('value')) ?? '' });
  return panel;
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED);
});

test('UAT-23 12:30 額滿被拒 → 改選 12:45 一鍵 → 送出成立，訂單時段為 12:45', async ({ page }) => {
  await openApp(page, '/', { demo_clock: undefined });
  await addProduct(page, '滷蛋');
  await goToCheckout(page);
  await fillContact(page);
  await selectScheduledSlot(page, '12:30');
  await waitCheckoutSettled(page);

  // 預備「時段額滿」：只在送出的交易內生效
  const panel = await pickPanelSlot(page, '12:30');
  await panel.getByRole('radio', { name: '時段額滿' }).check();
  await panel.getByRole('button', { name: '預備', exact: true }).click();
  await expect(panel.getByText('12:30 時段會先被補到額滿')).toBeVisible();
  await closeDemoPanel(page);
  await expect(page.getByTestId('checkout-status-bar')).toHaveAttribute('data-state', 'ok');

  await page.getByRole('button', { name: /^送出訂單/ }).click();

  // 被拒：留在結帳頁；清單標示該時段額滿並提供「改選 12:45」
  const list = page.getByTestId('availability-issue-list');
  await expect(list).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/checkout');
  await expect(list).toContainText('12:30 這個時段已額滿');
  await expect(list.getByRole('button', { name: '改選 12:45' })).toBeVisible();
  await expect(list.getByRole('button', { name: '選其他時段' })).toBeVisible();
  expect(await ownOrders(page)).toHaveLength(0);
  // 不靜默改選：原選取已清除，12:45 尚未被選取
  await expect(page.getByRole('radio', { name: /^12:30/ })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: /^12:45/ })).not.toBeChecked();

  // 一鍵改選 → 送出
  await list.getByRole('button', { name: '改選 12:45' }).click();
  await expect(page.getByRole('radio', { name: /^12:45/ })).toBeChecked();
  const submit = page.getByRole('button', { name: /^送出訂單/ });
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
  await submit.click();
  await page.waitForURL('**/orders/**');

  const orders = await ownOrders(page);
  expect(orders).toHaveLength(1);
  expect(orders[0]?.scheduled_at).toBe(Date.parse(SLOT_1245));
  await expect(page.getByText(/預約.*12:45/).first()).toBeVisible();
  // 姓名與手機沒有重填（成立的訂單帶著原填寫的聯絡資訊）
  const log = (await readMockDb(page)).demo_request_log.map((e) => e.outcome);
  expect(log).toEqual(['REJECTED', 'CREATED']);
});

test('UAT-23 變體：時段只剩 1 個名額時仍可成功送出（佔用最後一個名額）', async ({ page }) => {
  await openApp(page, '/', { demo_clock: undefined });
  await addProduct(page, '滷蛋');
  await goToCheckout(page);
  await fillContact(page);
  await selectScheduledSlot(page, '12:30');
  await waitCheckoutSettled(page);

  const panel = await pickPanelSlot(page, '12:30');
  await panel.getByRole('button', { name: '只剩 1 個名額', exact: true }).click();
  await expect(page.getByText(/已補 \d+ 筆他人訂單/)).toBeVisible();
  await closeDemoPanel(page);

  await page.getByRole('button', { name: /^送出訂單/ }).click();
  await page.waitForURL('**/orders/**');
  const orders = await ownOrders(page);
  expect(orders).toHaveLength(1);
  expect(orders[0]?.scheduled_at).toBe(Date.parse(SLOT_1230));

  // 此後同一時段再送出才會被拒：回菜單再下一單、同選 12:30
  await openApp(page, '/', { demo_clock: undefined });
  await addProduct(page, '滷蛋');
  await goToCheckout(page);
  await fillContact(page);
  await page.getByRole('radio', { name: /^預約/ }).check();
  await expect(page.getByRole('radio', { name: /^12:30/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});
