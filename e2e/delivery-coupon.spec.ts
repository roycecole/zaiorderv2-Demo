// UAT-02 外送 + 折扣碼 + 免運（01 §11；08 S2）
import { expect, test } from '@playwright/test';
import {
  addViaSheet,
  fillContact,
  gotoApp,
  openCheckout,
  ownOrders,
  pickupNo,
  quickAdd,
  submitAndWaitForOrder,
  submitButton,
} from './helpers/app';

test.describe('UAT-02 外送 + 折扣碼 + 免運', () => {
  test('小計 $420 外送大安區：運費 $0、LUNCH10 折扣 −$40、總計 $380，並可送出', async ({
    page,
  }) => {
    // Given：12:00、購物車小計 $420（紅燒牛肉麵 ×2 + 擔仔麵 ×1）
    await gotoApp(page);
    await addViaSheet(page, '紅燒牛肉麵', { quantity: 2 });
    await quickAdd(page, '擔仔麵');
    await openCheckout(page);

    // When：外送 → 地址選「大安區」
    await page.getByRole('radio', { name: '外送' }).first().check();
    await page.getByRole('combobox', { name: /縣市/ }).selectOption('臺北市');
    await page.getByRole('combobox', { name: /行政區/ }).selectOption('大安區');
    await page.getByRole('textbox', { name: /詳細地址/ }).fill('示範路 5 號');

    const summary = page.getByRole('complementary', { name: '訂單明細' });
    await expect(page.getByText('外送費 NT$ 30（滿 NT$ 400 免運）')).toBeVisible();
    await expect(
      summary.locator('dt', { hasText: '運費' }).locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('免運');

    // → 輸入 LUNCH10
    await page.getByRole('textbox', { name: /折扣碼/ }).fill('LUNCH10');
    await page.getByRole('button', { name: '套用' }).click();
    await expect(page.getByText('已套用 LUNCH10')).toBeVisible();

    // Then：小計 $420、運費 $0（免運）、折扣 −$40、總計 $380
    const valueOf = (term: string) =>
      summary.locator('dt', { hasText: term }).locator('xpath=following-sibling::dd[1]');
    await expect(valueOf('小計')).toHaveText('NT$ 420');
    await expect(valueOf('運費')).toHaveText('免運');
    await expect(valueOf('折扣')).toHaveText('−NT$ 40');
    await expect(valueOf('總計')).toHaveText('NT$ 380');
    await expect(submitButton(page)).toHaveAccessibleName('送出訂單 · NT$ 380');

    // 送出：訂單金額與取餐號碼前綴（外送 D）
    await fillContact(page);
    await submitAndWaitForOrder(page);
    await expect(pickupNo(page)).toContainText('D001');
    const orders = await ownOrders(page);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      order_type: 'DELIVERY',
      subtotal_amount: 420,
      delivery_fee: 0,
      discount_amount: 40,
      total_amount: 380,
      coupon_code: 'LUNCH10',
      delivery_district: '大安區',
    });
  });

  test('外送費依行政區計算：小計未達免運門檻時收運費，可套用折扣碼後再移除', async ({ page }) => {
    await gotoApp(page);
    await addViaSheet(page, '紅燒牛肉麵'); // $180，大安區免運門檻 $400、最低消費 $150
    await quickAdd(page, '擔仔麵'); // +$60 → $240
    await openCheckout(page);
    await page.getByRole('radio', { name: '外送' }).first().check();
    await page.getByRole('combobox', { name: /縣市/ }).selectOption('臺北市');
    await page.getByRole('combobox', { name: /行政區/ }).selectOption('大安區');
    await page.getByRole('textbox', { name: /詳細地址/ }).fill('示範路 5 號');

    const summary = page.getByRole('complementary', { name: '訂單明細' });
    const valueOf = (term: string) =>
      summary.locator('dt', { hasText: term }).locator('xpath=following-sibling::dd[1]');
    await expect(valueOf('運費')).toHaveText('NT$ 30');
    await expect(valueOf('總計')).toHaveText('NT$ 270');

    // WELCOME50 需小計滿 $250：$240 不符 → 顯示錯誤並計入送出鈕的待處理項目
    const code = page.getByRole('textbox', { name: /折扣碼/ });
    await code.fill('WELCOME50');
    await page.getByRole('button', { name: '套用' }).click();
    await expect(page.getByText('還沒有達到這個折扣碼的最低消費').first()).toBeVisible();
    await expect(page.getByText('折扣碼 WELCOME50')).toBeVisible();
    await expect(valueOf('折扣')).toHaveText('—');
    await expect(page.getByText('還有 1 項需要處理')).toBeVisible();

    // 移除後改 LUNCH10：9 折（−$24）
    await page.getByRole('button', { name: '移除折扣碼 WELCOME50' }).click();
    await code.fill('LUNCH10');
    await page.getByRole('button', { name: '套用' }).click();
    await expect(valueOf('折扣')).toHaveText('−NT$ 24');
    await expect(valueOf('總計')).toHaveText('NT$ 246');

    await page.getByRole('button', { name: '移除折扣碼 LUNCH10' }).click();
    await expect(valueOf('折扣')).toHaveText('—');
    await expect(valueOf('總計')).toHaveText('NT$ 270');
  });
  test('S2 選做：FREESHIP 於免運單折抵 $0；切回自取顯示「不適用此取餐方式」並鎖定送出，移除後回到 $420；板橋區超出外送範圍', async ({
    page,
  }) => {
    await gotoApp(page);
    await addViaSheet(page, '紅燒牛肉麵', { quantity: 2 });
    await quickAdd(page, '擔仔麵');
    await openCheckout(page);
    await fillContact(page);
    await page.getByRole('radio', { name: '外送' }).first().check();
    await page.getByRole('combobox', { name: /縣市/ }).selectOption('臺北市');
    await page.getByRole('combobox', { name: /行政區/ }).selectOption('大安區');
    await page.getByRole('textbox', { name: /詳細地址/ }).fill('示範路 5 號');

    const summary = page.getByRole('complementary', { name: '訂單明細' });
    const valueOf = (term: string) =>
      summary.locator('dt', { hasText: term }).locator('xpath=following-sibling::dd[1]');

    // FREESHIP：本單已免運，折抵 $0
    await page.getByRole('textbox', { name: /折扣碼/ }).fill('FREESHIP');
    await page.getByRole('button', { name: '套用' }).click();
    await expect(page.getByText('已套用 FREESHIP')).toBeVisible();
    await expect(valueOf('折扣')).toHaveText('—');
    await expect(valueOf('總計')).toHaveText('NT$ 420');

    // 切回自取：折扣碼不適用，送出鈕鎖定並說明還有 1 項需要處理
    await page.getByRole('radio', { name: '自取' }).first().check();
    await expect(page.getByText('這個折扣碼不適用於目前的取餐方式').first()).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();
    await expect(page.getByText('還有 1 項需要處理')).toBeVisible();
    await page.getByRole('button', { name: '移除折扣碼 FREESHIP' }).click();
    await expect(valueOf('總計')).toHaveText('NT$ 420');
    await expect(submitButton(page)).toBeEnabled();

    // 改回外送，地址選新北市板橋區（220）：超出外送範圍並提供「改為自取」
    await page.getByRole('radio', { name: '外送' }).first().check();
    await page.getByRole('combobox', { name: /縣市/ }).selectOption('新北市');
    await page.getByRole('combobox', { name: /行政區/ }).selectOption('板橋區');
    await expect(page.getByText('此地址不在外送範圍內，可改為自取')).toBeVisible();
    await page.getByRole('button', { name: '改為自取' }).click();
    await expect(page.getByRole('radio', { name: '自取' }).first()).toBeChecked();
  });
});
