// UAT-08 售完與價格異動（01 §11；07 §13；08 S8）
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  addViaSheet,
  fillContact,
  gotoApp,
  openCheckout,
  ownOrders,
  submitAndWaitForOrder,
  submitButton,
} from './helpers/app';
import { setBasePrice, setManualSoldOut } from './helpers/demo';

/** 結帳頁頁首的狀態列（`有 n 項需要調整` / `有 n 項價格更新`） */
const statusBar = (page: Page) => page.getByText(/^有 \d+ 項(需要調整|價格更新)$/);
/** 單一異動清單（region；標題依內容為「有 n 項餐點需要調整」或「價格已更新，請確認」） */
const issueList = (page: Page) =>
  page.getByRole('region', { name: /^(有 \d+ 項(餐點)?需要調整|價格已更新，請確認)$/ });

/**
 * 等重新計價完成：訂單明細已出現新價格的說明、送出鈕不在「重新計價中…」。
 * 結帳頁先以快取的報價呈現（stale-while-revalidate）；在新報價到達前按「查看」，差異尚未展示，
 * 之後仍需多按一次才送出（BR-25，行為正確），因此測試要等報價穩定再操作。
 */
async function settled(page: Page, priceNote: string): Promise<void> {
  await expect(page.getByRole('complementary', { name: '訂單明細' })).toContainText(priceNote);
  await expect(submitButton(page)).toBeVisible();
}

test.describe('UAT-08 售完與價格異動', () => {
  test('紅茶售完＋滷肉飯調價：狀態列「有 1 項需要調整」→ 查看 → 單一清單 → 移除售完品 → 一鍵確認新價格並送出', async ({
    page,
  }) => {
    // Given：購物車含招牌滷肉飯（小碗 $35）與古早味紅茶（中杯・半糖・微冰 $25）
    await gotoApp(page);
    await addViaSheet(page, '招牌滷肉飯');
    await addViaSheet(page, '古早味紅茶');
    // Demo 面板：紅茶設為售完、滷肉飯基本價調為 $40
    await setManualSoldOut(page, '古早味紅茶', true);
    await setBasePrice(page, '招牌滷肉飯', 40);

    // When：進入結帳 → 狀態列顯示「有 1 項需要調整」（價格更新不計入）
    await openCheckout(page);
    await fillContact(page);
    await settled(page, '價格已更新：NT$ 35 → NT$ 40');
    await expect(statusBar(page)).toHaveText('有 1 項需要調整');
    await expect(issueList(page)).toHaveCount(0); // 背景偵測不自動展開、不位移版面

    // 按「查看」展開「單一」異動清單，並把焦點移到標題
    await page.getByRole('button', { name: '查看需要調整的項目' }).click();
    const list = issueList(page);
    await expect(list).toHaveCount(1);
    await expect(list.getByRole('heading', { level: 2 })).toBeFocused();
    const items = list.getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.filter({ hasText: '古早味紅茶' })).toContainText('今日售完');
    await expect(items.filter({ hasText: '招牌滷肉飯' })).toContainText(
      '價格已更新：NT$ 35 → NT$ 40',
    );
    // 處理完前送出鈕鎖定並說明還有幾項需要處理（價格更新不計入）
    await expect(submitButton(page)).toBeDisabled();
    await expect(page.getByText('還有 1 項需要處理')).toBeVisible();

    // 移除售完品 → 阻擋項處理完，清單只剩價格更新（仍是同一份清單）；差異已於「查看」時展示 → 一鍵確認新價格
    await list.getByRole('button', { name: '移除古早味紅茶' }).click();
    await expect(issueList(page)).toHaveCount(1);
    await expect(issueList(page).getByRole('heading', { level: 2 })).toHaveText(
      '價格已更新，請確認',
    );
    await expect(issueList(page).getByRole('listitem')).toHaveCount(1);
    await expect(statusBar(page)).toHaveText('有 1 項價格更新');
    await expect(submitButton(page)).toBeEnabled();
    await expect(submitButton(page)).toHaveAccessibleName('確認新價格並送出 · NT$ 40');
    await expect(page.getByText('還有 1 項需要處理')).toHaveCount(0);

    // 按一次即成立訂單，總額 $40（與按鈕金額一致）；訂單內不含紅茶
    await submitAndWaitForOrder(page);
    await expect(page).toHaveURL(/\/orders\//);
    const orders = await ownOrders(page);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ status: 'PENDING', subtotal_amount: 40, total_amount: 40 });
  });

  test('僅價格上漲：第一次送出只展開差異並聚焦、不建單；確認後第二次才送出', async ({ page }) => {
    await gotoApp(page);
    await addViaSheet(page, '招牌滷肉飯');
    await setBasePrice(page, '招牌滷肉飯', 40);

    await openCheckout(page);
    await fillContact(page);
    await settled(page, '價格已更新：NT$ 35 → NT$ 40');
    // 只有價格更新：狀態列改為「有 1 項價格更新」，不顯示「有 0 項需要調整」
    await expect(statusBar(page)).toHaveText('有 1 項價格更新');
    await expect(submitButton(page)).toHaveAccessibleName('送出訂單 · NT$ 40');

    // 第一次：只展開並聚焦差異，沒有建立訂單
    await submitButton(page).click();
    const list = issueList(page);
    await expect(list.getByRole('heading', { level: 2, name: '價格已更新，請確認' })).toBeFocused();
    await expect(page).toHaveURL(/\/checkout$/);
    expect(await ownOrders(page)).toHaveLength(0);
    await expect(submitButton(page)).toHaveAccessibleName('確認新價格並送出 · NT$ 40');

    // 第二次：差異已展示，一鍵確認新價格並送出，金額與報價一致
    await submitAndWaitForOrder(page);
    const orders = await ownOrders(page);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ total_amount: 40 });
  });

  test('在姓名欄輸入中商品被設為售完（另一分頁）：不插入版面、不搶焦點；離開欄位並送出後才展開', async ({
    page,
    context,
  }) => {
    await gotoApp(page);
    await addViaSheet(page, '招牌滷肉飯');
    await addViaSheet(page, '古早味紅茶');
    await openCheckout(page);
    await settled(page, '1× 古早味紅茶');
    await page.getByRole('textbox', { name: /^手機/ }).fill('0912345678');
    const name = page.getByRole('textbox', { name: /^姓名/ });
    await name.click();
    await page.keyboard.type('王小');
    await expect(statusBar(page)).toHaveCount(0);
    const contact = page.getByRole('region', { name: '聯絡資訊' });
    const before = await contact.boundingBox();

    // 另一個分頁（共用同一份 Demo 狀態）把紅茶設為售完，本頁回到前景時背景重新確認
    const other = await context.newPage();
    await gotoApp(other);
    await setManualSoldOut(other, '古早味紅茶', true);
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));

    // 狀態列更新，但清單不展開、版面不位移、焦點與輸入中的內容不變
    await expect(statusBar(page)).toHaveText('有 1 項需要調整');
    await expect(issueList(page)).toHaveCount(0);
    await expect(name).toBeFocused();
    await expect(name).toHaveValue('王小');
    expect(await contact.boundingBox()).toEqual(before);

    // 離開欄位並送出：被退回、清單展開並聚焦標題；表單內容保留，沒有建立訂單
    await name.fill('王小明');
    await page.getByRole('textbox', { name: /^手機/ }).click();
    // 送出鈕因阻擋項而鎖定（aria-disabled）：按下會聚焦清單而不送出
    await submitButton(page).click({ force: true });
    const list = issueList(page);
    await expect(list.getByRole('heading', { level: 2 })).toBeFocused();
    await expect(list).toContainText('古早味紅茶');
    await expect(name).toHaveValue('王小明');
    await expect(page).toHaveURL(/\/checkout$/);
    expect(await ownOrders(page)).toHaveLength(0);
  });
});
