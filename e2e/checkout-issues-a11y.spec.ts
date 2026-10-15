// UAT-26 異動清單鍵盤與螢幕閱讀器（SY-12/16、CK-16、BR-34、NFR-04、EC-30）
// 螢幕閱讀器朗讀順序與不重複朗讀為手動驗證；此處驗證焦點移動、aria-live 文字、動作鈕名稱與無水平捲動。
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  activeInfo,
  addComboShare,
  addProduct,
  armRace,
  assertiveAnnouncement,
  goToCheckout,
  openApp,
  politeAnnouncement,
  setManualSoldOut,
  setRemaining,
  tabUntil,
  waitCheckoutSettled,
} from './helpers/b-app';

test.use({ viewport: { width: 1440, height: 900 } });
// 逐停點的焦點指示截圖比對與整頁掃描較耗時
test.setTimeout(90_000);

/** 購物車：雙人分享餐 ×3 + 古早味紅茶；紅茶售完、雙人分享餐剩 2 份 */
async function seedIssues(page: Page): Promise<void> {
  await openApp(page);
  await addComboShare(page, 3);
  await addProduct(page, '古早味紅茶');
  await setManualSoldOut(page, '古早味紅茶');
  await setRemaining(page, '雙人分享餐', 2);
}

/** 純鍵盤填妥姓名、手機（付款預設現金），焦點停在手機欄 */
async function fillByKeyboard(page: Page): Promise<void> {
  // 從頁面標題開始 Tab（Demo 面板收合後焦點在 Demo 浮動按鈕，其後沒有可 Tab 的元素）
  await page.evaluate(() => (document.querySelector('main h1') as HTMLElement | null)?.focus());
  await tabUntil(page, (i) => i.tag === 'INPUT' && i.name.startsWith('姓名'), {
    label: '結帳→姓名',
    max: 30,
  });
  await page.keyboard.type('林小美');
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await activeInfo(page)).name).toMatch(/^手機/);
  await page.keyboard.type('0912345678');
}

test('UAT-26 純鍵盤：鎖定時 Ctrl+Enter 聚焦清單不送出 → Tab/Enter 逐項處理 → 送出 → 焦點在訂單頁標題', async ({
  page,
}) => {
  await seedIssues(page);
  await goToCheckout(page);
  await waitCheckoutSettled(page);
  await expect(page.getByTestId('checkout-status-bar')).toContainText('有 2 項需要調整');
  await fillByKeyboard(page);

  // 鎖定時 Ctrl+Enter：焦點與捲動移到清單標題、通報還有 2 項、不送出
  await page.keyboard.press('Control+Enter');
  const list = page.getByTestId('availability-issue-list');
  await expect(list).toBeVisible();
  const heading = list.getByRole('heading', { level: 2 });
  await expect(heading).toBeFocused();
  expect(new URL(page.url()).pathname).toBe('/checkout');
  await expect.poll(() => politeAnnouncement(page)).toContain('還有 2 項需要處理');
  await expect(heading).toBeInViewport();

  // 每個動作鈕名稱含品名
  const names = await list
    .getByRole('button')
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''),
    );
  expect(names).toEqual(
    expect.arrayContaining(['移除古早味紅茶', '將雙人分享餐改為 2 份', '全部套用建議']),
  );

  // Tab 到「移除古早味紅茶」，Enter → 焦點移到下一個異動項的主要動作
  await tabUntil(page, (i) => i.name === '移除古早味紅茶', { label: '清單→移除紅茶', max: 6 });
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await activeInfo(page)).name, { timeout: 5000 })
    .toBe('將雙人分享餐改為 2 份');
  // 單項處理後以 polite 合併為一句通報（含金額與剩餘項數）
  await expect.poll(() => politeAnnouncement(page)).toMatch(/已移除|還有 1 項需要處理/);

  // 最後一項處理完 → 焦點回到送出鈕
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await activeInfo(page)).name, { timeout: 5000 })
    .toMatch(/^送出訂單/);
  expect((await activeInfo(page)).tag).toBe('BUTTON');

  // 送出 → 成功後焦點在訂單頁標題
  await page.keyboard.press('Enter');
  await page.waitForURL('**/orders/**');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
});

test('UAT-26 送出被退回後焦點在清單標題 h2（朗讀一次：標題 + 描述）', async ({ page }) => {
  await openApp(page);
  await addProduct(page, '古早味紅茶');
  await addProduct(page, '滷蛋');
  await goToCheckout(page);
  await waitCheckoutSettled(page);
  await armRace(page, { product: '古早味紅茶', kind: '商品變售完' });

  await fillByKeyboard(page);
  await page.keyboard.press('Control+Enter');

  const list = page.getByTestId('availability-issue-list');
  const heading = list.getByRole('heading', { level: 2 });
  await expect(heading).toBeFocused();
  await expect(heading).toHaveText('有 1 項餐點需要調整');
  // 摘要以 aria-describedby 帶入，不另用 role="alert"
  await expect(heading).toHaveAccessibleDescription(/訂單尚未送出，資料都還在。.*古早味紅茶/);
  await expect(list.locator('[role="alert"]')).toHaveCount(0);
  // 通報文字只含項數（標題摘要不重複朗讀）
  await expect.poll(() => politeAnnouncement(page)).not.toContain('古早味紅茶今日售完');
  expect(await assertiveAnnouncement(page)).not.toContain('古早味紅茶');
});

for (const width of [360, 390, 768, 1024, 1440]) {
  test(`UAT-26 異動清單展開：${width}px 無水平捲動、清單與動作鈕可見`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await seedIssues(page);
    await goToCheckout(page);
    await waitCheckoutSettled(page);
    await page.getByRole('button', { name: '查看需要調整的項目' }).click();
    const list = page.getByTestId('availability-issue-list');
    await expect(list).toBeVisible();
    await expect(list.getByRole('button', { name: '移除古早味紅茶' })).toBeVisible();
    await expect(list.getByRole('button', { name: '將雙人分享餐改為 2 份' })).toBeVisible();

    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return { scrollWidth: root.scrollWidth, innerWidth: window.innerWidth };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
    // 動作鈕不超出視窗
    const box = await list.getByRole('button', { name: '移除古早味紅茶' }).boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
  });
}
