// UAT-09 登入並再來一單（01 §11；08 S9）
import { expect, test } from '@playwright/test';
import { cartLines, gotoApp } from './helpers/app';
import { quickLoginDemoUser } from './helpers/demo';

test.describe('UAT-09 登入並再來一單', () => {
  test('快速登入示範會員 → 歷史訂單 → 已完成訂單「再來一單」：商品加入購物車，已售完品項被略過並提示', async ({
    page,
  }) => {
    await gotoApp(page);
    await quickLoginDemoUser(page);
    await expect(page.getByRole('link', { name: '示範會員' })).toBeVisible();

    // 歷史訂單 → 已完成
    await page.getByRole('link', { name: '我的訂單' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '歷史訂單' })).toBeVisible();
    await page.getByRole('tab', { name: '已完成' }).click();
    const card = page.getByRole('listitem').filter({ hasText: 'ZO261011HZ0001' });
    await expect(card).toContainText('招牌滷肉飯 等 3 項');

    // 再來一單：略過今日售完的控肉飯，其餘 2 項加入購物車
    await page.getByRole('button', { name: '再來一單，訂單 ZO261011HZ0001' }).click();
    const dialog = page.getByRole('dialog', { name: '再來一單' });
    await expect(dialog).toContainText('已將 2 項餐點加入購物車');
    await expect(dialog).toContainText('未加入的餐點');
    await expect(dialog.getByRole('listitem')).toHaveText('控肉飯　今日售完');

    // 前往購物車（≥ 1024 為首頁右側「我的訂單」面板）：保留原本的選項與備註；沒有控肉飯
    await dialog.getByRole('button', { name: '前往購物車' }).click();
    const lines = cartLines(page);
    await expect(lines).toHaveCount(2);
    const lurou = lines.filter({ hasText: '招牌滷肉飯' });
    await expect(lurou).toContainText('大碗・滷蛋');
    await expect(lurou).toContainText('備註：不要蔥');
    await expect(lines.filter({ hasText: '古早味紅茶' })).toContainText('中杯・半糖・微冰');
    await expect(lines.filter({ hasText: '控肉飯' })).toHaveCount(0);
  });
  test('登入頁以示範會員手機與驗證碼 123456 登入（AC-01），登入為選用：可「以訪客身分繼續」', async ({
    page,
  }) => {
    // 登入為選用：先確認訪客可略過
    await gotoApp(page, { path: '/login' });
    await expect(page.getByRole('heading', { level: 1, name: '登入會員' })).toBeVisible();
    await expect(page.getByRole('link', { name: '以訪客身分繼續' })).toBeVisible();

    await page.getByRole('textbox', { name: /^手機號碼/ }).fill('0900000000');
    await page.getByRole('button', { name: '發送驗證碼' }).click();
    await expect(page.getByRole('heading', { name: '輸入驗證碼' })).toBeVisible();
    // 6 格輸入：第一格已聚焦，逐碼輸入後自動送出
    await page.keyboard.type('123456');

    // 登入完成：離開登入頁，頂部列顯示會員名稱
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('link', { name: '示範會員' })).toBeVisible();
    await page.getByRole('link', { name: '我的訂單' }).click();
    await page.getByRole('tab', { name: '已完成' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'ZO261011HZ0001' })).toBeVisible();
  });
});
