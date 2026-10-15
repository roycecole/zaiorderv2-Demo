# 設計參考原型（Design Reference Prototype）

ZaiOrder 消費者端點餐介面的**靜態視覺原型**，用來在實作前確認設計方向。

> 這**不是**產品程式碼：沒有後端、沒有狀態持久化（偏好、提醒與結帳處理狀態只存在記憶體，重新載入即還原）；結帳的「送出時最終確認庫存與時段」以固定示範資料展示，清單按鈕可操作但不會產生訂單。正式專案以 React 實作，視覺規格以 [03 UI/UX 設計規格](../../03-uiux-design.md) 為準。

## 開啟方式

直接以瀏覽器開啟本資料夾的 `index.html`（截圖總覽與所有變體連結），或開啟 `app.html` 並加上 URL 參數。不需要建置，也不使用任何外部資源（無 CDN、外部字型或圖片）。

> 在 GitHub 網頁上瀏覽 `.html` 檔會顯示原始碼；請 clone 或下載後以瀏覽器開啟，或將本資料夾部署為靜態網站（如 GitHub Pages）。截圖（`png/`）可直接在 GitHub 上檢視，並已嵌入 03 與 README。

## URL 參數（`app.html`）

| 參數 | 值 | 預設 | 說明 |
| --- | --- | --- | --- |
| `screen` | `menu`、`sheet`、`checkout`、`tracking`、`themes`、`shortcuts`、`idle`、`done` | `menu` | 畫面；`shortcuts` = 快速鍵與偏好對話框（任何畫面按 `?` 亦可開啟）；`idle`、`done` 為觸控面板的閒置警示與完成畫面（自動套用 `mode=kiosk`） |
| `device` | `desktop`、`mobile` | `desktop` | 視口預設；實際版型由 CSS 斷點決定（≥ 768 桌機版型，≥ 1024 顯示右側訂單面板）；`mode=kiosk` 一律為桌機版型 |
| `data` | `full`、`mixed`、`noimg`、`minimal` | `full` | 菜單資料完整度（完整 / 約半數缺圖 / 全無圖 / 只有品名與價格） |
| `layout` | `auto`、`grid`、`list` | `auto` | 菜單版面；`auto` 依有圖商品比例 ≥ 50% 為圖卡，否則清單 |
| `brand` | `red`、`green`、`coffee`、`orange`、`blue`、`black`、`yellow` | `red` | 品牌主題色（對比度見 03 §4.8） |
| `login` | `guest`、`member` | `guest` | 影響右上角顯示，並讓會員的商品卡在品名前顯示收藏愛心（實心 = 已收藏，示範資料有兩項已收藏；訪客與觸控面板沒有愛心鈕，訪客按 `f` 只會看到可略過的登入提示）；任何狀態都不強制登入 |
| `sheet` | `lurou`、`aiyu` | `lurou` | `screen=sheet` 時的商品（`aiyu` 為無選項商品） |
| `cart` | `0`、`1` | `1` | `0` 顯示空購物車狀態 |
| `hints` | `auto`、`1`、`0` | `auto` | 單鍵快速鍵與徽章（`<kbd>`）。`auto`：**預設關閉**，桌機偵測到第一次可信的實體鍵盤按鍵後顯示鍵盤提醒，按「開啟」才啟用並顯示徽章；`1`：視為使用者已開啟（啟用並顯示徽章）；`0`：關閉且不提醒（截圖用）；`mode=kiosk` 永不偵測、不提醒、不顯示 |
| `reminder` | `0`、`1` | `0` | `1`：載入時直接顯示鍵盤提醒（截圖用；單鍵快速鍵已啟用、觸控面板、結帳畫面不顯示；訂單追蹤畫面會顯示）；提醒不論 `hints=auto` 或 `0` 都會出現，按「開啟」後徽章才出現 |
| `issues` | `0`、`bg`、`1`、`done` | `0` | `screen=checkout` 的庫存與時段最終確認：`0` 無異動；`bg` 背景偵測（狀態列「有 3 項需要調整〔查看〕」、訂單明細行在預留的狀態槽內標示、送出鈕鎖定，清單未展開；點「查看」或點擊鎖定的送出鈕 / `Ctrl/⌘ + Enter` 才展開）；`1` 送出被退回（清單展開，聚焦標題）；`done` 處理完成（「已調整：…〔復原〕」摘要、價格差異仍列、主按鈕「確認新價格並送出」；狀態列為「有 {k} 項價格更新〔查看〕」，k = 價格更新項數（不計入「有 n 項需要調整」的 n；示範資料 k = 1），僅價格更新時不顯示「有 0 項」）。無異動時狀態列為淡色的「✓ 餐點與時段可供應」。購物車改為含售完、限量不足、時段額滿與價格更新的示範內容 |
| `memory` | `0`、`1` | `0` | `1`：顯示點餐記憶（商品卡「上次：…」與「↻ 再點」、「常點」區塊、商品面板「已套用上次的選擇」）；`mode=kiosk` 不保存、不顯示 |
| `mode` | `normal`、`kiosk` | `normal` | `kiosk`：觸控面板模式（視口 1280×800 為基準；互動目標 ≥ 56×56、主要按鈕高 64、基準字級 18px、訂單面板寬 400；無鍵盤 / hover 相依，不偵測鍵盤、不提醒、不提供 ⌨ 與頁尾鍵盤入口，但仍處理 `Esc`（關閉浮層；閒置警示 = 繼續點餐）與 `Ctrl/⌘ + Enter`（結帳送出）；不顯示登入、查詢訂單、我的最愛與記憶，結帳僅現金（櫃檯付款）；60 秒閒置警示） |
| `focus` | 商品 id（例：`lurou`） | — | 載入時聚焦該商品卡，用於展示焦點外框與底部提示列 |

範例：

- `app.html?screen=menu&device=mobile&data=minimal&brand=green`
- `app.html?screen=menu&device=desktop&hints=1&focus=lurou`（已啟用單鍵快速鍵：徽章與焦點）
- `app.html?screen=menu&device=desktop&reminder=1`、`app.html?screen=menu&device=mobile&reminder=1`（鍵盤提醒：桌機錨定於 ⌨ 下方，手機與 Toast 同槽）
- `app.html?screen=checkout&device=desktop&issues=1`、`app.html?screen=checkout&device=mobile&issues=bg`（結帳庫存與時段確認：送出被退回、背景偵測）
- `app.html?screen=checkout&device=desktop`、`app.html?screen=tracking&device=desktop`（任務型頁面的鍵盤入口：頂欄 ⌨、頁尾「鍵盤快速鍵」、跳過連結）
- `app.html?screen=menu&device=desktop&memory=1`（點餐記憶與「常點」）
- `app.html?screen=menu&device=mobile&data=mixed&layout=list&login=member&memory=1`、`app.html?screen=menu&device=mobile&layout=grid&login=member`（商品卡：愛心在品名前、價格靠左與動作靠右的底列、窄卡堆疊）
- `app.html?screen=menu&mode=kiosk`、`app.html?screen=idle&mode=kiosk`、`app.html?screen=done&mode=kiosk`（觸控面板）

### 鍵盤快速鍵（小寫字母）與鍵盤提醒

**單鍵快速鍵預設關閉**（沒有徽章、沒有 `aria-keyshortcuts`，按 `c` 無反應）。開啟方式皆不依賴單鍵：鍵盤提醒的「開啟」、頂部 ⌨「鍵盤快速鍵與偏好」按鈕（≥ 768、非觸控面板，不論徽章開關都顯示）、跳過連結「鍵盤快速鍵與偏好」、頁尾「鍵盤快速鍵」「偏好設定」。任務型頁面（結帳、訂單追蹤）同樣保留 ⌨（≥ 768，位於頂欄最右）、頁尾連結與跳過連結（沒有訂單面板，故省略「跳到我的訂單」，只有「跳到主要內容」與「鍵盤快速鍵與偏好」兩個，相對順序與菜單頁一致；菜單頁的「跳到我的訂單」也只在有常駐訂單面板的 ≥ 1024 才存在，「鍵盤快速鍵與偏好」永遠是最後一個），位置與菜單頁一致（WCAG 3.2.6）。提醒本身只排除結帳與付款畫面（BR-42）：訂單追蹤畫面可出現提醒，錨定於該頁頂欄最右的 ⌨ 下方。啟用後按 `?` 開啟說明對話框（內有「啟用單鍵快速鍵」開關與顯示 / 輸入偏好）；停用時 `?` 不生效。快速鍵不在輸入框、輸入法組字中、按住 Ctrl / Alt / ⌘（`Ctrl/⌘ + Enter` 除外）或長按時觸發；`Esc` 與 `Ctrl/⌘ + Enter` 不受停用開關影響。鍵位表見 [03 §10.3](../../03-uiux-design.md)；原型內的 `HOTKEYS` 登錄表（與 07 §7.5 相同，沒有 notice 範圍；`Esc` 對提醒的處理屬 `closeTop` 的順序）是對話框、徽章與 `aria-keyshortcuts` 的單一來源。所有 `keydown` 由 `document` capture 階段的單一處理器處理：先累積偵測證據（不 `preventDefault`、不吞事件），再處理方向鍵 / 搜尋框導覽與 `HOTKEYS`（`normalizeKey` 與 07 相同：只有 `Process`、`Unidentified` 與 > U+024F 的非拉丁字元才改用 `code`，AZERTY 數字列的 `é`、`à` 不會被當成數字鍵）。

**鍵盤提醒（KeyboardNotice）**：偵測到第一次可信的實體鍵盤按鍵後，以不佔流的浮動卡詢問是否開啟單鍵快速鍵。證據以實體鍵碼 `code` 判斷（對應 07 的 `classifyKeyboardEvidence`）：`Tab` 不論焦點位置都算；Enter 與方向鍵須「目標不是輸入元件且焦點不在 body」；字母、數字與 `/ = - ?` 須焦點不在輸入元件；排除修飾鍵、`Esc`、Space / PageUp / PageDown / Home / End、輸入元件內的打字與組字（輸入元件內打字的 EDIT_TYPING 為 P2 選配，原型不實作）、不可信（合成）事件與長按；非輸入元件下 `key` 為 `Process` 的事件仍以 `code` 計；純觸控裝置需 Tab，或 10 秒內 ≥ 3 次且含非 Enter 鍵。按到的鍵若是快速鍵（例如 `c`），內文改為「剛才按的「c」是快速鍵，目前尚未開啟。要開啟單鍵快速鍵嗎？」：

- 位置：≥ 768 錨定於 ⌨ 按鈕下方（`position: fixed`，寬 `min(360px, 100vw − 32px)`；訂單追蹤頁的 ⌨ 在置中欄頂欄最右，提醒隨之對齊）；< 768 與 Toast 同槽，位於 CartBar 與底部 Tab 之上。顯示與收起前後所有互動元件的位置完全相同（CLS = 0），不呼叫 `focus()`，DOM 緊接跳過連結之後。「開啟」「不用了」高 ≥ 44，「不用了」為 ghost 按鈕。卡片可暫時覆蓋非互動的標題區（例如訂單面板標題），但不遮蔽取得焦點的元件（見下方「讓位」）。
- 按「開啟」→ 同卡轉為確認狀態（「已開啟單鍵快速鍵。按 ? 查看全部。」〔查看全部〕〔復原〕，6 秒，hover / 焦點暫停）並出現徽章；僅由鍵盤（`Enter` / `Space`）啟動時，焦點才由「開啟」移到「查看全部」，滑鼠或觸控點擊不移動焦點（避免計時被焦點暫停，卡片依計時收起）。按「不用了」→ 本次載入不再提醒。
- 焦點還原：收起（逾時、`Esc`、「復原」、「不用了」、被讓位）的當下，只有 `document.activeElement` 仍在卡片內才還原先前焦點；焦點已離開卡片（例如已移到搜尋框）時不移動焦點。
- 逾時與圓點：12 秒（hover / 焦點進入 / 頁面隱藏時暫停）或 `Esc` 收起後，≥ 768 在 ⌨ 上留下小圓點（`aria-label` 補「，有新提示」）；< 768 沒有 ⌨，直接收起（入口為頁尾與跳過連結）。圓點只在「點 ⌨、開啟偏好對話框、以任何途徑啟用單鍵快速鍵」時清除；開啟過偏好對話框即視為已看到提示，本次載入不再提醒。原型以多頁網址切換，換頁會重新載入而不保留圓點與提醒狀態。
- 讓位：Toast 或浮層（商品面板、購物車抽屜、對話框）出現時收起（提示狀態轉為圓點；確認狀態直接收起、不留圓點）；顯示中焦點移到被卡片遮住的元件時同樣轉為稍後（FOCUS_COVERED），待命時焦點在被遮住的元件上則不顯示；觸控面板、結帳與付款畫面不出現。
- `Esc` 的順序：關閉最上層浮層 → 收起鍵盤提醒（可見且焦點在其中；焦點不在提醒內時 `Esc` 不被提醒劫持）→ 搜尋框有字則清除並失焦 → 其餘不動作。
- 搜尋框內按 `↓` 或 `Enter`：焦點移到第一個結果商品卡（元件原生導覽，不屬於單字元快速鍵，不受單鍵開關影響）。

徽章（`KeyHint`）為行內元素（`inline-flex`、`aria-hidden`、`pointer-events: none`，放在標籤之後；只有搜尋框內那顆疊在輸入框的內距上）。啟用徽章時允許局部重排（按鈕旁多出徽章）；購物車品項的「編輯」「移除」按鈕不與徽章開關耦合，一律可見。

> 測試用：在載入前設定 `window.__PROTO_MEMORY__`（物件）可覆寫點餐記憶資料，例如驗證「部分選項已不提供」。

## 與規格的差異（示意簡化）

原型是示意用的簡化版，不逐區塊對應 03 的線框；核對規格或驗收時以 03 為準：

- **結帳區塊編號**：原型左欄為 1～6（取餐方式、取餐時間、聯絡資訊、付款方式、發票、備註與餐具），右欄「訂單明細」為 **7**；03 PG-04 的左欄為 ①～⑧、右欄訂單明細為 **⑨**。規格與驗收所說的「右欄 ⑨ 狀態槽」「⑨ 的小計與送出鈕」在原型對應右欄的 7「訂單明細」。
- **未示範的區塊**：外送地址與桌號（03 的 ③）、折扣碼與優惠券（⑥）、條款聲明與行銷同意勾選，以及店家狀態說明（休息中 / 暫停接單）。因此異動清單只示範「無法購買、數量不足、時段」三類阻擋項與一項價格更新；折扣 / 付款 / 發票 / 外送條件類沒有示範資料。
- **沒有付款畫面**：提醒的路由排除（結帳與付款）在原型只對應結帳；訂單追蹤畫面則照規格可出現提醒。
- **不保留狀態**：偏好、提醒與結帳處理狀態只存在記憶體（見上方說明）；原型以多頁網址切換，換頁會重新載入，因此不保留 ⌨ 圓點與提醒狀態。
- **商品卡門檻以 px 表示**：03 §6.6 的窄卡堆疊門檻以 rem 計（13.5rem；觸控面板 15.5rem），原型的字級是 px 代幣、沒有縮放 html 基準字級，因此以各模式的基準字級換算：一般 216px、大字 243px、觸控面板 279px、觸控面板大字 310px（`app.css` 的 `@container`）。型態仍只由卡片內容寬決定。
- **收藏只是示意**：愛心鈕只在 `login=member` 顯示，狀態只存在記憶體；商品面板沒有愛心。

## 截圖

`png/` 內為各畫面的截圖（手機 2×、桌機 1×），已嵌入 03 與 README。重新產生時請以固定視口（390×844、1440×900、觸控面板 1280×800 等）擷取；Chrome 無頭模式的 CLI 視窗最小寬度為 500px，手機尺寸需改用 DevTools Protocol 設定視口，並以觸控模擬（`Emulation.setTouchEmulationEnabled`）使 `hover: none` 與 `any-pointer: coarse`，鍵盤提醒才不會被偵測觸發。既有畫面以 `hints=0` 擷取（不含徽章與提醒）；結帳畫面需等待約 1 秒讓頂部狀態列完成「確認中 → 結果」。每次重拍後以像素差異比對，只替換因語意變更而改變的圖。

新增於 v0.4.1 的截圖（商品卡特寫，只截取菜單內前幾張商品卡的範圍；視口 390 寬 @2x、觸控模擬）：

| 檔案 | 參數 | 範圍 |
| --- | --- | --- |
| `card-list-member.png` | `screen=menu&device=mobile&data=mixed&layout=list&login=member&memory=1&cart=0&hints=0` | 飯類前 5 張卡（382×798） |
| `card-grid-member.png` | `screen=menu&device=mobile&data=full&layout=grid&login=member&memory=1&cart=0&hints=0` | 飯類前 4 張卡（382×653） |

新增於 v0.4 的截圖：

| 檔案 | 參數 | 視口 |
| --- | --- | --- |
| `keyboard-reminder-desktop.png` | `screen=menu&device=desktop&reminder=1&hints=auto` | 1440×900 |
| `keyboard-reminder-mobile.png` | `screen=menu&device=mobile&reminder=1` | 390×844 @2x |
| `checkout-issues-desktop.png` | `screen=checkout&device=desktop&issues=1` | 1440×900 |
| `checkout-issues-mobile.png` | `screen=checkout&device=mobile&issues=1` | 390×1200 @2x |

商品卡排版重整（v0.4.1：愛心在品名前、LIST 價格與動作移到跨滿全寬的底列、精簡卡為兩列、窄卡堆疊）而重拍的既有截圖：`menu-desktop-full`、`menu-desktop-minimal`、`menu-desktop-green`、`menu-desktop-hints`、`menu-desktop-memory`、`menu-mobile-full`、`menu-mobile-mixed-list`、`menu-mobile-minimal`、`menu-mobile-memory`、`sheet-mobile-minimal`（背景菜單）、`shortcuts-dialog`（背景菜單）、`keyboard-reminder-desktop` / `keyboard-reminder-mobile`、`kiosk-menu`、`kiosk-idle`（背景菜單）；其餘畫面（商品面板、結帳、訂單追蹤、主題、觸控面板完成畫面）不含商品卡，重拍後與修改前的原型輸出逐像素相同，未替換。

v0.4 語意變更而重拍的既有截圖：`menu-desktop-full`、`menu-desktop-minimal`、`menu-desktop-green`（⌨ 與「移除」不再隨徽章隱藏）、`checkout-mobile-guest`（390×1240，預留高度的狀態列、明細行狀態槽與頁尾入口）、`shortcuts-dialog` 與 `menu-desktop-memory`（改以預設關閉的 `hints=0` 重拍：開關為關、副標為未啟用版本、背景無徽章）、`tracking-mobile`（390×1060，新增頁尾入口）、`checkout-issues-desktop` / `checkout-issues-mobile`（頂欄 ⌨、明細行狀態槽）、`keyboard-reminder-desktop` / `keyboard-reminder-mobile`（按鈕高 ≥ 44、「不用了」為 ghost）。`menu-desktop-hints` 刻意維持已啟用單鍵快速鍵（`hints=1`）的畫面。

## 規則

- 設計代幣（顏色、圓角、陰影、品牌色組）必須與 03 §4 一致；修改代幣請先改規格文件。
- 預設品牌色組的數值由 `domain/theme.ts` 的演算法推導（見 07 §7.4），此處為其靜態副本。
- 任何畫面不得出現強制登入；登入僅為 ghost 連結或可略過的提示。
- 商品卡（03 §6.6）：`LIST` 與 `GRID` 共用「品名列（愛心在品名前）→ 底列（價格靠左、動作靠右，跨滿內容寬度並貼卡片底端）」；`LIST` 的縮圖 88×88 在底列上方的右欄，動作右緣 = 縮圖右緣 = 內容區右緣；精簡卡沒有縮圖與描述，仍是兩列；卡片內容寬低於門檻時底列一律堆疊，不依價格字數或動作種類。
- 單鍵快速鍵預設關閉，徽章與 `aria-keyshortcuts` 跟隨同一個開關；偵測到實體鍵盤只用於「提醒可開啟」，不隱藏或停用任何輸入方式。`?` 在停用時不生效；`Esc`、`Ctrl/⌘ + Enter` 永遠有效。
- 鍵盤提醒不位移版面、不搶焦點、不遮蔽取得焦點的元件與主要操作（可暫時覆蓋非互動的標題區）；⌨ 入口（含結帳與訂單追蹤，≥ 768）、頁尾連結與購物車「移除」不依賴徽章開關。徽章為行內元素，不得隱藏或移動功能控制項。
- 觸控面板不偵測、不提醒、不顯示鍵盤入口，但 `Esc` 與 `Ctrl/⌘ + Enter` 永遠有效（以同一個 `resolveHotkey`，`enabled = false`）。
- 結帳頁首為預留高度（`min-height`，涵蓋兩行與 44px 目標，內容可撐高）的狀態列，確認中 → 結果不位移；訂單明細行預留狀態槽（無狀態時空白佔位），狀態或動作鈕變化不推擠小計與送出鈕；異動清單只在送出被退回或使用者點「查看」（含點擊鎖定的送出鈕、鎖定時 `Ctrl/⌘ + Enter`）時展開，背景偵測只更新狀態列、明細行與送出鈕；異動清單標題（`h2`，被退回時取得焦點）以 `aria-describedby` 帶說明句與視覺隱藏的異動摘要（不重複標題的計數，不另用 `role="alert"`）；送出鈕鎖定使用 `aria-disabled`（可聚焦並以 `aria-describedby` 說明）；`Ctrl/⌘ + Enter` 小字僅桌機（`hover: hover` 且 `pointer: fine`）顯示且不跟隨單鍵開關；視窗高度 < 480 px（含手機橫向與 400% 縮放）時，sticky 送出列改為文件流內，鎖定說明不再預留兩行（03 §5.4）。
- 不使用任何外部資源（CDN、外部字型、圖片或網路請求）。
