import { expect, test } from '@playwright/test';

test('首頁可載入並顯示菜單', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.getByText('招牌滷肉飯').first()).toBeVisible();
});
