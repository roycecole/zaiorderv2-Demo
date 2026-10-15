// UAT-04 暫停接單（01 §11；08 S3 變體）
import { expect, test } from '@playwright/test';
import { gotoApp, openCheckout, quickAdd, submitButton } from './helpers/app';
import { setStoreStatus } from './helpers/demo';

test.describe('UAT-04 暫停接單', () => {
  test('Demo 面板設為暫停接單：結帳頁整頁唯讀、送出鈕停用並顯示說明與店家電話；改回自動即恢復', async ({
    page,
  }) => {
    await gotoApp(page);
    await quickAdd(page, '擔仔麵'); // 暫停期間仍可加入購物車
    await setStoreStatus(page, '暫停接單');
    await expect(page.getByRole('status').filter({ hasText: '暫停接單' }).first()).toBeVisible();

    await openCheckout(page);
    // 暫停接單說明與店家電話
    await expect(page.getByText('店家目前較忙，暫停接單。可稍後再試或直接來電')).toBeVisible();
    const call = page.getByRole('link', { name: '致電巷仔內小吃部（02-0000-0000）' });
    await expect(call).toHaveAttribute('href', 'tel:0200000000');
    // 送出鈕停用並說明；表單唯讀
    await expect(submitButton(page)).toBeDisabled();
    await expect(page.getByText('店家暫停接單，暫時無法送出')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^姓名/ })).toBeDisabled();
    await expect(page.getByRole('radio', { name: '盡快' })).toBeDisabled();

    // 改回「自動」即恢復
    await setStoreStatus(page, '自動');
    await expect(page.getByRole('textbox', { name: /^姓名/ })).toBeEnabled();
    await expect(page.getByText('店家暫停接單，暫時無法送出')).toHaveCount(0);
  });
});
