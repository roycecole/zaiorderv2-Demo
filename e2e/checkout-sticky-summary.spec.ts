// 結帳頁（桌機）的訂單摘要卡釘在頂部列「下方」：不被頂部列蓋住，捲動時位置也不跳動。
//
// 摘要卡是 sticky（右欄）。若釘住的位置（top）小於頂部列的高度，卡片上緣會被 sticky 頂部列蓋住；
// 更糟的是它的位置取決於視窗捲動量：欄位錯誤 / 提示橫幅出現或消失時，瀏覽器的捲動錨定會微調 scrollY，
// 卡片（含「送出訂單」鈕）在「釘住」與「自然位置」之間跳動，剛好落在點擊途中就會讓這一下點擊落空。
import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { gotoApp, openCheckout, quickAdd } from './helpers/app';

async function topAndBottom(locator: Locator): Promise<{ top: number; bottom: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('找不到元素的位置');
  return { top: box.y, bottom: box.y + box.height };
}

test.describe('結帳頁訂單摘要卡的 sticky 位置（桌機）', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('捲動時釘在頂部列下方，位置與未捲動時一致（不被蓋住、不跳動）', async ({ page }) => {
    await gotoApp(page);
    await quickAdd(page, '擔仔麵');
    await openCheckout(page);

    const summary = page.getByRole('complementary', { name: '訂單明細' });
    const header = page.getByRole('banner');
    await expect(summary).toBeVisible();

    const rest = await topAndBottom(summary);
    const headerBottom = (await topAndBottom(header)).bottom;
    // 未捲動時摘要卡在頂部列下方
    expect(rest.top).toBeGreaterThanOrEqual(headerBottom);

    for (const y of [150, 400, 900]) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(y);
      const pinned = await topAndBottom(summary);
      // 釘住時不得鑽到頂部列底下，也不得與未捲動時的位置差超過 2px（頂部列的 1px 下框線）
      expect(pinned.top, `scrollY=${y}`).toBeGreaterThanOrEqual(headerBottom);
      expect(Math.abs(pinned.top - rest.top), `scrollY=${y}`).toBeLessThanOrEqual(2);
    }
  });
});
