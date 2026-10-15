// UAT-06 付款逾時（01 §11；08 S6）
import { expect, test } from '@playwright/test';
import {
  fillContact,
  gotoApp,
  openCheckout,
  ownOrders,
  quickAdd,
  submitAndWaitForOrder,
} from './helpers/app';
import { fastForward } from './helpers/demo';

test.describe('UAT-06 付款逾時', () => {
  test('街口支付送出後不操作，快轉 +15 分鐘：付款頁顯示已逾時，訂單為 CANCELLED、原因「付款逾時」', async ({
    page,
  }) => {
    await gotoApp(page);
    await quickAdd(page, '擔仔麵');
    await openCheckout(page);
    await fillContact(page);
    await page.getByRole('radio', { name: '街口支付' }).check();
    const orderId = await submitAndWaitForOrder(page);

    // 付款頁：保留說明與 15:00 倒數（手動模式停在付款頁）
    await expect(page.getByText(/請於 \d{2}:\d{2} 前完成付款/)).toBeVisible();
    await expect(page.getByText(/剩餘付款時間\s*1[45]:\d{2}/)).toBeVisible();

    // 時間穿梭快轉 +15 分鐘
    await fastForward(page, '快轉 +15 分鐘');
    await expect(page.getByText('付款時間已過')).toBeVisible({ timeout: 15_000 });

    // 返回訂單頁：已取消、原因付款逾時
    await page
      .getByRole('link', { name: '查看訂單' })
      .or(page.getByRole('button', { name: '查看訂單' }))
      .click();
    await expect(page).toHaveURL(new RegExp(`/orders/${orderId}$`));
    const card = page.getByRole('region', { name: /^取餐號碼/ });
    await expect(card).toContainText('已取消');
    await expect(page.getByText('原因：付款逾時')).toBeVisible();

    const [order] = await ownOrders(page);
    expect(order).toMatchObject({ status: 'CANCELLED', cancel_reason: '付款逾時' });
  });
});
