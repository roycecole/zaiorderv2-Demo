// UAT-03 休息時段預約（01 §11；08 S3）、UAT-04 暫停接單（S3 變體，見 store-paused.spec.ts）
import { expect, test } from '@playwright/test';
import {
  addViaSheet,
  fillContact,
  gotoApp,
  openCheckout,
  ownOrders,
  submitAndWaitForOrder,
} from './helpers/app';
import { fastForward, setAutoSimulate, setTimePreset } from './helpers/demo';

/** 2026-10-14 17:00（台北）的 epoch ms */
const SLOT_17_00 = Date.parse('2026-10-14T17:00:00+08:00');

test.describe('UAT-03 休息時段預約', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await setTimePreset(page, '午休 14:30');
    // 休息中：店家狀態與下一個營業時段
    await expect(page.getByRole('status').filter({ hasText: '休息中' })).toContainText(
      '17:00 開始營業',
    );
    // 休息中仍可瀏覽與加入購物車（03 PG-01）
    await addViaSheet(page, '嘉義雞肉飯');
    await openCheckout(page);
  });

  test('「盡快」停用、預設選取今日 17:00，預約單可送出且不會於 10 分鐘後被自動取消', async ({
    page,
  }) => {
    // 「盡快」停用並說明；預約被選取、今日 17:00 時段為預設
    const asap = page.getByRole('radio', { name: '盡快' });
    await expect(asap).toBeDisabled();
    await expect(page.getByRole('radio', { name: '預約' })).toBeChecked();
    await expect(page.getByRole('button', { name: '今天' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('radio', { name: '17:00', exact: true })).toBeChecked();
    await expect(page.getByText('目前休息中，可預約 17:00 後取餐')).toBeVisible();
    // 休息中的最早時段是 17:00（午休時段不提供）
    await expect(page.getByRole('radio', { name: '14:45', exact: true })).toHaveCount(0);

    // 關閉自動模擬，使訂單停在「等待店家確認」，才能驗證接單期限
    await setAutoSimulate(page, false);
    await fillContact(page);
    await submitAndWaitForOrder(page);

    // 訂單頁固定顯示預約時間；接單期限不早於「預約時間 − 前置 15 分鐘」（BR-17）
    await expect(page.getByText('預約 17:00 取餐').first()).toBeVisible();
    await expect(page.getByText('等待店家確認').first()).toBeVisible();
    await expect(page.getByText('店家將於 16:45 前確認')).toBeVisible();

    const [order] = await ownOrders(page);
    expect(order).toMatchObject({
      status: 'PENDING',
      scheduled_at: SLOT_17_00,
      order_type: 'PICKUP',
    });

    // 快轉 +15 分鐘（遠超過 10 分鐘的即時單接單期限）：預約單仍待確認，沒有被取消
    await fastForward(page, '快轉 +15 分鐘');
    await page.getByRole('button', { name: '立即更新' }).click();
    const statusCard = page.getByRole('region', { name: /^取餐號碼/ });
    await expect(statusCard).toContainText('等待店家確認');
    await expect(statusCard).not.toContainText('已取消');
    const [after] = await ownOrders(page);
    expect(after?.status).toBe('PENDING');
  });

  test('自動模擬開啟時約 5 秒內接單轉為製作中，並維持到製作基準時間', async ({ page }) => {
    await fillContact(page);
    await submitAndWaitForOrder(page);
    await expect(page.getByText('預約 17:00 取餐').first()).toBeVisible();
    // 自動接單（約 5 秒）：頁面輪詢每 5 秒一次；狀態卡（取餐號碼區塊）顯示「製作中」
    const statusCard = page.getByRole('region', { name: /^取餐號碼/ });
    await expect(statusCard).toContainText('製作中', { timeout: 20_000 });
    // 快轉 +15 分鐘後仍為製作中（預約單於製作基準 16:45 之前維持已接單，不會逾時取消）
    await fastForward(page, '快轉 +15 分鐘');
    await page.getByRole('button', { name: '立即更新' }).click();
    await expect(statusCard).toContainText('製作中');
    await expect(statusCard).not.toContainText('已取消');
    const [order] = await ownOrders(page);
    expect(order?.status).toBe('ACCEPTED');
  });
});
