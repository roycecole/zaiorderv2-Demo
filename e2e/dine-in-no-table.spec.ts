// 內用可以沒有桌號（自由入座、先領餐號叫號）：BR-22 修訂；桌號選填、有填才驗證（VR-10 + 店家桌位）
import { expect, test } from '@playwright/test';
import {
  fillContact,
  gotoApp,
  openCheckout,
  ownOrders,
  pickupNo,
  quickAdd,
  submitAndWaitForOrder,
  submitButton,
} from './helpers/app';
import { addProduct, goToCheckout, openApp } from './helpers/b-app';

test.describe('內用沒有桌號', () => {
  test('手動選「內用」→ 桌號留空 → 送出成功：訂單頁顯示「內用」與取餐號碼 T001，沒有桌號列', async ({
    page,
  }) => {
    await gotoApp(page);
    await quickAdd(page, '擔仔麵');
    await openCheckout(page);

    // 沒掃 QR 時取餐方式不鎖定；手動改選「內用」
    await expect(page.getByRole('radio', { name: '自取' })).toBeChecked();
    await page.getByRole('radio', { name: '內用' }).check();

    // 桌號為選填，說明沒有桌號時如何叫號；留空不產生錯誤
    const table = page.getByRole('textbox', { name: /^桌號/ });
    await expect(table).toBeVisible();
    await expect(page.getByText('桌號（選填）')).toBeVisible();
    await expect(page.getByText('沒有桌號可以留空，餐點好了會依取餐號碼叫號')).toBeVisible();
    await expect(table).toHaveValue('');

    // 內用的姓名、手機皆可不填，直接送出
    await submitAndWaitForOrder(page);

    await expect(pickupNo(page)).toContainText('T001');
    const info = page.getByRole('region', { name: '內用資訊' });
    await expect(info).toContainText('內用・巷仔內小吃部・取餐號碼 T001');
    await expect(info).not.toContainText('桌號');
    await expect(info).not.toContainText('undefined');
    await expect(page.getByRole('main')).not.toContainText('桌號');

    // 訂單沒有桌號快照；取餐號碼前綴仍為 T
    const orders = await ownOrders(page);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      order_type: 'DINE_IN',
      table_no: null,
      pickup_no: 'T001',
      delivery_fee: 0,
      scheduled_at: null,
    });
  });

  test('填入不存在的桌號 → 留在結帳頁並標示桌號欄錯誤；清空桌號後可成立', async ({ page }) => {
    await gotoApp(page);
    await quickAdd(page, '擔仔麵');
    await openCheckout(page);
    await page.getByRole('radio', { name: '內用' }).check();

    const table = page.getByRole('textbox', { name: /^桌號/ });
    await table.fill('Z9');
    await expect(table).toHaveValue('Z9');
    await submitButton(page).click();

    // 被伺服器退回（422 TABLE_NOT_FOUND）：仍在結帳頁，錯誤標示在桌號欄
    await expect(table).toHaveAttribute('aria-invalid', 'true');
    await expect(table).toHaveAccessibleDescription(/找不到這個桌號，請洽店員協助/);
    await expect(page).toHaveURL(/\/checkout$/);
    expect(await ownOrders(page)).toHaveLength(0);

    // 異動清單的「確認桌號」把焦點帶到桌號欄
    await page.getByRole('button', { name: '確認桌號' }).click();
    await expect(table).toBeFocused();

    // 沒有桌號可以留空：清空後錯誤標示消失，再次送出成立
    await table.fill('');
    await expect(table).not.toHaveAttribute('aria-invalid', 'true');
    await submitAndWaitForOrder(page);
    await expect(pickupNo(page)).toContainText('T001');
    const [order] = await ownOrders(page);
    expect(order).toMatchObject({ order_type: 'DINE_IN', table_no: null });
  });

  test('桌號被退回後改選「自取」：桌號異動不再佔著清單與鎖定送出，自取單可直接送出', async ({
    page,
  }) => {
    await gotoApp(page);
    await quickAdd(page, '擔仔麵');
    await openCheckout(page);
    await page.getByRole('radio', { name: '內用' }).check();

    const table = page.getByRole('textbox', { name: /^桌號/ });
    await table.fill('Z9');
    await submitButton(page).click();
    await expect(table).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: '確認桌號' })).toBeVisible();

    // 改選自取：桌號欄消失，被退回的桌號異動與「確認桌號」一併移除，送出鈕不再鎖定
    await page.getByRole('radio', { name: '自取' }).check();
    await expect(page.getByRole('textbox', { name: /^桌號/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '確認桌號' })).toHaveCount(0);
    await expect(page.getByText(/找不到這個桌號/)).toHaveCount(0);
    await fillContact(page);
    await expect(submitButton(page)).toBeVisible();
    await expect(submitButton(page)).not.toHaveAttribute('aria-disabled', 'true');

    await submitAndWaitForOrder(page);
    const [order] = await ownOrders(page);
    expect(order).toMatchObject({ order_type: 'PICKUP', table_no: null });
  });

  test('桌號格式不符（含符號）：在欄位標示且不送出；改為存在的桌號 A3 後成立並帶桌號快照', async ({
    page,
  }) => {
    await gotoApp(page);
    await quickAdd(page, '擔仔麵');
    await openCheckout(page);
    await page.getByRole('radio', { name: '內用' }).check();

    const table = page.getByRole('textbox', { name: /^桌號/ });
    await table.fill('A-3');
    await submitButton(page).click();
    await expect(table).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('找不到此桌號，請洽店員').first()).toBeVisible();
    expect(await ownOrders(page)).toHaveLength(0);

    await table.fill('a3');
    await expect(table).toHaveValue('A3'); // 自動轉大寫
    await submitAndWaitForOrder(page);
    await expect(page.getByRole('region', { name: '內用資訊' })).toContainText(
      '內用・巷仔內小吃部・桌號 A3',
    );
    const [order] = await ownOrders(page);
    expect(order).toMatchObject({ order_type: 'DINE_IN', table_no: 'A3' });
  });

  test('QR 桌號無法辨識：提示「桌號可留空」；改選「內用」後留空仍可成立', async ({ page }) => {
    await gotoApp(page, { params: { table: 'Z9' } });
    await expect(
      page.getByText(/找不到 QR 帶入的桌號，已改為一般點餐；要內用請改選「內用」（桌號可留空）/),
    ).toBeVisible();

    await quickAdd(page, '擔仔麵');
    await openCheckout(page);
    await expect(page.getByRole('radio', { name: '自取' })).toBeChecked();
    await page.getByRole('radio', { name: '內用' }).check();

    // 說明不是欄位錯誤：桌號欄沒有 aria-invalid，留空即可送出
    const table = page.getByRole('textbox', { name: /^桌號/ });
    await expect(table).not.toHaveAttribute('aria-invalid', 'true');
    await submitAndWaitForOrder(page);
    await expect(pickupNo(page)).toContainText('T001');
    const [order] = await ownOrders(page);
    expect(order).toMatchObject({ order_type: 'DINE_IN', table_no: null });
  });
});

test.describe('觸控面板（?mode=kiosk）', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('內用沒有桌號輸入，也不因缺桌號被擋下；送出後完成畫面顯示取餐號碼', async ({ page }) => {
    await openApp(page, '/', { mode: 'kiosk' });
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'kiosk');
    await addProduct(page, '滷蛋');
    await goToCheckout(page);

    await page.getByRole('radio', { name: '內用' }).check();
    await expect(page.getByRole('textbox', { name: /^桌號/ })).toHaveCount(0);
    await expect(page.getByText('內用不需要桌號，餐點好了會依取餐號碼叫號')).toBeVisible();

    await page.getByRole('button', { name: /^送出訂單/ }).click();
    await page.waitForURL('**/orders/**');
    await expect(page.getByRole('heading', { level: 1, name: /取餐號碼/ })).toContainText('T001');
    await expect(page.getByRole('main')).not.toContainText('桌號');
  });
});
