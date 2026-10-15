// UAT-10 內用 QR 點餐（01 §11）
import { expect, test } from '@playwright/test';
import {
  gotoApp,
  openCheckout,
  ownOrders,
  pickupNo,
  quickAdd,
  submitAndWaitForOrder,
} from './helpers/app';

test.describe('UAT-10 內用 QR 點餐', () => {
  test('以 /?table=A3 進入：取餐方式鎖定「內用」、桌號 A3、無運費，取餐號碼前綴 T', async ({
    page,
  }) => {
    await gotoApp(page, { params: { table: 'A3' } });

    // 菜單頁頂部顯示「內用・桌號 A3」（03 PG-01、08 S10）；加入商品後右側訂單面板的標題同樣標示
    const strip = page.getByRole('region', { name: '內用桌號' });
    await expect(strip).toContainText('內用・桌號 A3');
    await expect(strip).toContainText('取餐方式已固定為內用');
    await quickAdd(page, '擔仔麵');
    await expect(page.getByRole('complementary', { name: '我的訂單' })).toContainText(
      '內用・桌號 A3',
    );
    await openCheckout(page);

    // 取餐方式鎖定為內用，其餘選項停用；桌號由 QR 帶入
    await expect(page.getByRole('radio', { name: '內用' })).toBeChecked();
    await expect(page.getByRole('radio', { name: '自取' })).toBeDisabled();
    await expect(page.getByRole('radio', { name: '外送' })).toBeDisabled();
    await expect(page.getByText('已由 QR 帶入桌號 A3，取餐方式固定為內用')).toBeVisible();
    await expect(page.getByText('桌號 A3', { exact: true })).toBeVisible();
    // 桌號由 QR 帶入並鎖定：沒有可編輯的桌號欄，不可改成別的（或不存在的）桌號
    await expect(page.getByRole('textbox', { name: /^桌號/ })).toHaveCount(0);

    // 無運費
    const summary = page.getByRole('complementary', { name: '訂單明細' });
    await expect(
      summary.locator('dt', { hasText: '運費' }).locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('—');
    await expect(
      summary.locator('dt', { hasText: '總計' }).locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('NT$ 60');

    // 內用的姓名與手機皆為選填；這裡只填手機，供店家聯絡
    await page.getByRole('textbox', { name: /^手機/ }).fill('0912345678');
    await submitAndWaitForOrder(page);

    await expect(pickupNo(page)).toContainText('T001');
    await expect(page.getByRole('region', { name: '內用資訊' })).toContainText(
      '內用・巷仔內小吃部・桌號 A3',
    );
    const [order] = await ownOrders(page);
    expect(order).toMatchObject({
      order_type: 'DINE_IN',
      table_no: 'A3',
      delivery_fee: 0,
      total_amount: 60,
      scheduled_at: null,
    });
    expect(order?.pickup_no.startsWith('T')).toBe(true);
  });

  test('購物車頁（< 1024）：站內導覽不帶 ?table=，取餐方式仍鎖定為內用並說明原因', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 820, height: 1000 });
    await gotoApp(page, { params: { table: 'A3' } });
    await expect(page.getByRole('region', { name: '內用桌號' })).toContainText('內用・桌號 A3');

    await quickAdd(page, '擔仔麵');
    await page.getByRole('link', { name: /查看購物車/ }).click();
    await expect(page).toHaveURL(/\/cart$/);

    const dineIn = page.getByRole('radio', { name: '內用' });
    await expect(dineIn).toBeChecked();
    await expect(page.getByRole('radio', { name: '自取' })).toBeDisabled();
    await expect(page.getByRole('radio', { name: '外送' })).toBeDisabled();
    await expect(page.getByText('已由 QR 帶入桌號 A3，取餐方式固定為內用')).toBeVisible();

    // 前往結帳後仍是內用、桌號 A3
    await openCheckout(page);
    await expect(page.getByRole('radio', { name: '內用' })).toBeChecked();
    await expect(page.getByText('桌號 A3', { exact: true })).toBeVisible();
  });

  test('桌號無法辨識：菜單頁與購物車頁說明已改為一般點餐，取餐方式不鎖定', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1000 });
    await gotoApp(page, { params: { table: 'Z9' } });
    await expect(page.getByText(/找不到 QR 帶入的桌號，已改為一般點餐/)).toBeVisible();
    // 回退文案說明桌號可以留空（內用可以沒有桌號）
    await expect(page.getByText(/要內用請改選「內用」（桌號可留空）/)).toBeVisible();
    await expect(page.getByRole('region', { name: '內用桌號' })).toHaveCount(0);

    await quickAdd(page, '擔仔麵');
    await page.getByRole('link', { name: /查看購物車/ }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByText(/找不到 QR 帶入的桌號，已改為一般點餐/)).toBeVisible();
    await expect(page.getByRole('radio', { name: '自取' })).toBeChecked();
    await expect(page.getByRole('radio', { name: '外送' })).toBeEnabled();
    await expect(page.getByRole('radio', { name: '內用' })).toBeEnabled();
  });
});
