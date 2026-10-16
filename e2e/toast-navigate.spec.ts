// 「已加入購物車・復原」換頁即關閉（B3）；「再來一單」「登入成功」等提示在新頁面保留
//
// 問題：加入商品後點「查看購物車」或直接前往結帳，帶「復原」的 Toast（預設 6 秒）還留在新頁面，壓在送出鈕上方；
// 在結帳頁按「復原」還會把品項從購物車移除，使結帳頁突然變空。
// 做法：復原類 Toast（加入、移除、清空購物車）帶 `dismissOnNavigate`，外殼在路由 pathname 變更時
// 呼叫 `useDismissToastsOnNavigate(pathname)` 關閉它們；沒有旗標的提示（登入成功、再來一單導向購物車…）照常保留。
//
// 待外殼（ShellFrame）接線後驗證：「換頁即關閉」的案例需要 ShellFrame 呼叫 `useDismissToastsOnNavigate(pathname)`；
// 「同一頁不關閉」「再來一單」「登入成功」三類案例不依賴該接線（接線前後都應通過）。
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { addViaSheet, cartLines, gotoApp, quickAdd } from './helpers/app';
import { boxOf } from './helpers/b-app';
import { quickLoginDemoUser } from './helpers/demo';

const toastViewport = (page: Page): Locator => page.locator('[data-zo-toast-viewport]');
const undoButton = (page: Page): Locator =>
  toastViewport(page).getByRole('button', { name: '復原' });
const toastText = (page: Page, text: string | RegExp): Locator =>
  toastViewport(page).getByText(text);

/**
 * 換頁後 Toast 必須「立刻」消失：用遠小於 Toast 計時（含「復原」為 6 秒）的逾時，
 * 避免把「計時結束」誤認成「換頁關閉」。
 */
const GONE = { timeout: 1500 } as const;

/** 送出鈕左端、中央、右端的最上層元素都是它自己（沒有 Toast 或其他浮動元件壓在上面） */
async function expectSubmitNotCovered(page: Page): Promise<void> {
  const submit = page.getByRole('button', { name: /^送出訂單/ });
  await submit.scrollIntoViewIfNeeded();
  const box = await boxOf(submit);
  for (const fx of [0.02, 0.5, 0.98]) {
    const hit = await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest('button')?.textContent?.trim().slice(0, 4) ?? null,
      { x: box.x + box.width * fx, y: box.y + box.height / 2 },
    );
    expect(hit, `送出鈕 ${Math.round(fx * 100)}% 處的最上層元素`).toBe('送出訂單');
  }
}

test.describe('手機 390×844：加入購物車 → 查看購物車 → 前往結帳', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('點「查看購物車」：「已加入購物車・復原」立即消失，購物車內容不變', async ({ page }) => {
    await gotoApp(page);
    await quickAdd(page, '滷蛋');
    await expect(toastText(page, '已加入購物車')).toBeVisible();
    await expect(undoButton(page)).toBeVisible();

    await page.getByRole('link', { name: /查看購物車/ }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(undoButton(page)).toHaveCount(0, GONE);
    await expect(toastText(page, '已加入購物車')).toHaveCount(0, GONE);
    // 沒有按「復原」：品項還在購物車
    await expect(cartLines(page)).toHaveCount(1);
    await expect(cartLines(page).first()).toContainText('滷蛋');
  });

  test('一路前往結帳：每次換頁後都沒有復原類 Toast，送出鈕不被蓋住，結帳頁不會因「復原」變空', async ({
    page,
  }) => {
    await gotoApp(page);
    await quickAdd(page, '滷蛋');
    await expect(undoButton(page)).toBeVisible();

    await page.getByRole('link', { name: /查看購物車/ }).click();
    await expect(undoButton(page)).toHaveCount(0, GONE);
    // 購物車 → 結帳是「一般版面 → 任務型版面」：外殼整個重新掛載，Toast 同樣要關閉
    await page.getByRole('link', { name: /^前往結帳/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: '結帳' })).toBeVisible();
    await expect(undoButton(page)).toHaveCount(0, GONE);
    await expect(toastText(page, '已加入購物車')).toHaveCount(0, GONE);

    await expectSubmitNotCovered(page);
    // 訂單明細仍有剛才加入的品項（沒有任何「復原」能把它移除）
    await expect(page.getByText('滷蛋').first()).toBeVisible();
  });

  test('移除品項的「復原」換頁即關閉；清空購物車的「復原」同樣', async ({ page }) => {
    await gotoApp(page);
    await quickAdd(page, '滷蛋');
    await quickAdd(page, '滷豆干');
    await page.getByRole('link', { name: /查看購物車/ }).click();
    await expect(cartLines(page)).toHaveCount(2);

    // 移除一項（數量 1 的步進器會先二次確認）→ 「已移除：…」含「復原」→ 換頁（購物車 → 店家資訊）後消失
    await page.getByRole('button', { name: '移除 滷蛋' }).first().click();
    const confirmRemove = page.getByRole('alertdialog', { name: '要移除這個品項嗎？' });
    if (
      await confirmRemove.waitFor({ state: 'visible', timeout: 1500 }).then(
        () => true,
        () => false,
      )
    ) {
      await confirmRemove.getByRole('button', { name: '移除', exact: true }).click();
    }
    await expect(toastText(page, /^已移除：/)).toBeVisible();
    await expect(undoButton(page)).toBeVisible();
    await page
      .getByRole('banner')
      .getByRole('link', { name: /^店家資訊/ })
      .click();
    await expect(page).toHaveURL(/\/store$/);
    await expect(undoButton(page)).toHaveCount(0, GONE);

    // 清空（二次確認後）→「購物車已清空」含「復原」→ 換頁消失
    await page
      .getByRole('navigation', { name: '主要導覽' })
      .getByRole('link', { name: '菜單' })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole('link', { name: /查看購物車/ }).click();
    await page.getByRole('button', { name: '清空', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: '要清空購物車嗎？' })
      .getByRole('button', { name: '清空', exact: true })
      .click();
    await expect(toastText(page, '購物車已清空')).toBeVisible();
    await expect(undoButton(page)).toBeVisible();
    await page
      .getByRole('navigation', { name: '主要導覽' })
      .getByRole('link', { name: '菜單' })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(undoButton(page)).toHaveCount(0, GONE);
    await expect(toastText(page, '購物車已清空')).toHaveCount(0, GONE);
  });
});

test.describe('桌機 1280×800：訂單面板的「前往結帳」', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('加入商品後直接前往結帳：復原類 Toast 隨換頁關閉，結帳頁沒有「復原」', async ({ page }) => {
    await gotoApp(page);
    await quickAdd(page, '滷蛋');
    await expect(toastText(page, '已加入購物車')).toBeVisible();
    await expect(undoButton(page)).toBeVisible();

    await page.getByRole('link', { name: /^前往結帳/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: '結帳' })).toBeVisible();
    await expect(undoButton(page)).toHaveCount(0, GONE);
    await expect(toastText(page, '已加入購物車')).toHaveCount(0, GONE);

    await expectSubmitNotCovered(page);
    await expect(page.getByText('滷蛋').first()).toBeVisible();
  });

  test('同一頁內不關閉：開關商品面板（網址帶 ?product=，pathname 不變）後 Toast 仍在，「復原」仍然有效', async ({
    page,
  }) => {
    await gotoApp(page);
    await addViaSheet(page, '招牌滷肉飯', { radios: ['小碗'] });
    await expect(toastText(page, '已加入購物車')).toBeVisible();
    await expect(undoButton(page)).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(undoButton(page)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');

    await undoButton(page).click();
    await expect(cartLines(page)).toHaveCount(0);
  });
});

test.describe('不帶旗標的提示換頁後保留', () => {
  test.use({ viewport: { width: 800, height: 900 } });

  test('登入成功：以示範會員手機與驗證碼登入後導回菜單，「已登入」提示在新頁面', async ({
    page,
  }) => {
    await gotoApp(page, { path: '/login' });
    await page.getByRole('textbox', { name: /^手機號碼/ }).fill('0900000000');
    await page.getByRole('button', { name: '發送驗證碼' }).click();
    await expect(page.getByRole('heading', { name: '輸入驗證碼' })).toBeVisible();
    await page.keyboard.type('123456');

    await expect(page).not.toHaveURL(/\/login/);
    await expect(toastText(page, '已登入')).toBeVisible();
    await expect(page.getByRole('link', { name: '示範會員' })).toBeVisible();
  });

  test('「再來一單」（餐點都能加入）導向購物車：先 Toast 再換頁，「已加入購物車」仍在新頁面（沒有「復原」）', async ({
    page,
  }) => {
    await gotoApp(page);
    await quickLoginDemoUser(page);
    await page.getByRole('link', { name: '我的訂單' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '歷史訂單' })).toBeVisible();
    await page.getByRole('tab', { name: '已完成' }).click();

    // 第二筆歷史訂單（HZ0002，外送）的餐點目前都可供應：直接加入並導向購物車，沒有「未加入的餐點」對話框
    await page.getByRole('button', { name: /^再來一單，訂單 .*HZ0002$/ }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(cartLines(page).first()).toBeVisible();

    await expect(toastText(page, '已加入購物車')).toBeVisible();
    await expect(undoButton(page)).toHaveCount(0);
    // 換頁後還在，並且沒有在換頁的當下被關閉（這則提示沒有旗標；它依自己的 3 秒計時結束）
    await page.waitForTimeout(800);
    await expect(toastText(page, '已加入購物車')).toBeVisible();
  });
});
