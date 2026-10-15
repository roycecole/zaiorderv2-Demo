// UAT-05 線上付款失敗改現金（01 §11；08 S5）
import { expect, test } from '@playwright/test';
import {
  fillContact,
  gotoApp,
  openCheckout,
  ownOrders,
  pickupNo,
  quickAdd,
  readDb,
  submitAndWaitForOrder,
} from './helpers/app';
import { setNextPaymentResult } from './helpers/demo';

test.describe('UAT-05 線上付款失敗改現金', () => {
  test('付款結果設為失敗，LINE Pay 送出 → 付款頁顯示失敗 → 改用現金後訂單成為 PENDING、付款方式現金', async ({
    page,
  }) => {
    await gotoApp(page);
    await quickAdd(page, '擔仔麵');
    await setNextPaymentResult(page, '失敗');

    await openCheckout(page);
    await fillContact(page);
    await page.getByRole('radio', { name: 'LINE Pay' }).check();
    const orderId = await submitAndWaitForOrder(page);

    // 付款頁：保留說明 → 約 1 秒「處理中」後自動顯示失敗
    await expect(page).toHaveURL(new RegExp(`/payment/${orderId}$`));
    await expect(page.getByText('已保留餐點與取餐時段，請於 12:15 前完成付款')).toBeVisible();
    const failure = page.getByRole('alert').filter({ hasText: '付款未完成' });
    await expect(failure).toBeVisible();
    await expect(failure).toContainText('可重新付款或改用現金');

    // 此時訂單仍待付款（付款失敗 ≠ 取消）
    const [pending] = await ownOrders(page);
    expect(pending).toMatchObject({ status: 'PENDING_PAYMENT', payment_method: 'LINE_PAY' });

    // 改用現金 → 訂單頁：PENDING、現金
    await page.getByRole('button', { name: '改用現金' }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${orderId}$`));
    await expect(pickupNo(page)).toContainText('A001');
    await expect(page.getByRole('region', { name: /^取餐號碼/ })).toContainText('等待店家確認');
    await expect(page.getByText('現金・取餐時付款')).toBeVisible();

    const [order] = await ownOrders(page);
    expect(order).toMatchObject({
      status: 'PENDING',
      payment_method: 'CASH',
      payment_status: 'UNPAID',
      total_amount: 60,
    });
    // 失敗的線上付款交易保留為 FAILED，不產生成功交易
    const payments = (await readDb(page)).payments.filter((p) => p.order_id === orderId);
    expect(payments.some((p) => p.status === 'FAILED' && p.method === 'LINE_PAY')).toBe(true);
    expect(payments.some((p) => p.status === 'SUCCESS')).toBe(false);
  });

  test('付款結果為「手動」時：付款失敗後可重新付款並成功，訂單成為待接單（已付款）', async ({
    page,
  }) => {
    await gotoApp(page);
    await quickAdd(page, '擔仔麵');
    await openCheckout(page);
    await fillContact(page);
    await page.getByRole('radio', { name: '信用卡' }).check();
    await submitAndWaitForOrder(page);

    await page.getByRole('button', { name: '付款失敗' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '付款未完成' })).toBeVisible();
    await page.getByRole('button', { name: '重新付款' }).click();
    await page.getByRole('button', { name: '付款成功' }).click();

    await expect(page).toHaveURL(/\/orders\//);
    await expect(page.getByText('已付款').first()).toBeVisible();
    const [order] = await ownOrders(page);
    expect(order).toMatchObject({ payment_method: 'CREDIT_CARD', payment_status: 'PAID' });
    expect(['PENDING', 'ACCEPTED']).toContain(order?.status);
  });
});
