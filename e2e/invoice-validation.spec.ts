// UAT-12 統編發票驗證（01 §11；VR-11）
import { expect, test } from '@playwright/test';
import {
  fillContact,
  gotoApp,
  openCheckout,
  ownOrders,
  quickAdd,
  submitAndWaitForOrder,
} from './helpers/app';

test.describe('UAT-12 統編發票驗證', () => {
  test('發票選「統編」：04595258 顯示錯誤，改為 04595257 通過並可送出', async ({ page }) => {
    await gotoApp(page);
    await quickAdd(page, '擔仔麵');
    await openCheckout(page);
    await fillContact(page);

    await page.getByRole('radio', { name: '統編' }).check();
    const taxId = page.getByRole('textbox', { name: /^統一編號/ });
    await expect(taxId).toBeVisible();

    // 04595258：檢查碼錯誤 → 離開欄位後顯示錯誤，並以 aria-invalid / aria-describedby 關聯
    await taxId.fill('04595258');
    await taxId.blur();
    await expect(taxId).toHaveAttribute('aria-invalid', 'true');
    const error = page.getByText('統一編號格式不正確');
    await expect(error).toBeVisible();
    await expect(taxId).toHaveAccessibleDescription(/統一編號格式不正確/);

    // 04595257：通過
    await taxId.fill('04595257');
    await taxId.blur();
    await expect(error).toHaveCount(0);
    await expect(taxId).not.toHaveAttribute('aria-invalid', 'true');

    // 可送出，訂單記下統一編號
    await submitAndWaitForOrder(page);
    await expect(page.getByText('統一編號 04595257')).toBeVisible();
    const db = await ownOrders(page);
    expect(db).toHaveLength(1);
  });
});
