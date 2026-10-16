# ZaiOrder（再點）— 台灣小吃店線上點餐平台（消費者端）

純前端的 React + TypeScript 單頁應用（SPA），RWD，可直接部署為**線上 Demo**（Mock Adapter + `localStorage`，零後端、零設定），之後只換資料來源即可串接 REST API。

- 全程免登入（訪客可下單、查詢訂單）；會員僅提供歷史訂單、地址簿、我的最愛、優惠券
- 白底簡約，單一可換的品牌主色；無圖片、無選項的商品也能完整使用
- 無障礙（WCAG 2.2 AA）、純鍵盤操作（小寫單鍵快速鍵預設關閉，偵測到實體鍵盤後提醒）、觸控面板（Kiosk）模式
- 結帳最終庫存確認、冪等重送、點餐記憶與一鍵再點

完整規格在 [`docs/`](./docs/README.md)（需求、流程、UI/UX、ERD、資料表、API、前端架構、Demo 指南、功能缺口）。

## 快速開始

```bash
npm install
npm run dev          # http://localhost:5173 ，預設 Mock + Demo 模式
```

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | 開發伺服器（讀取 `.env.development`：Mock + Demo 模式） |
| `npm run build` | 型別檢查 + 正式建置（資料來源依環境變數） |
| `npm run build:demo` | Mock + Demo 模式的建置，可直接部署為靜態網站 |
| `npm run preview` | 預覽建置結果 |
| `npm run typecheck` / `npm run lint` | 型別檢查 / ESLint（含分層依賴規則） |
| `npm test` | 單元與元件測試（Vitest） |
| `npm run test:e2e` | E2E（Playwright；見下方「E2E」） |
| `npm run measure:bundle` | 量測首頁首次載入的 JS（gzip），見下方「首次載入預算」 |

## 環境變數

複製 `.env.example` 為 `.env.local` 後調整（皆為 `VITE_` 前綴，詳見 [07 §5.1](./docs/07-frontend-architecture.md)）：

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `VITE_DATA_SOURCE` | `mock` | `mock`（Mock Adapter + localStorage）或 `http`（HTTP Adapter） |
| `VITE_API_BASE_URL` | `/api/v1` | HTTP 模式的 API 基底網址 |
| `VITE_STORE_SLUG` | `demo-snack` | 店家代號 |
| `VITE_DEMO_MODE` | `true`（開發） | 顯示 Demo 橫幅與工具面板、啟用 `?demo_*` 網址參數與 `?mode=kiosk` |
| `VITE_APP_BASE_PATH` | `/` | 子路徑部署（例：`/zaiorderv2-Demo/`） |
| `VITE_ROUTER_MODE` | `browser` | `browser` 或 `hash`（無法設定 SPA fallback 的主機） |
| `VITE_KIOSK_MODE` | `false` | 專用觸控面板部署 |

## 專案結構

```text
src/
├── app/            路由、Provider、版面（AppShell / TaskLayout）
├── domain/         純 TypeScript：型別、計價、時段、庫存配置、冪等、快速鍵、主題… （無 React、無 I/O）
├── services/       時鐘、儲存、ApiClient 介面；api/mock（Mock Adapter）、api/http（HTTP Adapter）
├── features/       依功能切分：menu、cart、checkout、orders、auth、account、store、a11y、kiosk、demo、prefs
├── components/     通用 UI（Button、Dialog、Sheet、Toast…）
├── hooks/、i18n/、styles/、test/
e2e/                Playwright
docs/               規格文件與設計參考原型
```

分層依賴方向由 ESLint 強制（`domain` ← `services` ← `features` / `components`；`features` 不得直接 import Mock / HTTP 內部，唯一例外是 `features/demo`），細節見 [07 §4](./docs/07-frontend-architecture.md)。

## Demo 與 Mock

- 第一次開啟可用 Demo 面板（頂部列的「Demo」入口，手機為圖示鈕）：自動推進訂單、時間穿梭、付款結果與錯誤注入、庫存與時段情境、菜單完整度、品牌色預覽、輸入模式預覽、重置資料。
- 示範會員：手機 `0900000000`、驗證碼 `123456`；所有資料皆為虛構。
- 網址參數（僅 Demo 模式）：`?demo_clock=`、`?demo_fail=`、`?demo_limit=`、`?demo_race=`、`?demo_fullslot=`、`?table=A3`、`?mode=kiosk`；用法見 [08 Demo 指南](./docs/08-demo-guide.md)。
- Mock 資料存於 `localStorage`（`zaiorder:v1:*`）；面板的「重置 Demo 資料」會清除並重新載入。

## 部署

建置產物是純靜態檔案（`dist/`），任何靜態主機都能放；專案已隨附各主機需要的設定：

| 主機 | 設定 | 說明 |
| --- | --- | --- |
| Vercel | [`vercel.json`](vercel.json) | SPA fallback + 安全 / 快取標頭 |
| Netlify、Cloudflare Pages | [`public/_redirects`](public/_redirects)、[`public/_headers`](public/_headers) | 建置時會被複製進 `dist/` |
| GitHub Pages | [`.github/workflows/deploy-demo.yml`](.github/workflows/deploy-demo.yml) | 以儲存庫名稱為子路徑，複製 `404.html` 當 SPA fallback；Settings → Pages → Source 選「GitHub Actions」。Pages 無法設定回應標頭 |

- **安全標頭**：CSP（`script-src 'self'`，不允許 inline / eval）、`nosniff`、`Referrer-Policy`、`Permissions-Policy`；快取：`/assets/*` 一年且不可變、`index.html` 每次驗證。定義集中在 [`vite-plugins/deployHeaders.ts`](vite-plugins/deployHeaders.ts)，E2E 在同樣的標頭下執行。
- **串接真實 API 時**：在該檔的 `CSP_DIRECTIVES['connect-src']` 加上 API 網域，然後重新產生三個設定檔並提交：
  ```bash
  node --experimental-strip-types -e "import('./vite-plugins/deployHeaders.ts').then(async (m) => { const fs = await import('node:fs'); fs.writeFileSync('public/_headers', m.renderHeadersFile()); fs.writeFileSync('public/_redirects', m.renderRedirectsFile()); fs.writeFileSync('vercel.json', m.renderVercelJson()); })"
  ```
- **搜尋引擎**：Demo 與觸控面板建置會輸出 `noindex` 與禁止收錄的 `robots.txt`；`VITE_DEMO_MODE=false` 的正式建置可被收錄。
- **hash 路由備案**（`VITE_ROUTER_MODE=hash`）：查詢字串寫在 `#/` 之後，例如 `https://host/repo/#/?mode=kiosk`。

## 串接真實 API

1. 設定 `VITE_DATA_SOURCE=http`、`VITE_API_BASE_URL`、`VITE_STORE_SLUG`
2. 後端依 [06 API 規格](./docs/06-api-spec.md) 實作；前端的 HTTP Adapter（`src/services/api/http`）已涵蓋攔截器、權杖換發、錯誤正規化與時鐘校正
3. 步驟與檢核清單見 [07 §15](./docs/07-frontend-architecture.md)

## E2E

```bash
# 本機若已有不同修訂版的 Chromium 快取，可指定執行檔，避免重新下載瀏覽器
export PW_CHROMIUM_PATH="/path/to/chromium"
npm run test:e2e -- --project=desktop
```

Playwright 會自動建置並預覽 Demo 版本；同時執行多組時以 `E2E_PORT`、`E2E_OUT_DIR` 區隔埠與輸出目錄。

## 首次載入預算

NFR-03：首頁首次載入的 JS ≤ **200 kB gzip**（kB = 1000 位元組，與 Vite 報表、Chrome DevTools 相同）。量測方式：

```bash
# HTTP 建置（正式環境）與 Demo 建置各建一份，再以 Chromium 載入首頁並加總所有 .js（逐檔 gzip）
VITE_DATA_SOURCE=http VITE_DEMO_MODE=false npx vite build --outDir dist/m-http --emptyOutDir
VITE_DATA_SOURCE=mock VITE_DEMO_MODE=true  npx vite build --outDir dist/m-mock --emptyOutDir
export PW_CHROMIUM_PATH="/path/to/chromium"   # 不會下載瀏覽器
npm run measure:bundle -- --dist dist/m-http --budget 200
npm run measure:bundle -- --dist dist/m-mock --viewport 390x844
```

腳本以內建靜態伺服器提供 `dist`、載入 `/`（可用 `--path` 指定）並等到菜單渲染與網路閒置；HTTP 建置沒有後端時，
`/api/v1` 以最小資料回應。輸出會標示「靜態相依」（`index.html` 直接引用）與「動態載入」（執行後 `import()`）。

| 建置 | 調整前 | 目前 | 主要內容（gzip） |
| --- | --- | --- | --- |
| HTTP（非 Demo） | 221.7 kB | **194.9 kB** | react-dom 等 67.5、應用程式入口（router + query + 外殼）59.7、MenuPage 13.9、共用元件與字串 12.4 + 11.2、react-query 7.5、購物車面板 7.0 |
| Demo（Mock + Demo 模式） | 262.5 kB | **231.2 kB** | 同上，另加 Mock Adapter 與種子資料 29.4、Demo 橫幅與入口鈕 7.6、slots 2.3 |

做法（皆不改變行為）：

- **浮層延後載入**（`src/components/lazyOverlay.tsx`）：`Dialog` / `ConfirmDialog`、商品面板（`LazyProductSheet`）、
  快速鍵與偏好（`ShortcutsDialog`）、Demo 工具面板第一次需要時才動態載入；Radix Dialog 與 remove-scroll 等
  相依套件獨立成 `overlay` chunk。指標移入 / 觸控 / 焦點進入菜單時先預載商品面板；觸控面板的閒置警示於掛載時預載。
- **字串依功能切分**：`t` 只含首屏與外殼的命名空間；結帳、訂單、帳號、登入、Demo 與隱私權 / 服務條款內文由各頁面直接
  匯入（`import { checkout as tCheckout } from '@/i18n/strings/checkout'`），不進首屏。
- **供應商分群**（`vite.config.ts` 的 `build.rolldownOptions.output.codeSplitting`）：react 系列、Radix、表單套件各自獨立。
  `@/components` 主匯出**不可**re-export 浮層群組的模組（`Sheet`、`DialogTitle` 等改由 `@/components/overlay` 匯出），
  否則承載主匯出的共用 chunk 會變成依賴 Radix chunk，首屏又會載入它。
- 觸控面板的閒置守衛、Demo 工具面板、Mock Adapter 與 HTTP Adapter 皆為動態載入，彼此不互相打包。

### 首屏體驗（LCP / CLS）

NFR-03 另要求 LCP ≤ 2.5 s、CLS ≤ 0.1。以 Chromium 模擬 Pixel 7、4G（1.6 Mbps、RTT 150 ms）、4× CPU，冷啟動載入首頁
（不使用 Lighthouse，不需下載額外工具；節流設定與 Lighthouse 行動版同級）：

```bash
VITE_DATA_SOURCE=mock VITE_DEMO_MODE=false npx vite build --outDir dist/vitals --emptyOutDir
PW_CHROMIUM_PATH=/path/to/chromium npm run measure:vitals -- --dist dist/vitals --max-lcp 2500 --max-cls 0.1
```

`e2e/layout-stability.spec.ts` 另以（不節流的）E2E 守住 CLS，避免之後又有區塊在資料回來時把內容推開。

| 項目 | 調整前 | 目前 |
| --- | --- | --- |
| CLS（手機 / 768 / 1440，白天與夜間） | 0.24 ～ 1.0 | **0**（最大 0.0025） |
| LCP | 2.4 ～ 2.8 s | **約 2.0 ～ 2.3 s** |

做法：

- **首頁整頁骨架一次換成內容**（`MenuSkeleton`、`useLatched`）：店家資訊、營業狀態、Banner 與菜單都回來之前不逐塊顯示。
  逐塊出現（公告、店家資訊、休息中提示、Banner、分類列）會把已顯示的內容一路往下推；公告只放在首頁，休息中提示併入店家資訊列。
- **啟動平行化**：`main.tsx` 在 React 渲染前就啟動資料來源並預取首屏資料（`app/startup.ts`），預先下載 Logo 與第一張 Banner；
  `vite-plugins/preloadChunks.ts` 在 `index.html` 預載資料來源與首頁路由的 chunk，不再「入口 JS → 資料來源 → 路由 chunk」串聯等待；
  路由器的 `HydrateFallback` 顯示頂部列骨架，不再整頁空白。

## 授權與聲明

示範店家、地址、電話與會員皆為虛構；金流、發票、簡訊在 Demo 中全為模擬，不會送出任何真實訂單或收款。
