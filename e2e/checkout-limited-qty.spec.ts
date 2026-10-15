// UAT-22 限量不足改為 n 份（FR-CK-16、BR-40、EC-31、KPI-11）
// 雙人分享餐剩 2 份、購物車 ×3：狀態列「有 1 項需要調整」→ 查看 → 全部套用建議 → 復原 → 再套用 → 送出；
// 訂單品項為 2 份，菜單顯示今日售完。
import { expect, test } from '@playwright/test';
import {
  addComboShare,
  goToCheckout,
  fillContact,
  openApp,
  ownOrders,
  readMockDb,
  setRemaining,
  waitCheckoutSettled,
} from './helpers/b-app';

test.use({ viewport: { width: 1440, height: 900 } });

test('UAT-22 限量剩 2 份、已選 3 份：全部套用建議 → 復原 → 再套用 → 送出，訂單 2 份、菜單今日售完', async ({
  page,
}) => {
  await openApp(page);
  await addComboShare(page, 3);
  await setRemaining(page, '雙人分享餐', 2);
  await expect(page.getByText('剩 2 份').first()).toBeVisible();

  await goToCheckout(page);
  await fillContact(page);
  await waitCheckoutSettled(page);

  // 進入結帳只更新狀態列，不展開清單
  const statusBar = page.getByTestId('checkout-status-bar');
  await expect(statusBar).toContainText('有 1 項需要調整');
  await expect(page.getByTestId('availability-issue-list')).toHaveCount(0);

  // 查看 → 清單
  await statusBar.getByRole('button', { name: '查看需要調整的項目' }).click();
  const list = page.getByTestId('availability-issue-list');
  await expect(list).toBeVisible();
  await expect(list).toContainText('雙人分享餐');
  await expect(list).toContainText('今日只剩 2 份（已選 3 份）');
  await expect(page.getByRole('button', { name: /^送出訂單/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  // 全部套用建議：數量改為 2 份、金額 $598
  await list.getByRole('button', { name: '全部套用建議' }).click();
  const summary = page.getByTestId('adjusted-summary');
  await expect(summary).toContainText('已調整');
  await expect(summary).toContainText('改為 2 份');
  await expect(page.getByRole('button', { name: /^送出訂單 · NT\$ 598$/ })).toBeVisible();

  // 復原：回到 3 份（仍標示不足）
  await summary.getByRole('button', { name: '復原' }).click();
  await expect(list).toContainText('今日只剩 2 份（已選 3 份）');
  // 復原後清單重新展開，焦點回到清單標題
  await expect(list.getByRole('heading', { level: 2 })).toBeFocused();
  await expect(page.getByRole('button', { name: /^送出訂單/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  // 再次套用 → 送出
  await list.getByRole('button', { name: '全部套用建議' }).click();
  const submit = page.getByRole('button', { name: /^送出訂單 · NT\$ 598$/ });
  await expect(submit).toBeVisible();
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
  await submit.click();
  await page.waitForURL('**/orders/**');

  const orders = await ownOrders(page);
  expect(orders).toHaveLength(1);
  expect(orders[0]?.total_amount).toBe(598);
  const items = (await readMockDb(page)).order_items.filter((i) => i.order_id === orders[0]?.id);
  expect(items).toHaveLength(1);
  expect(items[0]?.quantity).toBe(2);

  // 菜單：雙人分享餐今日售完
  await openApp(page);
  await expect(page.getByRole('button', { name: '雙人分享餐 今日售完' })).toBeVisible();
});
