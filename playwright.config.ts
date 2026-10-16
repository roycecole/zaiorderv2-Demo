// playwright.config.ts —— E2E（07 §13；UAT-01～17、19～27）
import { defineConfig, devices } from '@playwright/test';

// 多個 E2E 程序同時執行時，以 E2E_PORT / E2E_OUT_DIR 區隔（建置輸出與預覽埠不可共用）
const PORT = Number(process.env.E2E_PORT ?? 4173);
const OUT_DIR = process.env.E2E_OUT_DIR ?? 'dist';
// 本機已有不同修訂版的 Chromium 快取時，以 PW_CHROMIUM_PATH 指定執行檔（避免重新下載）；只套用在 Chromium 專案
const chromiumLaunch = process.env.PW_CHROMIUM_PATH
  ? { executablePath: process.env.PW_CHROMIUM_PATH }
  : {};
// NFR-02：Safari / Firefox 冒煙測試。需先 `npx playwright install webkit firefox`；CI 以不阻擋的工作執行（見 .github/workflows/ci.yml）
const crossBrowser = process.env.E2E_CROSS_BROWSER === '1';

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
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: chromiumLaunch } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: chromiumLaunch }, grep: /@mobile/ },
    ...(crossBrowser
      ? [
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        ]
      : []),
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
