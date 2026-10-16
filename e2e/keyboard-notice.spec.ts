// UAT-27 鍵盤偵測提醒（FR-SY-18、BR-42、NFR-18；FLOW-25）
// 提醒出現前後主要控制項 bounding box 相同、不遮擋主要操作、不搶焦點；
// 「開啟」「不用了」「逾時」「24 小時間隔」「結帳與觸控面板不提醒」。
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  addProduct,
  boxOf,
  countKeyBadges,
  fillContact,
  goToCheckout,
  helpButton,
  intersects,
  keyboardNotice,
  openApp,
  personalKeysInLocalStorage,
} from './helpers/b-app';
import type { Box } from './helpers/b-app';

const NOON_TAIPEI = '2026-10-14T12:00:00+08:00';

/** 主要控制項的定位器（名稱 → 定位器）；不存在或不可見者略過 */
async function visibleRegions(page: Page): Promise<Record<string, Locator>> {
  const candidates: Record<string, Locator> = {
    topbar: page.getByRole('banner'),
    // 頂部列的 Demo 入口：提醒出現前後位置不變，也不被提醒遮住
    demoTrigger: page.getByRole('banner').getByRole('button', { name: /^Demo 工具/ }),
    chips: page.getByRole('navigation', { name: '菜單分類' }),
    cta: page
      .getByRole('complementary', { name: '我的訂單' })
      .getByRole('link', { name: /^前往結帳/ }),
    cartBar: page.getByRole('link', { name: /查看購物車/ }),
    bottomTab: page.locator('[data-zo-bottom-tab]'),
    footer: page.getByRole('contentinfo'),
  };
  for (let i = 0; i < 6; i += 1) candidates[`card${i}`] = page.locator('main article').nth(i);
  const out: Record<string, Locator> = {};
  for (const [name, locator] of Object.entries(candidates)) {
    if ((await locator.count()) > 0 && (await locator.first().isVisible()))
      out[name] = locator.first();
  }
  return out;
}

async function captureBoxes(page: Page): Promise<Record<string, Box>> {
  const regions = await visibleRegions(page);
  const boxes: Record<string, Box> = {};
  for (const [name, locator] of Object.entries(regions)) boxes[name] = await boxOf(locator);
  return boxes;
}

async function pageState(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
    scrollY: window.scrollY,
    active: (() => {
      const el = document.activeElement;
      return el === null
        ? ''
        : `${el.tagName}|${el.getAttribute('href') ?? ''}|${el.textContent?.trim().slice(0, 20) ?? ''}`;
    })(),
  }));
}

/** 加入一項商品後重新載入：購物車內容保留，CTA、CartBar 才存在；重新載入同時清掉 Toast */
async function seedCartAndReload(page: Page): Promise<void> {
  await openApp(page);
  await addProduct(page, '滷蛋');
  await page.reload();
  await expect(page.locator('main article').first()).toBeVisible();
  // 版面穩定後才開始量測（圖片與輪播載入完成）
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(200);
}

test.describe('UAT-27 鍵盤偵測提醒：桌機 1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('預設無徽章；按 Tab 後 500 ms 內出現提醒，版面與焦點不變、不遮擋主要操作', async ({
    page,
  }) => {
    await seedCartAndReload(page);
    // 輔助：layout-shift（不計輸入後 500 ms 內的位移，故以 getBoundingClientRect 為準）
    await page.evaluate(() => {
      const w = window as unknown as { __cls: number; __shifts: string[] };
      w.__cls = 0;
      w.__shifts = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
            sources?: Array<{ node?: Node | null }>;
          };
          if (shift.hadRecentInput) continue;
          w.__cls += shift.value;
          w.__shifts.push(
            `${shift.value.toFixed(3)} ${(shift.sources ?? [])
              .map((src) => (src.node as Element | null)?.tagName ?? '?')
              .join(',')}`,
          );
        }
      }).observe({ type: 'layout-shift', buffered: false });
    });
    // 版面先穩定（圖片、輪播載入完），再歸零計數
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      (window as unknown as { __cls: number }).__cls = 0;
    });

    // 預設無徽章、無提醒
    expect(await countKeyBadges(page)).toBe(0);
    await expect(keyboardNotice(page)).toHaveCount(0);

    const before = await captureBoxes(page);
    expect(before['cta']).toBeDefined();
    expect(before['topbar']).toBeDefined();
    expect(before['card5']).toBeDefined();
    const stateBefore = await pageState(page);

    const tabAt = Date.now();
    await page.keyboard.press('Tab');
    await expect(keyboardNotice(page)).toBeVisible({ timeout: 500 });
    expect(Date.now() - tabAt).toBeLessThan(1500);
    await expect(page.getByRole('group', { name: '鍵盤快速鍵提醒' })).toContainText(
      '偵測到實體鍵盤',
    );

    // 焦點在第一個跳過連結（Tab 的結果），未被提醒搶走
    await expect(page.getByRole('link', { name: '跳到主要內容' })).toBeFocused();

    // 逐一比對 bounding box（容差 0）、scrollWidth、scrollY
    const after = await captureBoxes(page);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const name of Object.keys(before)) {
      expect(after[name], `${name} 位置不應改變`).toEqual(before[name]);
    }
    const stateAfter = await pageState(page);
    expect(stateAfter.scrollWidth).toBe(stateBefore.scrollWidth);
    expect(stateAfter.scrollY).toBe(stateBefore.scrollY);

    // 不遮擋 CTA；不遮擋頂部列的 Demo 入口與 ⌨（提醒錨定在 ⌨ 下方，Demo 入口在它左側）；位置 fixed
    const notice = await boxOf(keyboardNotice(page));
    expect(intersects(notice, after['cta']!)).toBe(false);
    expect(after['demoTrigger'], 'Demo 入口在頂部列').toBeDefined();
    expect(intersects(notice, after['demoTrigger']!)).toBe(false);
    expect(intersects(notice, await boxOf(helpButton(page)))).toBe(false);
    await expect(keyboardNotice(page)).toHaveCSS('position', 'fixed');
    // 仍沒有徽章（未按開啟）
    expect(await countKeyBadges(page)).toBe(0);
    // 輔助：沒有 layout-shift（失敗時附上位移來源）
    await page.waitForTimeout(300);
    const cls = await page.evaluate(() => {
      const w = window as unknown as { __cls: number; __shifts: string[] };
      return { value: w.__cls, shifts: w.__shifts };
    });
    expect(cls.value, `layout-shift 來源：${cls.shifts.join(' | ')}`).toBe(0);
  });

  test('純鍵盤：Tab 到「開啟」按 Enter，焦點移到「查看全部」、徽章出現；Esc 在提醒內收起並轉為圓點', async ({
    page,
  }) => {
    await seedCartAndReload(page);
    await page.keyboard.press('Tab');
    const notice = keyboardNotice(page);
    await expect(notice).toBeVisible({ timeout: 1000 });
    // 跳過連結（主要內容、購物車、鍵盤快速鍵與偏好）之後即為提醒的「開啟」
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(notice.getByRole('button', { name: '開啟', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(notice).toContainText('已開啟單鍵快速鍵');
    await expect(notice.getByRole('button', { name: '查看全部' })).toBeFocused();
    expect(await countKeyBadges(page)).toBeGreaterThan(0);
  });

  test('焦點在提醒內按 Esc：收起並轉為 ⌨ 上的小圓點（≥ 768）', async ({ page }) => {
    await seedCartAndReload(page);
    await page.keyboard.press('Tab');
    const notice = keyboardNotice(page);
    await expect(notice).toBeVisible({ timeout: 1000 });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(notice.getByRole('button', { name: '開啟', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(notice).toHaveCount(0);
    await expect(page.locator('[data-zo-kbd-dot]')).toBeVisible();
  });

  test('開啟前按 c 無反應（購物車不開啟、焦點不變），提醒改說明剛才按的是快速鍵', async ({
    page,
  }) => {
    await seedCartAndReload(page);
    // 點擊頁面空白處（焦點落在 <main tabindex="-1">）後直接按 c
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    const before = await pageState(page);
    await page.keyboard.press('c');
    const notice = keyboardNotice(page);
    await expect(notice).toBeVisible({ timeout: 1500 });
    await expect(notice).toContainText('剛才按的「c」是快速鍵，目前尚未開啟');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await pageState(page)).toEqual(before);
    expect(await countKeyBadges(page)).toBe(0);
  });

  test('按「開啟」→ 確認狀態；徽章與 aria-keyshortcuts 出現；c 開購物車（桌機移到訂單面板）', async ({
    page,
  }) => {
    await seedCartAndReload(page);
    await page.keyboard.press('Tab');
    const notice = keyboardNotice(page);
    await expect(notice).toBeVisible({ timeout: 500 });
    await notice.getByRole('button', { name: '開啟', exact: true }).click();
    await expect(notice).toContainText('已開啟單鍵快速鍵');

    expect(await countKeyBadges(page)).toBeGreaterThan(0);
    await expect(page.locator('[aria-keyshortcuts]').first()).toBeVisible();

    // 6 秒後確認卡收起，且不留圓點
    await page.keyboard.press('Escape');
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('c');
    await expect
      .poll(() =>
        page.evaluate(
          () => document.getElementById('orderpanel')?.contains(document.activeElement) ?? false,
        ),
      )
      .toBe(true);
  });

  test('「不用了」後重新整理不再提醒；入口仍在（⌨、頁尾、跳過連結）', async ({ page }) => {
    await seedCartAndReload(page);
    await page.keyboard.press('Tab');
    const notice = keyboardNotice(page);
    await expect(notice).toBeVisible({ timeout: 500 });
    await notice.getByRole('button', { name: '不用了' }).click();
    await expect(notice).toHaveCount(0);

    await page.reload();
    await expect(page.locator('main article').first()).toBeVisible();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(600);
    await expect(keyboardNotice(page)).toHaveCount(0);

    await expect(helpButton(page)).toBeVisible();
    await expect(
      page.getByRole('contentinfo').getByRole('button', { name: '鍵盤快速鍵' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: '鍵盤快速鍵與偏好' })).toHaveCount(1);
  });

  test('逾時後 ≥ 768 收成 ⌨ 上的小圓點（aria-label 含「有新提示」），點 ⌨ 後清除', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(NOON_TAIPEI) });
    await seedCartAndReload(page);
    await page.keyboard.press('Tab');
    await expect(keyboardNotice(page)).toBeVisible({ timeout: 1000 });
    await expect(page.locator('[data-zo-kbd-dot]')).toHaveCount(0);

    await page.clock.fastForward(13_000);
    await expect(keyboardNotice(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '鍵盤快速鍵與偏好，有新提示' })).toBeVisible();
    await expect(page.locator('[data-zo-kbd-dot]')).toHaveCount(1);

    // 路由切換不清除圓點
    await page.getByRole('link', { name: '查詢訂單' }).click();
    await expect(page.locator('[data-zo-kbd-dot]')).toHaveCount(1);

    await helpButton(page).click();
    await expect(page.getByRole('dialog', { name: '鍵盤快速鍵與偏好' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-zo-kbd-dot]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '鍵盤快速鍵與偏好', exact: true })).toBeVisible();
  });

  test('第 1 次逾時後 24 小時內不再提醒；快轉 25 小時出現第 2 次；第 3 次不出現', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(NOON_TAIPEI) });
    await seedCartAndReload(page);

    // 第 1 次
    await page.keyboard.press('Tab');
    await expect(keyboardNotice(page)).toBeVisible({ timeout: 1000 });
    await page.clock.fastForward(13_000);
    await expect(keyboardNotice(page)).toHaveCount(0);

    // 24 小時內重新載入：不再提醒
    await page.reload();
    await expect(page.locator('main article').first()).toBeVisible();
    await page.keyboard.press('Tab');
    await page.clock.fastForward(1_000);
    await expect(keyboardNotice(page)).toHaveCount(0);

    // 滿 24 小時：第 2 次
    await page.clock.fastForward('25:00:00');
    await page.reload();
    await expect(page.locator('main article').first()).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(keyboardNotice(page)).toBeVisible({ timeout: 1000 });
    await page.clock.fastForward(13_000);
    await expect(keyboardNotice(page)).toHaveCount(0);

    // 再過 25 小時：已提醒 2 次，不再出現
    await page.clock.fastForward('25:00:00');
    await page.reload();
    await expect(page.locator('main article').first()).toBeVisible();
    await page.keyboard.press('Tab');
    await page.clock.fastForward(1_000);
    await expect(keyboardNotice(page)).toHaveCount(0);
  });

  test('付款頁不出現提醒，⌨ 入口仍在', async ({ page }) => {
    await seedCartAndReload(page);
    await goToCheckout(page);
    await fillContact(page);
    await page.getByRole('radio', { name: 'LINE Pay' }).check();
    await page.getByRole('button', { name: /^送出訂單/ }).click();
    await page.waitForURL('**/payment/**');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(700);
    await expect(keyboardNotice(page)).toHaveCount(0);
    await expect(helpButton(page)).toBeVisible();
  });

  test('結帳頁不出現提醒，⌨ 入口仍在', async ({ page }) => {
    await seedCartAndReload(page);
    await goToCheckout(page);
    await fillContact(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(700);
    await expect(keyboardNotice(page)).toHaveCount(0);
    await expect(helpButton(page)).toBeVisible();
    await expect(page.getByRole('link', { name: '鍵盤快速鍵與偏好' })).toHaveCount(1);
  });
});

test.describe('UAT-27 鍵盤偵測提醒：平板 768 與手機 390', () => {
  test('平板 768：提醒位於 ⌨ 下方，位置不位移且不遮擋 CartBar、頂部列的 Demo 入口', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await seedCartAndReload(page);
    const before = await captureBoxes(page);
    expect(before['cartBar']).toBeDefined();
    expect(before['demoTrigger']).toBeDefined();

    await page.keyboard.press('Tab');
    await expect(keyboardNotice(page)).toBeVisible({ timeout: 1000 });
    const after = await captureBoxes(page);
    for (const name of Object.keys(before)) expect(after[name], name).toEqual(before[name]);
    const notice = await boxOf(keyboardNotice(page));
    expect(intersects(notice, after['cartBar']!)).toBe(false);
    expect(intersects(notice, after['demoTrigger']!)).toBe(false);
    expect(intersects(notice, await boxOf(helpButton(page)))).toBe(false);
  });

  test('@mobile 手機 390：提醒在 CartBar 與底部 Tab 之上、不遮擋頂部列的 Demo 入口與購物車圖示；逾時直接收起、無圓點', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(NOON_TAIPEI) });
    await page.setViewportSize({ width: 390, height: 844 });
    await seedCartAndReload(page);
    const before = await captureBoxes(page);
    expect(before['cartBar']).toBeDefined();
    expect(before['bottomTab']).toBeDefined();

    // 外接鍵盤的手機：Tab 為證據
    await page.keyboard.press('Tab');
    const notice = keyboardNotice(page);
    await expect(notice).toBeVisible({ timeout: 1000 });
    const after = await captureBoxes(page);
    for (const name of Object.keys(before)) expect(after[name], name).toEqual(before[name]);

    const noticeBox = await boxOf(notice);
    expect(intersects(noticeBox, after['cartBar']!)).toBe(false);
    expect(intersects(noticeBox, after['bottomTab']!)).toBe(false);
    // Demo 入口在頂部列（不再是浮動鈕）：提醒與它、購物車圖示都不相交
    expect(after['demoTrigger']).toBeDefined();
    expect(intersects(noticeBox, after['demoTrigger']!)).toBe(false);
    expect(
      intersects(
        noticeBox,
        await boxOf(page.getByRole('banner').getByRole('button', { name: /^購物車/ })),
      ),
    ).toBe(false);

    await page.clock.fastForward(13_000);
    await expect(notice).toHaveCount(0);
    await expect(page.locator('[data-zo-kbd-dot]')).not.toBeVisible();
    // 入口仍在：頁尾「鍵盤快速鍵」與跳過連結
    await expect(page.getByRole('link', { name: '鍵盤快速鍵與偏好' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: '鍵盤快速鍵' })).toBeAttached();
  });
});

test.describe('UAT-27 觸控面板與本機儲存', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('?mode=kiosk：按 Tab 與 c 都不出現提醒，localStorage 沒有 prefs 旗標', async ({ page }) => {
    await openApp(page, '/', { mode: 'kiosk' });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('c');
    await page.waitForTimeout(700);
    await expect(keyboardNotice(page)).toHaveCount(0);
    expect(await personalKeysInLocalStorage(page)).not.toContain('zaiorder:v1:prefs');
  });
});
