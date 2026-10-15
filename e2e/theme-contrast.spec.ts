// UAT-14 主題色與對比（01 §11；07 §13；08 S14）
import { expect, test } from '@playwright/test';
import { gotoApp, quickAdd } from './helpers/app';
import { contrastRatio, sampleStableColors as sampleColors } from './helpers/color';
import { setThemeColor } from './helpers/demo';

test.use({ viewport: { width: 1440, height: 900 } });

/** 03 §4.1 的 7 組預設品牌色（Demo 面板的名稱與色碼） */
const THEMES = [
  { name: '辣椒紅', hex: '#D93A22' },
  { name: '抹茶綠', hex: '#2E7D4F' },
  { name: '咖啡棕', hex: '#7A4B2A' },
  { name: '活力橘', hex: '#BA520A' },
  { name: '海洋藍', hex: '#1F5FBF' },
  { name: '極簡黑', hex: '#18181B' },
  { name: '檸檬黃', hex: '#FACC15' },
] as const;

test.describe('UAT-14 主題色與對比', () => {
  test('依序切換 7 組主題色：每組皆套用新主題，主要按鈕、選取標籤、連結文字對比 ≥ 4.5:1，焦點外框 ≥ 3:1', async ({
    page,
  }) => {
    await gotoApp(page);
    await quickAdd(page, '擔仔麵'); // 訂單面板的「前往結帳」成為主要按鈕

    const primary = page
      .locator('aside[aria-label="我的訂單"]')
      .getByRole('link', { name: /^前往結帳/ });
    const chip = page
      .getByRole('navigation', { name: '菜單分類' })
      .locator('[aria-current="true"]');
    const linkLike = page.getByRole('button', { name: '加入 嘉義雞肉飯' }); // text-brand-text 於白底

    const dangerOf = (): Promise<string> =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--color-danger'),
      );
    const dangerBefore = await dangerOf();
    const seen = new Set<string>();

    for (const theme of THEMES) {
      await setThemeColor(page, theme.name);

      // 已套用新主題：:root 的品牌色代幣為該組色碼
      await expect
        .poll(() =>
          page.evaluate(() =>
            document.documentElement.style.getPropertyValue('--color-brand').trim().toUpperCase(),
          ),
        )
        .toBe(theme.hex);
      seen.add(theme.hex);

      // 主要按鈕：填滿品牌色，文字對比 ≥ 4.5
      const btn = await sampleColors(primary);
      expect(contrastRatio(btn.fg, btn.bg), `${theme.name} 主要按鈕`).toBeGreaterThanOrEqual(4.5);
      if (theme.name === '檸檬黃') {
        // 淺色主色：按鈕文字必須是深色（亮度低），不是白字
        expect(btn.fg.r + btn.fg.g + btn.fg.b, '檸檬黃的主要按鈕為深色文字').toBeLessThan(200);
      }

      // 選取中的標籤（目前所在分類）：品牌淺底 + brand-text
      const sel = await sampleColors(chip);
      expect(contrastRatio(sel.fg, sel.bg), `${theme.name} 選取標籤`).toBeGreaterThanOrEqual(4.5);

      // 連結 / 品牌文字：brand-text 於白底
      const link = await sampleColors(linkLike);
      expect(contrastRatio(link.fg, link.bg), `${theme.name} 品牌文字`).toBeGreaterThanOrEqual(4.5);

      // 焦點外框：鍵盤聚焦主要按鈕 → 可見外框對背景 ≥ 3:1
      await page.keyboard.press('Tab'); // 確保進入鍵盤導覽模式
      await primary.focus();
      const focused = await sampleColors(primary);
      expect(focused.outline, `${theme.name} 焦點外框存在`).not.toBeNull();
      const pageBg = await sampleColors(page.locator('body'));
      const ringVsPage = contrastRatio(focused.outline ?? focused.fg, pageBg.bg);
      const ringVsButton = contrastRatio(focused.outline ?? focused.fg, focused.bg);
      expect(
        Math.max(ringVsPage, ringVsButton),
        `${theme.name} 焦點外框對比`,
      ).toBeGreaterThanOrEqual(3);

      // 錯誤色（danger）不隨主題改變
      expect(await dangerOf()).toBe(dangerBefore);
    }
    expect(seen.size).toBe(7);

    // 回到「店家設定」：還原預設品牌色
    await setThemeColor(page, '店家設定');
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--color-brand').trim().toUpperCase(),
        ),
      )
      .toBe('#D93A22');
  });
});
