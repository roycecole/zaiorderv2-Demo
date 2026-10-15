// UAT-19 觸控面板模式（?mode=kiosk，1280×800）（FR-SY-14/15、BR-36/37/41；FLOW-21、FLOW-24）
// 目標 ≥ 56×56；60 / 90 秒閒置警示與重置；完成畫面 30 秒；本機儲存無個資鍵寫入；
// 單鍵停用、無鍵盤提醒；結果未知後閒置：警示多一行、重置後 Key 與記下的送出內容丟棄。
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  addProduct,
  boxOf,
  countKeyBadges,
  fillContact,
  findSmallTargets,
  goToCheckout,
  keyboardNotice,
  openApp,
  PERSONAL_STORAGE_KEYS,
} from './helpers/b-app';

const NOON_TAIPEI = '2026-10-14T12:00:00+08:00';

test.use({ viewport: { width: 1280, height: 800 } });
// 逐停點的焦點指示截圖比對與整頁掃描較耗時
test.setTimeout(90_000);

/** 假時鐘（涵蓋 setTimeout / setInterval / performance.now）＋記錄所有 Storage 寫入的鍵 */
async function startKiosk(page: Page, params: Record<string, string> = {}): Promise<void> {
  await page.clock.install({ time: new Date(NOON_TAIPEI) });
  await page.addInitScript(() => {
    const w = window as unknown as { __storageWrites: string[] };
    w.__storageWrites = [];
    const origSet = Storage.prototype.setItem;
    const origRemove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key: string, value: string): void {
      w.__storageWrites.push(`set:${key}`);
      origSet.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key: string): void {
      w.__storageWrites.push(`remove:${key}`);
      origRemove.call(this, key);
    };
  });
  await openApp(page, '/', { mode: 'kiosk', ...params });
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'kiosk');
}

/** 以假時鐘前進（毫秒），並等 React 處理計時器的狀態更新 */
async function advance(page: Page, ms: number): Promise<void> {
  await page.clock.fastForward(ms);
  await page.waitForTimeout(100);
}

async function personalWrites(page: Page): Promise<string[]> {
  return page.evaluate(
    (keys) => {
      const w = window as unknown as { __storageWrites: string[] };
      return w.__storageWrites.filter((entry) => keys.some((k) => entry.endsWith(`:${k}`)));
    },
    [...PERSONAL_STORAGE_KEYS],
  );
}

async function expectNoPersonalKeys(page: Page): Promise<void> {
  expect(await personalWrites(page), '觸控面板不得寫入個資鍵').toEqual([]);
  const present = await page.evaluate(
    (keys) => keys.filter((k) => window.localStorage.getItem(k) !== null),
    [...PERSONAL_STORAGE_KEYS],
  );
  expect(present).toEqual([]);
}

/** 加入一項商品並進入結帳、填聯絡資訊並送出（現金） */
async function placeOrder(page: Page, product = '滷蛋'): Promise<void> {
  await addProduct(page, product);
  await goToCheckout(page);
  await fillContact(page);
  await page.getByRole('button', { name: /^送出訂單/ }).click();
}

const idleDialog = (page: Page) => page.getByRole('alertdialog', { name: '還在嗎？' });

test('UAT-19 版面：目標 ≥ 56×56、無鍵盤徽章、無登入與查詢訂單入口、僅櫃檯付款', async ({
  page,
}) => {
  await startKiosk(page);

  // 菜單
  expect(await findSmallTargets(page, 56)).toEqual([]);
  expect(await countKeyBadges(page)).toBe(0);
  await expect(page.getByRole('link', { name: '登入' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '查詢訂單' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^鍵盤快速鍵與偏好/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '大字' })).toBeVisible();

  // 商品面板與訂單面板
  await page
    .getByRole('button', { name: /^加入 古早味紅茶/ })
    .first()
    .click();
  const sheet = page.getByRole('dialog', { name: '古早味紅茶' });
  await expect(sheet.getByRole('button', { name: /^加入購物車/ })).toBeVisible();
  expect(await findSmallTargets(page, 56)).toEqual([]);
  await sheet.getByRole('button', { name: /^加入購物車/ }).click();
  await expect(sheet).toBeHidden();
  await addProduct(page, '滷蛋');
  expect(await findSmallTargets(page, 56)).toEqual([]);

  // 主要按鈕高 ≥ 64
  const cta = page
    .getByRole('complementary', { name: '我的訂單' })
    .getByRole('link', { name: /^前往結帳/ });
  expect((await boxOf(cta)).height).toBeGreaterThanOrEqual(64);

  // 結帳：只有櫃檯付款；無「記住我的資料」
  await goToCheckout(page);
  expect(await findSmallTargets(page, 56)).toEqual([]);
  await expect(page.getByRole('radio', { name: /^現金（櫃檯付款）/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /LINE Pay|街口支付|信用卡/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /記住我的資料/ })).toHaveCount(0);
  const submit = page.getByRole('button', { name: /^送出訂單/ });
  expect((await boxOf(submit)).height).toBeGreaterThanOrEqual(64);
  // 不顯示鍵盤提示小字
  await expect(page.getByText('Ctrl/⌘ + Enter')).toHaveCount(0);
});

test('UAT-19 本機儲存：進入、操作、送出與重置全程不寫入 cart / session / prefs / guestOrders', async ({
  page,
}) => {
  await startKiosk(page);
  await expectNoPersonalKeys(page);

  await placeOrder(page);
  await page.waitForURL('**/orders/**');
  await expect(page.getByRole('heading', { level: 1, name: /取餐號碼/ })).toBeVisible();
  await expectNoPersonalKeys(page);

  // 「開始新訂單」重置後仍無寫入，且購物車清空
  await page.getByRole('button', { name: '開始新訂單' }).click();
  await expect(page).toHaveURL(/\/(\?|$)/);
  await expectNoPersonalKeys(page);
  await expect(page.getByRole('heading', { name: '購物車還是空的' })).toBeVisible();

  // 重新整理：仍為觸控面板模式，記憶體資料不殘留
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'kiosk');
  await expect(page.getByRole('heading', { name: '購物車還是空的' })).toBeVisible();
  await expectNoPersonalKeys(page);
});

test('UAT-19 單鍵快速鍵停用、不出現鍵盤提醒；Esc 與 Ctrl/⌘+Enter 仍有效', async ({ page }) => {
  await startKiosk(page);
  await addProduct(page, '滷蛋');
  await page.reload();
  await expect(page.locator('main article').first()).toBeVisible();

  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('c');
  await page.keyboard.press('s');
  await page.keyboard.press('?');
  await page.waitForTimeout(700);
  await expect(keyboardNotice(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: '搜尋菜單' })).not.toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(700);
  await expect(keyboardNotice(page)).toHaveCount(0);
  await expectNoPersonalKeys(page);

  // Esc 仍可關閉浮層
  await page
    .getByRole('button', { name: /^加入 古早味紅茶/ })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: '古早味紅茶' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Ctrl+Enter 仍可送出（結帳頁）
  await addProduct(page, '滷蛋');
  await goToCheckout(page);
  await fillContact(page);
  await page.getByRole('textbox', { name: /^手機/ }).press('Control+Enter');
  await page.waitForURL('**/orders/**');
});

test('UAT-19 閒置：60 秒警示（可延長）、90 秒重置清空購物車並回到菜單', async ({ page }) => {
  await startKiosk(page);
  await addProduct(page, '滷蛋');
  await addProduct(page, '古早味紅茶');
  const panel = page.getByRole('complementary', { name: '我的訂單' });
  await expect(panel).toContainText('滷蛋');

  // 59 秒：尚無警示；60 秒：警示出現，倒數 30 秒
  await advance(page, 59_000);
  await expect(idleDialog(page)).toHaveCount(0);
  await advance(page, 1_500);
  const dialog = idleDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/秒後將重新開始，購物車會清空/);
  await expect(dialog.getByRole('button', { name: '繼續點餐' })).toBeFocused();
  expect(await findSmallTargets(page, 56)).toEqual([]);
  // 沒有結果未知的那一行
  await expect(dialog).not.toContainText('上一筆訂單結果尚未確認');

  // 繼續點餐：警示消失、購物車保留、重新計時
  await dialog.getByRole('button', { name: '繼續點餐' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(panel).toContainText('滷蛋');
  await advance(page, 59_000);
  await expect(idleDialog(page)).toHaveCount(0);

  // 再閒置到 60 秒警示，之後不操作到 90 秒：重置
  await advance(page, 2_000);
  await expect(idleDialog(page)).toBeVisible();
  await advance(page, 31_000);
  await expect(idleDialog(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '購物車還是空的' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  await expectNoPersonalKeys(page);
});

test('UAT-19 完成畫面：超大取餐號碼、30 秒倒數可延長、「開始新訂單」「再看一下」', async ({
  page,
}) => {
  await startKiosk(page);
  await placeOrder(page);
  await page.waitForURL('**/orders/**');

  const heading = page.getByRole('heading', { level: 1, name: /取餐號碼/ });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByText('請至櫃檯付款並等候叫號')).toBeVisible();
  const countdown = page.getByTestId('kiosk-done-countdown');
  await expect(countdown).toHaveText(/^\d+ 秒後自動回到首頁$/);

  const startNew = page.getByRole('button', { name: '開始新訂單' });
  const keepLooking = page.getByRole('button', { name: '再看一下' });
  expect((await boxOf(startNew)).height).toBeGreaterThanOrEqual(64);
  expect((await boxOf(keepLooking)).height).toBeGreaterThanOrEqual(64);
  expect(await findSmallTargets(page, 56)).toEqual([]);

  // 倒數到約 10 秒，按「再看一下」重新計 30 秒
  await advance(page, 20_000);
  await expect(countdown).toHaveText(/^(9|10|11) 秒後自動回到首頁$/);
  await keepLooking.click();
  await advance(page, 1_500);
  await expect(countdown).toHaveText(/^(28|29|30) 秒後自動回到首頁$/);
  expect(new URL(page.url()).pathname).toMatch(/^\/orders\//);

  // 不操作至 30 秒：自動回到首頁
  await advance(page, 31_000);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  await expect(page.getByRole('heading', { name: '購物車還是空的' })).toBeVisible();
  await expectNoPersonalKeys(page);
});

test('UAT-19 結果未知：改顯示「請洽櫃檯確認」，閒置警示多一行，重置後下一位顧客使用新 Key', async ({
  page,
}) => {
  await startKiosk(page, { demo_fail: 'orders.create:AFTER_COMMIT:1' });
  await placeOrder(page, '滷蛋');

  // 結果未知：留在結帳頁；無店家電話連結與查詢訂單
  const alert = page.getByRole('alert').filter({ hasText: '無法確認訂單是否已送出' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('請洽櫃檯確認');
  await expect(alert.getByRole('button', { name: /再試一次/ })).toBeVisible();
  await expect(alert.getByRole('link')).toHaveCount(0);
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '查詢訂單' })).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/checkout');

  // 閒置：警示照常出現並多一行
  await advance(page, 61_000);
  const dialog = idleDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('上一筆訂單結果尚未確認，請洽櫃檯確認');

  // 90 秒重置：回到菜單、購物車清空
  await advance(page, 31_000);
  await expect(idleDialog(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '購物車還是空的' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');

  // 下一位顧客：相同品項再送出，必須是「新 Key」建立新訂單（不是重放前一位的訂單）
  await placeOrder(page, '滷蛋');
  await page.waitForURL('**/orders/**');
  const log = await page.evaluate(() => {
    const raw = window.localStorage.getItem('zaiorder:v1:db');
    const db =
      raw === null
        ? {}
        : (JSON.parse(raw) as {
            demo_request_log?: Array<{ idempotencyKey: string; outcome: string }>;
          });
    return db.demo_request_log ?? [];
  });
  const outcomes = log.map((entry) => entry.outcome);
  expect(outcomes).toEqual(['RESPONSE_LOST', 'CREATED']);
  expect(log[0]?.idempotencyKey).not.toBe(log[1]?.idempotencyKey);
  await expectNoPersonalKeys(page);
});
