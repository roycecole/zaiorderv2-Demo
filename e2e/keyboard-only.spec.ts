// UAT-16 純鍵盤點餐（FR-SY-12、KPI-09、BR-34、BR-42）
// A. 以提醒的「開啟」啟用單鍵快速鍵後，只用鍵盤完成：搜尋「滷」→ 商品面板 → 大碗 → 加入 → 結帳 → 填寫 → Ctrl/⌘+Enter
// B. 未啟用單鍵快速鍵時，僅用 Tab / 方向鍵 / Enter / Ctrl+Enter 重做一次
// 每個 Tab 停點都有可見的焦點指示；送出後焦點在訂單頁標題。
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  activeInfo,
  expectFocusIndicatorVisible,
  keyboardNotice,
  openApp,
  tabUntil,
} from './helpers/b-app';

test.use({ viewport: { width: 1440, height: 900 } });
// 逐停點的焦點指示截圖比對與整頁掃描較耗時
test.setTimeout(90_000);

/** 結帳頁：Tab 填姓名、手機，方向鍵選現金，Ctrl+Enter 送出，確認焦點在訂單頁標題 */
async function checkoutByKeyboard(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: '結帳' })).toBeVisible();
  await tabUntil(page, (i) => i.tag === 'INPUT' && i.name.startsWith('姓名'), {
    label: '結帳→姓名',
  });
  await page.keyboard.type('王小明');
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await activeInfo(page)).name).toMatch(/^手機/);
  await expectFocusIndicatorVisible(page, '手機欄');
  await page.keyboard.type('0912345678');

  // 付款方式：Tab 進入 radiogroup（焦點在已選的「現金」），以方向鍵切換後回到現金
  await tabUntil(page, (i) => i.type === 'radio' && i.name.includes('現金'), {
    label: '結帳→付款方式',
    max: 40,
  });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('radio', { name: /^現金/ })).toBeChecked();

  await page.keyboard.press('Control+Enter');
  await page.waitForURL('**/orders/**');
  const heading = page.getByRole('heading', { level: 1 }).first();
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
}

test('UAT-16 A：以提醒「開啟」啟用單鍵快速鍵後，純鍵盤完成點餐並送出', async ({ page }) => {
  await openApp(page);
  // 第一次 Tab → 提醒出現（不搶焦點）；Tab 越過三個跳過連結到「開啟」，Enter 啟用
  await page.keyboard.press('Tab');
  await expect(keyboardNotice(page)).toBeVisible({ timeout: 1500 });
  await tabUntil(page, (i) => i.tag === 'BUTTON' && i.name === '開啟', {
    label: '提醒→開啟',
    max: 6,
  });
  await page.keyboard.press('Enter');
  await expect(keyboardNotice(page)).toContainText('已開啟單鍵快速鍵');
  await page.keyboard.press('Escape');
  await expect(keyboardNotice(page)).toHaveCount(0);

  // s → 搜尋「滷」→ ↓ 把焦點移到第一個結果 → Enter 開啟商品面板
  await page.keyboard.press('s');
  const searchBox = page.getByRole('searchbox', { name: '搜尋菜單' });
  await expect(searchBox).toBeFocused();
  await page.keyboard.type('滷');
  await expect(page.getByRole('heading', { name: '搜尋結果' })).toBeVisible();
  await expect(page.locator('main article').first()).toContainText('滷');
  await page.keyboard.press('ArrowDown');
  await expectFocusIndicatorVisible(page, '搜尋結果第一張卡');
  await expect(page.locator('main article').first()).toContainText('招牌滷肉飯');
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: '招牌滷肉飯' });
  await expect(sheet).toBeVisible();
  // 開啟後焦點移入面板標題；等商品詳情載入完成（載入中沒有可 Tab 的內容）
  await expect(sheet.getByRole('heading', { name: '招牌滷肉飯' })).toBeFocused();
  await expect(sheet.getByRole('button', { name: /^加入購物車/ })).toBeVisible();

  // 商品面板：Tab 進入「份量」群組，↓ 選大碗；Tab 進入「加料」，Space 勾滷蛋；a 加入購物車
  await tabUntil(page, (i) => i.type === 'radio', { label: '面板→份量', max: 6 });
  await page.keyboard.press('ArrowDown');
  await expect(sheet.getByRole('radio', { name: '大碗' })).toBeChecked();
  await tabUntil(page, (i) => i.type === 'checkbox', { label: '面板→加料', max: 4 });
  await page.keyboard.press('Space');
  await expect(sheet.getByRole('checkbox', { name: '滷蛋' })).toBeChecked();
  await page.keyboard.press('a');
  await expect(sheet).toBeHidden();

  // c：桌機把焦點移到訂單面板；p 前往結帳
  await page.keyboard.press('c');
  await expect
    .poll(() =>
      page.evaluate(
        () => document.getElementById('orderpanel')?.contains(document.activeElement) ?? false,
      ),
    )
    .toBe(true);
  await expect(page.getByRole('complementary', { name: '我的訂單' })).toContainText('大碗・滷蛋');
  await page.keyboard.press('p');
  await page.waitForURL('**/checkout');

  await checkoutByKeyboard(page);
  // 訂單頁：取餐號碼（A 前綴）
  await expect(page.locator('main')).toContainText(/A\d{3}/);
});

test('UAT-16 B：未啟用單鍵快速鍵，僅用 Tab / 方向鍵 / Enter / Ctrl+Enter 完成點餐', async ({
  page,
}) => {
  await openApp(page);

  // 以 Tab 走到搜尋框（沿途每個停點都有可見焦點指示）
  await tabUntil(page, (i) => i.tag === 'INPUT' && i.name.includes('搜尋菜單'), {
    label: '首頁→搜尋框',
    max: 12,
  });
  await page.keyboard.type('滷');
  await expect(page.getByRole('heading', { name: '搜尋結果' })).toBeVisible();
  await expect(page.locator('main article').first()).toContainText('招牌滷肉飯');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: '招牌滷肉飯' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: '招牌滷肉飯' })).toBeFocused();
  await expect(sheet.getByRole('button', { name: /^加入購物車/ })).toBeVisible();

  await tabUntil(page, (i) => i.type === 'radio', { label: '面板→份量', max: 6 });
  await page.keyboard.press('ArrowDown');
  await expect(sheet.getByRole('radio', { name: '大碗' })).toBeChecked();
  await tabUntil(page, (i) => i.type === 'checkbox', { label: '面板→加料', max: 4 });
  await page.keyboard.press('Space');
  await expect(sheet.getByRole('checkbox', { name: '滷蛋' })).toBeChecked();
  // Tab 到「加入購物車」按 Enter
  await tabUntil(page, (i) => i.tag === 'BUTTON' && i.name.startsWith('加入購物車'), {
    label: '面板→加入購物車',
    max: 24,
  });
  await page.keyboard.press('Enter');
  await expect(sheet).toBeHidden();

  // Tab 到訂單面板的「前往結帳」，Enter
  await tabUntil(page, (i) => i.tag === 'A' && i.name.startsWith('前往結帳'), {
    label: '首頁→前往結帳',
    max: 60,
  });
  await page.keyboard.press('Enter');
  await page.waitForURL('**/checkout');

  await checkoutByKeyboard(page);
  await expect(page.locator('main')).toContainText(/A\d{3}/);
  // 全程未啟用單鍵快速鍵
  expect(await page.evaluate(() => window.localStorage.getItem('zaiorder:v1:prefs'))).not.toContain(
    '"hotkeysEnabled":true',
  );
});
