// 首屏版面穩定（NFR-03：CLS ≤ 0.1）：冷啟動載入首頁，店家資訊、營業狀態、Banner、菜單由 Mock 以 300 ms ± 100 ms
// 先後回來。逐塊出現會把已顯示的內容往下推（調整前實測 CLS 0.24～1.0）；首頁以整頁骨架一次換成內容，應為 0。
import { expect, test } from '@playwright/test';
import { BREAK_TIME, NOON } from './helpers/app';

declare global {
  interface Window {
    __cls?: { total: number; entries: Array<{ at: number; value: number }> };
  }
}

const VIEWPORTS = [
  { name: '手機 390', width: 390, height: 844 },
  { name: '平板 768', width: 768, height: 1024 },
  { name: '桌機 1440', width: 1440, height: 900 },
] as const;

// 營業中與休息中（午休）：休息中會多出「可預約取餐」提示，這兩種狀態都不得位移
const CLOCKS = [
  { name: '營業中', clock: NOON },
  { name: '休息中', clock: BREAK_TIME },
] as const;

const BUDGET = 0.02;

test.describe('首頁首次載入的版面位移（CLS）', () => {
  for (const viewport of VIEWPORTS) {
    for (const { name: clockName, clock } of CLOCKS) {
      test(`${viewport.name}・${clockName}：CLS ≤ ${BUDGET}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.addInitScript(() => {
          window.__cls = { total: 0, entries: [] };
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
              if (entry.hadRecentInput) continue;
              window.__cls!.total += entry.value;
              window.__cls!.entries.push({ at: Math.round(entry.startTime), value: entry.value });
            }
          }).observe({ type: 'layout-shift', buffered: true });
        });

        await page.goto(`/?demo_clock=${encodeURIComponent(clock)}`);
        await expect(page.getByRole('heading', { level: 3, name: '招牌滷肉飯' })).toBeVisible();
        // 其餘非同步內容（預估時間、圖片）都就緒後再讀取
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1500);

        const cls = await page.evaluate(() => window.__cls ?? { total: -1, entries: [] });
        expect(cls.total, `位移紀錄：${JSON.stringify(cls.entries)}`).toBeGreaterThanOrEqual(0);
        expect(cls.total, `位移紀錄：${JSON.stringify(cls.entries)}`).toBeLessThanOrEqual(BUDGET);
      });
    }
  }
});
