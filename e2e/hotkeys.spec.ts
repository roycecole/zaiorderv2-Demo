// UAT-17 快速鍵預設關閉、提示與關閉（BR-34、BR-42、FR-SY-13/17/18、EC-25）
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  addButtonOf,
  addProduct,
  boxOf,
  countKeyBadges,
  helpButton,
  keyboardNotice,
  openApp,
} from './helpers/b-app';

test.use({ viewport: { width: 1440, height: 900 } });

/** 桌機的訂單面板（`c` 的目標）是否持有焦點 */
async function orderPanelHasFocus(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.getElementById('orderpanel')?.contains(document.activeElement) ?? false,
  );
}

/** 點擊頁面空白處讓焦點離開輸入元件（落在 <main>），並確認沒有開啟任何浮層 */
async function focusPageBackground(page: Page): Promise<void> {
  await page.locator('body').click({ position: { x: 5, y: 300 } });
}

async function seedCart(page: Page): Promise<void> {
  await openApp(page);
  await addProduct(page, '滷蛋');
  await page.reload();
  await expect(page.locator('main article').first()).toBeVisible();
}

test('UAT-17 預設關閉 → 按 c 無反應並出現提醒 → 開啟 → c 生效 → ? 說明 → 搜尋框不觸發 → 停用 → 重新整理', async ({
  page,
}) => {
  await seedCart(page);

  // 1. 載入時無小寫字母徽章；aria-keyshortcuts 只出現在 Esc / Ctrl+Enter 類（此頁沒有）
  expect(await countKeyBadges(page)).toBe(0);
  await expect(page.locator('[aria-keyshortcuts]')).toHaveCount(0);

  // 2. 首次按 c：購物車不開啟、版面不位移，提醒出現
  await focusPageBackground(page);
  const searchBox = page.getByRole('searchbox', { name: '搜尋菜單' });
  const before = await boxOf(searchBox);
  await page.keyboard.press('c');
  const notice = keyboardNotice(page);
  await expect(notice).toBeVisible({ timeout: 1500 });
  expect(await orderPanelHasFocus(page)).toBe(false);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await boxOf(searchBox)).toEqual(before);

  // 3. 在提醒按「開啟」：徽章出現；再按 c 開啟購物車（桌機：焦點移到訂單面板）
  await notice.getByRole('button', { name: '開啟', exact: true }).click();
  await expect(notice).toContainText('已開啟單鍵快速鍵');
  expect(await countKeyBadges(page)).toBeGreaterThan(0);
  await focusPageBackground(page);
  await page.keyboard.press('c');
  await expect.poll(() => orderPanelHasFocus(page)).toBe(true);

  // 4. 按 ? 開啟說明對話框：列出全部快速鍵；Esc 關閉並還原焦點
  await focusPageBackground(page);
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: '鍵盤快速鍵與偏好' });
  await expect(dialog).toBeVisible();
  for (const label of [
    '顯示 / 關閉快速鍵說明',
    '搜尋菜單',
    '回到菜單',
    '開啟購物車',
    '關閉浮層、清除搜尋',
    '切換圖卡 / 清單',
    '加入焦點商品',
    '加入購物車',
    '送出訂單',
    '再來一單',
  ]) {
    await expect(dialog.getByText(label, { exact: false }).first()).toBeVisible();
  }
  await expect(dialog.getByRole('switch', { name: '啟用單鍵快速鍵' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const active = await page.evaluate(() => document.activeElement?.tagName ?? '');
  expect(['MAIN', 'BODY']).toContain(active);

  // 5. 搜尋框內輸入 c 不觸發；Esc 清除並離開搜尋框
  await page.keyboard.press('s');
  await expect(searchBox).toBeFocused();
  await page.keyboard.type('co');
  await expect(searchBox).toHaveValue('co');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(searchBox).toHaveValue('');
  await expect(searchBox).not.toBeFocused();

  // 6. 輸入法組字中（isComposing）不觸發 c
  await focusPageBackground(page);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', isComposing: true, bubbles: true }),
    );
  });
  expect(new URL(page.url()).pathname).toBe('/');

  // 7. 再按 ?，於說明對話框停用單鍵快速鍵並關閉
  await page.keyboard.press('?');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('switch', { name: '啟用單鍵快速鍵' }).click();
  await expect(dialog.getByRole('switch', { name: '啟用單鍵快速鍵' })).not.toBeChecked();
  await dialog.getByRole('button', { name: '完成' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => countKeyBadges(page)).toBe(0);

  // 8. 停用後 c 與 ? 失效（焦點不在輸入框）
  await focusPageBackground(page);
  await page.keyboard.press('c');
  expect(await orderPanelHasFocus(page)).toBe(false);
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 9. 商品面板仍可由 Esc 關閉
  await addButtonOf(page, '古早味紅茶').first().click();
  await expect(page.getByRole('dialog', { name: '古早味紅茶' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 10. 重新整理：維持關閉，且不會再自動提醒（已處理過）
  await page.reload();
  await expect(page.locator('main article').first()).toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(700);
  await expect(keyboardNotice(page)).toHaveCount(0);
  expect(await countKeyBadges(page)).toBe(0);
  await expect(page.locator('[aria-keyshortcuts]')).toHaveCount(0);
});

test('UAT-17 未啟用時 c、s、? 都不攔截；Esc 仍可關閉浮層', async ({ page }) => {
  await seedCart(page);
  await focusPageBackground(page);

  // 未啟用：s 不進搜尋、? 不開對話框、c 不移焦點；且 keydown 未被 preventDefault（不攔截瀏覽器與輔助科技）
  await page.evaluate(() => {
    const w = window as unknown as { __prevented: Record<string, boolean> };
    w.__prevented = {};
    // 冒泡階段：HotkeyProvider（capture）已處理完
    document.addEventListener('keydown', (e) => {
      w.__prevented[e.key] = e.defaultPrevented;
    });
  });
  await page.keyboard.press('s');
  await page.keyboard.press('?');
  await page.keyboard.press('c');
  await expect(page.getByRole('searchbox', { name: '搜尋菜單' })).not.toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await orderPanelHasFocus(page)).toBe(false);
  expect(
    await page.evaluate(
      () => (window as unknown as { __prevented: Record<string, boolean> }).__prevented,
    ),
  ).toEqual({ s: false, '?': false, c: false });

  // Esc 不受開關影響：商品面板可關閉
  await addButtonOf(page, '古早味紅茶').first().click();
  await expect(page.getByRole('dialog', { name: '古早味紅茶' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 入口仍在：⌨ 按鈕開啟說明對話框，開關為第一個可操作控制項
  await helpButton(page).click();
  const dialog = page.getByRole('dialog', { name: '鍵盤快速鍵與偏好' });
  await expect(dialog.getByRole('switch', { name: '啟用單鍵快速鍵' })).not.toBeChecked();
  // 焦點先落在對話框標題，其後依序為「關閉」與第一個內容控制項（啟用單鍵快速鍵）
  await expect(dialog.getByRole('heading', { name: '鍵盤快速鍵與偏好' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '關閉' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('switch', { name: '啟用單鍵快速鍵' })).toBeFocused();
});
