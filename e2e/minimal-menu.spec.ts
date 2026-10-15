// UAT-13 精簡菜單點餐（01 §11；07 §13；08 S13）
import { expect, test } from '@playwright/test';
import {
  fillContact,
  gotoApp,
  horizontalOverflow,
  openCheckout,
  ownOrders,
  productCard,
  submitAndWaitForOrder,
} from './helpers/app';
import { DEMO_SECTION, setMenuProfile, withDemoSection } from './helpers/demo';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('UAT-13 精簡菜單點餐', () => {
  test('菜單資料設為「精簡」：清單版面、無圖片與空白描述行；「＋」直接加入；購物車單行；可完成下單 @mobile', async ({
    page,
  }) => {
    await gotoApp(page);
    // 限量用盡的商品，精簡菜單仍要標示「今日售完」（庫存事實不被折疊）
    await withDemoSection(page, DEMO_SECTION.stock, async (s) => {
      await s.getByRole('combobox', { name: '商品' }).selectOption({ label: '雙人分享餐' });
      await s.getByRole('button', { name: '用盡（剩 0 份）' }).click();
    });
    await setMenuProfile(page, '精簡');

    // 清單版面；商品卡沒有圖片區、描述行與標籤
    await expect(page.getByRole('radio', { name: '清單' })).toBeChecked();
    const cards = page.locator('[data-product-card]');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBe(34);
    await expect(page.locator('[data-product-card] img')).toHaveCount(0);
    await expect(page.locator('[data-product-card] p')).toHaveCount(0);
    expect((await horizontalOverflow(page)).scrollWidth).toBeLessThanOrEqual(390);

    // 今日售完：手動旗標（控肉飯）與限量用盡（雙人分享餐）
    await expect(productCard(page, 'prd_kong_rou')).toContainText('今日售完');
    await expect(productCard(page, 'prd_combo_share')).toContainText('今日售完');

    // 「＋」直接加入、不開面板；卡片動作區變為 `− 1 ＋`
    await page.getByRole('button', { name: '加入 招牌滷肉飯' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(productCard(page, 'prd_lurou').getByRole('spinbutton')).toHaveText('1');
    await page.getByRole('button', { name: '加入 嘉義雞肉飯' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(productCard(page, 'prd_chicken_rice').getByRole('spinbutton')).toHaveText('1');

    // 購物車：品項單行「品名 + 價格」，沒有選項摘要與備註行
    await page.getByRole('link', { name: /查看購物車/ }).click();
    const lines = page.getByRole('list', { name: '購物車品項' }).getByRole('listitem');
    await expect(lines).toHaveCount(2);
    for (const [name, price] of [
      ['招牌滷肉飯', 'NT$ 35'],
      ['嘉義雞肉飯', 'NT$ 45'],
    ] as const) {
      const line = lines.filter({ hasText: name });
      const head = line.getByRole('heading', { name });
      await expect(head).toBeVisible();
      await expect(line.getByText(price, { exact: true })).toBeVisible();
      await expect(line.locator('p')).toHaveCount(0);
      // 品名與價格在同一行（垂直位置相同）
      const [h, p] = await Promise.all([
        head.boundingBox(),
        line.getByText(price, { exact: true }).boundingBox(),
      ]);
      expect(h).not.toBeNull();
      expect(p).not.toBeNull();
      expect(Math.abs((h?.y ?? 0) - (p?.y ?? 0))).toBeLessThan(12);
    }
    expect((await horizontalOverflow(page)).scrollWidth).toBeLessThanOrEqual(390);

    // 可完成下單
    await openCheckout(page);
    await fillContact(page);
    await submitAndWaitForOrder(page);
    await expect(page).toHaveURL(/\/orders\//);
    const [order] = await ownOrders(page);
    expect(order).toMatchObject({ status: 'PENDING', total_amount: 80 });
  });

  test('切換「無圖片」與「部分缺圖」：沒有破圖，缺圖者以佔位圖塊呈現且名稱與價格完整 @mobile', async ({
    page,
  }) => {
    await gotoApp(page);
    await expect(page.locator('[data-product-card]').first()).toBeVisible();

    for (const profile of ['無圖片', '部分缺圖'] as const) {
      await setMenuProfile(page, profile);
      await expect(productCard(page, 'prd_lurou')).toContainText('招牌滷肉飯');
      // 沒有載入失敗的 <img>（naturalWidth = 0）；圖片載入完成後再檢查
      await page.waitForLoadState('networkidle');
      const broken = await page.evaluate(
        () =>
          Array.from(document.querySelectorAll<HTMLImageElement>('[data-product-card] img')).filter(
            (img) => img.complete && img.naturalWidth === 0,
          ).length,
      );
      expect(broken, `${profile} 不得有破圖`).toBe(0);
      await expect(productCard(page, 'prd_lurou')).toContainText('NT$ 35');
      // 沒有描述為空的空白行
      const emptyParagraphs = await page
        .locator('[data-product-card] p')
        .evaluateAll((els) => els.filter((e) => (e.textContent ?? '').trim() === '').length);
      expect(emptyParagraphs).toBe(0);
    }
    // 無圖片時完全沒有商品圖；部分缺圖則只剩一部分
    await setMenuProfile(page, '無圖片');
    await expect(page.locator('[data-product-card] img')).toHaveCount(0);
  });
});
