// Demo 入口在頂部列（不浮動）：不蓋住商品卡 / 送出鈕 / CartBar、與頂部列其他控制項同一條中線、鍵盤可達
//
// 原本的「Demo」浮動鈕固定在左下角，會蓋住手機首頁第一張商品卡價格的「NT$」、結帳頁送出鈕的左端與桌機左下角的卡片。
// 現在入口在頂部列（ShellHeader / TaskHeader）：< 1024 為 44px 的圓形圖示鈕（觸控面板 56px），≥ 1024 為「圖示 + Demo」膠囊。
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { gotoApp, openCheckout, productCard, quickAdd } from './helpers/app';
import { boxOf, intersects } from './helpers/b-app';
import type { Box } from './helpers/b-app';

const trigger = (page: Page): Locator =>
  page.getByRole('banner').getByRole('button', { name: /^Demo 工具/ });
/** 底部 Sheet（< 768，modal）開啟時背景為 aria-hidden，ARIA 角色查不到入口：狀態與焦點改用屬性定位 */
const triggerEl = (page: Page): Locator => page.locator('[data-demo-trigger]');
const panel = (page: Page): Locator => page.getByRole('dialog', { name: 'Demo 工具' });

const centerY = (b: Box): number => b.y + b.height / 2;
const inside = (inner: Box, outer: Box): boolean =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5;

/** 與入口同一排的頂部列控制項（只取目前可見者） */
async function visiblePeers(
  page: Page,
  names: Record<string, Locator>,
): Promise<Record<string, Box>> {
  const out: Record<string, Box> = {};
  for (const [name, locator] of Object.entries(names)) {
    if ((await locator.count()) > 0 && (await locator.first().isVisible())) {
      out[name] = await boxOf(locator.first());
    }
  }
  return out;
}

/** 入口在頂部列內、尺寸符合契約、垂直中線與同排控制項相差 ≤ 1px */
async function expectTriggerInTopbar(
  page: Page,
  peers: Record<string, Locator>,
  shape: 'circle' | 'pill',
  size = 44,
): Promise<void> {
  const header = await boxOf(page.getByRole('banner'));
  const box = await boxOf(trigger(page));
  expect(
    inside(box, header),
    `入口 ${JSON.stringify(box)} 應在頂部列 ${JSON.stringify(header)} 內`,
  ).toBe(true);
  if (shape === 'circle') {
    expect(box.width).toBeCloseTo(size, 0);
    expect(box.height).toBeCloseTo(size, 0);
  } else {
    expect(box.height).toBeCloseTo(size, 0);
    expect(box.width).toBeGreaterThan(size + 16);
    await expect(trigger(page)).toContainText('Demo', { useInnerText: true });
  }
  // 與頂部列的垂直中線一致，也與其他圖示 / 按鈕對齊（±1px）
  expect(Math.abs(centerY(box) - centerY(header))).toBeLessThanOrEqual(1);
  const found = await visiblePeers(page, peers);
  expect(Object.keys(found).length, '至少有一個同排的控制項可比對').toBeGreaterThan(0);
  for (const [name, peer] of Object.entries(found)) {
    expect(
      Math.abs(centerY(box) - centerY(peer)),
      `入口與「${name}」的垂直中線應相差 ≤ 1px（入口 ${centerY(box)}、${name} ${centerY(peer)}）`,
    ).toBeLessThanOrEqual(1);
  }
}

const homePeers = (page: Page): Record<string, Locator> => {
  const banner = page.getByRole('banner');
  return {
    店名: banner.getByRole('link', { name: /^店家資訊/ }),
    購物車圖示: banner.getByRole('button', { name: /^購物車/ }),
    '⌨': banner.getByRole('button', { name: /^鍵盤快速鍵與偏好/ }),
    登入: banner.getByRole('link', { name: '登入' }),
    查詢訂單: banner.getByRole('link', { name: '查詢訂單' }),
  };
};

const checkoutPeers = (page: Page): Record<string, Locator> => {
  const banner = page.getByRole('banner');
  return {
    返回: banner.getByRole('button', { name: '返回' }),
    '⌨': banner.getByRole('button', { name: /^鍵盤快速鍵與偏好/ }),
  };
};

/**
 * 等「已加入購物車・復原」Toast 消失再量測送出鈕：Toast 是另一個浮動元件（換頁即關閉由外殼接線，B3），
 * 本檔只驗證 Demo 入口不再蓋住送出鈕，不依賴 Toast 的行為。
 */
async function waitForUndoToastGone(page: Page): Promise<void> {
  await expect(
    page.locator('[data-zo-toast-viewport]').getByRole('button', { name: '復原' }),
  ).toHaveCount(0, { timeout: 9000 });
}

/** 所有可見的商品卡 */
async function visibleCardBoxes(page: Page): Promise<Box[]> {
  const cards = page.locator('[data-product-card]');
  const boxes: Box[] = [];
  for (let i = 0; i < (await cards.count()); i += 1) {
    const card = cards.nth(i);
    if (await card.isVisible()) boxes.push(await boxOf(card));
  }
  return boxes;
}

/** Tab 直到焦點落在入口（最多 n 次），回傳按了幾次 */
async function tabToTrigger(page: Page, max = 30): Promise<number> {
  for (let i = 1; i <= max; i += 1) {
    await page.keyboard.press('Tab');
    const focused = await trigger(page).evaluate((el) => el === document.activeElement);
    if (focused) return i;
  }
  throw new Error(`Tab ${max} 次內沒有到達 Demo 入口`);
}

/** 鍵盤可達：Tab 到入口 → Enter 開啟面板 → Esc 收合 → 焦點回到入口 */
async function expectKeyboardRoundTrip(page: Page): Promise<void> {
  const presses = await tabToTrigger(page);
  expect(presses, '入口在頂部列：跳過連結與頂部列的控制項之後很快就能 Tab 到').toBeLessThanOrEqual(
    14,
  );
  await expect(triggerEl(page)).toBeFocused();
  await expect(triggerEl(page)).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();
  await expect(triggerEl(page)).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(triggerEl(page)).toBeFocused();
  await expect(triggerEl(page)).toHaveAttribute('aria-expanded', 'false');
}

test.describe('手機 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('首頁：入口在頂部列（44px 圓形圖示鈕）、與店名 / 購物車圖示同一條中線，不蓋住第一張商品卡', async ({
    page,
  }) => {
    await gotoApp(page);
    await expectTriggerInTopbar(page, homePeers(page), 'circle');
    // 沒有可見文字（僅圖示），名稱來自 aria-label
    await expect(trigger(page)).toHaveAccessibleName('Demo 工具');
    await expect(trigger(page)).not.toContainText('Demo', { useInnerText: true });

    const t = await boxOf(trigger(page));
    for (const card of await visibleCardBoxes(page)) expect(intersects(t, card)).toBe(false);
    // 原本被浮動鈕蓋住的第一張卡價格：「NT$」現在完全可見、不被任何固定定位的元素蓋住
    const firstCard = productCard(page, 'prd_lurou');
    await firstCard.scrollIntoViewIfNeeded();
    const price = firstCard.getByText(/^NT\$/).first();
    const priceBox = await boxOf(price);
    const topmost = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('[data-product-card]')?.getAttribute('data-product-card') ?? null;
      },
      { x: priceBox.x + 2, y: priceBox.y + priceBox.height / 2 },
    );
    expect(topmost, '價格左緣的最上層元素應是商品卡本身').toBe('prd_lurou');
  });

  test('首頁：店名不被擠掉（未截斷）、購物車圖示在畫面內，360 寬同樣成立，沒有水平捲動', async ({
    page,
  }) => {
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await gotoApp(page);
      const banner = page.getByRole('banner');
      const brand = banner.getByRole('link', { name: /^店家資訊/ });
      await expect(brand).toBeVisible();
      const truncated = await brand.evaluate((el) => {
        const text = el.querySelector('span, p, div');
        const scope = (text ?? el) as HTMLElement;
        return el.scrollWidth > el.clientWidth + 1 || scope.scrollWidth > scope.clientWidth + 1;
      });
      expect(truncated, `${width} 寬時店名不應被截斷`).toBe(false);
      const cart = await boxOf(banner.getByRole('button', { name: /^購物車/ }));
      const demo = await boxOf(trigger(page));
      const brandBox = await boxOf(brand);
      expect(cart.x).toBeGreaterThanOrEqual(brandBox.x + brandBox.width);
      expect(cart.x + cart.width).toBeLessThanOrEqual(demo.x);
      expect(demo.x + demo.width).toBeLessThanOrEqual(width);
      // 圓的右緣與內容區的 16px 邊界對齊
      expect(width - (demo.x + demo.width)).toBeCloseTo(16, 0);
      const overflow = await page.evaluate(
        () => (document.scrollingElement?.scrollWidth ?? 0) - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });

  test('結帳頁：入口在頂部列，不蓋住「送出訂單」（含左端）、與返回鈕同一條中線', async ({
    page,
  }) => {
    await gotoApp(page);
    await quickAdd(page, '滷蛋');
    await openCheckout(page);
    await expectTriggerInTopbar(page, checkoutPeers(page), 'circle');

    const submit = page.getByRole('button', { name: /^送出訂單/ });
    await waitForUndoToastGone(page);
    await submit.scrollIntoViewIfNeeded();
    const t = await boxOf(trigger(page));
    const s = await boxOf(submit);
    expect(intersects(t, s)).toBe(false);
    // 送出鈕的左端、中央、右端在最上層都是它自己（沒有任何浮動元件蓋住）
    for (const fx of [0.02, 0.5, 0.98]) {
      const hit = await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return el?.closest('button')?.textContent?.trim().slice(0, 4) ?? null;
        },
        { x: s.x + s.width * fx, y: s.y + s.height / 2 },
      );
      expect(hit, `送出鈕 ${Math.round(fx * 100)}% 處的最上層元素`).toBe('送出訂單');
    }
  });

  test('加入商品後：入口不與 CartBar、底部 Tab 相交（它們在畫面底部，入口在頂部列）', async ({
    page,
  }) => {
    await gotoApp(page);
    await quickAdd(page, '滷蛋');
    const cartBar = page.getByRole('link', { name: /查看購物車/ });
    await expect(cartBar).toBeVisible();
    const t = await boxOf(trigger(page));
    expect(intersects(t, await boxOf(cartBar))).toBe(false);
    expect(intersects(t, await boxOf(page.locator('[data-zo-bottom-tab]')))).toBe(false);
    // 入口與購物車圖示（頂部列）相鄰但不重疊，購物車徽章也不蓋到入口
    const cartIcon = await boxOf(page.getByRole('banner').getByRole('button', { name: /^購物車/ }));
    expect(intersects(t, cartIcon)).toBe(false);
    const badge = await boxOf(page.getByRole('banner').getByText('1', { exact: true }));
    expect(intersects(t, badge)).toBe(false);
  });

  test('頂部列是 sticky：捲動後入口位置不變、仍在頂部列內（不浮動、不位移版面）', async ({
    page,
  }) => {
    await gotoApp(page);
    const before = await boxOf(trigger(page));
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    const after = await boxOf(trigger(page));
    expect(after).toEqual(before);
    expect(inside(after, await boxOf(page.getByRole('banner')))).toBe(true);
  });

  test('首次造訪的橫幅：位於左下、底部 Tab 與 CartBar 之上，不與入口、CartBar、底部 Tab 相交；結帳頁不顯示', async ({
    page,
  }) => {
    await gotoApp(page, { keepBanner: true });
    const banner = page.getByRole('region', { name: '示範站台提示' });
    await expect(banner).toBeVisible();
    const tab = page.locator('[data-zo-bottom-tab]');
    const first = await boxOf(banner);
    expect(first.x).toBeLessThanOrEqual(16 + 0.5);
    expect(first.y + first.height).toBeLessThanOrEqual((await boxOf(tab)).y);
    expect(intersects(first, await boxOf(trigger(page)))).toBe(false);

    // 加入商品後出現 CartBar：橫幅移到它之上，三者互不相交
    await quickAdd(page, '滷蛋');
    const cartBar = page.getByRole('link', { name: /查看購物車/ });
    await expect(cartBar).toBeVisible();
    await expect
      .poll(async () => {
        const b = await boxOf(banner);
        const c = await boxOf(cartBar);
        return b.y + b.height <= c.y;
      })
      .toBe(true);
    expect(intersects(await boxOf(banner), await boxOf(tab))).toBe(false);
    expect(intersects(await boxOf(cartBar), await boxOf(tab))).toBe(false);

    // 一般頁面（購物車頁）仍顯示；任務型頁面（結帳）頁底有 sticky 送出列，不顯示橫幅，回上一頁又出現
    await cartBar.click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(banner).toBeVisible();
    await page.getByRole('link', { name: /^前往結帳/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: '結帳' })).toBeVisible();
    await expect(page.getByRole('region', { name: '示範站台提示' })).toHaveCount(0);
    await expect(trigger(page)).toBeVisible();
    await page.goBack();
    await expect(banner).toBeVisible();
  });

  test('鍵盤：Tab 到達入口、Enter 開啟面板、Esc 收合後焦點回到入口（結帳頁同樣成立）', async ({
    page,
  }) => {
    await gotoApp(page);
    await expectKeyboardRoundTrip(page);

    await quickAdd(page, '滷蛋');
    await openCheckout(page);
    // 結帳頁的頂部列：返回 → Demo 入口（頁名不可聚焦）；Tab 順序與視覺順序一致
    await page.getByRole('banner').getByRole('button', { name: '返回' }).focus();
    await page.keyboard.press('Tab');
    await expect(triggerEl(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await expect(triggerEl(page)).toBeFocused();
  });
});

test.describe('平板 768×1024', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('首頁：入口維持 44px 圓形（不用 95px 膠囊，才不會把搜尋框擠到只剩 153px），搜尋框的提示文字完整', async ({
    page,
  }) => {
    await gotoApp(page);
    await expectTriggerInTopbar(page, homePeers(page), 'circle');
    const search = page.getByRole('banner').getByRole('searchbox');
    const box = await boxOf(search);
    expect(box.width, '768 寬的搜尋框至少 200px').toBeGreaterThanOrEqual(200);
    // placeholder 沒有被截斷
    const clipped = await search.evaluate(
      (el: HTMLInputElement) => el.scrollWidth > el.clientWidth + 1,
    );
    expect(clipped).toBe(false);
    // 頂部列的 Tab 順序：登入 → Demo → ⌨
    const names = await page
      .getByRole('banner')
      .locator('a, button, input')
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''),
      );
    const at = (re: RegExp): number => names.findIndex((n) => re.test(n));
    expect(at(/^Demo 工具/)).toBe(at(/^登入$/) + 1);
    expect(at(/^鍵盤快速鍵與偏好/)).toBe(at(/^Demo 工具/) + 1);
  });

  test('加入商品後：入口不與置中的 CartBar 相交', async ({ page }) => {
    await gotoApp(page);
    await quickAdd(page, '滷蛋');
    const cartBar = page.getByRole('link', { name: /查看購物車/ });
    await expect(cartBar).toBeVisible();
    expect(intersects(await boxOf(trigger(page)), await boxOf(cartBar))).toBe(false);
  });

  test('結帳頁：入口在頂部列、⌨ 之前', async ({ page }) => {
    await gotoApp(page);
    await quickAdd(page, '滷蛋');
    await openCheckout(page);
    await expectTriggerInTopbar(page, checkoutPeers(page), 'circle');
    const submit = page.getByRole('button', { name: /^送出訂單/ });
    await submit.scrollIntoViewIfNeeded();
    expect(intersects(await boxOf(trigger(page)), await boxOf(submit))).toBe(false);
    const demo = await boxOf(trigger(page));
    const help = await boxOf(
      page.getByRole('banner').getByRole('button', { name: /^鍵盤快速鍵與偏好/ }),
    );
    expect(demo.x + demo.width).toBeLessThanOrEqual(help.x);
  });
});

test.describe('桌機 1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('首頁：入口在頂部列（高 40 的「圖示 + Demo」膠囊）、位於登入與 ⌨ 之間，與其他控制項同一條中線', async ({
    page,
  }) => {
    await gotoApp(page);
    await expectTriggerInTopbar(page, homePeers(page), 'pill', 40);
    const demo = await boxOf(trigger(page));
    const login = await boxOf(page.getByRole('banner').getByRole('link', { name: '登入' }));
    const help = await boxOf(
      page.getByRole('banner').getByRole('button', { name: /^鍵盤快速鍵與偏好/ }),
    );
    expect(login.x + login.width).toBeLessThanOrEqual(demo.x);
    expect(demo.x + demo.width).toBeLessThanOrEqual(help.x);
    // 不蓋住任何商品卡（包含原本被浮動鈕蓋住的左下角那張）
    for (const card of await visibleCardBoxes(page)) expect(intersects(demo, card)).toBe(false);
    const orderPanel = page.getByRole('complementary', { name: '我的訂單' });
    expect(intersects(demo, await boxOf(orderPanel))).toBe(false);
  });

  test('結帳頁：入口在頂部列，不蓋住「送出訂單」與訂單明細', async ({ page }) => {
    await gotoApp(page);
    await quickAdd(page, '滷蛋');
    await openCheckout(page);
    await expectTriggerInTopbar(page, checkoutPeers(page), 'pill', 40);
    const demo = await boxOf(trigger(page));
    const submit = page.getByRole('button', { name: /^送出訂單/ });
    await submit.scrollIntoViewIfNeeded();
    expect(intersects(demo, await boxOf(submit))).toBe(false);
    for (const card of await visibleCardBoxes(page)) expect(intersects(demo, card)).toBe(false);
  });

  test('鍵盤：Tab 到達入口、Enter 開啟左下浮動面板、Esc 收合後焦點回到入口；再點一次入口也能收合', async ({
    page,
  }) => {
    await gotoApp(page);
    await expectKeyboardRoundTrip(page);

    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toHaveAttribute('aria-modal', 'false');
    await trigger(page).click();
    await expect(panel(page)).toBeHidden();

    // 面板自己的關閉鈕：收合後焦點同樣回到入口
    await trigger(page).click();
    await panel(page).getByRole('button', { name: '收合 Demo 工具' }).click();
    await expect(panel(page)).toBeHidden();
    await expect(trigger(page)).toBeFocused();
  });

  test('面板展開時入口維持在頂部列（位置不變）；面板在左下，不蓋住入口與右側訂單面板的「前往結帳」', async ({
    page,
  }) => {
    await gotoApp(page);
    await quickAdd(page, '滷蛋');
    const before = await boxOf(trigger(page));
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    expect(await boxOf(trigger(page))).toEqual(before);
    const p = await boxOf(panel(page));
    expect(intersects(p, before)).toBe(false);
    expect(intersects(p, await boxOf(page.getByRole('link', { name: /^前往結帳/ })))).toBe(false);
    expect(p.x).toBeLessThanOrEqual(16 + 0.5);
  });

  test('結帳頁開啟面板：不蓋住送出鈕（桌機的送出鈕在右側摘要欄）', async ({ page }) => {
    await gotoApp(page);
    await quickAdd(page, '滷蛋');
    await openCheckout(page);
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    const submit = page.getByRole('button', { name: /^送出訂單/ });
    await submit.scrollIntoViewIfNeeded();
    expect(intersects(await boxOf(panel(page)), await boxOf(submit))).toBe(false);
  });

  test('「已預備」的情境：入口帶小圓點，名稱同步為「Demo 工具，已預備 n 項下次送出的模擬」', async ({
    page,
  }) => {
    await gotoApp(page, { params: { demo_fail: 'orders.create:BEFORE:1' } });
    const armed = page
      .getByRole('banner')
      .getByRole('button', { name: 'Demo 工具，已預備 1 項下次送出的模擬' });
    await expect(armed).toBeVisible();
    const dot = armed.getByTestId('demo-fab-dot');
    await expect(dot).toBeVisible();
    const t = await boxOf(armed);
    const d = await boxOf(dot);
    // 圓點在入口的右上角（可略凸出 2px，但不脫離入口）
    expect(d.x + d.width / 2).toBeGreaterThan(t.x + t.width / 2);
    expect(d.y + d.height / 2).toBeLessThan(t.y + t.height / 2);
    expect(Math.abs(d.x + d.width / 2 - (t.x + t.width))).toBeLessThanOrEqual(8);
  });

  test('入口在 DemoRoot（延後載入）就緒前被點了，就緒後面板仍會開啟', async ({ page }) => {
    let delayed = 0;
    await page.route('**/assets/DemoRoot-*.js', async (route) => {
      delayed += 1;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await page.goto('/?demo_clock=2026-10-14T12:00:00%2B08:00');
    await expect(page.getByRole('main')).toBeVisible();
    await trigger(page).click();
    // DemoRoot 還沒載入：面板尚未出現，但入口已記下「要開啟」
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(page)).toBeVisible({ timeout: 8000 });
    expect(delayed, 'DemoRoot 區塊確實被延遲載入').toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await expect(trigger(page)).toBeFocused();
  });
});

test.describe('觸控面板（1280×800）', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('?mode=kiosk：入口仍在頂部列（56px 高的膠囊），與「大字」同一條中線；沒有 ⌨ 與橫幅', async ({
    page,
  }) => {
    await gotoApp(page, { params: { mode: 'kiosk' } });
    const banner = page.getByRole('banner');
    await expectTriggerInTopbar(
      page,
      { 大字: banner.getByRole('button', { name: '大字' }) },
      'pill',
      56,
    );
    await expect(banner.getByRole('button', { name: /^鍵盤快速鍵與偏好/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '示範站台提示' })).toHaveCount(0);
    // 入口在「大字」之右（Tab 順序 = 視覺順序）
    const big = await boxOf(banner.getByRole('button', { name: '大字' }));
    expect((await boxOf(trigger(page))).x).toBeGreaterThanOrEqual(big.x + big.width);
  });

  test('S18：以 Demo 面板預覽「觸控面板」後，入口仍在頂部列，可再用面板切回「自動」', async ({
    page,
  }) => {
    await gotoApp(page);
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-mode', 'kiosk');
    await expect(
      page.getByRole('banner').getByRole('button', { name: /^鍵盤快速鍵與偏好/ }),
    ).toBeVisible();

    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    await panel(page).getByRole('button', { name: '菜單與外觀', exact: true }).click();
    const input = panel(page).getByRole('group', { name: '輸入模式' });
    await input.getByRole('radio', { name: '觸控面板', exact: true }).check();
    await expect(html).toHaveAttribute('data-mode', 'kiosk');

    // 觸控面板的頂部列：沒有 ⌨，但入口還在（56px 高），面板維持開啟
    const banner = page.getByRole('banner');
    await expect(banner.getByRole('button', { name: /^鍵盤快速鍵與偏好/ })).toHaveCount(0);
    await expect(trigger(page)).toBeVisible();
    expect((await boxOf(trigger(page))).height).toBeCloseTo(56, 0);
    await expect(panel(page)).toBeVisible();

    // 以入口收合再開啟，切回「自動」
    await trigger(page).click();
    await expect(panel(page)).toBeHidden();
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    // 面板收合後內容卸載，區塊回到預設收合
    await panel(page).getByRole('button', { name: '菜單與外觀', exact: true }).click();
    await panel(page)
      .getByRole('group', { name: '輸入模式' })
      .getByRole('radio', { name: '自動', exact: true })
      .check();
    await expect(html).not.toHaveAttribute('data-mode', 'kiosk');
    await expect(banner.getByRole('button', { name: /^鍵盤快速鍵與偏好/ })).toBeVisible();
    // 回到一般版面後入口仍是同一個頂部列的膠囊
    expect((await boxOf(trigger(page))).height).toBeCloseTo(40, 0);
  });

  test('結帳頁的頂部列（只有 56px 高）：56px 的入口不頂到上下緣', async ({ page }) => {
    await gotoApp(page, { params: { mode: 'kiosk' } });
    await quickAdd(page, '滷蛋');
    await page.getByRole('link', { name: /^前往結帳/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: '結帳' })).toBeVisible();
    const header = await boxOf(page.getByRole('banner'));
    const demo = await boxOf(trigger(page));
    expect(demo.height).toBeCloseTo(56, 0);
    expect(demo.y - header.y, '上緣留白').toBeGreaterThanOrEqual(3);
    expect(header.y + header.height - (demo.y + demo.height), '下緣留白').toBeGreaterThanOrEqual(3);
    expect(Math.abs(centerY(demo) - centerY(header))).toBeLessThanOrEqual(1);
  });
});
