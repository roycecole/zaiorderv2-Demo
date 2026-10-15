# 06 · API 規格（API Specification）

| 項目 | 內容 |
| --- | --- |
| 專案 | ZaiOrder — 台灣小吃店線上點餐平台（消費者端） |
| 文件 | 前後端串接契約：通則、端點、資料型別、錯誤碼、串接檢核 |
| 版本 | v0.4.1 草案 ｜ 2026-10-16 |
| 狀態 | **契約先行**：Phase 1 由前端 Mock Adapter 實作；Phase 2 由後端實作，兩者必須通過同一組契約測試 |
| 相關文件 | [05 資料表](./05-database-schema.md)（欄位與列舉）・[07 前端架構](./07-frontend-architecture.md)（`ApiClient` 與 Adapter）・[02 流程圖](./02-flows.md) |

> 文件導覽：[← 05 資料表設計](./05-database-schema.md) ・ 下一份：[07 前端架構 →](./07-frontend-architecture.md)

---

## 1. 通則

### 1.1 基本資訊

| 項目 | 規範 |
| --- | --- |
| Base URL | `{API_BASE_URL}/api/v1`（前端以 `VITE_API_BASE_URL` 設定） |
| 協定 | HTTPS；JSON（`Content-Type: application/json; charset=utf-8`） |
| 版本 | 路徑版本 `/v1`；破壞性變更升版，非破壞性（新增欄位 / 新增選填參數）不升版 |
| 命名 | JSON 欄位 `camelCase`；路徑 `kebab-case`；列舉值 `UPPER_SNAKE_CASE`（見 [05 §3](./05-database-schema.md)） |
| 店家定位 | 路徑以 `{storeSlug}` 指定店家（Phase 1 固定為 `demo-snack`） |

### 1.2 資料格式慣例

| 類型 | 規範 | 範例 |
| --- | --- | --- |
| ID | 不透明字串，**前端不得假設格式**（正式環境為 ULID；Demo 種子使用可讀前綴，如 `prd_lurou`） | `"01JAXN5Q8Z3M7R2T4V6W9K1B2C"` |
| 日期時間 | ISO 8601，**含 `+08:00` 偏移**（店家時區） | `"2026-10-14T12:30:00+08:00"` |
| 日期 / 時刻 | `YYYY-MM-DD`／`HH:mm`（24 小時制，店家時區） | `"2026-10-14"`、`"11:00"` |
| 金額 | 整數新台幣元（含稅），**不使用小數** | `92` |
| 空值 | 可省略的欄位以 `null` 或省略表示；本文以 `?` 與 `\| null` 明確標示 | |
| 列舉 | 大寫字串；**前端遇到未知列舉值必須優雅降級**（顯示原值或預設樣式） | `"PENDING"` |

### 1.3 認證與授權

| 情境 | 機制 |
| --- | --- |
| 會員 | `Authorization: Bearer <accessToken>`；Access Token 有效 15 分鐘；Refresh Token 有效 30 天並於每次換發時輪替 |
| 訪客訂單 | 建立訂單時回傳 `trackingToken`（冪等重放與 `GET /orders/lookup` 時重新簽發，舊權杖失效；同一訂單同時只有一把有效權杖）；之後以標頭 `X-Tracking-Token: <token>` 存取該訂單 |
| 訪客查詢 | `GET /orders/lookup`（訂單編號 + 手機）換取 `trackingToken`；需嚴格速率限制 |
| 公開 | 店家資訊、菜單、時段、外送範圍、報價（`quote`）、建立訂單（訪客）無須認證 |

> **Token 傳遞模式**：
> - **Cookie 模式（Phase 2 瀏覽器建議）**：Refresh Token 以 `HttpOnly; Secure; SameSite=Lax` Cookie 簽發，回應 body 的 `tokens.refreshToken` **省略**；`/auth/refresh`、`/auth/logout` 以 Cookie 識別，前端請求需 `credentials: 'include'`；Access Token 僅存於記憶體。
> - **Body 模式（Demo、非瀏覽器用戶端）**：Refresh Token 於 body 收發。Phase 1 Demo 無後端，Session 存於 `localStorage`（僅限虛構資料）。

### 1.4 共通標頭

| 標頭 | 方向 | 說明 |
| --- | --- | --- |
| `Authorization` | 請求 | 會員 Bearer Token |
| `X-Tracking-Token` | 請求 | 訪客存取訂單 |
| `Idempotency-Key` | 請求 | **`POST /orders` 必填**；UUID v4 或 ULID；同 Key 同內容回傳原結果、不同內容回 `409`（BR-27；規範見下方「`Idempotency-Key` 規範」） |
| `X-Request-Id` | 請求 / 回應 | 追蹤用；前端可帶入，後端回傳並寫入錯誤 `requestId` |
| `Accept-Language` | 請求 | 預設 `zh-TW`（目前僅支援） |
| `ETag` / `If-None-Match` | 回應 / 請求 | `GET /orders/{id}` 支援條件請求，輪詢時回 `304` 節省流量 |
| `Idempotent-Replayed` | 回應 | `POST /orders` 冪等重放時為 `true`，僅作輔助；前端以回應 body 的 `replayed` 為準。跨網域時須以 `Access-Control-Expose-Headers` 暴露（§7.1） |
| `Retry-After` | 回應 | `429`、`503` 時的建議等待秒數，與 `error.retryAfterSeconds` 相同；前端以 body 為準。跨網域時須暴露（§7.1） |

**`Idempotency-Key` 規範**（`POST /stores/{storeSlug}/orders`）

| 項目 | 規範 |
| --- | --- |
| 格式 | UUID v4 或 ULID，長度 ≤ 64；缺少或格式不符 → `400 VALIDATION_FAILED` |
| 指紋 | 以 SHA-256 對**正規化後的請求內容**取值，用來判斷「同一 Key 的內容是否相同」。正規化：每行 `optionIds` 排序、每行 `note` 去前後空白（空白視同未填）、**移除 `expectedTotal`**；`items` 順序保留（順序決定同商品多行的配置，BR-40）；其餘欄位（整單 `note`、`scheduledAt`、`paymentMethod`、`contact` 等）原樣納入，任一改動即視為不同內容。因此回應遺失後背景重新報價、價格改變，同 Key 重送仍視為同一內容 |
| 指紋保存 | 隨訂單保存於 `orders.idempotency_request_hash`（[05 §5.4](./05-database-schema.md)）；帳號刪除或保存期限到期的去識別化步驟（[05 §7.2](./05-database-schema.md)）將其置為 `NULL`，或改以伺服器祕密為鍵的 HMAC 計算，避免指紋成為反推個資的旁路 |
| 保證期間 | 自訂單建立起**至少 24 小時**，同 Key 保證回傳原結果。實作上 Key 隨訂單存續（[05](./05-database-schema.md) 的唯一鍵不隨時間清除），不另設清除排程 |
| 綁定 | 僅**成功建立訂單（2xx）**的請求綁定 Key；4xx、5xx（未建立訂單）不綁定，可沿用同 Key 修改內容後重送（BR-27） |
| 重放 | 同 Key 且指紋相同 → `201`，回傳原訂單的**目前狀態**（可為 `CANCELLED`）：`replayed: true`、標頭 `Idempotent-Replayed: true`、訪客重新簽發 `trackingToken`（舊權杖失效）；不重驗庫存與價格、不重複計入、忽略 `expectedTotal`。回應建構前先對原訂單執行 `expireIfDue`（同 [§5.10](#510-get-ordersorderid)），已逾付款期限者回 `CANCELLED`，`nextAction` 與 `permissions` 以結算後狀態計算。指紋不同 → `409 IDEMPOTENCY_CONFLICT`。無鎖快速路徑與鎖內重查皆須比對指紋 |
| 並行 | 同 Key 的並行請求由店家建單互斥鎖序列化：第二個請求在鎖內看見已提交訂單，轉為重放；唯一鍵衝突亦轉為重放，不回 `500` |
| 前端規範 | 見下列五點 |

前端（`ApiClient` 呼叫端）須遵守（BR-41、[FLOW-24](./02-flows.md#flow-24-結果未知與冪等重送)）：

1. **產生**：首次按下送出時產生，存入 `sessionStorage`（涵蓋重新整理）；觸控面板模式僅存於記憶體，閒置重置時一併丟棄 Key 與記下的送出內容，下一位顧客一律使用新 Key（結果未知時的重複下單風險由櫃檯確認承擔，BR-37）。
2. **沿用**：直到收到 2xx 為止一律沿用同一把 Key，包含 `422`、`409 PRICE_CHANGED`、`400`、`429`、附 `retryAfterSeconds` 的 `503`（鎖逾時）與結果未知（無回應、逾時、不附 `retryAfterSeconds` 的 `5xx`）後修改內容再送；只有結果未知時才記下該次送出的內容，確定未建立者（`422`、`409 PRICE_CHANGED`、`400`、`429`、附 `retryAfterSeconds` 的 `503`）不記下。`429` 與附 `retryAfterSeconds` 的 `503` 依該秒數暫停送出鈕，之後以同一把 Key 重送。
3. **衝突**：`IDEMPOTENCY_CONFLICT` 代表先前某次送出其實已成立，**不得換新 Key**；改以同 Key 依序重放記下的內容，取回原訂單。
4. **作廢**：任一次 `201`（首次建立或重放）後 Key 立即作廢，下次送出產生新 Key；購物車僅在取回的訂單內容與目前購物車一致時清除，不一致則保留並提示。
5. **判斷重放**：以回應 body 的 `replayed` 為準，標頭 `Idempotent-Replayed` 僅輔助。

### 1.5 回應與分頁

- 單一資源：直接回傳物件，**不使用 `data` 包裝**。
- 清單：`{ "items": [...], "nextCursor": "..." | null }`；以 `limit`（預設 10，最大 50）與 `cursor` 做游標分頁。
- 無內容：`204 No Content`。
- 建立：`201 Created`。

### 1.6 速率限制

| 端點群 | 限制（建議） | 超過時 |
| --- | --- | --- |
| `POST /auth/otp/send` | 同手機 60 秒 1 次；每日 10 次；同 IP 每小時 20 次 | `429 OTP_RATE_LIMITED`，附 `retryAfterSeconds` |
| `POST /auth/otp/verify` | 同手機 10 分鐘 5 次 | `423 OTP_LOCKED` |
| `GET /orders/lookup` | 同 IP 每分鐘 10 次；**同一手機 10 分鐘 5 次**（不論訂單編號是否正確） | `429 RATE_LIMITED`，附 `retryAfterSeconds` |
| `POST /stores/{storeSlug}/orders` | 同 IP 每分鐘 10 次；同手機（`contact.phone`）10 分鐘 5 次（含被退回的嘗試；`DINE_IN` 未填手機者只計 IP） | `429 RATE_LIMITED`，附 `retryAfterSeconds`；確定未建立訂單、不綁定 Key；前端不記下送出內容、依 `retryAfterSeconds` 暫停送出鈕，之後沿用同一把 Key 重送（[FLOW-24](./02-flows.md#flow-24-結果未知與冪等重送)） |
| 其他 | 同 IP 每分鐘 120 次 | `429 RATE_LIMITED` |

> 免登入訪客可無成本建立訂單，`POST /orders` 的專屬限流是限量與時段遭佔住的第一道防線（[01 R-07、Q-14](./01-requirements.md)）。**待處理訂單上限**（同手機或同 IP 的 `PENDING_PAYMENT`、`PENDING` 訂單數）不屬速率限制：Phase 1 不限制，Phase 2 上線前須設定有限值（建議 3 張），超過時同樣回 `429 RATE_LIMITED`（`message` 說明尚有未完成的訂單）。測試環境須提供關閉或放寬 `POST /orders` 專屬限流的開關（見 [§7 測試輔助](#7-mock-與正式-api-對照)），契約並行測試不得依賴正式環境的限流值。

---

## 2. 端點總覽

階段：**P1** = Mock 需實作；**P2** = 預留。「驗證」：公開 / 會員 / 擁有者（會員本人或持有追蹤權杖）。

### 2.1 認證

| 方法 | 路徑 | 驗證 | 說明 | 需求 | 階段 |
| --- | --- | --- | --- | --- | --- |
| POST | `/auth/otp/send` | 公開 | 發送 OTP | FR-AC-01 | P1 |
| POST | `/auth/otp/verify` | 公開 | 驗證 OTP，登入或註冊 | FR-AC-01 | P1 |
| POST | `/auth/refresh` | 公開 | 以 Refresh Token 換發 | FR-AC-02 | P1 |
| POST | `/auth/logout` | 會員 | 登出並撤銷 Refresh Token | FR-AC-02 | P1 |

### 2.2 店家與菜單

| 方法 | 路徑 | 驗證 | 說明 | 需求 | 階段 |
| --- | --- | --- | --- | --- | --- |
| GET | `/stores/{storeSlug}` | 公開 | 店家資訊、營業時間、服務、付款方式、限制 | FR-ST-01～06 | P1 |
| GET | `/stores/{storeSlug}/status` | 公開 | 即時營業狀態（輕量，供輪詢） | FR-ST-02/08 | P1 |
| GET | `/stores/{storeSlug}/menu` | 公開 | 分類與商品清單（含售完旗標與剩餘份數） | FR-MN-01～06 | P1 |
| GET | `/stores/{storeSlug}/products/{productId}` | 公開 | 商品詳情與選項群組 | FR-PD-01/02 | P1 |
| GET | `/stores/{storeSlug}/banners` | 公開 | 首頁 Banner | FR-ST-07 | P1 |
| GET | `/stores/{storeSlug}/pickup-slots` | 公開 | 可預約時段 | FR-CK-02 | P1 |
| GET | `/stores/{storeSlug}/delivery-zones` | 公開 | 外送範圍清單 | FR-ST-06、FR-CK-04 | P1 |
| GET | `/stores/{storeSlug}/delivery-check` | 公開 | 檢查郵遞區號是否可外送 | FR-CK-04 | P1 |
| GET | `/stores/{storeSlug}/tables/{qrToken}` | 公開 | 以 QR 權杖解析桌號（僅網址帶 `?table=` 時呼叫；手動選內用不呼叫，桌號選填） | FR-CK-05 | P1 |

### 2.3 訂單與付款

| 方法 | 路徑 | 驗證 | 說明 | 需求 | 階段 |
| --- | --- | --- | --- | --- | --- |
| POST | `/stores/{storeSlug}/orders/quote` | 公開 | 計價與驗證（不建立訂單、不保留庫存） | FR-CK-09/11、FR-CT-05 | P1 |
| POST | `/stores/{storeSlug}/orders` | 公開 | 建立訂單（需 `Idempotency-Key`；同一交易內做最終庫存與時段確認） | FR-CK-11/15/16 | P1 |
| GET | `/orders` | 會員 | 我的訂單（游標分頁；唯讀，已逾付款期限者顯示為已取消） | FR-OD-04 | P1 |
| GET | `/orders/{orderId}` | 擁有者 | 訂單詳情 / 追蹤（已逾期的待付款訂單於讀取時結算） | FR-OD-01/02/05 | P1 |
| POST | `/orders/{orderId}/cancel` | 擁有者 | 取消訂單（冪等；進入 `CANCELLED` 即釋放庫存與時段） | FR-OD-03 | P1 |
| GET | `/orders/lookup` | 公開 | 以編號 + 手機查詢，回傳追蹤權杖 | FR-OD-07 | P1 |
| POST | `/orders/{orderId}/payments` | 擁有者 | 發起付款 / 改用現金（不重驗庫存；已逾付款期限回 `409`） | FR-PY-02/04 | P1 |
| POST | `/orders/{orderId}/review` | 會員 | 評價訂單 | FR-OD-09 | P2 |

### 2.4 會員

| 方法 | 路徑 | 驗證 | 說明 | 需求 | 階段 |
| --- | --- | --- | --- | --- | --- |
| GET | `/me` | 會員 | 個人資料 | FR-AC-03 | P1 |
| PATCH | `/me` | 會員 | 更新個人資料 | FR-AC-03 | P1 |
| DELETE | `/me` | 會員 | 刪除帳號 | FR-AC-07 | P1 |
| GET | `/me/addresses` | 會員 | 地址簿 | FR-AC-04 | P1 |
| POST | `/me/addresses` | 會員 | 新增地址 | FR-AC-04 | P1 |
| PATCH | `/me/addresses/{addressId}` | 會員 | 更新地址 / 設為預設 | FR-AC-04 | P1 |
| DELETE | `/me/addresses/{addressId}` | 會員 | 刪除地址 | FR-AC-04 | P1 |
| GET | `/me/favorites` | 會員 | 收藏商品 ID 清單 | FR-AC-05 | P1 |
| PUT | `/me/favorites/{productId}` | 會員 | 加入收藏（冪等） | FR-AC-05 | P1 |
| DELETE | `/me/favorites/{productId}` | 會員 | 取消收藏 | FR-AC-05 | P1 |
| GET | `/me/coupons` | 會員 | 我的優惠券 | FR-AC-06、FR-PR-02 | P1 |
| GET | `/me/frequent-items` | 會員 | 常點 / 上次點過的商品與選項（跨裝置） | FR-AC-11、FR-MN-13 | P1 |
| POST | `/me/coupons/claim` | 會員 | 以折扣碼領券 | FR-PR-03 | P2 |
| POST | `/me/orders/claim` | 會員 | 訪客訂單歸戶 | FR-AC-08 | P2 |

---

## 3. 錯誤格式與錯誤碼

### 3.1 錯誤回應

所有非 2xx 回應皆為：

```ts
export interface ApiErrorResponse {
  error: {
    code: ErrorCode;
    message: string;               // 繁體中文訊息；異動清單的逐項文案由前端依 code 與份數組成（03 §9），此欄為降級顯示用，不含「今日」等相對日期用語（取餐營業日可能不是今日）
    details?: ApiErrorDetail[];    // 400 欄位錯誤；422 為 error.quote.checks 中 ERROR 項的 { field, code, message } 投影
    requestId?: string;
    retryAfterSeconds?: number;    // 429 / 423 / 503 時；POST /orders 的 429（專屬限流）與附此欄位的 503（建單互斥鎖等待逾時）皆為確定未建立
    remainingAttempts?: number;    // OTP_INVALID 時：剩餘嘗試次數
    /**
     * PRICE_CHANGED，以及 POST /orders 的所有 422 業務錯誤：交易回復當下的最新報價，
     * 結構與同一請求的 quote 回應相同（見 §3.2 註記）。IDEMPOTENCY_CONFLICT、ORDER_STATE_CONFLICT 與 400 不附
     */
    quote?: QuoteResponse;
  };
}
```

### 3.2 錯誤碼表

| HTTP | `code` | 說明 | 前端處理 |
| --- | --- | --- | --- |
| 400 | `VALIDATION_FAILED` | 欄位格式錯誤；`details[]` 指出欄位 | 對應欄位顯示錯誤 |
| 400 | `OTP_INVALID` | 驗證碼錯誤或過期；`error.remainingAttempts` 為剩餘次數 | 顯示剩餘次數 |
| 401 | `UNAUTHORIZED` | 未登入或 Token 失效 | 嘗試 refresh，失敗導向登入（[FLOW-15](./02-flows.md#flow-15-api-錯誤處理策略)） |
| 403 | `FORBIDDEN` | 帳號被停用（`SUSPENDED`）等無權限情境。**訂單資源無權存取時一律回 `404`**，避免洩漏訂單是否存在 | 顯示「帳號已停用，請聯絡店家」 |
| 404 | `NOT_FOUND` | 資源不存在，或無權存取該訂單（非擁有者且追蹤權杖無效） | 404 狀態 / 統一顯示「找不到訂單」 |
| 409 | `PRICE_CHANGED` | **僅在無任何業務 `ERROR`（無 `422` 項）時**回傳：金額與伺服器重新計算不符；`error.quote` 為最新報價 | 異動清單顯示價格差異並要求確認；總額增加時須先展示差異再送出（[FLOW-04](./02-flows.md#flow-04-結帳與送出訂單)） |
| 409 | `ORDER_STATE_CONFLICT` | 狀態已變更（例：取消時店家已接單）；付款或改用現金時訂單已逾 `payment_expires_at`（含排程尚未寫入 `CANCELLED`）或不是 `PENDING_PAYMENT` | 重新載入訂單並提示；已逾期者說明餐點已釋出並提供「再來一單」 |
| 409 | `IDEMPOTENCY_CONFLICT` | 同一 `Idempotency-Key` 但內容不同（指紋排除 `expectedTotal`，見 §1.4）；通常代表先前某次回應遺失的送出其實已成立 | **不得換新 Key**；依 [FLOW-24](./02-flows.md#flow-24-結果未知與冪等重送) 以同 Key 重放記下的內容，取回原訂單 |
| 422 | `STORE_PAUSED` | 店家暫停接單 | 立即重新載入 `/status` 與 StoreInfo；狀態列顯示店家狀態說明（唯讀並提供店家電話），不進異動清單 |
| 422 | `STORE_CLOSED` | 休息中且非預約單 | 立即重新載入 `/status` 與 StoreInfo；狀態列顯示休息說明並提供「改預約」，不進異動清單 |
| 422 | `SERVICE_NOT_AVAILABLE` | 店家未開放此取餐方式 | 重新載入 StoreInfo 並停用該取餐方式；列入異動清單的「時段 / 取餐方式」類，動作「改為其他取餐方式」 |
| 422 | `ITEM_UNLISTED` | 商品已下架 | 移除品項 |
| 422 | `ITEM_SOLD_OUT` | 手動售完（旗標僅約束當前營業日），或商品層級可購買量為 0（含他人待付款訂單暫時占用）；該行 `availableQuantity = 0` | 清單項「移除」；限量用盡時補充說明份數可能於他人付款期限後釋出 |
| 422 | `ITEM_STOCK_INSUFFICIENT` | 限量商品剩餘 > 0 但少於所需（已跨同商品多行加總）；該行 `availableQuantity` 為依請求順序配置後可購買的份數，可為 `0`（剩餘已被同商品其他行占用） | 清單項「改為 n 份」「移除」 |
| 422 | `OPTION_INVALID` | 選項不符必選 / 上限規則或不屬於該商品 | 重新開啟客製化 |
| 422 | `OPTION_UNAVAILABLE` | 選項暫無供應 | 重新選擇 |
| 422 | `QUANTITY_EXCEEDED` | 單行數量超過 `limits.maxQuantityPerItem`（該行 `availableQuantity = min(quantity, 單行上限)`），或品項行數超過 `limits.maxLines`（整單 check，無 `lineIndex`） | 單行：清單項「改為 n 份」「移除」；行數：「移除品項」 |
| 422 | `MIN_ORDER_NOT_MET` | 未達最低消費 | 顯示差額 |
| 422 | `OUT_OF_DELIVERY_AREA` | 超出外送範圍 | 建議改自取 |
| 422 | `SLOT_UNAVAILABLE` | 時段已過、額滿或不在營業時間；預約時段於送出確認時被占滿（EC-07）；`checks[]` 帶 `field=scheduledAt` | 重新載入時段並重選；清單提供最近可選時段，不靜默改選 |
| 422 | `TABLE_NOT_FOUND` | 有提供的桌號或 QR 權杖無效（不是店家桌位、已停用，或格式不符 VR-10）；**未提供桌號時不檢查、不回此碼**（BR-22）；`checks[].field = "dineIn.tableNo"` | 提示洽店員；列入異動清單第 4 類並定位到桌號欄，動作為改正桌號或清空（內用可以沒有桌號） |
| 422 | `PAYMENT_METHOD_NOT_ALLOWED` | 付款方式未啟用或不適用 | 重新選擇 |
| 422 | `INVOICE_INVALID` | 發票資料格式或組合錯誤 | 欄位錯誤 |
| 422 | `COUPON_NOT_FOUND` | 找不到折扣碼 | 見 [FLOW-07](./02-flows.md#flow-07-優惠券驗證) |
| 422 | `COUPON_EXPIRED` | 已過期或尚未生效 | 同上 |
| 422 | `COUPON_NOT_APPLICABLE` | 不適用此取餐方式 | 同上 |
| 422 | `COUPON_MIN_NOT_MET` | 未達折扣最低消費 | 同上 |
| 422 | `COUPON_USED_UP` | 總量或個人上限已用完 | 同上 |
| 422 | `LOGIN_REQUIRED` | 此操作需登入（如會員限定券） | 與其他折扣碼錯誤同為折扣類異動：定位到折扣碼欄位並計入鎖定數；動作「移除折扣碼」「登入（可略過）」，不強制登入下單（BR-33） |
| 423 | `OTP_LOCKED` | 驗證錯誤次數過多暫時鎖定 | 顯示倒數 |
| 429 | `OTP_RATE_LIMITED` | OTP 發送過於頻繁 | 顯示冷卻秒數 |
| 429 | `RATE_LIMITED` | 一般速率限制（含 `POST /orders` 專屬限流，§1.6）；附 `retryAfterSeconds` | 依 `retryAfterSeconds` 稍後重試；`POST /orders` 命中時確定未建立訂單：不記下送出內容、送出鈕依該秒數暫停，沿用同一把 Key 重送（[FLOW-24](./02-flows.md#flow-24-結果未知與冪等重送)） |
| 500 | `INTERNAL_ERROR` | 伺服器錯誤 | 錯誤頁塊 + 重試 + `requestId` |
| 503 | `SERVICE_UNAVAILABLE` | 維護或依賴服務不可用；`POST /orders` 的建單互斥鎖等待逾時亦回此碼並**附 `retryAfterSeconds`**，代表確定未建立訂單、不綁定 Key；不附者視為結果未知 | 錯誤頁塊 + 重試 + `requestId`；附 `retryAfterSeconds` 者提示稍後再按一次送出並以該秒數暫停送出鈕，以同一把 Key 重送；不附者依 [FLOW-24](./02-flows.md#flow-24-結果未知與冪等重送) 處理結果未知 |

> **報價（`quote`）永不因業務規則回傳 4xx**：所有業務檢查結果以 `checks[]` 回傳，使 UI 可一次呈現全部問題；只有請求格式錯誤才會回 `400`。`POST /orders` 則依上表以錯誤碼拒絕，且**所有 `422` 與 `409 PRICE_CHANGED` 皆附與同一請求的 `quote` 回應一致的 `error.quote`**（`IDEMPOTENCY_CONFLICT`、`ORDER_STATE_CONFLICT` 與 `400` 不附），前端以同一套邏輯處理 `quote` 與送出被退回（[FLOW-23](./02-flows.md#flow-23-異動清單處理)）。失敗品項與欄位以 `error.quote.items[i]` 及 `checks[].lineIndex` / `checks[].field` 定位，`details[]` 僅為 `ERROR` 項的投影；前端對每個 `422` 的 `code` 皆須有落點，不得只顯示通用錯誤或靜默丟棄：`ITEM_*`、`OPTION_*`、`QUANTITY_EXCEEDED` → 異動清單的品項行（行數超過上限為無 `lineIndex` 的整單項）；`SLOT_UNAVAILABLE`、`SERVICE_NOT_AVAILABLE` → 異動清單的「時段 / 取餐方式」類；折扣、付款、發票、外送條件與桌號類（含 `LOGIN_REQUIRED`）→ 對應欄位並計入鎖定數；`STORE_PAUSED`、`STORE_CLOSED` → 店家狀態說明（不進清單，並立即重新載入 `/status` 與 StoreInfo）。
>
> **`quote` 與 `POST /orders` 的檢查範圍**：`QuoteRequest` 不含 `paymentMethod`、`invoice`、`dineIn`，因此 `PAYMENT_METHOD_NOT_ALLOWED`、`INVOICE_INVALID`、`TABLE_NOT_FOUND` 只會在 `POST /orders` 產生，`quote` 預檢不會回報；其餘檢查共用同一份驗證，`error.quote` 與以同一請求內容呼叫的 `quote` 逐欄一致（`checks[]` 至多多出上述三碼）。`TABLE_NOT_FOUND` 另有前提：內用的 `dineIn.tableNo` 與 `dineIn.qrToken` 皆為選填，未提供（含空字串、全空白）時不檢查，因此內用沒有桌號時不會產生此碼。

**驗證順序與頂層錯誤碼優先序**：`quote` 與 `POST /orders` 共用同一份驗證，**收集全部 `ERROR`、不短路**；`POST /orders` 的頂層 `error.code` 取下表順位最高者（同順位取 `checks[]` 中最先出現者），其餘全部列於 `error.quote.checks[]`。僅在**沒有任何**業務 `ERROR` 時才比對 `expectedTotal`（庫存先於價格）。

| 順位 | `code` |
| --- | --- |
| 1 | `STORE_PAUSED`、`STORE_CLOSED`、`SERVICE_NOT_AVAILABLE` |
| 2 | `ITEM_UNLISTED` |
| 3 | `ITEM_SOLD_OUT` |
| 4 | `ITEM_STOCK_INSUFFICIENT` |
| 5 | `OPTION_INVALID`、`OPTION_UNAVAILABLE` |
| 6 | `QUANTITY_EXCEEDED` |
| 7 | `SLOT_UNAVAILABLE`、`TABLE_NOT_FOUND` |
| 8 | `OUT_OF_DELIVERY_AREA`、`MIN_ORDER_NOT_MET` |
| 9 | `COUPON_NOT_FOUND`、`COUPON_EXPIRED`、`COUPON_NOT_APPLICABLE`、`COUPON_MIN_NOT_MET`、`COUPON_USED_UP`、`LOGIN_REQUIRED` |
| 10 | `PAYMENT_METHOD_NOT_ALLOWED`、`INVOICE_INVALID` |
| 全數通過後 | `PRICE_CHANGED`（`409`） |

> `TABLE_NOT_FOUND`（順位 7）只在請求有提供桌號或 QR 權杖時才會參與；內用沒有桌號時不產生此碼，也不影響其他順位。

---

## 4. 資料型別

> 以下 TypeScript 型別為**前後端共用契約**，前端放置於 `src/domain/types.ts`（見 [07 §3](./07-frontend-architecture.md)）。

### 4.1 基礎與列舉

```ts
export type ID = string;
export type ISODateTime = string; // "2026-10-14T12:30:00+08:00"
export type ISODate = string;     // "2026-10-14"
export type HHmm = string;        // "11:00"（店家時區）
export type TWD = number;         // 新台幣整數（元）

export type OrderType = 'PICKUP' | 'DELIVERY' | 'DINE_IN';
export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PENDING'
  | 'ACCEPTED'
  | 'READY'
  | 'DELIVERING'
  | 'COMPLETED'
  | 'CANCELLED';
export type PaymentStatus = 'UNPAID' | 'PAID' | 'REFUNDING' | 'REFUNDED';
export type PaymentTxnStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';
export type PaymentMethod = 'CASH' | 'CREDIT_CARD' | 'LINE_PAY' | 'JKOPAY';
export type InvoiceType = 'PAPER' | 'MOBILE_BARCODE' | 'CITIZEN_CERT' | 'DONATION' | 'COMPANY';
export type InvoiceStatus = 'PENDING' | 'ISSUED' | 'VOIDED';
export type OperatorType = 'CUSTOMER' | 'STORE' | 'SYSTEM';
export type DiscountType = 'PERCENT' | 'FIXED_AMOUNT' | 'FREE_DELIVERY';
export type SelectionType = 'SINGLE' | 'MULTIPLE';
export type ProductTag = 'HOT' | 'NEW' | 'CHEF_PICK' | 'SPICY' | 'VEGETARIAN' | 'LIMITED';
export type Allergen =
  | 'CRUSTACEAN' | 'MOLLUSC' | 'PEANUT' | 'MILK' | 'EGG' | 'TREE_NUT'
  | 'SESAME' | 'GLUTEN' | 'SOY' | 'FISH' | 'MANGO' | 'SULFITE';
export type StoreStatusCode = 'OPEN' | 'CLOSED' | 'PAUSED';
export type ClosedReason = 'OUT_OF_HOURS' | 'HOLIDAY' | 'LAST_ORDER_PASSED';
export type UserCouponStatus = 'AVAILABLE' | 'USED' | 'EXPIRED';
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = 週日
export type MenuLayout = 'AUTO' | 'GRID' | 'LIST';

export type ErrorCode =
  | 'VALIDATION_FAILED' | 'OTP_INVALID' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'PRICE_CHANGED' | 'ORDER_STATE_CONFLICT' | 'IDEMPOTENCY_CONFLICT'
  | 'STORE_PAUSED' | 'STORE_CLOSED' | 'SERVICE_NOT_AVAILABLE'
  | 'ITEM_UNLISTED' | 'ITEM_SOLD_OUT' | 'ITEM_STOCK_INSUFFICIENT'
  | 'OPTION_INVALID' | 'OPTION_UNAVAILABLE' | 'QUANTITY_EXCEEDED'
  | 'MIN_ORDER_NOT_MET' | 'OUT_OF_DELIVERY_AREA' | 'SLOT_UNAVAILABLE' | 'TABLE_NOT_FOUND'
  | 'PAYMENT_METHOD_NOT_ALLOWED' | 'INVOICE_INVALID'
  | 'COUPON_NOT_FOUND' | 'COUPON_EXPIRED' | 'COUPON_NOT_APPLICABLE' | 'COUPON_MIN_NOT_MET'
  | 'COUPON_USED_UP' | 'LOGIN_REQUIRED'
  | 'OTP_LOCKED' | 'OTP_RATE_LIMITED' | 'RATE_LIMITED'
  | 'INTERNAL_ERROR' | 'SERVICE_UNAVAILABLE';

export interface ApiErrorDetail {
  field?: string;          // 例 "delivery.zipCode"
  code?: ErrorCode;
  message: string;
}
```

### 4.2 店家與菜單

```ts
export interface BusinessHour { weekday: Weekday; open: HHmm; close: HHmm }
export interface SpecialDay {
  date: ISODate;
  type: 'CLOSED' | 'SPECIAL_HOURS';
  open?: HHmm;
  close?: HHmm;
  note?: string;
}

export interface StoreStatus {
  status: StoreStatusCode;
  closedReason?: ClosedReason;
  nextOpenAt?: ISODateTime;
  todayHours: { open: HHmm; close: HHmm }[];
  pausedUntil?: ISODateTime;    // PAUSED 時的預計恢復時間；省略 = 手動恢復
  serverTime: ISODateTime;      // 前端用以校正本機時鐘偏差
}

export interface StoreInfo {
  id: ID;
  slug: string;
  name: string;
  tagline?: string;
  description?: string;
  logoUrl?: string;
  coverUrl?: string;
  phone: string;
  email?: string;
  address: {
    city: string;
    district: string;
    zipCode: string;
    line: string;
    latitude?: number;
    longitude?: number;
  };
  announcement?: string;
  timezone: string;             // "Asia/Taipei"
  services: { pickup: boolean; delivery: boolean; dineIn: boolean };
  paymentMethods: PaymentMethod[];
  businessHours: BusinessHour[];
  specialDays: SpecialDay[];    // 今日起 30 天內
  /** 顯示設定：品牌主題色與菜單版面（03 §4.8、BR-31） */
  display: {
    brandColor: string | null;  // "#D93A22"；null = 使用系統預設色
    menuLayout: MenuLayout;
  };
  limits: {
    minOrderAmount: TWD;        // 自取 / 內用最低消費
    maxQuantityPerItem: number; // 單行數量上限：20（超過回 QUANTITY_EXCEEDED）
    maxLines: number;           // 品項行數上限：30（超過回整單 QUANTITY_EXCEEDED）
    maxAdvanceDays: number;
    slotIntervalMinutes: number;
    pickupLeadMinutes: number;
    deliveryLeadMinutes: number;
  };
  status: StoreStatus;
}

export interface Banner {
  id: ID;
  title: string;
  imageUrl: string;
  linkType: 'NONE' | 'PRODUCT' | 'CATEGORY' | 'URL';
  linkValue?: string;
}

export interface ProductOption {
  id: ID;
  name: string;
  priceDelta: number;           // 可為負
  isDefault: boolean;
  isAvailable: boolean;
}

export interface OptionGroup {
  id: ID;
  name: string;
  selectionType: SelectionType;
  required: boolean;            // = minSelect >= 1
  minSelect: number;
  maxSelect: number;
  options: ProductOption[];
}

/**
 * 商品摘要。必要欄位僅 id、categoryId、name、basePrice 與旗標；
 * description、imageUrl 可省略，tags / allergens 可為空陣列，前端必須優雅降級（03 §6.7）。
 */
export interface ProductSummary {
  id: ID;
  categoryId: ID;
  name: string;
  description?: string;       // 可省略
  imageUrl?: string;          // 可省略；無圖時前端以分類圖示佔位
  basePrice: TWD;
  displayPrice: TWD;            // 基本價 + 各必選群組最低加價
  isPriceFrom: boolean;         // 是否顯示「起」
  tags: ProductTag[];
  allergens: Allergen[];
  /** 不可加入：店家手動售完旗標（僅約束當前營業日）或可購買量為 0（含他人待付款訂單暫時占用）；前端判斷「不可加入」的依據 */
  isSoldOut: boolean;
  /**
   * 當前營業日還可購買份數（≥ 0）；null = 不限量；
   * 省略 = 未提供剩餘資訊（不等於保證不限量）：前端不顯示「剩 n 份」、不預先限制步進器，仍以 isSoldOut 與伺服器驗證為準
   */
  remainingToday?: number | null;
  hasRequiredOptions: boolean;  // true：快速加入需開啟客製化面板
}

export interface ProductDetail extends ProductSummary {
  optionGroups: OptionGroup[];  // 可為空陣列（無任何選項）
}

export interface MenuCategory {
  id: ID;
  name: string;
  description?: string;
  icon?: string;               // emoji 或圖示代碼；商品無圖時作為佔位圖的圖示
  products: ProductSummary[];
}

export interface Menu {
  categories: MenuCategory[];
  generatedAt: ISODateTime;
}
```

### 4.3 時段、外送與報價

```ts
export interface Slot {
  startAt: ISODateTime;
  status: 'AVAILABLE' | 'FULL';
}
export interface SlotDay {
  date: ISODate;
  label: string;                // "今天" / "明天"
  slots: Slot[];
}
export interface PickupSlotsResponse {
  orderType: OrderType;
  asap: {
    available: boolean;
    etaMinutes?: { min: number; max: number };
    unavailableReason?: ErrorCode;  // STORE_PAUSED / STORE_CLOSED / SLOT_UNAVAILABLE（外送來不及在打烊前送達）
  };
  days: SlotDay[];
}

export interface DeliveryZone {
  zipCode: string;
  city: string;
  district: string;
  deliveryFee: TWD;
  minOrderAmount: TWD;
  freeDeliveryThreshold: TWD | null;
  estimatedMinutes: number;
}
export interface DeliveryCheckResponse {
  deliverable: boolean;
  zone?: DeliveryZone;
  reason?: 'OUT_OF_DELIVERY_AREA' | 'SERVICE_NOT_AVAILABLE';
}

export interface OrderLineInput {
  productId: ID;
  quantity: number;
  optionIds: ID[];              // 跨群組的選項 ID
  note?: string;
}

export interface QuoteRequest {
  orderType: OrderType;
  items: OrderLineInput[];
  scheduledAt: ISODateTime | null;  // null = 盡快
  zipCode?: string;                 // DELIVERY 必填
  couponCode?: string;
}

export interface QuotedLine {
  index: number;                    // 對應該次 request.items 的索引（與請求一一對應，productId 相同）；前端以送出該請求當下的購物車快照解讀，不套用到之後已變動的購物車
  productId: ID;
  name: string;
  imageUrl?: string;
  optionLabels: string[];
  unitPrice: TWD;
  quantity: number;                 // 請求的數量
  lineTotal: TWD;                   // = unitPrice × availableQuantity（不可購買行為 0）
  /** false = 此行無法依原數量成立（售完 / 下架 / 選項失效 / 數量不足 / 超過單行上限）；等同 availableQuantity < quantity */
  available: boolean;
  /**
   * 此行配置後最多可購買份數，0..quantity；available = true 時等於 quantity。
   * 只有可購買的行（未下架、選項有效）參與配置；同商品多行依請求順序配置，後面的行先被縮減（BR-40）；
   * 單行超過 limits.maxQuantityPerItem 者另受 min(quantity, 單行上限) 限制，與配置結果取較小者
   */
  availableQuantity: number;
  /** 取餐營業日該商品剩餘份數（同商品多行加總前）；null = 不限量；省略 = 不適用（如已下架） */
  remaining?: number | null;
  /**
   * 一行只回報優先序最高者：ITEM_UNLISTED > ITEM_SOLD_OUT > ITEM_STOCK_INSUFFICIENT > OPTION_INVALID > OPTION_UNAVAILABLE > QUANTITY_EXCEEDED，其餘見 checks[]。
   * ITEM_SOLD_OUT 僅限手動售完或商品層級 remaining = 0；未手動售完且 remaining > 0，
   * 但此行配置後為 0（剩餘已被同商品其他行占用）一律為 ITEM_STOCK_INSUFFICIENT；
   * QUANTITY_EXCEEDED 為單行數量超過 limits.maxQuantityPerItem，availableQuantity = min(quantity, 單行上限)
   */
  issue?: 'ITEM_UNLISTED' | 'ITEM_SOLD_OUT' | 'ITEM_STOCK_INSUFFICIENT'
        | 'OPTION_UNAVAILABLE' | 'OPTION_INVALID' | 'QUANTITY_EXCEEDED';
}

export interface QuoteCheck {
  code: ErrorCode;
  severity: 'ERROR' | 'WARNING';    // ERROR 會阻擋送出
  message: string;
  field?: string;
  lineIndex?: number;
}

export interface QuoteResponse {
  valid: boolean;                   // 無 ERROR 即為 true
  items: QuotedLine[];
  /**
   * 金額一律以「可成立內容」計算：subtotal = Σ lineTotal（BR-02），不可購買行為 0、數量不足行 × availableQuantity；
   * 最低消費、免運與折扣門檻以調整後小計判斷；全部不可購買時 subtotal、deliveryFee、discount、total 皆為 0
   */
  subtotal: TWD;
  deliveryFee: TWD;
  discount: TWD;
  total: TWD;
  coupon?: {
    code: string;
    name: string;
    discountType: DiscountType;
    applied: boolean;
  };
  minOrderShortfall?: TWD;          // 未達最低消費時的差額
  estimatedReadyAt?: ISODateTime;
  checks: QuoteCheck[];
}
```

> `QuoteCheck` 與 `ApiErrorDetail` 結構不變。定位慣例：庫存與數量類 check 以 `field = "items"` 加 `lineIndex` 指向 `items[]`；品項行數超過 `limits.maxLines` 為無 `lineIndex` 的整單 check（`field = "items"`，動作「移除品項」）；時段類以 `field = "scheduledAt"`；折扣類（含 `LOGIN_REQUIRED`）以 `field = "couponCode"`；外送範圍、付款方式、發票與桌號依序為 `delivery.zipCode`、`paymentMethod`、`invoice`、`dineIn.tableNo`，未達最低消費為 `items`。前端不須自行推算份數：以 `availableQuantity < quantity` 判斷數量不足，並以 `availableQuantity` 作為「改為 n 份」的建議值（為 `0` 時只提供「移除」）。同一行（`lineIndex` 相同）有多個 check 時，以 `QuotedLine.issue` 為該行的主要原因，其餘僅為補充說明，前端不重複計為異動項。

### 4.4 訂單與付款

```ts
export interface CreateOrderRequest {
  orderType: OrderType;
  items: OrderLineInput[];
  scheduledAt: ISODateTime | null;
  contact: { name?: string; phone?: string };   // PICKUP / DELIVERY 必填姓名與手機；DINE_IN 可省略
  delivery?: {
    addressId?: ID;
    city: string;
    district: string;
    zipCode: string;
    line: string;
    note?: string;
  };
  dineIn?: { tableNo?: string; qrToken?: string };   // 僅 DINE_IN；整個可省略，tableNo 與 qrToken 皆選填，空字串 / 全空白視為未提供（BR-22、VR-10）
  paymentMethod: PaymentMethod;
  invoice: {
    type: InvoiceType;
    carrierCode?: string;
    taxId?: string;
    buyerName?: string;
    donateCode?: string;
  };
  couponCode?: string;
  needUtensils: boolean;
  note?: string;
  marketingOptIn?: boolean;
  expectedTotal: TWD;                           // 前端顯示總額，供 PRICE_CHANGED 檢查
}

export interface OrderItemOption {
  groupName: string;
  name: string;
  priceDelta: number;
}
export interface OrderItem {
  id: ID;
  productId?: ID | null;
  name: string;
  quantity: number;
  unitPrice: TWD;                   // 含選項加價
  lineTotal: TWD;
  options: OrderItemOption[];
  note?: string;
}

export interface OrderStatusLog {
  status: OrderStatus;
  at: ISODateTime;
  by: OperatorType;
  note?: string;
}

export interface PaymentAttempt {
  id: ID;
  method: PaymentMethod;
  status: PaymentTxnStatus;
  amount: TWD;
  failureMessage?: string;
  createdAt: ISODateTime;
}

export interface OrderInvoice {
  type: InvoiceType;
  carrierCode?: string;
  taxId?: string;
  buyerName?: string;
  donateCode?: string;
  status: InvoiceStatus;
  invoiceNo?: string;
  issuedAt?: ISODateTime;
}

export interface Order {
  id: ID;
  orderNo: string;
  storeId: ID;
  orderType: OrderType;
  status: OrderStatus;
  pickupNo: string;
  businessDate: ISODate;
  customer?: { name?: string; phone?: string };
  scheduledAt: ISODateTime | null;
  estimatedReadyAt: ISODateTime | null;
  /**
   * 接單期限（BR-17）：僅 status = PENDING 有值，由伺服器計算，前端不自行推算（PG-06「店家將於 HH:mm 前確認」）。
   * 自進入 PENDING 起算（現金單 = 建單時間；線上付款 = 付款成功或改用現金的時間）：
   * 即時單 = 起算點 + accept_timeout_minutes；預約單 = max(起算點 + accept_timeout_minutes, scheduledAt − lead)；
   * lead 同 BR-08：外送 = 該單配送區的 estimated_minutes（以外送郵遞區號對應），缺值才用店家 delivery_lead_minutes；自取 = pickup_lead_minutes
   */
  acceptBy?: ISODateTime | null;
  table?: { tableNo: string };      // 內用且有提供桌號時才有；沒有桌號的內用單省略（pickupNo 為叫號與領餐識別）
  delivery?: { city: string; district: string; zipCode: string; line: string; note?: string };
  items: OrderItem[];
  amounts: { subtotal: TWD; deliveryFee: TWD; discount: TWD; total: TWD };
  couponCode?: string;
  needUtensils: boolean;
  note?: string;
  invoice: OrderInvoice;
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    expiresAt: ISODateTime | null;  // 僅 PENDING_PAYMENT
    latest?: PaymentAttempt;
  };
  cancellation?: { by: OperatorType; reason?: string; at: ISODateTime };
  timeline: OrderStatusLog[];
  placedAt: ISODateTime;
  acceptedAt?: ISODateTime;
  readyAt?: ISODateTime;
  completedAt?: ISODateTime;
  cancelledAt?: ISODateTime;
  /** 由伺服器計算的操作權限，前端不得自行推斷規則（例：已逾 payment.expiresAt 的待付款訂單，canPay 為 false） */
  permissions: { canCancel: boolean; canPay: boolean; canReorder: boolean; canReview: boolean };
}

export interface OrderSummary {
  id: ID;
  orderNo: string;
  orderType: OrderType;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  pickupNo: string;
  total: TWD;
  itemCount: number;
  itemsPreview: string;             // "招牌滷肉飯 等 3 項"
  placedAt: ISODateTime;
  scheduledAt: ISODateTime | null;
}

export interface CreateOrderResponse {
  order: Order;
  trackingToken?: string;           // 僅訪客訂單，且僅此次回傳（冪等重放時重新簽發，舊權杖失效）
  nextAction: 'TRACK' | 'PAY';      // PAY 僅限仍為 PENDING_PAYMENT 且未逾期；重放時依結算逾期後的目前狀態計算（已取消或已逾期為 TRACK）
  /** 冪等重放（同一 Idempotency-Key 取回原訂單）時為 true；省略 = 首次建立。以此欄位為準，標頭 Idempotent-Replayed 僅輔助 */
  replayed?: boolean;
}

export interface CreatePaymentRequest {
  method: PaymentMethod;
  returnUrl?: string;               // 線上付款完成後導回的前端網址
}
export interface CreatePaymentResponse {
  paymentId: ID;
  status: PaymentTxnStatus;
  redirectUrl?: string;             // method = CASH 時無
  expiresAt?: ISODateTime;
  order: Order;
}
```

### 4.5 會員與優惠

```ts
export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;            // Cookie 模式下省略（§1.3）
  expiresIn: number;                // 秒
}
export interface UserProfile {
  id: ID;
  phone: string;
  name?: string;
  email?: string;
  marketingOptIn: boolean;
  createdAt: ISODateTime;
}
export interface OtpVerifyResponse {
  tokens: AuthTokens;
  user: UserProfile;
  isNewUser: boolean;
}

export interface Address {
  id: ID;
  label: string;
  recipientName: string;
  recipientPhone: string;
  city: string;
  district: string;
  zipCode: string;
  line: string;
  note?: string;
  isDefault: boolean;
}

export interface Coupon {
  id: ID;
  code: string;
  name: string;
  description?: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount?: TWD;
  minOrderAmount: TWD;
  applicableOrderTypes: OrderType[];
  memberOnly: boolean;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
}
/** 會員「上次點過」：由近 180 天內非取消訂單的品項推導，每商品取最近一次的選項與備註 */
export interface FrequentItem {
  productId: ID;
  optionIds: ID[];            // 最近一次點過的選項（跨群組）
  optionLabels: string[];     // 名稱快照，供卡片顯示「上次：大碗・滷蛋」
  note?: string;
  lastOrderedAt: ISODateTime;
  orderCount: number;         // 近 180 天內點過的次數
}
export interface FrequentItemsResponse {
  items: FrequentItem[];
}

export interface UserCoupon {
  id: ID;
  coupon: Coupon;
  status: UserCouponStatus;
  claimedAt: ISODateTime;
  usedAt?: ISODateTime;
}
```

---

## 5. 端點詳細

> 範例以 Demo 種子資料為準（見 [08](./08-demo-guide.md)）；範例皆已通過型別檢查。

### 5.1 `POST /auth/otp/send`

| | |
| --- | --- |
| Request | `{ "phone": "0912345678" }` |
| 200 | `{ "resendAfterSeconds": 60 }` |
| 錯誤 | `VALIDATION_FAILED`、`OTP_RATE_LIMITED` |

### 5.2 `POST /auth/otp/verify`

| | |
| --- | --- |
| Request | `{ "phone": "0912345678", "code": "123456" }` |
| 200 | `OtpVerifyResponse` |
| 錯誤 | `OTP_INVALID`（`error.remainingAttempts` 為剩餘次數）、`OTP_LOCKED` |

### 5.2a `POST /auth/refresh`、`POST /auth/logout`

| 端點 | Request | Response | 說明 |
| --- | --- | --- | --- |
| `POST /auth/refresh` | Body 模式：`{ "refreshToken": "..." }`；Cookie 模式：可省略 body | `200 { "tokens": AuthTokens }` | Refresh Token 輪替：舊 Token 立即失效；重複使用已失效的 Token 視為遭竊，撤銷該使用者所有 Session，回 `401 UNAUTHORIZED` |
| `POST /auth/logout` | Body 模式：`{ "refreshToken": "..." }`；Cookie 模式：可省略 body | `204` | 撤銷該 Refresh Token（Cookie 模式同時清除 Cookie）；冪等 |

### 5.2b `GET /stores/{storeSlug}`

回傳店家資訊、營業時間、服務、付款方式、限制與顯示設定。`display.brandColor` 為 `null` 時前端使用系統預設色 `#D93A22`；前端須以 `deriveBrandTokens` 推導主題並保護文字對比（[07 §7.4](./07-frontend-architecture.md)）。

**Response `200` — `StoreInfo`**

```json
{
  "id": "01JAXN0000000000000000STORE",
  "slug": "demo-snack",
  "name": "巷仔內小吃部",
  "tagline": "三十年老味道",
  "phone": "02-0000-0000",
  "address": { "city": "臺北市", "district": "大安區", "zipCode": "106", "line": "示範路 100 號" },
  "announcement": "本週日公休，歡迎提前預約",
  "timezone": "Asia/Taipei",
  "services": { "pickup": true, "delivery": true, "dineIn": true },
  "paymentMethods": ["CASH", "CREDIT_CARD", "LINE_PAY", "JKOPAY"],
  "businessHours": [
    { "weekday": 1, "open": "11:00", "close": "14:00" },
    { "weekday": 1, "open": "17:00", "close": "21:00" }
  ],
  "specialDays": [
    { "date": "2026-10-17", "type": "CLOSED", "note": "店休日" }
  ],
  "display": { "brandColor": "#D93A22", "menuLayout": "AUTO" },
  "limits": {
    "minOrderAmount": 0,
    "maxQuantityPerItem": 20,
    "maxLines": 30,
    "maxAdvanceDays": 1,
    "slotIntervalMinutes": 15,
    "pickupLeadMinutes": 15,
    "deliveryLeadMinutes": 40
  },
  "status": {
    "status": "OPEN",
    "todayHours": [
      { "open": "11:00", "close": "14:00" },
      { "open": "17:00", "close": "21:00" }
    ],
    "serverTime": "2026-10-14T12:00:00+08:00"
  }
}
```

### 5.3 `GET /stores/{storeSlug}/status`

**Response `200` — `StoreStatus`**

```json
{
  "status": "CLOSED",
  "closedReason": "OUT_OF_HOURS",
  "nextOpenAt": "2026-10-14T17:00:00+08:00",
  "todayHours": [
    { "open": "11:00", "close": "14:00" },
    { "open": "17:00", "close": "21:00" }
  ],
  "serverTime": "2026-10-14T14:30:00+08:00"
}
```

### 5.4 `GET /stores/{storeSlug}/menu`

回傳所有上架商品；`ProductSummary` 不含選項群組（減少傳輸量），選項於 `GET .../products/{productId}` 取得。售完商品仍回傳並標示 `isSoldOut: true`。

`isSoldOut` 由伺服器合成：店家手動售完旗標（僅約束當前營業日）**或**可購買量為 0（含他人待付款訂單暫時占用）。`remainingToday` 為當前營業日還可購買份數（限量商品才有意義；省略不等於不限量）。菜單與商品詳情只是預檢，**不保留**：加入購物車不會占用份數，送出時以 `POST /orders` 的最終確認為準（BR-39）。計算可購買量時，已逾 `payment_expires_at` 的待付款訂單即使排程尚未寫入 `CANCELLED` 也不計入（唯讀查詢以條件排除，不寫入）。

**Response `200` — `Menu`**

```json
{
  "generatedAt": "2026-10-14T12:00:00+08:00",
  "categories": [
    {
      "id": "cat_rice",
      "name": "飯類",
      "products": [
        {
          "id": "prd_lurou",
          "categoryId": "cat_rice",
          "name": "招牌滷肉飯",
          "description": "古早味滷肉燥，肥瘦比例剛剛好",
          "imageUrl": "/images/products/lurou.svg",
          "basePrice": 35,
          "displayPrice": 35,
          "isPriceFrom": true,
          "tags": ["HOT"],
          "allergens": ["SOY"],
          "isSoldOut": false,
          "remainingToday": null,
          "hasRequiredOptions": true
        },
        {
          "id": "prd_kong_rou",
          "categoryId": "cat_rice",
          "name": "控肉飯",
          "basePrice": 85,
          "displayPrice": 85,
          "isPriceFrom": false,
          "tags": ["CHEF_PICK"],
          "allergens": ["SOY"],
          "isSoldOut": true,
          "remainingToday": null,
          "hasRequiredOptions": false
        }
      ]
    },
    {
      "id": "cat_combo",
      "name": "套餐",
      "products": [
        {
          "id": "prd_combo_share",
          "categoryId": "cat_combo",
          "name": "雙人分享餐",
          "basePrice": 299,
          "displayPrice": 299,
          "isPriceFrom": true,
          "tags": ["LIMITED"],
          "allergens": ["MOLLUSC", "EGG", "SOY"],
          "isSoldOut": false,
          "remainingToday": 5,
          "hasRequiredOptions": true
        }
      ]
    }
  ]
}
```

> 控肉飯是**手動售完**（不限量，`remainingToday: null`）；限量商品用盡時則為 `isSoldOut: true` 且 `remainingToday: 0`（Demo 面板「用盡」，[08 §3.4](./08-demo-guide.md)）。

### 5.5 `GET /stores/{storeSlug}/products/{productId}`

唯讀、不寫入任何資料；`isSoldOut` 與 `remainingToday` 的語意與 §5.4 相同（可購買量的計算只以計入條件排除逾期待付款單）。

**Response `200` — `ProductDetail`**

```json
{
  "id": "prd_lurou",
  "categoryId": "cat_rice",
  "name": "招牌滷肉飯",
  "description": "古早味滷肉燥，肥瘦比例剛剛好",
  "imageUrl": "/images/products/lurou.svg",
  "basePrice": 35,
  "displayPrice": 35,
  "isPriceFrom": true,
  "tags": ["HOT"],
  "allergens": ["SOY"],
  "isSoldOut": false,
  "remainingToday": null,
  "hasRequiredOptions": true,
  "optionGroups": [
    {
      "id": "og_size_bowl",
      "name": "份量",
      "selectionType": "SINGLE",
      "required": true,
      "minSelect": 1,
      "maxSelect": 1,
      "options": [
        { "id": "opt_bowl_s", "name": "小碗", "priceDelta": 0, "isDefault": true, "isAvailable": true },
        { "id": "opt_bowl_l", "name": "大碗", "priceDelta": 20, "isDefault": false, "isAvailable": true }
      ]
    },
    {
      "id": "og_rice_topping",
      "name": "加料",
      "selectionType": "MULTIPLE",
      "required": false,
      "minSelect": 0,
      "maxSelect": 3,
      "options": [
        { "id": "opt_egg", "name": "滷蛋", "priceDelta": 12, "isDefault": false, "isAvailable": true },
        { "id": "opt_tofu_dry", "name": "滷豆干", "priceDelta": 10, "isDefault": false, "isAvailable": true },
        { "id": "opt_fried_egg", "name": "荷包蛋", "priceDelta": 15, "isDefault": false, "isAvailable": true },
        { "id": "opt_extra_meat", "name": "加肉燥", "priceDelta": 10, "isDefault": false, "isAvailable": true }
      ]
    }
  ]
}
```

**最小商品**：店家只填品名與價格即可上架；前端必須能完整顯示、加入購物車並下單（FR-MN-10、FR-PD-08）。`hasRequiredOptions=false` 的商品，菜單卡上的「＋」直接加入（BR-30）。

**Response `200`（無圖片、無描述、無標籤、無選項）— `ProductDetail`**

```json
{
  "id": "prd_aiyu",
  "categoryId": "cat_dessert",
  "name": "愛玉檸檬",
  "basePrice": 45,
  "displayPrice": 45,
  "isPriceFrom": false,
  "tags": [],
  "allergens": [],
  "isSoldOut": false,
  "hasRequiredOptions": false,
  "optionGroups": []
}
```

### 5.6 `GET /stores/{storeSlug}/pickup-slots`

| Query | 說明 |
| --- | --- |
| `orderType` | `PICKUP` / `DELIVERY`（必填；`DINE_IN` 不需時段） |
| `zipCode` | `DELIVERY` 時必填，用以取得該區預估外送分鐘 |

演算法見 [FLOW-05](./02-flows.md#flow-05-取餐時段產生)。

時段的 `status` 只是預檢：`AVAILABLE` 不保證送出時仍有名額；送出時由 `POST /orders` 在同一交易內重新確認時段容量（`SLOT_UNAVAILABLE`，[§5.9](#59-post-storesstoreslugorders)）。本端點唯讀、不寫入任何資料：已逾 `payment_expires_at` 的待付款訂單以條件排除，不計入時段已訂數。

**Response `200` — `PickupSlotsResponse`**

```json
{
  "orderType": "PICKUP",
  "asap": {
    "available": false,
    "unavailableReason": "STORE_CLOSED"
  },
  "days": [
    {
      "date": "2026-10-14",
      "label": "今天",
      "slots": [
        { "startAt": "2026-10-14T17:00:00+08:00", "status": "AVAILABLE" },
        { "startAt": "2026-10-14T17:15:00+08:00", "status": "AVAILABLE" },
        { "startAt": "2026-10-14T17:30:00+08:00", "status": "FULL" }
      ]
    },
    {
      "date": "2026-10-15",
      "label": "明天",
      "slots": [
        { "startAt": "2026-10-15T11:00:00+08:00", "status": "AVAILABLE" }
      ]
    }
  ]
}
```

### 5.7 `GET /stores/{storeSlug}/delivery-check`

| Query | 說明 |
| --- | --- |
| `zipCode` | 3 碼郵遞區號 |

**Response `200` — `DeliveryCheckResponse`**

```json
{
  "deliverable": true,
  "zone": {
    "zipCode": "106",
    "city": "臺北市",
    "district": "大安區",
    "deliveryFee": 30,
    "minOrderAmount": 150,
    "freeDeliveryThreshold": 400,
    "estimatedMinutes": 35
  }
}
```

### 5.8 `POST /stores/{storeSlug}/orders/quote`

> 建議於以下時機呼叫：進入購物車（背景預檢：逐行標示可購買狀態並提供就地動作，不阻擋「前往結帳」）、進入結帳、購物車品項的數量 / 移除 / 復原 / 套用建議（異動處理後重新計價）、變更取餐方式 / 地址 / 時段 / 折扣碼、視窗重新取得焦點、從付款頁返回、送出前。可使用 250ms debounce。

| 契約重點 | 說明 |
| --- | --- |
| 不保留 | `quote` 只是預檢：不保留庫存與時段、不扣減、不消耗優惠券用量、不寫入任何資料。兩次呼叫之間狀態可能改變，送出（[§5.9](#59-post-storesstoreslugorders)）才是最終裁決（BR-39） |
| 永不因業務規則回 4xx | 所有業務檢查以 `checks[]` 回傳（`valid=false`）；只有請求格式錯誤才回 `400`。`quote` 逾時或回 `5xx` 時不阻擋送出，前端略過預檢直接 `POST /orders`（伺服器會完整重驗） |
| 金額基準 | `subtotal`、`deliveryFee`、`discount`、`total` 以**可成立內容**計算：不可購買行 `lineTotal = 0`、數量不足行 `lineTotal = unitPrice × availableQuantity`，`subtotal = Σ lineTotal`；最低消費、免運與折扣門檻以調整後小計判斷；全部不可購買時各金額皆為 `0`。顧客看到的即「處理完之後要付的錢」 |
| 一次回報 | 全部 `ERROR` 一次列出、不短路；每行以 `availableQuantity` 與 `remaining` 說明可購買份數；同商品多行依請求順序配置（BR-40） |
| 檢查範圍 | `QuoteRequest` 不含 `paymentMethod`、`invoice`、`dineIn`：`PAYMENT_METHOD_NOT_ALLOWED`、`INVOICE_INVALID`、`TABLE_NOT_FOUND` 不會出現在 `quote`，只在 `POST /orders` 產生（§3.2；`TABLE_NOT_FOUND` 且僅在請求有提供桌號或 QR 權杖時）；`LOGIN_REQUIRED`（未登入使用會員限定券）為 `ERROR` check，`field = "couponCode"` |

**Request body — `QuoteRequest`**

```json
{
  "orderType": "DELIVERY",
  "items": [
    { "productId": "prd_lurou", "quantity": 2, "optionIds": ["opt_bowl_l", "opt_egg"] },
    { "productId": "prd_beef_noodle", "quantity": 2, "optionIds": ["opt_noodle_thin", "opt_spice_none"] }
  ],
  "scheduledAt": null,
  "zipCode": "106",
  "couponCode": "LUNCH10"
}
```

**Response `200` — `QuoteResponse`**

```json
{
  "valid": true,
  "items": [
    {
      "index": 0,
      "productId": "prd_lurou",
      "name": "招牌滷肉飯",
      "optionLabels": ["大碗", "滷蛋"],
      "unitPrice": 67,
      "quantity": 2,
      "lineTotal": 134,
      "available": true,
      "availableQuantity": 2,
      "remaining": null
    },
    {
      "index": 1,
      "productId": "prd_beef_noodle",
      "name": "紅燒牛肉麵",
      "optionLabels": ["細麵", "不辣"],
      "unitPrice": 180,
      "quantity": 2,
      "lineTotal": 360,
      "available": true,
      "availableQuantity": 2,
      "remaining": null
    }
  ],
  "subtotal": 494,
  "deliveryFee": 0,
  "discount": 40,
  "total": 454,
  "coupon": {
    "code": "LUNCH10",
    "name": "午餐 9 折",
    "discountType": "PERCENT",
    "applied": true
  },
  "estimatedReadyAt": "2026-10-14T13:00:00+08:00",
  "checks": []
}
```

> 計算：小計 `134 + 360 = 494`；大安區滿 `$400` 免運 → 運費 `0`；`LUNCH10` 為 10% 上限 `$40`：`floor(494 × 10 / 100) = 49` → 取上限 `40`；總計 `494 + 0 − 40 = 454`。

**未達最低消費的回應（`valid: false`）— `QuoteResponse`**

```json
{
  "valid": false,
  "items": [
    {
      "index": 0,
      "productId": "prd_chicken_rice",
      "name": "嘉義雞肉飯",
      "optionLabels": ["大碗"],
      "unitPrice": 65,
      "quantity": 1,
      "lineTotal": 65,
      "available": true,
      "availableQuantity": 1,
      "remaining": null
    },
    {
      "index": 1,
      "productId": "prd_lurou",
      "name": "招牌滷肉飯",
      "optionLabels": ["大碗"],
      "unitPrice": 55,
      "quantity": 1,
      "lineTotal": 55,
      "available": true,
      "availableQuantity": 1,
      "remaining": null
    }
  ],
  "subtotal": 120,
  "deliveryFee": 30,
  "discount": 0,
  "total": 150,
  "minOrderShortfall": 30,
  "checks": [
    {
      "code": "MIN_ORDER_NOT_MET",
      "severity": "ERROR",
      "message": "還差 $30 可外送",
      "field": "items"
    }
  ]
}
```

> 大安區外送最低消費為 `$150`，小計 `$120` 差 `$30`；此時 `total` 仍會計算（`120 + 30 = 150`），但 `valid=false` 且 `POST /orders` 會回 `422 MIN_ORDER_NOT_MET`。

**限量商品數量不足的回應（`valid: false`）— `QuoteResponse`**

```json
{
  "valid": false,
  "items": [
    {
      "index": 0,
      "productId": "prd_combo_share",
      "name": "雙人分享餐",
      "optionLabels": ["招牌滷肉飯", "嘉義雞肉飯", "蚵仔煎", "燙青菜"],
      "unitPrice": 299,
      "quantity": 3,
      "lineTotal": 598,
      "available": false,
      "availableQuantity": 2,
      "remaining": 2,
      "issue": "ITEM_STOCK_INSUFFICIENT"
    },
    {
      "index": 1,
      "productId": "prd_black_tea",
      "name": "古早味紅茶",
      "optionLabels": ["中杯", "半糖", "微冰"],
      "unitPrice": 25,
      "quantity": 1,
      "lineTotal": 25,
      "available": true,
      "availableQuantity": 1,
      "remaining": null
    }
  ],
  "subtotal": 623,
  "deliveryFee": 0,
  "discount": 0,
  "total": 623,
  "checks": [
    {
      "code": "ITEM_STOCK_INSUFFICIENT",
      "severity": "ERROR",
      "message": "雙人分享餐只剩 2 份",
      "field": "items",
      "lineIndex": 0
    }
  ]
}
```

> 雙人分享餐今日剩 `2` 份、顧客選了 `3` 份：`availableQuantity = 2`，`lineTotal = 299 × 2 = 598`，`total = 598 + 25 = 623` 為**可成立內容**的金額（顧客原本看到 `922`）。前端以 `availableQuantity` 提供「改為 2 份」，不自動調整。
>
> **同商品多行**：剩 `3` 份、同商品 A 行 `quantity=4`、B 行 `quantity=2` → A 行 `availableQuantity=3`（`ITEM_STOCK_INSUFFICIENT`）、B 行 `availableQuantity=0`（`ITEM_STOCK_INSUFFICIENT`，剩餘已被 A 行占用，**不是** `ITEM_SOLD_OUT`）；剩 `0` 份時兩行皆為 `ITEM_SOLD_OUT`。兩行的 `remaining` 皆為加總前的 `3`。

### 5.9 `POST /stores/{storeSlug}/orders`

**必填標頭**：`Idempotency-Key`（規範見 [§1.4](#14-共通標頭)）。

> **最終裁決點**：本端點在單一資料庫交易內完成「冪等 → 取得店家建單互斥鎖 → 結算逾期待付款 → 驗證 → 計入並寫入」，是庫存、限量與時段容量的**唯一裁決**（BR-39）；`quote`、購物車與步進器皆為不保留的預檢。任一項不成立即整單不建立（全有或全無），不自動調整。

**Request body — `CreateOrderRequest`**

```json
{
  "orderType": "PICKUP",
  "items": [
    { "productId": "prd_lurou", "quantity": 1, "optionIds": ["opt_bowl_l", "opt_egg"], "note": "不要蔥" },
    { "productId": "prd_black_tea", "quantity": 1, "optionIds": ["opt_cup_m", "opt_sugar_half", "opt_ice_light"] }
  ],
  "scheduledAt": null,
  "contact": { "name": "王小明", "phone": "0912345678" },
  "paymentMethod": "CASH",
  "invoice": { "type": "PAPER" },
  "needUtensils": false,
  "note": "麻煩分開裝",
  "expectedTotal": 92
}
```

**Response `201` — `CreateOrderResponse`**

```json
{
  "order": {
    "id": "01JAXN5Q8Z3M7R2T4V6W9K1B2C",
    "orderNo": "ZO261014K7M3QX",
    "storeId": "01JAXN0000000000000000STORE",
    "orderType": "PICKUP",
    "status": "PENDING",
    "pickupNo": "A027",
    "businessDate": "2026-10-14",
    "customer": { "name": "王小明", "phone": "0912345678" },
    "scheduledAt": null,
    "estimatedReadyAt": "2026-10-14T12:35:00+08:00",
    "acceptBy": "2026-10-14T12:30:00+08:00",
    "items": [
      {
        "id": "01JAXN5Q8Z3M7R2T4V6W9K1B2D",
        "productId": "prd_lurou",
        "name": "招牌滷肉飯",
        "quantity": 1,
        "unitPrice": 67,
        "lineTotal": 67,
        "options": [
          { "groupName": "份量", "name": "大碗", "priceDelta": 20 },
          { "groupName": "加料", "name": "滷蛋", "priceDelta": 12 }
        ],
        "note": "不要蔥"
      },
      {
        "id": "01JAXN5Q8Z3M7R2T4V6W9K1B2E",
        "productId": "prd_black_tea",
        "name": "古早味紅茶",
        "quantity": 1,
        "unitPrice": 25,
        "lineTotal": 25,
        "options": [
          { "groupName": "杯型", "name": "中杯", "priceDelta": 0 },
          { "groupName": "甜度", "name": "半糖", "priceDelta": 0 },
          { "groupName": "冰量", "name": "微冰", "priceDelta": 0 }
        ]
      }
    ],
    "amounts": { "subtotal": 92, "deliveryFee": 0, "discount": 0, "total": 92 },
    "needUtensils": false,
    "note": "麻煩分開裝",
    "invoice": { "type": "PAPER", "status": "PENDING" },
    "payment": { "method": "CASH", "status": "UNPAID", "expiresAt": null },
    "timeline": [
      { "status": "PENDING", "at": "2026-10-14T12:20:00+08:00", "by": "CUSTOMER" }
    ],
    "placedAt": "2026-10-14T12:20:00+08:00",
    "permissions": { "canCancel": true, "canPay": false, "canReorder": true, "canReview": false }
  },
  "trackingToken": "trk_8f3a1c9e5b7d4a62",
  "nextAction": "TRACK"
}
```

| 規則 | 說明 |
| --- | --- |
| 單一交易 | 冪等檢查、取得店家建單互斥鎖、結算逾期待付款、驗證、計入與寫入在同一個資料庫交易內；任一失敗整單不建立，伺服器不自動降量、移除品項或改選時段 |
| 結算先於計數 | 鎖內計數前，先把 `PENDING_PAYMENT` 且 `payment_expires_at` 已逾**資料庫時鐘**的訂單條件式轉為 `CANCELLED`（`cancel_reason` 於同一 UPDATE 寫入；作廢進行中交易、返還優惠券、寫入狀態紀錄等後處理在**同一交易內**完成，皆為資料庫操作；需要退款的外部呼叫於 `COMMIT` 後、鎖外執行），再以 `status <> 'CANCELLED'` 計入；逾期判斷不得使用應用伺服器時間 |
| 同一份邏輯 | 與 `quote` 共用同一份驗證與計價；階段順序與 `checks[]` 順序相同；`quote` 無法表達的付款方式、發票與桌號檢查只在本端點執行（§3.2；桌號僅在有提供時檢查） |
| 全部收集 | 驗證不短路：一次回報所有異動項與各行 `availableQuantity`；頂層 `error.code` 依 [§3.2 優先序](#32-錯誤碼表) |
| 庫存先於價格 | 有任何業務 `ERROR` 回 `422`（`error.quote` 內為最新價格）；全數通過後 `expectedTotal` 與伺服器計算不同才回 `409 PRICE_CHANGED`，`error.quote` 為最新報價 |
| 金額基準 | `error.quote` 的金額以可成立內容計算，`subtotal = Σ lineTotal`；與同一請求的 `quote` 回應逐欄一致 |
| 同商品多行 | 以 `productId` 加總判斷（BR-13 的合併鍵含選項與備註，同商品可有多行但共用同一份庫存）；依請求順序配置，後面的行先被縮減；只有可購買的行（未下架、選項有效）參與配置 |
| 營業日歸屬 | 限量以**取餐營業日**計：預約明日扣明日限量，不受今日 `is_sold_out` 旗標影響（BR-40、Q-12） |
| 時段容量 | 與庫存同一把鎖、同一交易：`scheduledAt` 須為伺服器以送出當下時間重新產生的合法時段，且已計入單數小於 `max_orders_per_slot`（`NULL` 不限）；即時單暫不計入（Q-11） |
| 保留與釋放 | 成功提交即計入庫存與時段。線上付款保留至 `payment.expiresAt`（15 分鐘）後釋放；現金單保留至店家接單或接單期限 `order.acceptBy`（BR-17，自進入 `PENDING` 起算，預約單最長可至預約時間前）；取消、拒單、逾時進入 `CANCELLED` 即釋放（BR-38） |
| 線上付款 | `paymentMethod` 非 `CASH` → `status=PENDING_PAYMENT`、`payment.expiresAt` 為 15 分鐘後、`nextAction="PAY"`；付款階段不再重驗庫存（§5.13）。建單交易內不呼叫金流、不建立線上付款交易，付款嘗試由 `POST /orders/{orderId}/payments`（§5.13）於鎖外建立 |
| 冪等 | 僅**成功建立訂單（2xx）**的請求綁定 Key。同 Key 且指紋相同 → `201` 重放原訂單目前狀態（`replayed: true`、標頭 `Idempotent-Replayed: true`），不重驗、不重複計入、忽略 `expectedTotal`；回應建構前先對原訂單執行 `expireIfDue`；原訂單此時可能已是 `CANCELLED`（含逾付款期限但排程尚未寫入者；`nextAction="TRACK"`，前端不得導向付款頁）。指紋不同 → `409 IDEMPOTENCY_CONFLICT`（規範見 [§1.4](#14-共通標頭)） |
| 並行同 Key | 由店家建單互斥鎖序列化，第二個請求在鎖內轉為重放；唯一鍵衝突亦轉為重放，不回 `500` |
| 鎖逾時 | 等待互斥鎖逾時 → `503 SERVICE_UNAVAILABLE` 並附 `retryAfterSeconds`；不建立訂單、不綁定 Key，顧客以同 Key 重送即可。附 `retryAfterSeconds` 的 `503` 即代表確定未建立；不附者（維護、閘道）視為結果未知（[FLOW-24](./02-flows.md#flow-24-結果未知與冪等重送)） |
| 4xx / 5xx | 不綁定 Key、不計入庫存與時段、不消耗優惠券用量；可沿用同一 Key 修改內容後重送（BR-27） |
| 速率限制 | 同 IP、同手機有專屬限流（§1.6，含被退回的嘗試），命中回 `429 RATE_LIMITED` 並附 `retryAfterSeconds`；確定未建立訂單、不綁定 Key、不計入庫存與時段；前端不記下送出內容、依 `retryAfterSeconds` 暫停送出鈕，沿用同一把 Key 重送（[FLOW-24](./02-flows.md#flow-24-結果未知與冪等重送)）。測試環境須可關閉或放寬此限流（§7） |
| 追蹤權杖 | 訪客訂單回傳 `trackingToken`（後端僅存雜湊，同一訂單同時只有一把有效權杖）。**冪等重放時重新簽發**新權杖並使舊權杖失效，確保回應遺失的訪客仍能取回；同 Key 並行或多次重放時以最後簽發者為準，前端採用較晚收到的 `201`，若以權杖存取訂單回 `404`，改以 `GET /orders/lookup`（§5.12）取回（訂單編號與手機取自該筆 `201` 的 `order.orderNo`、`order.customer.phone`；`DINE_IN` 訪客未填手機時無法以 `lookup` 取回，因此前端於送出中須停用送出鈕，不並行送出同一把 Key） |
| 日誌 | 被拒的請求不落資料庫；僅寫結構化日誌 `order.create.rejected`（`requestId`、`codes`、`productIds`、`requested`、`available`，不含個資） |
| 內用桌號 | 桌號與 QR 權杖皆為選填（BR-22）：`dineIn` 可整個省略；`tableNo`、`qrToken` 為空字串或全空白視為未提供，與省略相同。**有提供才驗證**：提供 `qrToken` 時以權杖解析店家桌位，僅提供 `tableNo` 時以桌號（VR-10：1～10 字元英數字）比對店家桌位，查無或已停用回 `422 TABLE_NOT_FOUND`；沒有提供則不檢查、不回此碼，`orders.table_id`、`orders.table_no` 為 `NULL`，回應的 `Order.table` 省略。取餐號碼（`T` 前綴）照常產生，作為叫號與領餐識別；`dineIn` 僅對 `orderType = DINE_IN` 有意義 |

**請求（節錄）：內用，不掃 QR、沒有桌號（`dineIn` 省略）— `CreateOrderRequest`**

```json
{
  "orderType": "DINE_IN",
  "items": [
    { "productId": "prd_lurou", "quantity": 1, "optionIds": ["opt_bowl_l", "opt_egg"] }
  ],
  "scheduledAt": null,
  "contact": {},
  "paymentMethod": "CASH",
  "invoice": { "type": "PAPER" },
  "needUtensils": false,
  "expectedTotal": 67
}
```

**請求（節錄）：內用，掃描桌上 QR 帶入桌號（`tableNo` 與 `qrToken` 皆有提供）— `CreateOrderRequest`**

```json
{
  "orderType": "DINE_IN",
  "items": [
    { "productId": "prd_lurou", "quantity": 1, "optionIds": ["opt_bowl_l", "opt_egg"] }
  ],
  "scheduledAt": null,
  "contact": { "name": "阿凱" },
  "dineIn": { "tableNo": "A3", "qrToken": "qr_7d1f0a9c3e5b" },
  "paymentMethod": "CASH",
  "invoice": { "type": "PAPER" },
  "needUtensils": false,
  "expectedTotal": 67
}
```

| 內用請求 | `201` 的 `order.table` | `order.pickupNo` | 驗證 |
| --- | --- | --- | --- |
| 有桌號（有效的 `tableNo` 或 `qrToken`） | `{ "tableNo": "A3" }`（建單當下的桌號快照） | `T` 前綴（例：`T001`） | 通過 |
| 沒有桌號（`dineIn` 省略，或 `tableNo`、`qrToken` 為空字串 / 全空白） | 省略 | `T` 前綴（例：`T001`） | 不檢查，不回 `TABLE_NOT_FOUND` |
| 有提供但不是店家桌位（例：`"Z99"`） | — | — | `422 TABLE_NOT_FOUND`（`error.quote.checks[]` 以 `field = "dineIn.tableNo"` 定位） |

**錯誤範例 `409`（價格異動，無任何業務錯誤）— `ApiErrorResponse`**

```json
{
  "error": {
    "code": "PRICE_CHANGED",
    "message": "部分商品價格已更新，請確認後再送出",
    "requestId": "req_01JAXN6B2",
    "quote": {
      "valid": true,
      "items": [
        {
          "index": 0,
          "productId": "prd_lurou",
          "name": "招牌滷肉飯",
          "optionLabels": ["大碗", "滷蛋"],
          "unitPrice": 72,
          "quantity": 1,
          "lineTotal": 72,
          "available": true,
          "availableQuantity": 1,
          "remaining": null
        },
        {
          "index": 1,
          "productId": "prd_black_tea",
          "name": "古早味紅茶",
          "optionLabels": ["中杯", "半糖", "微冰"],
          "unitPrice": 25,
          "quantity": 1,
          "lineTotal": 25,
          "available": true,
          "availableQuantity": 1,
          "remaining": null
        }
      ],
      "subtotal": 97,
      "deliveryFee": 0,
      "discount": 0,
      "total": 97,
      "checks": []
    }
  }
}
```

> 情境：前端送出 `expectedTotal=92`，但店家已將「招牌滷肉飯」的大碗價格調整，伺服器計算為 `97`，因此回傳 `PRICE_CHANGED` 與最新報價。僅在庫存、時段與其他業務規則全數通過時才會走到這一步。

**請求（節錄）：售完、數量不足與時段額滿同時成立 — `CreateOrderRequest`**

```json
{
  "orderType": "PICKUP",
  "items": [
    { "productId": "prd_lurou", "quantity": 1, "optionIds": ["opt_bowl_l", "opt_egg"] },
    { "productId": "prd_black_tea", "quantity": 1, "optionIds": ["opt_cup_m", "opt_sugar_half", "opt_ice_light"] },
    { "productId": "prd_combo_share", "quantity": 3, "optionIds": ["opt_sm_lurou", "opt_sm_chicken", "opt_ss_oyster", "opt_sd_greens"] }
  ],
  "scheduledAt": "2026-10-14T17:00:00+08:00",
  "contact": { "name": "王小明", "phone": "0912345678" },
  "paymentMethod": "LINE_PAY",
  "invoice": { "type": "PAPER" },
  "needUtensils": false,
  "expectedTotal": 989
}
```

**錯誤範例 `422`（一次回報三項異動，招牌滷肉飯同時調價）— `ApiErrorResponse`**

```json
{
  "error": {
    "code": "ITEM_SOLD_OUT",
    "message": "有 3 項需要調整：古早味紅茶已售完、雙人分享餐只剩 2 份、17:00 時段已額滿",
    "requestId": "req_01JAXN7C4",
    "details": [
      { "field": "items", "code": "ITEM_SOLD_OUT", "message": "古早味紅茶已售完" },
      { "field": "items", "code": "ITEM_STOCK_INSUFFICIENT", "message": "雙人分享餐只剩 2 份" },
      { "field": "scheduledAt", "code": "SLOT_UNAVAILABLE", "message": "17:00 這個時段已額滿" }
    ],
    "quote": {
      "valid": false,
      "items": [
        {
          "index": 0,
          "productId": "prd_lurou",
          "name": "招牌滷肉飯",
          "optionLabels": ["大碗", "滷蛋"],
          "unitPrice": 72,
          "quantity": 1,
          "lineTotal": 72,
          "available": true,
          "availableQuantity": 1,
          "remaining": null
        },
        {
          "index": 1,
          "productId": "prd_black_tea",
          "name": "古早味紅茶",
          "optionLabels": ["中杯", "半糖", "微冰"],
          "unitPrice": 25,
          "quantity": 1,
          "lineTotal": 0,
          "available": false,
          "availableQuantity": 0,
          "remaining": null,
          "issue": "ITEM_SOLD_OUT"
        },
        {
          "index": 2,
          "productId": "prd_combo_share",
          "name": "雙人分享餐",
          "optionLabels": ["招牌滷肉飯", "嘉義雞肉飯", "蚵仔煎", "燙青菜"],
          "unitPrice": 299,
          "quantity": 3,
          "lineTotal": 598,
          "available": false,
          "availableQuantity": 2,
          "remaining": 2,
          "issue": "ITEM_STOCK_INSUFFICIENT"
        }
      ],
      "subtotal": 670,
      "deliveryFee": 0,
      "discount": 0,
      "total": 670,
      "checks": [
        { "code": "ITEM_SOLD_OUT", "severity": "ERROR", "message": "古早味紅茶已售完", "field": "items", "lineIndex": 1 },
        { "code": "ITEM_STOCK_INSUFFICIENT", "severity": "ERROR", "message": "雙人分享餐只剩 2 份", "field": "items", "lineIndex": 2 },
        { "code": "SLOT_UNAVAILABLE", "severity": "ERROR", "message": "17:00 這個時段已額滿", "field": "scheduledAt" }
      ]
    }
  }
}
```

> 頂層 `error.code` 取優先序最高者（`ITEM_SOLD_OUT`），其餘兩項在 `checks[]`。滷肉飯單價由 `67` 變 `72` **不產生 check**：前端比對購物車快照（`67`）與 `quote.items[0].unitPrice`（`72`）推導「價格已更新」項目；有業務 `ERROR` 時不回 `409`。`quote.total`（`670`）與顧客原本看到的 `989` 不同，是因為金額以可成立內容計算；顧客套用建議後，前端以 `expectedTotal = 670` 重送（沿用同一把 Key）。

**錯誤範例 `422`（預約時段在送出時被占滿，僅此一項）— `ApiErrorResponse`**

```json
{
  "error": {
    "code": "SLOT_UNAVAILABLE",
    "message": "此時段已額滿，請選擇其他時段",
    "requestId": "req_01JAXN6D4",
    "details": [
      { "field": "scheduledAt", "code": "SLOT_UNAVAILABLE", "message": "17:15 這個時段已額滿" }
    ],
    "quote": {
      "valid": false,
      "items": [
        {
          "index": 0,
          "productId": "prd_lurou",
          "name": "招牌滷肉飯",
          "optionLabels": ["大碗"],
          "unitPrice": 55,
          "quantity": 1,
          "lineTotal": 55,
          "available": true,
          "availableQuantity": 1,
          "remaining": null
        }
      ],
      "subtotal": 55,
      "deliveryFee": 0,
      "discount": 0,
      "total": 55,
      "checks": [
        { "code": "SLOT_UNAVAILABLE", "severity": "ERROR", "message": "17:15 這個時段已額滿", "field": "scheduledAt" }
      ]
    }
  }
}
```

> 時段額滿不在回應中附建議時段：前端重新載入 `pickup-slots`（§5.6）後自行推導最近可選時段，且不靜默改選。

**錯誤範例 `503`（建單互斥鎖等待逾時，不綁定 Key）— `ApiErrorResponse`**

```json
{
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "目前點餐人數較多，請稍後再按一次送出訂單",
    "requestId": "req_01JAXN6E1",
    "retryAfterSeconds": 2
  }
}
```

**錯誤範例 `429`（`POST /orders` 專屬限流，未建立訂單、不綁定 Key）— `ApiErrorResponse`**

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "操作太頻繁，請稍後再按一次送出訂單",
    "requestId": "req_01JAXN6F3",
    "retryAfterSeconds": 45
  }
}
```

> 標頭 `Retry-After: 45` 與 `error.retryAfterSeconds` 相同，前端以 body 為準。命中時確定未建立訂單：前端不記下送出內容、送出鈕依該秒數暫停，之後以同一把 Key 重送（[FLOW-24](./02-flows.md#flow-24-結果未知與冪等重送)）。

**冪等重放**：請求與原送出相同（同一把 `Idempotency-Key`、指紋相同）時回 `201`，並帶標頭 `Idempotent-Replayed: true`。下例為原訂單已因付款逾時取消的情況。

**回應 `201`（重放，原訂單已因付款逾時取消）— `CreateOrderResponse`**

```json
{
  "order": {
    "id": "01JAXN5R1B4T8W2Y6Z9C3D5F7G",
    "orderNo": "ZO261014M2P9RT",
    "storeId": "01JAXN0000000000000000STORE",
    "orderType": "PICKUP",
    "status": "CANCELLED",
    "pickupNo": "A028",
    "businessDate": "2026-10-14",
    "customer": { "name": "王小明", "phone": "0912345678" },
    "scheduledAt": null,
    "estimatedReadyAt": null,
    "items": [
      {
        "id": "01JAXN5R1B4T8W2Y6Z9C3D5F7H",
        "productId": "prd_combo_share",
        "name": "雙人分享餐",
        "quantity": 2,
        "unitPrice": 299,
        "lineTotal": 598,
        "options": [
          { "groupName": "主餐（選 2）", "name": "招牌滷肉飯", "priceDelta": 0 },
          { "groupName": "主餐（選 2）", "name": "嘉義雞肉飯", "priceDelta": 0 },
          { "groupName": "小吃（選 1）", "name": "蚵仔煎", "priceDelta": 0 },
          { "groupName": "小菜（選 1）", "name": "燙青菜", "priceDelta": 0 }
        ]
      }
    ],
    "amounts": { "subtotal": 598, "deliveryFee": 0, "discount": 0, "total": 598 },
    "needUtensils": false,
    "invoice": { "type": "PAPER", "status": "PENDING" },
    "payment": { "method": "LINE_PAY", "status": "UNPAID", "expiresAt": null },
    "cancellation": { "by": "SYSTEM", "reason": "付款逾時", "at": "2026-10-14T12:35:00+08:00" },
    "timeline": [
      { "status": "PENDING_PAYMENT", "at": "2026-10-14T12:20:00+08:00", "by": "CUSTOMER" },
      { "status": "CANCELLED", "at": "2026-10-14T12:35:00+08:00", "by": "SYSTEM", "note": "付款逾時" }
    ],
    "placedAt": "2026-10-14T12:20:00+08:00",
    "cancelledAt": "2026-10-14T12:35:00+08:00",
    "permissions": { "canCancel": false, "canPay": false, "canReorder": true, "canReview": false }
  },
  "trackingToken": "trk_5d2a9b7e1c4f8a36",
  "nextAction": "TRACK",
  "replayed": true
}
```

> 重放回傳原訂單的**目前狀態**：訪客於付款逾時後才重送同一把 Key，取得的是已取消的訂單。前端依 `nextAction` 導向：`TRACK` → 訂單頁（已取消者顯示取消原因與「再來一單」，**不得導向付款頁**）；`PAY`（訂單仍為 `PENDING_PAYMENT` 且未逾期）→ 付款頁並續用剩餘時間。`Order.items` 只含選項名稱快照（無 `optionId`），前端判斷「取回的訂單與目前購物車是否一致」時，以被重放的那次請求內容為準，不以 `Order.items` 推算。

### 5.10 `GET /orders/{orderId}`

回傳 `Order`（結構見 §5.9 的 `order`）。無權存取（非擁有者且追蹤權杖無效）一律回 `404 NOT_FOUND`。支援 `ETag`；輪詢建議 5 秒，**訂單為終態但退款進行中（`payment.status=REFUNDING`）仍需持續輪詢**。`permissions` 由伺服器依狀態與擁有者計算，例如 `canCancel` 僅於 `PENDING_PAYMENT`、`PENDING` 為 `true`（BR-16）。

**讀取時結算逾期**：訂單為 `PENDING_PAYMENT` 且已逾 `payment.expiresAt` 時，伺服器先以冪等的 `expireIfDue` 補做逾時處理（條件式轉為 `CANCELLED`、`cancelled_by=SYSTEM`，原因「付款逾時」於同一 UPDATE 寫入，並於**同一交易內**作廢進行中交易、返還優惠券、寫入狀態紀錄），再回傳 `CANCELLED`；因此不會回傳已逾期的 `PENDING_PAYMENT`，且 `canPay` 為 `false`。釋放庫存與時段不需額外寫入（BR-38）。

**接單逾時不做讀取時結算**：`PENDING` 已逾 `acceptBy` 但排程尚未寫入時仍回 `PENDING`（前端不自行推斷取消），待排程寫入 `CANCELLED` 後由輪詢取得；`acceptBy` 僅 `PENDING` 有值。

### 5.11 `POST /orders/{orderId}/cancel`

| | |
| --- | --- |
| Request | `{ "reason": "不小心點錯了" }`（選填，≤ 100 字） |
| 200 | 更新後的 `Order`（`status=CANCELLED`；已付款者 `payment.status=REFUNDING`） |
| 冪等 | 第一個資料庫動作為 `SELECT … FROM orders WHERE id = ? FOR UPDATE`（同 §5.13），鎖後以條件式更新 `WHERE status IN ('PENDING_PAYMENT','PENDING')`；影響 0 列時重讀訂單：已為 `CANCELLED` → `200` 回原狀態，不重複返還優惠券、不重複退款；已 `ACCEPTED` 以後 → `409 ORDER_STATE_CONFLICT` |
| 釋放 | 進入 `CANCELLED` 即釋放庫存與時段（BR-38），與退款進度無關；作廢交易與返還優惠券於同一交易完成（BR-28、BR-29） |
| 錯誤 | `ORDER_STATE_CONFLICT`（已被接單）、`FORBIDDEN`、`NOT_FOUND` |

### 5.12 `GET /orders/lookup`

| Query | 說明 |
| --- | --- |
| `orderNo` | 訂單編號 |
| `phone` | 訂單聯絡手機 |

**Response `200`**：`{ "orderId": "...", "trackingToken": "..." }`（`trackingToken` 為新簽發並覆寫雜湊，舊權杖失效，與冪等重放相同）；查無或不符一律 `404 NOT_FOUND`（EC-15）；同一手機 10 分鐘內最多 5 次嘗試（§1.6），避免以 30 bit 的隨機碼暴力猜測。

### 5.13 `POST /orders/{orderId}/payments`

| | |
| --- | --- |
| 用途 | 為 `PENDING_PAYMENT` 訂單發起付款（首次或重試），或改用現金 |
| Request | `CreatePaymentRequest` |
| 201 | `CreatePaymentResponse` |
| 前提 | 訂單須為 `PENDING_PAYMENT` 且尚未逾 `payment.expiresAt`；否則（含排程尚未寫入 `CANCELLED`、`method=CASH` 亦同）回 `409 ORDER_STATE_CONFLICT`。`permissions.canPay` 於逾期時為 `false` |
| 鎖定 | 同一交易內第一個資料庫動作為 `SELECT … FROM orders WHERE id = ? FOR UPDATE`（鎖後再以條件判斷狀態與期限，不以可能影響 0 列的條件式更新充當鎖），再作廢 / 建立付款交易；不取店家建單鎖，鎖序見 [05 §6.3](./05-database-schema.md)。避免與建單鎖內的逾期結算交錯，在已取消的訂單上留下 `PENDING` 交易 |
| 不重驗庫存 | 付款、重試與改用現金**不重驗**庫存、時段與店家狀態：餐點已於建單時保留（BR-38），此處只檢查保留是否仍有效（未逾期） |
| 重試 | 建立新交易前，同訂單既有 `PENDING` 交易一律作廢（`FAILED`，`failure_code=SUPERSEDED`）（BR-28）；付款成功轉為 `PENDING` 的同一交易內，同訂單其餘 `PENDING` 的線上交易亦一併作廢，避免殘留處理中的交易 |
| `method=CASH` | 不回傳 `redirectUrl`；以條件式更新（`status='PENDING_PAYMENT'` 且未逾期）將訂單轉為 `PENDING`、`payment.method=CASH`（接單期限自此刻起算，`order.acceptBy` 隨之出現）；影響 0 列 → `409 ORDER_STATE_CONFLICT` |
| 逾時後才成功 | 付款成功回呼先以（`provider`、`provider_txn_id`）查交易，再取訂單列鎖並以交易層級條件式更新作為閘門；已 `SUCCESS` / `REFUNDED`（金流重送），或閘門影響 0 列（與第一次處理重疊的並行相同回呼）者直接回 `200`；訂單條件式更新影響 0 列時須重讀訂單並分流（交易記 `SUCCESS`、自動退款或僅退回該筆款項，不復活訂單、不重新計入庫存），見 [§6.2](#62-後端對外整合非前端契約)（BR-28、EC-17） |
| 線上付款 | 回傳 `redirectUrl`（Demo 為站內 `/payment/:orderId`）；付款結果以後端 Webhook 為準；付款成功轉為 `PENDING` 時才起算接單期限（`acceptBy`，BR-17） |
| 錯誤 | `ORDER_STATE_CONFLICT`（已逾付款期限或非待付款）、`FORBIDDEN`、`NOT_FOUND` |

### 5.14 `GET /orders`

| Query | 說明 |
| --- | --- |
| `tab` | `active`（`PENDING_PAYMENT` `PENDING` `ACCEPTED` `READY` `DELIVERING`）、`completed`、`cancelled` |
| `limit`、`cursor` | 游標分頁 |

**Response `200`**：`{ "items": OrderSummary[], "nextCursor": string | null }`

**唯讀、不結算**：本端點不寫入任何資料（呼叫前後資料庫狀態相同）。已逾 `payment.expiresAt` 但排程尚未寫入 `CANCELLED` 的 `PENDING_PAYMENT` 訂單，以與計入條件相同的判斷顯示為 `CANCELLED`，`tab` 分群亦同（歸入 `cancelled`、不歸 `active`）；實際結算於 `GET /orders/{orderId}`、取消、付款或排程。`GET /orders/lookup`（§5.12）只回 `orderId` 與新簽發的權杖，不回狀態、不結算。

### 5.15 會員端點摘要

| 端點 | Request | Response |
| --- | --- | --- |
| `GET /me` | — | `UserProfile` |
| `PATCH /me` | `{ name?, email?, marketingOptIn? }` | `UserProfile` |
| `DELETE /me` | — | `204`（流程見 [05 §7.2](./05-database-schema.md)） |
| `GET /me/addresses` | — | `{ items: Address[] }` |
| `POST /me/addresses` | `Omit<Address, 'id'>` | `201 Address` |
| `PATCH /me/addresses/{id}` | `Partial<Omit<Address, 'id'>>` | `Address`；`isDefault=true` 時其他地址自動取消預設 |
| `DELETE /me/addresses/{id}` | — | `204` |
| `GET /me/favorites` | — | `{ productIds: ID[] }` |
| `PUT /me/favorites/{productId}` | — | `204`（冪等） |
| `DELETE /me/favorites/{productId}` | — | `204` |
| `GET /me/coupons?status=` | — | `{ items: UserCoupon[] }` |
| `GET /me/frequent-items?limit=` | — | `FrequentItemsResponse`（見 §5.15a） |

### 5.15a `GET /me/frequent-items`

供「常點」區塊與「↻ 再點」使用（[FLOW-20](./02-flows.md#flow-20-點餐記憶與快速再點)）。伺服器由會員近 180 天內**非取消**訂單的品項推導：每個商品取最近一次的選項與備註，依 `lastOrderedAt` 由新到舊；`limit` 預設 50、最大 100（與前端本機上限 100 項一致）。「常點」區塊取前 6 項，`orderCount` 預留供日後排序策略。**訪客不呼叫此端點**，記憶僅存於本機（BR-35）。

前端須以商品**目前**的選項驗證 `optionIds`（失效者丟棄、超出群組上限視同失效），不可直接信任此回應即可購買。回應不含品名與價格，前端以菜單中的商品資料顯示；已不在菜單內的商品不列入「常點」。

訪客的本機記憶於下單時寫入、不因之後訂單被取消而回溯移除，與本端點（排除已取消訂單）可能略有差異；前端合併時以 `lastOrderedAt` 較新者為準，且合併結果只存於記憶體（會員的常點不寫入本機）。

**Response `200` — `FrequentItemsResponse`**

```json
{
  "items": [
    {
      "productId": "prd_lurou",
      "optionIds": ["opt_bowl_l", "opt_egg"],
      "optionLabels": ["大碗", "滷蛋"],
      "note": "不要蔥",
      "lastOrderedAt": "2026-10-11T12:20:00+08:00",
      "orderCount": 1
    },
    {
      "productId": "prd_black_tea",
      "optionIds": ["opt_cup_m", "opt_sugar_half", "opt_ice_light"],
      "optionLabels": ["中杯", "半糖", "微冰"],
      "lastOrderedAt": "2026-10-11T12:20:00+08:00",
      "orderCount": 1
    },
    {
      "productId": "prd_kong_rou",
      "optionIds": [],
      "optionLabels": [],
      "lastOrderedAt": "2026-10-11T12:20:00+08:00",
      "orderCount": 1
    },
    {
      "productId": "prd_beef_noodle",
      "optionIds": ["opt_noodle_thin", "opt_spice_none"],
      "optionLabels": ["細麵", "不辣"],
      "lastOrderedAt": "2026-10-07T12:20:00+08:00",
      "orderCount": 1
    },
    {
      "productId": "prd_danzai",
      "optionIds": [],
      "optionLabels": [],
      "lastOrderedAt": "2026-10-07T12:20:00+08:00",
      "orderCount": 1
    }
  ]
}
```

---

## 6. 非同步與整合

### 6.1 訂單狀態更新

| 階段 | 方式 |
| --- | --- |
| P1 / P2 初期 | **輪詢** `GET /orders/{id}`，間隔 5 秒、僅頁面可見時（[FLOW-16](./02-flows.md#flow-16-訂單追蹤輪詢)）；使用 `If-None-Match` |
| P2 後期（建議） | **SSE**：`GET /orders/{id}/events`（`text/event-stream`），事件 `order.updated` 帶完整 `Order`；斷線時自動退回輪詢 |
| 通知（P2） | LINE 訊息 / 簡訊 / Web Push，由後端依 `order_status_logs` 觸發 |

### 6.2 後端對外整合（非前端契約）

| 整合 | 說明 |
| --- | --- |
| 金流 Webhook | 後端提供 `POST /webhooks/payments/{provider}`，驗簽後更新 `payments` 與 `orders.payment_status`；**前端不得以導回網址的參數判定付款成功**。處理順序見表後「付款成功回呼的處理順序」（預檢、訂單列鎖、交易層級閘門、訂單條件式更新、0 列分流；BR-28、EC-17） |
| 電子發票 | 後端於付款成功 / 訂單完成後呼叫加值中心開立，回寫 `order_invoices` |
| 簡訊 | OTP 與狀態通知 |
| 店家端 | 店家 POS / 後台透過後台 API 變更訂單狀態（接單、出餐、出發、完成、拒單），每次必寫 `order_status_logs` |

**付款成功回呼的處理順序**（同一資料庫交易，加鎖順序先 `orders` 後 `payments`，不取店家建單鎖，與 [05 §6.3](./05-database-schema.md) 相同）

1. **預檢**（唯讀、不持鎖）：以（`provider`、`provider_txn_id`）查交易；已為 `SUCCESS` 或 `REFUNDED`（金流重送）者直接回 `200`，不再處理、不退款。預檢不是防止並行重複的閘門，並行抵達的兩個相同回呼可能同時通過。
2. **鎖定訂單列**：第一個資料庫動作為 `SELECT … FROM orders WHERE id = ? FOR UPDATE`；並行的相同回呼在此序列化，不以影響 0 列的條件式更新充當鎖。
3. **交易層級閘門**：`UPDATE payments SET status = 'SUCCESS', paid_at = NOW(3) WHERE id = ? AND status IN ('PENDING', 'FAILED')`。影響 0 列代表該交易已被並行的相同回呼處理，回 `200` 並結束；影響 1 列才進入後續。`payments` 以 `UK(provider, provider_txn_id)` 保證同一筆金流交易只有一列（[05 §5.4](./05-database-schema.md)）。
4. **訂單條件式更新**：`status='PENDING_PAYMENT'` 且 `payment_expires_at` 大於資料庫時鐘。影響 1 列（正常路徑）時，同一交易內作廢同訂單其餘 `PENDING` 的線上付款交易（`FAILED`，`failure_code=SUPERSEDED`）。
5. **0 列分流**：訂單影響 0 列時必須重讀訂單（列鎖已於步驟 2 取得）並依下表分流，不得一律視為逾時。

**付款成功回呼的分流**（先判斷交易，再判斷訂單；後兩列為訂單條件式更新影響 0 列時，該交易已由閘門記為 `SUCCESS`）

| 重讀後的訂單狀態 | 付款交易 | 訂單 | 庫存與時段 | 退款 |
| --- | --- | --- | --- | --- |
| （不重讀）該交易已為 `SUCCESS` 或 `REFUNDED`，或閘門影響 0 列（金流重送，含並行重疊的相同回呼） | 不變 | 不變 | 不受影響 | 不再退款；直接回 `200` |
| `CANCELLED`（排程或顧客已取消），或 `PENDING_PAYMENT` 但已逾 `payment_expires_at` | 記為 `SUCCESS` | 維持或轉為 `CANCELLED`，不復活 | 不重新計入（份額可能已被他人買走） | 自動退款（`REFUNDING` → `REFUNDED`） |
| 已為 `PENDING`、`ACCEPTED` 以後（例如顧客已改用現金） | 僅該筆交易記為 `SUCCESS` | **不得**變更狀態 | 不受影響 | 僅退回該筆款項 |

> 逾時排程取消與付款成功回呼是作用於同一列的兩個條件式更新，恰一方生效，不會出現「已付款卻無訂單」或「逾期後重新佔用庫存」。逾期後才成功的付款**不復活**訂單，因為復活需重新搶庫存，且與已釋放給他人的份額衝突。自動退款的外部呼叫在 `COMMIT` 後（鎖外）執行，交易內只寫入 `REFUNDING`。並行抵達的兩個相同成功回呼，後到者在列鎖處序列化，取得鎖後閘門影響 0 列，直接回 `200`、不進入分流，因此退款次數為 0（正常付款）或 1（逾時路徑），不會把正常入帳的款項再退一次。

---

## 7. Mock 與正式 API 對照

| 項目 | Phase 1（Mock Adapter） | Phase 2（HTTP Adapter） | 注意事項 |
| --- | --- | --- | --- |
| 資料存放 | 記憶體 + `localStorage`，集合名稱同資料表 | 後端資料庫 | 型別與欄位一致 |
| 計價 / 驗證 | 共用 `domain/pricing`、`domain/validation` 純函式 | 後端為準 | 前端保留相同邏輯作預覽（BR-25） |
| 庫存 / 時段 | 同一份 `evaluateOrder`（`quote` 與 `POST /orders` 共用）＋ 同步臨界區 ＋ Web Locks（寫入前重讀 db）；他人下單以真實訂單列注入 | 店家建單互斥鎖（以 `FOR UPDATE` 鎖定店家設定列）＋ `READ COMMITTED` ＋ 條件式狀態轉換 | 兩者通過同一組庫存與時段契約測試；Mock 單執行緒無法暴露真實併發（R-08），串接後須以並行測試補驗；不支援 Web Locks 的瀏覽器可能遺失多分頁寫入（見 [08 §8](./08-demo-guide.md)） |
| 冪等指紋 | Mock 以 `requestFingerprint` 計算雜湊並綁定於訂單 | `orders.idempotency_request_hash`（SHA-256 或 HMAC） | 正規化規則相同（§1.4）；指紋排除 `expectedTotal` |
| 時段 / 營業狀態 | 共用 `domain/slots`、`domain/storeStatus`；時鐘可被 Demo 覆寫 | 後端為準；前端以 `serverTime` 校正時差 | 切換時移除時鐘覆寫 |
| 訂單推進 | Demo 模擬器（[FLOW-14](./02-flows.md#flow-14-demo-模擬器狀態推進)） | 店家端操作 | 前端不應假設推進速度 |
| 接單逾時 | Demo 模擬器在推進時依接單期限（`acceptBy`）寫入 `CANCELLED`，時點較精確：自動模擬開啟時，推進先以 `min(現在, acceptBy)` 為時間點補寫模擬轉換（至少補到進入 `PENDING` 後 5 秒的 `ACCEPTED`）再判斷接單逾時，因此接單逾時只在自動模擬關閉、店家端未接單時出現（付款逾時不受開關影響） | 排程掃描寫入 `CANCELLED`；不做讀取時結算（[05 §6.4](./05-database-schema.md)），排程寫入前 `PENDING` 仍計入 | 契約測試不得斷言接單逾時的釋放時點；唯讀路徑（`quote`、菜單、商品、時段）兩種來源皆不寫入，只以計入條件排除逾期待付款單 |
| 付款 | 站內模擬頁 | 金流導轉 + Webhook | `redirectUrl` 契約不變 |
| OTP | 固定 `123456` | 簡訊 | 錯誤碼與冷卻時間契約不變 |
| 追蹤權杖 | 本機產生 | 後端簽發 | 前端只負責保存與帶入標頭 |
| 延遲 / 錯誤 | 可由 Demo 面板注入 | 真實網路 | 錯誤處理需同樣可靠（FLOW-15） |
| 測試輔助 | `DemoControl`（Demo 面板：每日限量、他人下單、補滿時段、時鐘、下一次送出前才發生、回應遺失） | 測試環境提供可設定時鐘、每日限量與售完、以他人身分建單、補滿時段、店家端取消的輔助，以及關閉或放寬 `POST /orders` 專屬限流的開關（或測試標頭 / 白名單 IP 豁免）（僅非正式環境，不屬公開契約） | 無輔助時 HTTP 來源的庫存套件標記 `skipped` 並列於報告，不得靜默通過；契約並行測試（同 IP、同手機瞬間送出多筆）不得依賴正式環境的限流值 |

### 7.1 串接檢核表（Phase 2）

- [ ] 後端回傳之 JSON 通過本文件 TypeScript 型別與 JSON Schema 驗證（建議 CI 加入契約測試）。
- [ ] 所有列舉值與 [05 §3](./05-database-schema.md) 一致；前端對未知列舉優雅降級。
- [ ] 時間欄位皆含 `+08:00`；金額皆為整數。
- [ ] `POST /orders` 實作冪等（`Idempotency-Key`）與 `PRICE_CHANGED`：指紋排除 `expectedTotal`；鎖前與鎖內重查皆比對指紋；重放回 `201` 與 `replayed: true`，保證 ≥ 24 小時。
- [ ] `quote` 與 `POST /orders` 使用**同一份**計價與驗證邏輯；所有 `422` 與 `409 PRICE_CHANGED` 皆附 `error.quote`，與以同一請求內容呼叫的 `quote` 逐欄一致（`PAYMENT_METHOD_NOT_ALLOWED`、`INVOICE_INVALID`、`TABLE_NOT_FOUND` 因 `QuoteRequest` 無對應欄位，只出現在 `error.quote`）；頂層 `error.code` 依 [§3.2](#32-錯誤碼表) 優先序。
- [ ] 內用桌號選填（BR-22）：`dineIn` 可整個省略，`tableNo`、`qrToken` 皆選填且空字串 / 全空白視為未提供；未提供不檢查、不回 `TABLE_NOT_FOUND`，取餐號碼仍為 `T` 前綴，`Order.table` 省略；有提供才驗證格式與店家桌位；`orders.table_no` 可為 `NULL` 且資料庫沒有「內用必須有桌號」的 `CHECK`（[05 §5.4](./05-database-schema.md)）。
- [ ] CORS 以 `Access-Control-Expose-Headers` 暴露 `Idempotent-Replayed`、`Retry-After`（前端以 body 的 `replayed` 與 `retryAfterSeconds` 為準，標頭僅輔助）。
- [ ] 庫存與時段契約套件（含並行）於 Mock 與 HTTP 兩種來源皆通過：20 個不同 Key 同時搶最後 1 份只成功 1 筆、其餘 `422 ITEM_SOLD_OUT`；最後 1 個時段名額並行只成功 1 筆；同 Key 並行 ×5 只建立 1 筆、其餘 `201` 且 `replayed: true`、庫存只扣一次。HTTP 來源須先關閉或放寬 `POST /orders` 專屬限流（見下方測試環境項），否則同 IP、同手機的瞬間多筆會先回 `429`。
- [ ] 取消、拒單與付款逾時（含排程尚未寫入 `CANCELLED`）後立即釋放；`GET /orders/{id}` 讀取時補做 `expireIfDue`；鎖內結算先於計數，且結算與其後處理（作廢交易、返還優惠券、狀態紀錄）在同一交易內完成（付款交易在途時建單不超賣）。
- [ ] 唯讀路徑（`quote`、菜單、商品、`pickup-slots`、`GET /orders`）不寫入任何資料（呼叫前後資料庫狀態相同），只以計入條件排除逾期待付款單（`GET /orders` 為顯示修正，分群亦同）；`GET /orders/lookup` 不回狀態、不結算；逾期結算僅在寫入路徑（建單、取消、付款與 `GET /orders/{id}`）執行，接單逾時由排程寫入。
- [ ] 付款回呼、發起付款、改用現金、取消與排程的第一個資料庫動作一律為 `SELECT … FROM orders WHERE id = ? FOR UPDATE`（鎖後才以條件判斷與條件式更新，不以影響 0 列的條件式更新充當鎖），再動 `payments`；皆不取店家建單鎖（[05 §6.3](./05-database-schema.md)）。
- [ ] `Order.acceptBy` 僅 `PENDING` 有值，由伺服器依 BR-17 自進入 `PENDING`（建單現金、付款成功或改用現金）起算。
- [ ] 逾期後付款成功：交易記 `SUCCESS`、自動退款且不復活訂單；改用現金後晚到的線上付款成功：僅退回該筆款項，訂單狀態與庫存不變；同一成功回呼連送兩次：訂單不變、僅退款 0 次（正常）或 1 次（逾時路徑），第二次直接回 `200`；兩個相同成功回呼並行（第二個與第一個處理重疊）：結果相同，後到者不進入分流。
- [ ] 取餐號碼序號以（營業日、前綴）為鍵：今日下的隔日預約單取得明日序號（可為明日 `A001`），不佔用今日序號；明日第一張即時單為 `A002` 且不重號；今日下一張 `A` 序號不受影響。
- [ ] 建單鎖內無外部 I/O（金流、簡訊、發票）；鎖等待逾時回 `503` 並附 `retryAfterSeconds`，不綁定 Key，同 Key 重送可成功。
- [ ] 測試環境提供可設定時鐘與庫存輔助（時鐘、每日限量與售完、他人下單、補滿時段、店家端取消），以及關閉或放寬 `POST /orders` 專屬限流的開關（或測試標頭 / 白名單 IP 豁免）；契約並行測試不得依賴正式環境的限流值；缺少時庫存套件標記 `skipped` 並列於報告。
- [ ] `permissions` 由後端計算並回傳。
- [ ] 訪客訂單的 `trackingToken` 後端僅存雜湊、同一訂單同時只有一把有效（建立、冪等重放與 `lookup` 時簽發，後簽發者取代前者）；`/orders/lookup` 與 `POST /orders` 具專屬速率限制（§1.6）。
- [ ] CORS 白名單、HTTPS、安全標頭（CSP、HSTS）已設定。
- [ ] 金流 Webhook 驗簽、重送（含並行重送）與對帳流程已驗證；`payments` 具 `UK(provider, provider_txn_id)`，查詢帶 `provider`。
- [ ] 前端將 `VITE_DATA_SOURCE` 切為 `http`，執行 [UAT-01～12、UAT-15、UAT-21～25](./01-requirements.md#11-驗收情境uat) 全數通過；另以會員身分確認 `GET /me/frequent-items` 回傳常點，且前端套用前以現行選項驗證（FR-AC-11、BR-35）。
