// UAT-15 全程免登入（01 §11；08 S15）
import { expect, test } from '@playwright/test';
import {
  addViaSheet,
  fillContact,
  gotoApp,
  openCheckout,
  ownOrders,
  quickAdd,
  submitAndWaitForOrder,
} from './helpers/app';

test.describe('UAT-15 全程免登入', () => {
  test('進站 → 點餐 → 結帳（記住我的資料）→ 送出 → 關閉分頁重開 → 查詢訂單找回；第二次結帳姓名手機已預填', async ({
    page,
    context,
  }) => {
    const visited: string[] = [];
    const track = (p: typeof page): void => {
      p.on('framenavigated', (frame) => {
        if (frame === p.mainFrame()) visited.push(new URL(frame.url()).pathname);
      });
    };
    track(page);

    // 進站 → 點餐 → 結帳（勾選記住我的資料）→ 送出
    await gotoApp(page);
    await addViaSheet(page, '招牌滷肉飯', { checks: ['滷蛋'] });
    await openCheckout(page);
    await fillContact(page, { name: '林小華', phone: '0988123456' });
    await page.getByRole('checkbox', { name: /記住我的資料/ }).check();
    await submitAndWaitForOrder(page);

    // 訂單頁：記下訂單編號；「想保存這筆訂單？」提示可關閉，關閉後不再出現
    const orderNo = (
      await page
        .getByText(/^ZO\d{6}[A-Z0-9]+$/)
        .first()
        .innerText()
    ).trim();
    expect(orderNo).toMatch(/^ZO\d{6}[A-Z0-9]{6,}$/);
    const prompt = page.getByRole('complementary', { name: '想保存這筆訂單？' });
    await expect(prompt).toBeVisible();
    await page.getByRole('button', { name: '關閉保存提示' }).click();
    await expect(prompt).toHaveCount(0);
    const [created] = await ownOrders(page);
    expect(created).toMatchObject({ customer_name: '林小華', customer_phone: '0988123456' });

    // 關閉分頁、重新開啟（同一瀏覽器：localStorage 保留、sessionStorage 清空）
    await page.close();
    const reopened = await context.newPage();
    track(reopened);
    await gotoApp(reopened);
    // 未登入：頂部列只有「登入」連結，沒有「我的訂單」
    await expect(reopened.getByRole('link', { name: '登入', exact: true })).toBeVisible();

    // 「查詢訂單」：輸入編號與手機
    await reopened.getByRole('link', { name: '查詢訂單' }).first().click();
    await expect(reopened.getByRole('heading', { level: 1, name: '查詢訂單' })).toBeVisible();
    // 本機記錄也列出這筆訂單
    await expect(reopened.getByRole('link', { name: `查看訂單 ${orderNo}` })).toBeVisible();
    await reopened.getByRole('textbox', { name: /^訂單編號/ }).fill(orderNo);
    await reopened.getByRole('textbox', { name: /^手機號碼/ }).fill('0988123456');
    await reopened.getByRole('button', { name: '查詢', exact: true }).click();

    // 查得到該訂單並看到進度；提示不再出現
    await expect(reopened).toHaveURL(/\/orders\//);
    await expect(reopened.getByText(orderNo).first()).toBeVisible();
    await expect(reopened.getByRole('list', { name: '訂單進度' })).toBeVisible();
    await expect(reopened.getByRole('complementary', { name: '想保存這筆訂單？' })).toHaveCount(0);

    // 第二次結帳：姓名與手機已預填（取自「記住我的資料」）
    await gotoApp(reopened); // 回菜單（同一分頁，sessionStorage 仍在）
    await quickAdd(reopened, '擔仔麵');
    await openCheckout(reopened);
    await expect(reopened.getByRole('textbox', { name: /^姓名/ })).toHaveValue('林小華');
    await expect(reopened.getByRole('textbox', { name: /^手機/ })).toHaveValue('0988-123-456');

    // 全程未導向登入頁
    expect(visited.filter((path) => path.startsWith('/login'))).toEqual([]);
  });
});
