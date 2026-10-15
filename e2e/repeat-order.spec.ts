// UAT-20 上次選項快速點餐（01 §11；08 S19）
import { expect, test } from '@playwright/test';
import {
  addViaSheet,
  cartLines,
  fillContact,
  gotoApp,
  openCheckout,
  productCard,
  submitAndWaitForOrder,
} from './helpers/app';
import { loadRememberedSample } from './helpers/demo';

test.describe('UAT-20 上次選項快速點餐', () => {
  test('下單後卡片顯示「上次：…」；「↻ 再點」直接加入不開面板；面板套用上次選項並可恢復預設', async ({
    page,
  }) => {
    // Given：訪客，已完成一筆含「招牌滷肉飯 大碗・滷蛋」的訂單
    await gotoApp(page);
    await addViaSheet(page, '招牌滷肉飯', { radios: ['大碗'], checks: ['滷蛋'], note: '不要蔥' });
    await openCheckout(page);
    await fillContact(page);
    await submitAndWaitForOrder(page);

    // When：回菜單 → 卡片顯示「上次：大碗・滷蛋」
    await gotoApp(page);
    const card = productCard(page, 'prd_lurou');
    await expect(card).toContainText('上次：大碗・滷蛋');
    // 其他沒有點過的商品沒有「上次」
    await expect(productCard(page, 'prd_chicken_rice')).not.toContainText('上次');
    // 頂部的「常點的餐點」
    await expect(page.getByRole('heading', { name: '常點的餐點' })).toBeVisible();

    // 點「↻ 再點」：購物車新增 1 份相同選項，且不開面板
    await card.getByRole('button', { name: /^再點 招牌滷肉飯/ }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(/^已再點：招牌滷肉飯/).first()).toBeVisible();
    const lines = cartLines(page);
    await expect(lines).toHaveCount(1);
    await expect(lines.first()).toContainText('招牌滷肉飯');
    await expect(lines.first()).toContainText('大碗・滷蛋');
    await expect(lines.first()).toContainText('1×');

    // 再開啟商品面板（「＋」）：預設套用上次選項並提示；「恢復預設」可還原
    await card.getByRole('button', { name: '調整選項：招牌滷肉飯' }).click();
    const sheet = page.getByRole('dialog', { name: '招牌滷肉飯' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('已套用上次的選擇：大碗・滷蛋')).toBeVisible();
    await expect(sheet.getByRole('radio', { name: '大碗' })).toBeChecked();
    await expect(sheet.getByRole('checkbox', { name: '滷蛋' })).toBeChecked();
    await expect(sheet.getByRole('textbox', { name: /備註/ })).toHaveValue('不要蔥');

    await sheet.getByRole('button', { name: '恢復預設' }).click();
    await expect(sheet.getByRole('radio', { name: '小碗' })).toBeChecked();
    await expect(sheet.getByRole('checkbox', { name: '滷蛋' })).not.toBeChecked();
    await expect(sheet.getByText('已套用上次的選擇：大碗・滷蛋')).toHaveCount(0);
  });

  test('「載入範例」的部分失效記憶：鹽酥雞的舊選項已停售，改開面板並提示改用預設', async ({
    page,
  }) => {
    await gotoApp(page);
    await loadRememberedSample(page);
    const card = productCard(page, 'prd_salt_chicken');
    await expect(card).toContainText('上次：');
    await card.getByRole('button', { name: /^再點 鹽酥雞/ }).click();
    const sheet = page.getByRole('dialog', { name: '鹽酥雞' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('部分選項已不提供，已改用預設')).toBeVisible();
    // 梅子粉保留、辣度回到預設「不辣」
    await expect(sheet.getByRole('radio', { name: '梅子粉' })).toBeChecked();
    await expect(sheet.getByRole('radio', { name: '不辣' })).toBeChecked();
  });
});
