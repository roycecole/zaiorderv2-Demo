import { fileURLToPath, URL } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { SECURITY_HEADERS } from './vite-plugins/deployHeaders.ts';
import { htmlMeta } from './vite-plugins/htmlMeta.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: env.VITE_APP_BASE_PATH || '/',
    plugins: [
      react(),
      tailwindcss(),
      htmlMeta({ demo: env.VITE_DEMO_MODE === 'true', kiosk: env.VITE_KIOSK_MODE === 'true' }),
    ],
    // `vite preview`（E2E 使用）送出與正式部署相同的安全標頭，CSP 有問題會在測試中暴露
    preview: { headers: SECURITY_HEADERS },
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      rolldownOptions: {
        output: {
          // 首次載入 JS 預算（NFR-03：≤ 200 kB gzip；量測方式見 README「首次載入預算」）。
          // 自動分群會把「只有浮層（Radix Dialog）才用到」的套件併進首屏必載的共用 chunk；
          // 這裡明確指定：React 與 Radix / 表單套件各自獨立，Radix 只在第一次開啟浮層時才載入。
          // 注意：`@/components` 主匯出不可 re-export overlay 群組內的模組（Sheet、dialogParts…），
          // 否則承載該匯出檔的共用 chunk 會變成依賴 overlay chunk，首屏就會連帶載入。
          codeSplitting: {
            groups: [
              { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
              {
                // Radix Dialog 與其相依套件，連同 Dialog / Sheet 的實作：只有第一次開啟浮層時才載入
                name: 'overlay',
                test: (id: string) =>
                  /node_modules[\\/](@radix-ui|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-sidecar|use-callback-ref|aria-hidden|get-nonce|tslib)[\\/]/.test(id) ||
                  /src[\\/]components[\\/](overlayParts|dialogParts|DialogImpl|Sheet)\.tsx$/.test(id),
                priority: 20,
                includeDependenciesRecursively: false,
              },
              {
                name: 'vendor-forms',
                test: /node_modules[\\/](react-hook-form|@hookform|zod)[\\/]/,
                priority: 20,
              },
            ],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      passWithNoTests: true,
      // Node ≥ 22 的實驗性 Web Storage 會遮蔽 jsdom 的 localStorage 並印出警告；支援該旗標時關閉（setup.ts 另有防護）
      execArgv: process.allowedNodeEnvironmentFlags.has('--no-experimental-webstorage')
        ? ['--no-experimental-webstorage']
        : [],
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      include: ['src/**/*.test.{ts,tsx}', 'vite-plugins/**/*.test.ts'],
    },
  };
});
