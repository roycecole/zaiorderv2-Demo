// UAT-21 送出當下才售完（FR-CK-16、BR-38/39、NFR-17、EC-30、KPI-11）
// 進入結帳時一切正常，按下送出才被搶：不建立訂單、留在結帳頁、表單與時段與 Idempotency-Key 保留，移除後可成功送出。
import { expect, test } from '@playwright/test';
import {
  armRace,
  currentIdempotencyKey,
  openApp,
  ownOrders,
  prepareCheckout,
  readMockDb,
  submitButton,
} from './helpers/b-app';

test.use({ viewport: { width: 1440, height: 900 } });

test('UAT-21 預備「古早味紅茶變售完」→ 送出被退回 → 移除 → 再送出成功（≤ 2 次操作）', async ({
  page,
}) => {
  await prepareCheckout(page, ['古早味紅茶', '招牌滷肉飯']);
  await page.getByRole('textbox', { name: /^姓名/ }).fill('林小美');
  await armRace(page, { product: '古早味紅茶', kind: '商品變售完' });

  // 預檢仍然乾淨（進入結帳時可購買）
  await expect(page.getByTestId('checkout-status-bar')).toHaveAttribute('data-state', 'ok');
  const timeBefore = await page.getByRole('radio', { name: /^盡快/ }).isChecked();
  expect(timeBefore).toBe(true);

  // 按下送出
  await submitButton(page).click();

  // 留在結帳頁；沒有建立訂單；異動清單展開並聚焦標題
  const list = page.getByTestId('availability-issue-list');
  await expect(list).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/checkout');
  const heading = list.getByRole('heading', { level: 2 });
  await expect(heading).toHaveText('有 1 項餐點需要調整');
  await expect(heading).toBeFocused();
  await expect(list).toContainText('古早味紅茶');
  await expect(list).toContainText('剛剛被訂走了');
  expect(await ownOrders(page)).toHaveLength(0);

  // 表單、已選時段與 Idempotency-Key 保留
  await expect(page.getByRole('textbox', { name: /^姓名/ })).toHaveValue('林小美');
  await expect(page.getByRole('textbox', { name: /^手機/ })).toHaveValue(/0912-?345-?678/);
  await expect(page.getByRole('radio', { name: /^盡快/ })).toBeChecked();
  const keyAfterReject = await currentIdempotencyKey(page);
  expect(keyAfterReject).not.toBeNull();
  const log = (await readMockDb(page)).demo_request_log;
  expect(log.map((e) => e.outcome)).toEqual(['REJECTED']);
  expect(log[0]?.idempotencyKey).toBe(keyAfterReject);

  // 送出鈕鎖定並說明還有 1 項需要處理
  const submit = page.getByRole('button', { name: /^送出訂單/ });
  await expect(submit).toHaveAttribute('aria-disabled', 'true');
  await expect(submit).toHaveAccessibleDescription(/還有 1 項需要處理/);

  // 移除（第 1 次操作）→ 送出（第 2 次操作）
  await list.getByRole('button', { name: '移除古早味紅茶' }).click();
  await expect(page.getByRole('button', { name: /^送出訂單 · NT\$ 35$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^送出訂單/ })).toBeFocused();
  await page.getByRole('button', { name: /^送出訂單 · NT\$ 35$/ }).click();

  await page.waitForURL('**/orders/**');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  const orders = await ownOrders(page);
  expect(orders).toHaveLength(1);
  expect(orders[0]?.total_amount).toBe(35);
  // 仍是同一把 Key；紅茶被設為手動售完（預備情境在送出時生效並保留）
  const finalLog = (await readMockDb(page)).demo_request_log.map((e) => e.outcome);
  expect(finalLog).toEqual(['REJECTED', 'CREATED']);
  expect(orders[0]?.idempotency_key).toBe(keyAfterReject);
  const items = (await readMockDb(page)).order_items
    .filter((i) => i.order_id === orders[0]?.id)
    .map((i) => i.product_name);
  expect(items).toEqual(['招牌滷肉飯']);

  // 菜單顯示紅茶今日售完（預備情境留下的手動售完旗標）
  await openApp(page);
  await expect(page.getByRole('button', { name: '古早味紅茶 今日售完' })).toBeVisible();
});
