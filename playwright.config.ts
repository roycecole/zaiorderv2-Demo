// playwright.config.ts —— E2E（07 §13；UAT-01～17、19～27）
import { defineConfig, devices } from '@playwright/test';

// 多個 E2E 程序同時執行時，以 E2E_PORT / E2E_OUT_DIR 區隔（建置輸出與預覽埠不可共用）
const PORT = Number(process.env.E2E_PORT ?? 4173);
const OUT_DIR = process.env.E2E_OUT_DIR ?? 'dist';

export default defineConfig({
  testDir: './e2e',
  // Mock 每個請求固定延遲 300ms（±100ms）；多步驟流程在多程序同時執行時可能超過預設的 30 秒
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // 本機已有不同修訂版的 Chromium 快取時，以 PW_CHROMIUM_PATH 指定執行檔（避免重新下載）
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: {
    // Demo 建置（Mock + Demo 模式）；型別檢查由 `npm run typecheck` 負責，這裡只建置
    command: `npx vite build --outDir ${OUT_DIR} --emptyOutDir && npx vite preview --outDir ${OUT_DIR} --port ${PORT} --strictPort`,
    env: { VITE_DATA_SOURCE: 'mock', VITE_DEMO_MODE: 'true', VITE_APP_BASE_PATH: '/' },
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
