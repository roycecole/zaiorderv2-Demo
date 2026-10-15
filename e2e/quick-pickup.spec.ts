// UAT-01 手機自取快速點餐（01 §11；08 S1）
import { expect, test } from '@playwright/test';
import {
  addViaSheet,
  fillContact,
  gotoApp,
  horizontalOverflow,
  openCheckout,
  ownOrders,
  pickupNo,
  submitAndWaitForOrder,
  submitButton,
} from './helpers/app';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('UAT-01 手機自取快速點餐', () => {
  test('滷肉飯大碗＋滷蛋與古早味紅茶，自取盡快、現金送出，取餐號碼 A001、總額 NT$ 92 @mobile', async ({
    page,
  }) => {
    // Given：訪客（未登入）、12:00、手機寬 390
    await gotoApp(page);
    await expect(page.getByRole('status').filter({ hasText: '營業中' })).toBeVisible();

    // When：加入「滷肉飯 大碗 + 滷蛋」與「古早味紅茶」
    await addViaSheet(page, '招牌滷肉飯', { radios: ['大碗'], checks: ['滷蛋'] });
    await addViaSheet(page, '古早味紅茶'); // 預設：中杯・半糖・微冰
    const cartBar = page.getByRole('link', { name: /查看購物車/ });
    await expect(cartBar).toContainText('2 項');
    await expect(cartBar).toContainText('NT$ 92');

    // → 結帳 → 自取盡快 → 填姓名手機 → 現金
    await openCheckout(page);
    await expect(page.getByRole('radio', { name: '自取' })).toBeChecked();
    await expect(page.getByRole('radio', { name: '盡快' })).toBeChecked();
    await fillContact(page);
    await expect(page.getByRole('radio', { name: '現金' })).toBeChecked();

    // 金額 = ($35+$20+$12)+$25 = $92（小計、總計與送出鈕一致）
    const summary = page.getByRole('region', { name: '訂單明細' });
    await expect(summary).toContainText('NT$ 92');
    await expect(submitButton(page)).toHaveAccessibleName('送出訂單 · NT$ 92');
    expect((await horizontalOverflow(page)).scrollWidth).toBeLessThanOrEqual(390);

    // → 送出
    await submitAndWaitForOrder(page);

    // Then：訂單頁顯示取餐號碼 A001、狀態「等待店家確認」、總額 NT$ 92
    await expect(page).toHaveURL(/\/orders\//);
    await expect(pickupNo(page)).toContainText('A001');
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(page.getByText('等待店家確認').first()).toBeVisible();
    await expect(page.getByRole('region', { name: /訂單明細/ })).toContainText('NT$ 92');
    await expect(page.getByText('現金・取餐時付款')).toBeVisible();

    // 全程免登入；資料庫只有一筆自己的訂單，狀態 PENDING、金額 92、現金、自取
    expect(new URL(page.url()).pathname).not.toBe('/login');
    const orders = await ownOrders(page);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      status: 'PENDING',
      order_type: 'PICKUP',
      payment_method: 'CASH',
      subtotal_amount: 92,
      total_amount: 92,
      delivery_fee: 0,
      scheduled_at: null,
    });
    expect(orders[0]?.pickup_no).toBe('A001');
    expect((await horizontalOverflow(page)).scrollWidth).toBeLessThanOrEqual(390);
  });
});
