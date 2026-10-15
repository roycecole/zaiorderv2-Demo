// UAT-11 RWD 檢查：360 / 390 / 768 / 1024 / 1440 的首頁、購物車、結帳、訂單、店家頁、登入頁無水平捲動（01 §11；07 §13）
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  addViaSheet,
  fillContact,
  gotoApp,
  horizontalOverflow,
  openCheckout,
  quickAdd,
  submitAndWaitForOrder,
} from './helpers/app';

const WIDTHS = [360, 390, 768, 1024, 1440] as const;

async function expectNoHorizontalScroll(page: Page, label: string, width: number): Promise<void> {
  // 等版面穩定（字型、骨架換成內容）後再量測
  await page.waitForLoadState('networkidle');
  const { scrollWidth, innerWidth } = await horizontalOverflow(page);
  expect(
    scrollWidth,
    `${label}（${width}px）scrollWidth ${scrollWidth} 不得大於 innerWidth ${innerWidth}`,
  ).toBeLessThanOrEqual(innerWidth);
}

for (const width of WIDTHS) {
  test.describe(`UAT-11 無水平捲動 ${width}px`, () => {
    test.use({ viewport: { width, height: width >= 1024 ? 900 : 844 } });

    test(`首頁、購物車、結帳、訂單、店家頁、登入頁（${width}px）`, async ({ page }) => {
      // 首頁（含商品面板開啟時）
      await gotoApp(page);
      await expect(page.locator('[data-product-card]').first()).toBeVisible();
      await expectNoHorizontalScroll(page, '首頁', width);

      await addViaSheet(page, '招牌滷肉飯', {
        radios: ['大碗'],
        checks: ['滷蛋', '滷豆干'],
        note: '不要蔥',
      });
      await addViaSheet(page, '紅燒牛肉麵');
      await quickAdd(page, '擔仔麵');
      await expectNoHorizontalScroll(page, '首頁（購物車有品項）', width);

      // 購物車頁（≥ 1024 為常駐訂單面板，/cart 會導回首頁）
      await page.goto('/cart');
      await expect(page.getByRole('main')).toBeVisible();
      await expectNoHorizontalScroll(page, '購物車', width);

      // 結帳頁
      await openCheckout(page);
      await expectNoHorizontalScroll(page, '結帳', width);
      await fillContact(page);
      // 外送：地址欄位、外送費說明與折扣碼不得撐出水平捲動
      await page.getByRole('radio', { name: '外送' }).first().check();
      await page.getByRole('combobox', { name: /縣市/ }).selectOption('臺北市');
      await page.getByRole('combobox', { name: /行政區/ }).selectOption('大安區');
      await page
        .getByRole('textbox', { name: /詳細地址/ })
        .fill('示範路五段一百二十三號十二樓之三（請按電鈴兩次並致電）');
      await page.getByRole('textbox', { name: /折扣碼/ }).fill('LUNCH10');
      await page.getByRole('button', { name: '套用' }).click();
      await expect(page.getByText('已套用 LUNCH10')).toBeVisible();
      await expectNoHorizontalScroll(page, '結帳（外送、折扣碼）', width);
      await page
        .getByRole('textbox', { name: /^訂單備註/ })
        .fill('不要香菜，謝謝，請把餐點分開包裝比較方便攜帶，也請放兩雙筷子。');
      await expectNoHorizontalScroll(page, '結帳（已填寫）', width);

      // 訂單頁
      await submitAndWaitForOrder(page);
      await expect(page.locator('#order-pickup-no')).toBeVisible();
      await expectNoHorizontalScroll(page, '訂單', width);

      // 店家頁
      await page.goto('/store');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page, '店家頁', width);

      // 登入頁
      await page.goto('/login');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page, '登入頁', width);
    });
  });
}
