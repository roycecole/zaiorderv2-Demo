// e2e/helpers/b-app.ts —— B 組（鍵盤 / 觸控面板 / 庫存最終確認 / 無障礙）共用輔助
//
// 時間：Mock 以 getClock() 計時；以 `?demo_clock=` 設定「現在」的起點（繼續走時）。
// 單鍵快速鍵與鍵盤提醒的計時使用 systemClock（real time），需要時以 `page.clock` 快轉。
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** 午餐營業時段（週三 12:00，台北時間）：店家營業中、無異動 */
export const DEMO_CLOCK = '2026-10-14T12:00:00+08:00';

export type DemoParams = Record<string, string | undefined>;

/** 組出帶有 Demo 啟動參數的網址（預設 `demo_clock` = 營業中的 12:00） */
export function appUrl(path = '/', params: DemoParams = {}): string {
  const merged: DemoParams = { demo_clock: DEMO_CLOCK, ...params };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) query.set(key, value);
  }
  const qs = query.toString();
  return qs === '' ? path : `${path}?${qs}`;
}

/** 開啟頁面並等待外殼與頁面主體就緒（菜單頁等到至少一張商品卡） */
export async function openApp(page: Page, path = '/', params: DemoParams = {}): Promise<void> {
  await page.goto(appUrl(path, params));
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  if (path === '/') {
    await expect(page.locator('main article').first()).toBeVisible();
  }
}

/** 取得「商品卡上的加入鈕」（名稱可能附帶「（購物車已有 n 份）」） */
export function addButtonOf(page: Page, productName: string): Locator {
  return page.getByRole('button', { name: new RegExp(`^加入 ${productName}`) });
}

/**
 * 把商品加入購物車：無選項者「＋」直接加入；有必選選項者開啟商品面板後以預設選項加入。
 * @returns 是否經由商品面板加入
 */
export async function addProduct(page: Page, productName: string): Promise<boolean> {
  await addButtonOf(page, productName).first().click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: /^加入購物車/ });
  const viaSheet = await confirm
    .waitFor({ state: 'visible', timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  if (viaSheet) {
    await confirm.click();
    await expect(page.getByRole('dialog')).toBeHidden();
  }
  return viaSheet;
}

/** 前往結帳頁（桌機：訂單面板；窄螢幕：購物車列 → 購物車頁） */
export async function goToCheckout(page: Page): Promise<void> {
  const direct = page.getByRole('link', { name: /^前往結帳/ });
  if (!(await direct.first().isVisible())) {
    await page.getByRole('link', { name: /查看購物車/ }).click();
    await page.waitForURL('**/cart');
  }
  await page
    .getByRole('link', { name: /^前往結帳/ })
    .first()
    .click();
  await page.waitForURL('**/checkout');
  await expect(page.getByRole('heading', { level: 1, name: '結帳' })).toBeVisible();
}

/** 填寫結帳聯絡資訊（付款預設為現金、取餐方式為自取、時間為盡快） */
export async function fillContact(
  page: Page,
  contact: { name?: string; phone?: string } = {},
): Promise<void> {
  await page.getByRole('textbox', { name: /^姓名/ }).fill(contact.name ?? '王小明');
  await page.getByRole('textbox', { name: /^手機/ }).fill(contact.phone ?? '0912345678');
}

/** 送出鈕（名稱隨金額、價格確認與鎖定狀態而變） */
export function submitButton(page: Page): Locator {
  return page.getByRole('button', {
    name: /^(送出訂單|確認新價格並送出|還有 \d+ 項需要處理|重新計價中|確認餐點與時段中)/,
  });
}

/** 等待結帳頁的狀態列離開「確認中」 */
export async function waitCheckoutSettled(page: Page): Promise<void> {
  await expect(page.getByTestId('checkout-status-bar')).not.toHaveAttribute(
    'data-state',
    'confirming',
  );
}

/** 鍵盤提醒卡 */
export function keyboardNotice(page: Page): Locator {
  return page.locator('[data-zo-keyboard-notice]');
}

/** 頂部 ⌨ 按鈕（名稱可能附帶「，有新提示」） */
export function helpButton(page: Page): Locator {
  return page.getByRole('button', { name: /^鍵盤快速鍵與偏好/ });
}

/** 頁面上可見的鍵帽徽章數（排除鍵盤提醒卡、說明對話框與結帳頁常駐的 Ctrl/⌘ + Enter 小字） */
export async function countKeyBadges(page: Page): Promise<number> {
  return page.evaluate(() => {
    const badges = Array.from(document.querySelectorAll('span[aria-hidden="true"] kbd'));
    return badges.filter((el) => {
      if (el.closest('[data-zo-keyboard-notice], [role="dialog"]') !== null) return false;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    }).length;
  });
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('元素沒有 bounding box（不可見）');
  return box;
}

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** 主要資料儲存鍵（觸控面板模式不得寫入） */
export const PERSONAL_STORAGE_KEYS = [
  'zaiorder:v1:cart',
  'zaiorder:v1:session',
  'zaiorder:v1:prefs',
  'zaiorder:v1:guestOrders',
] as const;

/** 讀取目前 localStorage 內存在的個資鍵 */
export async function personalKeysInLocalStorage(page: Page): Promise<string[]> {
  return page.evaluate(
    (keys) => keys.filter((k) => window.localStorage.getItem(k) !== null),
    [...PERSONAL_STORAGE_KEYS],
  );
}

// ───────── 鍵盤輔助 ─────────

export interface ActiveInfo {
  tag: string;
  role: string;
  /** 近似的可存取名稱（label / aria-label / 文字） */
  name: string;
  type: string;
  isBody: boolean;
}

/** 目前取得焦點的元素摘要（在頁面內計算） */
export async function activeInfo(page: Page): Promise<ActiveInfo> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el === null) return { tag: '', role: '', name: '', type: '', isBody: true };
    const input = el as HTMLInputElement;
    const labelled = el.getAttribute('aria-labelledby');
    const labelledText =
      labelled === null
        ? ''
        : labelled
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ');
    const name =
      el.getAttribute('aria-label') ??
      (labelledText !== '' ? labelledText : null) ??
      input.labels?.[0]?.textContent ??
      el.textContent ??
      '';
    return {
      tag: el.tagName,
      role: el.getAttribute('role') ?? '',
      name: name.replace(/\s+/g, ' ').trim(),
      type: el.getAttribute('type') ?? '',
      isBody: el === document.body || el === document.documentElement,
    };
  });
}

/**
 * 斷言目前焦點有「可見的焦點指示」：以螢幕截圖比對焦點元素周圍區域在聚焦與失焦時不同
 * （不依賴實作方式：outline、box-shadow、同層 peer 樣式皆可）。比對後把焦點還原到原元素。
 */
export async function expectFocusIndicatorVisible(page: Page, context: string): Promise<void> {
  const clip = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el === null || el === document.body) return null;
    let target: HTMLElement = el;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (parseFloat(cs.opacity) === 0 || rect.width < 2 || rect.height < 2) {
      target = (el.closest('label') as HTMLElement | null) ?? el.parentElement ?? el;
    }
    const r = target.getBoundingClientRect();
    const pad = 6;
    const x = Math.max(0, Math.floor(r.left - pad));
    const y = Math.max(0, Math.floor(r.top - pad));
    const right = Math.min(window.innerWidth, Math.ceil(r.right + pad));
    const bottom = Math.min(window.innerHeight, Math.ceil(r.bottom + pad));
    return { x, y, width: right - x, height: bottom - y };
  });
  expect(clip, `${context}：焦點不應在 body`).not.toBeNull();
  if (clip === null || clip.width <= 0 || clip.height <= 0) return;
  const handle = await page.evaluateHandle(() => document.activeElement as HTMLElement);
  const focused = await page.screenshot({ clip, animations: 'disabled' });
  await handle.evaluate((el) => el.blur());
  const blurred = await page.screenshot({ clip, animations: 'disabled' });
  await handle.evaluate((el) => el.focus({ preventScroll: true }));
  await handle.dispose();
  expect(focused.equals(blurred), `${context}：焦點指示不可見`).toBe(false);
}

/**
 * 連按 Tab 直到焦點元素符合條件；沿途每個停點都檢查焦點指示可見且不在 body。
 * @returns 停點數
 */
export async function tabUntil(
  page: Page,
  match: (info: ActiveInfo) => boolean,
  options: { max?: number; label?: string; shift?: boolean } = {},
): Promise<number> {
  const max = options.max ?? 80;
  const key = options.shift === true ? 'Shift+Tab' : 'Tab';
  for (let i = 1; i <= max; i += 1) {
    await page.keyboard.press(key);
    const info = await activeInfo(page);
    expect(info.isBody, `${options.label ?? 'tabUntil'}：第 ${i} 次 Tab 後焦點落在 body`).toBe(
      false,
    );
    await expectFocusIndicatorVisible(
      page,
      `${options.label ?? 'tabUntil'} #${i}（${info.tag} ${info.name}）`,
    );
    if (match(info)) return i;
  }
  throw new Error(`${options.label ?? 'tabUntil'}：${max} 次 Tab 內未到達目標`);
}

// ───────── 目標尺寸 ─────────

export interface SmallTarget {
  tag: string;
  name: string;
  width: number;
  height: number;
}

/**
 * 掃描目前畫面中所有可點目標，回傳「實際可點熱區」小於 minSize 的清單。
 * 熱區以 `elementFromPoint` 取樣（涵蓋 `::after` 擴大熱區、包住 opacity-0 輸入的整張卡片）。
 * 需要時會先捲動到該元素；略過跳過連結（只在取得焦點時才顯示）與不可見元素。
 */
export async function findSmallTargets(page: Page, minSize = 56): Promise<SmallTarget[]> {
  return page.evaluate((min) => {
    const selector =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, ' +
      '[role="button"], [role="link"], [role="radio"], [role="checkbox"], [role="switch"], ' +
      '[role="tab"], [role="menuitem"], [role="option"], [role="spinbutton"]';
    const out: Array<{ tag: string; name: string; width: number; height: number }> = [];
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
    for (const el of nodes) {
      if (el.closest('[data-zo-skip-links]') !== null) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (el.closest('[aria-hidden="true"], [inert]') !== null) continue;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const pad = Math.ceil(min / 2) + 4; // 擴大熱區最多延伸到 min 的一半
      const step = 4;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let y = Math.max(0, r.top - pad); y < Math.min(innerHeight, r.bottom + pad); y += step) {
        for (
          let x = Math.max(0, r.left - pad);
          x < Math.min(innerWidth, r.right + pad);
          x += step
        ) {
          const hit = document.elementFromPoint(x, y);
          if (hit !== null && (hit === el || el.contains(hit))) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const width = maxX === -Infinity ? 0 : maxX - minX + step;
      const height = maxY === -Infinity ? 0 : maxY - minY + step;
      if (maxX === -Infinity) continue; // 被其他元素完全覆蓋（例：浮層下的背景），不可點
      if (width < min || height < min) {
        const input = el as HTMLInputElement;
        const name =
          el.getAttribute('aria-label') ?? input.labels?.[0]?.textContent ?? el.textContent ?? '';
        out.push({
          tag: el.tagName,
          name: name.replace(/\s+/g, ' ').trim().slice(0, 30),
          width: Math.round(width),
          height: Math.round(height),
        });
      }
    }
    return out;
  }, minSize);
}

// ───────── Demo 面板 ─────────

export function demoPanel(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Demo 工具' });
}

/** 開啟 Demo 面板（已開啟則不動作），回傳面板定位器 */
export async function openDemoPanel(page: Page): Promise<Locator> {
  const panel = demoPanel(page);
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: /^Demo 工具/ }).click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

export async function closeDemoPanel(page: Page): Promise<void> {
  const panel = demoPanel(page);
  if (await panel.isVisible()) {
    // ≥ 768 為浮動面板（「收合 Demo 工具」）；< 768 為底部面板（對話框的「關閉」）
    const collapse = panel.getByRole('button', { name: '收合 Demo 工具' });
    if ((await collapse.count()) > 0) await collapse.click();
    else await panel.getByRole('button', { name: '關閉' }).first().click();
    await expect(panel).toBeHidden();
  }
}

/** 展開面板的某個區塊（已展開則不動作） */
export async function openDemoSection(panel: Locator, title: string): Promise<void> {
  const toggle = panel.getByRole('button', { name: title, exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

export type RaceKind = '商品變售完' | '他人買走' | '時段額滿';

/** 「庫存與時段情境」→「下一次送出前才發生」→ 預備；完成後收合面板 */
export async function armRace(
  page: Page,
  options: { product?: string; kind: RaceKind; quantity?: number; slotLabel?: RegExp },
): Promise<void> {
  const panel = await openDemoPanel(page);
  await openDemoSection(panel, '庫存與時段情境');
  if (options.product !== undefined) {
    await panel.getByLabel('商品', { exact: true }).selectOption({ label: options.product });
  }
  if (options.kind === '時段額滿' && options.slotLabel !== undefined) {
    const timeSelect = panel.getByLabel('時段', { exact: true });
    const option = timeSelect.locator('option').filter({ hasText: options.slotLabel }).first();
    await timeSelect.selectOption({ value: (await option.getAttribute('value')) ?? '' });
  }
  await panel.getByRole('radio', { name: options.kind }).check();
  if (options.kind === '他人買走' && options.quantity !== undefined) {
    await panel.getByLabel('買走份數', { exact: true }).fill(String(options.quantity));
  }
  await panel.getByRole('button', { name: '預備', exact: true }).click();
  await expect(panel.getByText('已預備（下次送出訂單時各生效一次）')).toBeVisible();
  await closeDemoPanel(page);
}

// ───────── Mock 資料庫（只讀） ─────────

export interface MockOrderRow {
  id: string;
  status: string;
  pickup_no: string;
  scheduled_at: number | null;
  idempotency_key: string | null;
  total_amount: number;
  payment_method: string;
}

export interface MockItemRow {
  order_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
}

export interface MockLogRow {
  idempotencyKey: string;
  outcome: string;
  orderNo?: string;
  summary?: string;
}

export interface MockDb {
  orders: MockOrderRow[];
  order_items: MockItemRow[];
  demo_request_log: MockLogRow[];
}

/** 讀取 Mock 在 localStorage 的資料庫（`zaiorder:v1:db`）；僅供斷言，不寫入 */
export async function readMockDb(page: Page): Promise<MockDb> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('zaiorder:v1:db');
    const db = (raw === null ? {} : JSON.parse(raw)) as Partial<MockDb>;
    return {
      orders: db.orders ?? [],
      order_items: db.order_items ?? [],
      demo_request_log: db.demo_request_log ?? [],
    };
  });
}

/** 本次操作下的訂單（排除種子歷史訂單 `ord_hist_*` 與他人訂單 `X` 前綴） */
export async function ownOrders(page: Page): Promise<MockOrderRow[]> {
  return (await readMockDb(page)).orders.filter(
    (o) => !o.id.startsWith('ord_hist_') && !o.pickup_no.startsWith('X'),
  );
}

/** 結帳草稿中目前的 Idempotency-Key（sessionStorage；尚未送出為 null） */
export async function currentIdempotencyKey(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const raw = window.sessionStorage.getItem('zaiorder:v1:checkoutDraft');
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { idempotencyKey?: string | null };
    return parsed.idempotencyKey ?? null;
  });
}

/** 準備結帳：加入商品、進入結帳、填聯絡資訊並等待狀態列穩定 */
export async function prepareCheckout(
  page: Page,
  products: string[],
  params: DemoParams = {},
): Promise<void> {
  await openApp(page, '/', params);
  for (const name of products) await addProduct(page, name);
  await goToCheckout(page);
  await fillContact(page);
  await waitCheckoutSettled(page);
}

/** 加入「雙人分享餐」（主餐勾招牌滷肉飯與嘉義雞肉飯，其餘預設）指定份數 */
export async function addComboShare(page: Page, quantity = 1): Promise<void> {
  await addButtonOf(page, '雙人分享餐').first().click();
  const sheet = page.getByRole('dialog', { name: '雙人分享餐' });
  await sheet.getByRole('checkbox', { name: '招牌滷肉飯' }).check();
  await sheet.getByRole('checkbox', { name: '嘉義雞肉飯' }).check();
  for (let i = 1; i < quantity; i += 1) {
    await sheet.getByRole('button', { name: '增加數量' }).click();
  }
  await expect(sheet.getByRole('spinbutton', { name: '數量' })).toHaveText(String(quantity));
  await sheet.getByRole('button', { name: /^加入購物車/ }).click();
  await expect(sheet).toBeHidden();
}

/** Demo 面板「庫存與時段情境」：把某商品設為「剩 n 份」（n = 0 為用盡），完成後收合面板 */
export async function setRemaining(
  page: Page,
  product: string,
  remaining: 0 | 1 | 2,
): Promise<void> {
  const panel = await openDemoPanel(page);
  await openDemoSection(panel, '庫存與時段情境');
  await panel.getByLabel('商品', { exact: true }).selectOption({ label: product });
  const label = remaining === 0 ? '用盡（剩 0 份）' : `剩 ${remaining} 份`;
  await panel.getByRole('button', { name: label, exact: true }).click();
  await closeDemoPanel(page);
}

/** Demo 面板「庫存與時段情境」→「手動售完（今日售完旗標）」：把某商品設為售完，完成後收合面板 */
export async function setManualSoldOut(page: Page, product: string): Promise<void> {
  const panel = await openDemoPanel(page);
  await openDemoSection(panel, '庫存與時段情境');
  await panel.getByLabel('商品', { exact: true }).selectOption({ label: product });
  await panel.getByRole('switch', { name: '手動售完（今日售完旗標）' }).check();
  await closeDemoPanel(page);
}

/** LiveAnnouncer 的 polite 區文字（Toast 另有 role=status，故以容器限定） */
export async function politeAnnouncement(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector('[data-zo-live-announcer] [role="status"]')?.textContent ?? '',
  );
}

/** LiveAnnouncer 的 assertive 區文字 */
export async function assertiveAnnouncement(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector('[data-zo-live-announcer] [role="alert"]')?.textContent ?? '',
  );
}
