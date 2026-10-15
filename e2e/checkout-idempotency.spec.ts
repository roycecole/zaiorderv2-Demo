// UAT-25 連點與回應遺失只建立一筆（BR-27/41、EC-04/05/35/36；FLOW-24）
import { expect, test } from '@playwright/test';
import {
  addComboShare,
  addProduct,
  currentIdempotencyKey,
  fillContact,
  goToCheckout,
  openApp,
  ownOrders,
  readMockDb,
  submitButton,
  waitCheckoutSettled,
} from './helpers/b-app';

test.use({ viewport: { width: 1440, height: 900 } });

test('UAT-25 回應遺失：顯示結果未知 → 再試一次 → 只有 1 筆訂單、庫存只扣一次、取餐號碼不跳號', async ({
  page,
}) => {
  await openApp(page, '/', { demo_fail: 'orders.create:AFTER_COMMIT:1' });
  await addComboShare(page, 1);
  await goToCheckout(page);
  await fillContact(page, { name: '陳大文' });
  await waitCheckoutSettled(page);
  await page.getByRole('button', { name: /^送出訂單/ }).click();

  // 結果未知：留在結帳頁、說明再試一次不會重複下單、提供「再試一次」與店家電話
  const alert = page.getByRole('alert').filter({ hasText: '無法確認訂單是否已送出' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('再試一次不會重複下單');
  await expect(alert.getByRole('link', { name: /^致電.*確認$/ })).toHaveAttribute('href', /^tel:/);
  expect(new URL(page.url()).pathname).toBe('/checkout');
  // 已填資料與付款方式都還在
  await expect(page.getByRole('textbox', { name: /^姓名/ })).toHaveValue('陳大文');
  await expect(page.getByRole('radio', { name: '現金' })).toBeChecked();
  const key = await currentIdempotencyKey(page);
  expect(key).not.toBeNull();

  // 訂單其實已建立（回應遺失）：此時只有 1 筆
  expect(await ownOrders(page)).toHaveLength(1);

  // 再試一次 → 進入訂單頁並提示「訂單已成立」
  await alert.getByRole('button', { name: /再試一次/ }).click();
  await page.waitForURL('**/orders/**');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();

  const orders = await ownOrders(page);
  expect(orders).toHaveLength(1);
  expect(orders[0]?.pickup_no).toBe('A001');
  expect(orders[0]?.idempotency_key).toBe(key);
  const log = (await readMockDb(page)).demo_request_log.map((e) => e.outcome);
  expect(log).toEqual(['RESPONSE_LOST', 'REPLAYED']);

  // 庫存只扣一次：5 → 4 份
  await openApp(page, '/', {});
  await expect(page.getByRole('article', { name: '雙人分享餐' })).toContainText('剩 4 份');
});

test('UAT-25 連點「送出訂單」與 Ctrl+Enter 並用：只建立 1 筆', async ({ page }) => {
  await openApp(page);
  await addProduct(page, '滷蛋');
  await goToCheckout(page);
  await fillContact(page);
  await waitCheckoutSettled(page);

  const submit = submitButton(page);
  await submit.click();
  // 送出中：按鈕名稱改為「確認餐點與時段中…」，以 aria-disabled + aria-busy 呈現（保留焦點）
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  await expect(submit).toHaveAttribute('aria-disabled', 'true');
  await submit.click({ force: true });
  await page.keyboard.press('Control+Enter');
  await submit.click({ force: true, clickCount: 2 });
  await page.waitForURL('**/orders/**');

  const orders = await ownOrders(page);
  expect(orders).toHaveLength(1);
  const outcomes = (await readMockDb(page)).demo_request_log.map((e) => e.outcome);
  expect(outcomes).toEqual(['CREATED']);
});

test('UAT-25 回應遺失後改品項備註再送出：導向先前訂單並提示內容不同，購物車保留', async ({
  page,
}) => {
  await openApp(page, '/', { demo_fail: 'orders.create:AFTER_COMMIT:1' });
  await addProduct(page, '滷蛋');
  await goToCheckout(page);
  await fillContact(page);
  await waitCheckoutSettled(page);
  await page.getByRole('button', { name: /^送出訂單/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: '無法確認訂單是否已送出' })).toBeVisible();
  const [created] = await ownOrders(page);
  expect(created).toBeDefined();

  // 回菜單，編輯品項備註
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await page.getByRole('button', { name: '編輯 滷蛋' }).click();
  const sheet = page.getByRole('dialog', { name: '滷蛋' });
  await sheet.getByRole('textbox', { name: /^備註/ }).fill('多加一點辣');
  await sheet.getByRole('button', { name: /^更新購物車/ }).click();
  await expect(sheet).toBeHidden();

  // 再回結帳送出
  await goToCheckout(page);
  await waitCheckoutSettled(page);
  await page.getByRole('button', { name: /^送出訂單/ }).click();
  await page.waitForURL(`**/orders/${created?.id ?? ''}`);
  await expect(page.getByText('稍早送出的訂單已成立，內容與目前購物車不同').first()).toBeVisible();

  // 沒有重複建立；購物車保留（含新備註）
  expect(await ownOrders(page)).toHaveLength(1);
  const cart = await page.evaluate(() => window.localStorage.getItem('zaiorder:v1:cart') ?? '');
  expect(cart).toContain('滷蛋');
  expect(cart).toContain('多加一點辣');
});
