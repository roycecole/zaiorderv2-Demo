// 部署標頭（07 §11、§14.2；NFR-07）：preview 以與正式部署相同的安全標頭提供頁面，
// 走過典型流程（商品面板 / 結帳 / 訂單頁的確認對話框 / Demo 面板 / 快速鍵說明）不得產生任何 CSP 違規。
import { expect, test } from '@playwright/test';
import { addViaSheet, fillContact, gotoApp, openCheckout, submitAndWaitForOrder } from './helpers/app';
import { closeDemoPanel, openDemoPanel } from './helpers/demo';

declare global {
  interface Window {
    __csp?: string[];
  }
}

test.use({ viewport: { width: 1280, height: 800 } });

test.describe('安全標頭與 CSP', () => {
  test('文件回應帶有 CSP、nosniff、Referrer-Policy 與 Permissions-Policy', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers() ?? {};
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("script-src 'self'");
    expect(headers['content-security-policy']).not.toContain("'unsafe-eval'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
  });

  test('典型流程（商品面板、結帳、取消確認、Demo 面板、快速鍵說明）沒有 CSP 違規', async ({
    page,
  }) => {
    const consoleViolations: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to (?:load|apply|execute|connect)/i.test(message.text())) {
        consoleViolations.push(message.text());
      }
    });
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        (window.__csp ??= []).push(`${event.violatedDirective} ← ${event.blockedURI}`);
      });
    });

    await gotoApp(page);
    // 商品面板（Radix Dialog：會注入捲動鎖的 <style>）
    await addViaSheet(page, '招牌滷肉飯', { radios: ['大碗'] });
    // 結帳 → 送出 → 訂單頁
    await openCheckout(page);
    await fillContact(page);
    await submitAndWaitForOrder(page);
    // 取消訂單的確認對話框
    await page.getByRole('button', { name: '取消訂單' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toBeHidden();
    // Demo 面板
    await openDemoPanel(page);
    await closeDemoPanel(page);
    // 快速鍵說明對話框（頂部列 ⌨）
    await page.getByRole('button', { name: /鍵盤快速鍵與偏好/ }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    expect(await page.evaluate(() => window.__csp ?? [])).toEqual([]);
    expect(consoleViolations).toEqual([]);
  });
});
