// UAT-07 取消訂單（01 §11；08 S7）
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  fillContact,
  gotoApp,
  openCheckout,
  ownOrders,
  quickAdd,
  submitAndWaitForOrder,
} from './helpers/app';
import { fastForward, setAutoSimulate, storeAction } from './helpers/demo';

/** 加入擔仔麵 → 結帳 → 現金送出，回到訂單頁 */
async function placeCashOrder(page: Page): Promise<string> {
  await quickAdd(page, '擔仔麵');
  await openCheckout(page);
  await fillContact(page);
  return submitAndWaitForOrder(page);
}

test.describe('UAT-07 取消訂單', () => {
  test('PENDING 的訂單可取消：確認後變為已取消', async ({ page }) => {
    await gotoApp(page);
    await setAutoSimulate(page, false); // 停在「等待店家確認」
    await placeCashOrder(page);
    const card = page.getByRole('region', { name: /^取餐號碼/ });
    await expect(card).toContainText('等待店家確認');

    // 取消：對話框說明並預設焦點在安全選項（保留訂單）
    await page.getByRole('button', { name: '取消訂單' }).click();
    const dialog = page.getByRole('alertdialog', { name: '確定要取消這筆訂單嗎？' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '保留訂單' })).toBeFocused();
    await dialog.getByRole('button', { name: '確認取消' }).click();

    await expect(card).toContainText('已取消');
    await expect(page.getByText('你取消了這筆訂單・原因：顧客自行取消')).toBeVisible();
    await expect(page.getByRole('button', { name: '取消訂單' })).toHaveCount(0);
    // 已取消的訂單可「再來一單」
    await expect(page.getByRole('button', { name: '再來一單' })).toBeVisible();

    const [order] = await ownOrders(page);
    expect(order).toMatchObject({ status: 'CANCELLED', cancelled_by: 'CUSTOMER' });
  });

  test('店家已接單（ACCEPTED）：沒有取消按鈕，改為「致電店家」', async ({ page }) => {
    await gotoApp(page);
    await setAutoSimulate(page, false);
    await placeCashOrder(page);
    await expect(page.getByRole('button', { name: '取消訂單' })).toBeVisible();

    await storeAction(page, '接單');
    await page.getByRole('button', { name: '立即更新' }).click();
    const card = page.getByRole('region', { name: /^取餐號碼/ });
    await expect(card).toContainText('製作中');
    await expect(page.getByRole('button', { name: '取消訂單' })).toHaveCount(0);
    const call = page.getByRole('link', { name: /^致電店家/ }).first();
    await expect(call).toBeVisible();
    await expect(call).toHaveAttribute('href', 'tel:0200000000');
  });
  test('接單逾時：自動模擬關閉、店家未接單，快轉 +15 分鐘後訂單轉為已取消（接單逾時）', async ({
    page,
  }) => {
    await gotoApp(page);
    await setAutoSimulate(page, false);
    await placeCashOrder(page);
    const card = page.getByRole('region', { name: /^取餐號碼/ });
    await expect(card).toContainText('等待店家確認');

    await fastForward(page, '快轉 +15 分鐘');
    await page.getByRole('button', { name: '立即更新' }).click();
    await expect(card).toContainText('已取消');
    const [order] = await ownOrders(page);
    expect(order).toMatchObject({ status: 'CANCELLED', cancelled_by: 'SYSTEM' });
  });
});
