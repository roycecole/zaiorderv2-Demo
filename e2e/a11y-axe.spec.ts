// axe-core 掃描（FR-SY-04、NFR-15；07 §13「無障礙」）：主要頁面與浮層狀態無 critical / serious（WCAG 2.2 AA）
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  addComboShare,
  addProduct,
  armRace,
  fillContact,
  goToCheckout,
  helpButton,
  keyboardNotice,
  openApp,
  ownOrders,
  setManualSoldOut,
  setRemaining,
  waitCheckoutSettled,
} from './helpers/b-app';

// 靜態檢查：關閉動態（淡入動畫期間量到的半透明前景色會造成對比誤判）
test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
// 逐停點的焦點指示截圖比對與整頁掃描較耗時
test.setTimeout(90_000);

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING_IMPACTS = new Set(['critical', 'serious']);

interface Finding {
  rule: string;
  impact: string;
  nodes: string[];
}

/** 掃描目前畫面：WCAG 規則集（critical / serious 為失敗）＋最佳實務規則集（只輸出，不擋） */
async function scan(
  page: Page,
  label: string,
  options: { exclude?: string[] } = {},
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags([...WCAG_TAGS, 'best-practice']);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  const results = await builder.analyze();
  const findings: Finding[] = results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact ?? 'minor',
    nodes: v.nodes
      .slice(0, 4)
      .map(
        (n) =>
          `${n.target.join(' ')} :: ${n.html.slice(0, 160)} :: ${n.failureSummary?.split('\n')[1] ?? ''}`,
      ),
  }));
  const blocking = findings.filter((f) => BLOCKING_IMPACTS.has(f.impact));
  const rest = findings.filter((f) => !BLOCKING_IMPACTS.has(f.impact));
  if (rest.length > 0) {
    console.log(`[axe:${label}] 非阻擋（moderate / minor）：${JSON.stringify(rest)}`);
  }
  expect(blocking, `${label}：不得有 critical / serious`).toEqual([]);
  // 跳過連結必須指向真實存在的目標（skip-link），且不得因此被 region 規則標出；
  // 其他 region 結果（例：暫時浮動的鍵盤提醒卡，規格為 role="group"）只輸出不擋
  const skipLinkFindings = findings.filter(
    (f) =>
      f.rule === 'skip-link' ||
      (f.rule === 'region' && f.nodes.some((n) => n.startsWith('a[href$='))),
  );
  expect(skipLinkFindings, `${label}：skip-link / region（跳過連結）`).toEqual([]);
}

test('首頁（菜單，含公告與輪播）', async ({ page }) => {
  await openApp(page);
  await scan(page, '首頁');
});

test('首頁 390：手機版型（底部 Tab、購物車列）', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await addProduct(page, '滷蛋');
  await expect(page.getByRole('link', { name: /查看購物車/ })).toBeVisible();
  await scan(page, '首頁390');
});

test('商品面板開啟', async ({ page }) => {
  await openApp(page);
  await page
    .getByRole('button', { name: /^加入 招牌滷肉飯/ })
    .first()
    .click();
  const sheet = page.getByRole('dialog', { name: '招牌滷肉飯' });
  await expect(sheet.getByRole('button', { name: /^加入購物車/ })).toBeVisible();
  await scan(page, '商品面板');
});

test('購物車：桌機訂單面板與手機購物車頁', async ({ page }) => {
  await openApp(page);
  await addProduct(page, '滷蛋');
  await addProduct(page, '古早味紅茶');
  await expect(page.getByRole('complementary', { name: '我的訂單' })).toContainText('滷蛋');
  await scan(page, '訂單面板');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: /查看購物車/ }).click();
  await page.waitForURL('**/cart');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await scan(page, '購物車頁');
});

test('結帳：一般、異動清單展開', async ({ page }) => {
  await openApp(page);
  await addComboShare(page, 3);
  await addProduct(page, '古早味紅茶');
  await setManualSoldOut(page, '古早味紅茶');
  await setRemaining(page, '雙人分享餐', 2);
  await goToCheckout(page);
  await fillContact(page);
  await waitCheckoutSettled(page);
  await expect(page.getByTestId('checkout-status-bar')).toContainText('有 2 項需要調整');
  await scan(page, '結帳（收合）');

  await page.getByRole('button', { name: '查看需要調整的項目' }).click();
  await expect(page.getByTestId('availability-issue-list')).toBeVisible();
  await scan(page, '結帳（異動清單展開）');
});

test('付款頁、訂單追蹤', async ({ page }) => {
  await openApp(page);
  await addProduct(page, '滷蛋');
  await goToCheckout(page);
  await fillContact(page);
  await page.getByRole('radio', { name: 'LINE Pay' }).check();
  await waitCheckoutSettled(page);
  await page.getByRole('button', { name: /^送出訂單/ }).click();
  await page.waitForURL('**/payment/**');
  await expect(page.getByText('剩餘付款時間')).toBeVisible();
  await scan(page, '付款頁');

  const [order] = await ownOrders(page);
  await page.goto(`/orders/${order?.id ?? ''}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('取餐號碼');
  await scan(page, '訂單追蹤');
});

test('登入頁、店家頁、查詢訂單', async ({ page }) => {
  await openApp(page, '/login');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await scan(page, '登入');

  await openApp(page, '/store');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await scan(page, '店家頁');

  await openApp(page, '/orders/lookup');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await scan(page, '查詢訂單');
});

test('快速鍵說明對話框（含單鍵快速鍵啟用後的徽章頁面）', async ({ page }) => {
  await openApp(page);
  await helpButton(page).click();
  await expect(page.getByRole('dialog', { name: '鍵盤快速鍵與偏好' })).toBeVisible();
  await scan(page, '快速鍵說明');

  await page.getByRole('switch', { name: '啟用單鍵快速鍵' }).click();
  await page.getByRole('button', { name: '完成' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await scan(page, '單鍵快速鍵啟用後（徽章）');
});

test('鍵盤提醒：提示與確認狀態', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Tab');
  const notice = keyboardNotice(page);
  await expect(notice).toBeVisible({ timeout: 1500 });
  await scan(page, '鍵盤提醒（提示）');

  await notice.getByRole('button', { name: '開啟', exact: true }).click();
  await expect(notice).toContainText('已開啟單鍵快速鍵');
  await scan(page, '鍵盤提醒（確認）');
});

test('Demo 面板展開（含庫存與時段情境區塊）', async ({ page }) => {
  await openApp(page);
  await armRace(page, { product: '古早味紅茶', kind: '商品變售完' });
  await page.getByRole('button', { name: /^Demo 工具/ }).click();
  await expect(page.getByRole('dialog', { name: 'Demo 工具' })).toBeVisible();
  await scan(page, 'Demo 面板');
});

test.describe('觸控面板模式', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('菜單、商品面板、完成畫面', async ({ page }) => {
    await openApp(page, '/', { mode: 'kiosk' });
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'kiosk');
    await scan(page, '觸控面板菜單');

    await addProduct(page, '滷蛋');
    await goToCheckout(page);
    await scan(page, '觸控面板結帳');
    await fillContact(page);
    await page.getByRole('button', { name: /^送出訂單/ }).click();
    await page.waitForURL('**/orders/**');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('取餐號碼');
    await scan(page, '觸控面板完成畫面');
  });

  test('閒置警示', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-14T12:00:00+08:00') });
    await openApp(page, '/', { mode: 'kiosk' });
    await addProduct(page, '滷蛋');
    await page.clock.fastForward(61_000);
    const dialog = page.getByRole('alertdialog', { name: '還在嗎？' });
    await expect(dialog).toBeVisible();
    await scan(page, '觸控面板閒置警示');
  });
});
