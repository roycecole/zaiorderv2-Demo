# 05 · 資料表設計（Database Schema）

| 項目 | 內容 |
| --- | --- |
| 專案 | ZaiOrder — 台灣小吃店線上點餐平台（消費者端） |
| 文件 | 資料表、欄位字典、列舉值、索引與約束 |
| 版本 | v0.4.1 草案 ｜ 2026-10-16 |
| 適用階段 | Phase 1 前端以 Mock 資料集合對應本設計；Phase 2 後端依本設計建立資料庫 |
| 相關文件 | [04 ERD](./04-erd.md)（關聯圖）・[06 API](./06-api-spec.md)（欄位對外命名）・[01 需求](./01-requirements.md) |

> 文件導覽：[← 04 ERD](./04-erd.md) ・ 下一份：[06 API 規格 →](./06-api-spec.md)

---

## 1. 設計原則與命名慣例

| 項目 | 規範 |
| --- | --- |
| 資料庫 | 關聯式資料庫（MySQL 8 / PostgreSQL 14+ 皆可）；本文以邏輯型別描述，實體型別對照見 §2 |
| 命名 | 表名：小寫 snake_case、複數（`orders`）；欄位：snake_case；外鍵：`<單數表名>_id` |
| 主鍵 | `id CHAR(26)`，**ULID**（應用程式產生，可排序、不可列舉）；前端視為不透明字串 |
| 金額 | `INT UNSIGNED`，單位新台幣「元」，含稅，**不使用浮點數**；差額欄位（如 `price_delta`）使用有號 `INT` |
| 時間 | 一律儲存 UTC；API 回傳 ISO 8601 並帶 `+08:00`；顯示依店家時區 `Asia/Taipei` |
| 列舉 | 以 `VARCHAR` + `CHECK` 約束儲存，不使用資料庫原生 `ENUM`（利於變更與移植）；值集合見 §3 |
| 布林 | `BOOLEAN`（MySQL `TINYINT(1)`），欄位名稱以 `is_` / `has_` / `allow_` / `need_` 開頭 |
| 共通欄位 | 除特別註明外，每表皆含 `created_at`、`updated_at`（`TS NOT NULL`，預設 `CURRENT_TIMESTAMP`，後者於更新時自動更新） |
| 軟刪除 | 僅 `stores`、`users`、`categories`、`products`、`option_groups` 具 `deleted_at`；查詢預設加上 `deleted_at IS NULL` |
| 快照 | 訂單相關表保存**下單當下**的名稱、價格、選項與地址，不依賴後續主檔變更 |
| 多店 | 營運類資料皆帶 `store_id`，Phase 1 只有一筆店家（見 [A-01](./01-requirements.md#10-假設限制與風險)） |
| 購物車 | **不落資料庫**：購物車為前端狀態，結帳時由 `POST /orders` 一次送出，後端重新驗證與計價 |
| 庫存與時段 | **不另存計數欄位**：剩餘份數與時段已訂數由訂單查詢計算（[04 D-08](./04-erd.md)）；建單交易的鎖定與隔離見 §6.3，計入規則與對帳見 §6.4 |

---

## 2. 型別對照

| 邏輯型別 | 說明 | MySQL | PostgreSQL |
| --- | --- | --- | --- |
| `ID` | ULID | `CHAR(26)` | `CHAR(26)` |
| `MONEY` | 新台幣整數 | `INT UNSIGNED` | `INTEGER` + `CHECK (>= 0)` |
| `TS` | 時間戳記（UTC） | `DATETIME(3)` | `TIMESTAMPTZ(3)` |
| `DATE` / `TIME` | 日期 / 時間 | `DATE` / `TIME` | `DATE` / `TIME` |
| `BOOL` | 布林 | `TINYINT(1)` | `BOOLEAN` |
| `ENUM(n)` | 列舉字串 | `VARCHAR(n)` + `CHECK` | `VARCHAR(n)` + `CHECK` |
| `JSON` | 結構化資料 | `JSON` | `JSONB` |

---

## 3. 列舉值字典

> 流程圖、API 與前端型別中的列舉值**必須與此表完全一致**。

| 列舉 | 使用欄位 | 值 | 中文 |
| --- | --- | --- | --- |
| `OrderType` | `orders.order_type`、`coupons.applicable_order_types[]` | `PICKUP` | 自取 |
| | | `DELIVERY` | 外送 |
| | | `DINE_IN` | 內用 |
| `OrderStatus` | `orders.status`、`order_status_logs.from_status/to_status` | `PENDING_PAYMENT` | 待付款 |
| | | `PENDING` | 待店家確認 |
| | | `ACCEPTED` | 製作中 |
| | | `READY` | 可取餐 / 待外送 |
| | | `DELIVERING` | 外送中 |
| | | `COMPLETED` | 已完成 |
| | | `CANCELLED` | 已取消 |
| `PaymentStatus` | `orders.payment_status` | `UNPAID` | 未付款（含現金待收） |
| | | `PAID` | 已付款 |
| | | `REFUNDING` | 退款中 |
| | | `REFUNDED` | 已退款 |
| `PaymentTxnStatus` | `payments.status` | `PENDING` | 處理中 |
| | | `SUCCESS` | 成功 |
| | | `FAILED` | 失敗 |
| | | `REFUNDED` | 已退款 |
| `PaymentMethod` | `orders.payment_method`、`payments.method`、`store_payment_methods.method` | `CASH` | 現金（取餐 / 送達 / 櫃檯付款） |
| | | `CREDIT_CARD` | 信用卡 |
| | | `LINE_PAY` | LINE Pay |
| | | `JKOPAY` | 街口支付 |
| `InvoiceType` | `order_invoices.invoice_type` | `PAPER` | 隨餐附紙本 |
| | | `MOBILE_BARCODE` | 手機條碼載具 |
| | | `CITIZEN_CERT` | 自然人憑證載具 |
| | | `DONATION` | 捐贈 |
| | | `COMPANY` | 統編（公司戶） |
| `InvoiceStatus` | `order_invoices.status` | `PENDING` | 待開立 |
| | | `ISSUED` | 已開立 |
| | | `VOIDED` | 已作廢 |
| `DiscountType` | `coupons.discount_type` | `PERCENT` | 百分比折扣 |
| | | `FIXED_AMOUNT` | 固定金額折抵 |
| | | `FREE_DELIVERY` | 免運費 |
| `UserCouponStatus` | `user_coupons.status` | `AVAILABLE` / `USED` / `EXPIRED` | 可用 / 已使用 / 已過期 |
| `UserStatus` | `users.status` | `ACTIVE` / `SUSPENDED` | 啟用 / 停用 |
| `SelectionType` | `option_groups.selection_type` | `SINGLE` / `MULTIPLE` | 單選 / 複選 |
| `ProductTag` | `products.tags[]` | `HOT` | 熱銷 |
| | | `NEW` | 新品 |
| | | `CHEF_PICK` | 店長推薦 |
| | | `SPICY` | 辣 |
| | | `VEGETARIAN` | 素食 |
| | | `LIMITED` | 限量 |
| `Allergen` | `products.allergens[]` | `CRUSTACEAN` `MOLLUSC` `PEANUT` `MILK` `EGG` `TREE_NUT` `SESAME` `GLUTEN` `SOY` `FISH` `MANGO` `SULFITE` | 甲殼類、軟體動物、花生、乳製品、蛋、堅果、芝麻、含麩質穀物、大豆、魚類、芒果、亞硫酸鹽 |
| `PaymentFailureCode`（系統值） | `payments.failure_code` | `SUPERSEDED` / `ORDER_CANCELLED` / `EXPIRED` | 被新付款嘗試取代 / 訂單已取消 / 付款逾時（其餘為金流供應商代碼）；晚到的成功回呼使交易由 `FAILED` 改記 `SUCCESS` 時，原值保留作為稽核線索（§5.4 `payments`） |
| `MenuLayout` | `store_settings.menu_layout` | `AUTO` / `GRID` / `LIST` | 自動 / 圖卡 / 清單 |
| `OperatorType` | `orders.cancelled_by`、`order_status_logs.operator_type` | `CUSTOMER` / `STORE` / `SYSTEM` | 顧客 / 店家 / 系統 |
| `SpecialDayType` | `store_special_days.day_type` | `CLOSED` / `SPECIAL_HOURS` | 公休 / 特殊營業時間 |
| `BannerLinkType` | `banners.link_type` | `NONE` `PRODUCT` `CATEGORY` `URL` | 無 / 商品 / 分類 / 外部連結 |
| `PointTxType` | `point_transactions.tx_type` | `EARN` `REDEEM` `EXPIRE` `ADJUST` | 累積 / 折抵 / 到期 / 調整 |

**非資料表欄位的衍生列舉（API 回傳用）**

| 列舉 | 值 | 說明 |
| --- | --- | --- |
| `StoreStatus` | `OPEN` `CLOSED` `PAUSED` | 由 [FLOW-02](./02-flows.md#flow-02-店家營業狀態判定) 計算，不落庫 |
| `ClosedReason` | `OUT_OF_HOURS` `HOLIDAY` `LAST_ORDER_PASSED` | 同上 |

> `Allergen` 清單參考衛福部食藥署過敏原標示公告；實際上線前請依最新法規核對。

---

## 4. 資料表總覽

「PII」欄標示含個人資料之表（需存取控管與遮罩，見 §7）。

| # | 資料表 | 領域 | 階段 | 說明 | PII |
| --- | --- | --- | --- | --- | --- |
| 1 | `stores` | 店家 | P1 | 店家主檔 | — |
| 2 | `store_settings` | 店家 | P1 | 營運設定（1:1） | — |
| 3 | `store_business_hours` | 店家 | P1 | 每週營業時段 | — |
| 4 | `store_special_days` | 店家 | P1 | 特殊公休 / 特殊營業時間 | — |
| 5 | `store_tables` | 店家 | P1 | 內用桌位與 QR 權杖 | — |
| 6 | `delivery_zones` | 店家 | P1 | 外送行政區、運費與門檻 | — |
| 7 | `store_payment_methods` | 店家 | P1 | 店家啟用的付款方式 | — |
| 8 | `banners` | 店家 | P1 | 首頁 Banner | — |
| 9 | `categories` | 菜單 | P1 | 商品分類 | — |
| 10 | `products` | 菜單 | P1 | 商品 | — |
| 11 | `option_groups` | 菜單 | P1 | 選項群組（可跨商品共用） | — |
| 12 | `options` | 菜單 | P1 | 選項 | — |
| 13 | `product_option_groups` | 菜單 | P1 | 商品與選項群組關聯 | — |
| 14 | `users` | 會員 | P1 | 會員 | ✔ |
| 15 | `user_addresses` | 會員 | P1 | 地址簿 | ✔ |
| 16 | `favorites` | 會員 | P1 | 我的最愛 | — |
| 17 | `orders` | 訂單 | P1 | 訂單主檔 | ✔ |
| 18 | `order_items` | 訂單 | P1 | 訂單品項（快照） | — |
| 19 | `order_item_options` | 訂單 | P1 | 品項選項（快照） | — |
| 20 | `order_status_logs` | 訂單 | P1 | 狀態異動紀錄 | — |
| 21 | `payments` | 訂單 | P1 | 付款交易 | — |
| 22 | `order_invoices` | 訂單 | P1 | 發票資訊（1:1） | ✔ |
| 23 | `coupons` | 行銷 | P1 | 優惠券 / 折扣碼定義 | — |
| 24 | `user_coupons` | 行銷 | P1 | 會員持有與使用紀錄 | — |
| 25 | `reviews` | 行銷 | P2 | 訂單評價 | ✔ |
| 26 | `point_transactions` | 行銷 | P2 | 點數異動 | — |

---

## 5. 欄位字典

欄位表格式：**鍵** `PK` 主鍵、`FK` 外鍵、`UK` 唯一、`IX` 一般索引。Null 欄「N」＝不可為空。

### 5.1 店家與營運

#### `stores` 店家

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | 店家 ID |
| `slug` | VARCHAR(50) | N | — | UK | URL 識別，例 `demo-snack` |
| `name` | VARCHAR(50) | N | — | | 店名 |
| `tagline` | VARCHAR(100) | Y | NULL | | 一句話簡介 |
| `description` | TEXT | Y | NULL | | 店家介紹 |
| `logo_url` | VARCHAR(500) | Y | NULL | | Logo |
| `cover_url` | VARCHAR(500) | Y | NULL | | 封面圖 |
| `brand_color` | CHAR(7) | Y | NULL | | 品牌主題色 `#RRGGBB`；`NULL` 使用系統預設 `#D93A22`。前端據此推導整組主題代幣並保護文字對比（03 §4.8） |
| `phone` | VARCHAR(20) | N | — | | 店家電話 |
| `email` | VARCHAR(100) | Y | NULL | | 聯絡 Email |
| `city` | VARCHAR(10) | N | — | | 縣市 |
| `district` | VARCHAR(10) | N | — | | 鄉鎮市區 |
| `zip_code` | CHAR(3) | N | — | | 郵遞區號（3 碼） |
| `address_line` | VARCHAR(100) | N | — | | 路街巷弄號樓 |
| `latitude` | DECIMAL(9,6) | Y | NULL | | 緯度 |
| `longitude` | DECIMAL(9,6) | Y | NULL | | 經度 |
| `announcement` | VARCHAR(200) | Y | NULL | | 店家公告 |
| `timezone` | VARCHAR(40) | N | `'Asia/Taipei'` | | IANA 時區 |
| `is_active` | BOOL | N | TRUE | | 是否對外營運 |
| `deleted_at` | TS | Y | NULL | | 軟刪除 |

#### `store_settings` 營運設定（與 `stores` 1:1）

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `store_id` | ID | N | — | PK, FK→`stores.id` | |
| `is_accepting_orders` | BOOL | N | TRUE | | `FALSE` = 暫停接單（`PAUSED`），期間不接受任何新訂單（含預約） |
| `paused_until` | TS | Y | NULL | | 預計恢復接單時間；到達後自動視為恢復。`is_accepting_orders=FALSE` 且為 `NULL` = 手動暫停，需人工恢復 |
| `allow_pickup` | BOOL | N | TRUE | | 開放自取 |
| `allow_delivery` | BOOL | N | TRUE | | 開放外送 |
| `allow_dine_in` | BOOL | N | FALSE | | 開放內用（QR 帶入桌號或手動選內用；桌號選填，BR-22） |
| `pickup_lead_minutes` | SMALLINT UNSIGNED | N | 15 | | 自取前置分鐘（BR-08） |
| `delivery_lead_minutes` | SMALLINT UNSIGNED | N | 40 | | 外送預設前置分鐘；配送區 `delivery_zones.estimated_minutes` 缺值時使用（BR-08；預約單接單期限的前置分鐘同此規則，§6.4） |
| `slot_interval_minutes` | SMALLINT UNSIGNED | N | 15 | | 預約時段間隔 |
| `max_advance_days` | TINYINT UNSIGNED | N | 1 | | 可預約天數（今日起算） |
| `max_orders_per_slot` | SMALLINT UNSIGNED | Y | 8 | | 單時段訂單上限；`NULL` = 不限 |
| `last_order_offset_minutes` | SMALLINT UNSIGNED | N | 15 | | 打烊前幾分鐘停止接單 |
| `min_order_amount` | MONEY | N | 0 | | 自取 / 內用最低消費 |
| `payment_timeout_minutes` | TINYINT UNSIGNED | N | 15 | | 付款逾時（BR-17） |
| `accept_timeout_minutes` | TINYINT UNSIGNED | N | 10 | | 店家未接單逾時（分鐘）；自 `orders.pending_at` 起算（BR-17），預約單的算式見 §6.4 |
| `menu_layout` | ENUM(10) | N | `'AUTO'` | | `MenuLayout`：`AUTO` 依有圖商品比例決定、`GRID` 圖卡、`LIST` 清單（BR-31） |

#### `store_business_hours` 每週營業時段

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `store_id` | ID | N | — | FK→`stores.id` | |
| `weekday` | TINYINT UNSIGNED | N | — | | 0–6，**0 = 週日**（與 JS `Date.getDay()` 一致） |
| `open_time` | TIME | N | — | | 開始營業 |
| `close_time` | TIME | N | — | | 結束營業；`≤ open_time` 表示跨午夜（BR-23） |

唯一鍵：`UK(store_id, weekday, open_time)`。一天可有多筆（午市、晚市）；某天無資料 = 當日公休。

#### `store_special_days` 特殊日

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `store_id` | ID | N | — | FK | |
| `special_date` | DATE | N | — | IX | 日期（店家時區） |
| `day_type` | ENUM(20) | N | — | | `SpecialDayType` |
| `open_time` | TIME | Y | NULL | | `SPECIAL_HOURS` 必填 |
| `close_time` | TIME | Y | NULL | | `SPECIAL_HOURS` 必填 |
| `note` | VARCHAR(100) | Y | NULL | | 例：國定假日公休 |

規則：`CLOSED` 全日公休；`SPECIAL_HOURS` 可有多筆，**覆蓋**當日每週時段。索引：`IX(store_id, special_date)`。

#### `store_tables` 內用桌位

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `store_id` | ID | N | — | FK | |
| `table_no` | VARCHAR(10) | N | — | | 桌號，如 `A3` |
| `qr_token` | VARCHAR(64) | N | — | UK | QR Code 內嵌權杖（不可猜測） |
| `seats` | TINYINT UNSIGNED | Y | NULL | | 座位數 |
| `is_active` | BOOL | N | TRUE | | |

唯一鍵：`UK(store_id, table_no)`。

訂單不強制引用桌位：內用桌號為選填（BR-22），沒有桌號的內用單不參照本表（`orders.table_id`、`orders.table_no` 皆為 `NULL`）。

#### `delivery_zones` 外送範圍

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `store_id` | ID | N | — | FK | |
| `city` | VARCHAR(10) | N | — | | 縣市 |
| `district` | VARCHAR(10) | N | — | | 行政區 |
| `zip_code` | CHAR(3) | N | — | | 郵遞區號（比對鍵） |
| `delivery_fee` | MONEY | N | 0 | | 運費（BR-03） |
| `min_order_amount` | MONEY | N | 0 | | 外送最低消費（BR-04） |
| `free_delivery_threshold` | MONEY | Y | NULL | | 免運門檻；`NULL` = 不提供免運 |
| `estimated_minutes` | SMALLINT UNSIGNED | Y | NULL | | 預估外送分鐘，覆蓋店家預設 |
| `is_active` | BOOL | N | TRUE | | |

唯一鍵：`UK(store_id, zip_code)`。

#### `store_payment_methods` 店家付款方式

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `store_id` | ID | N | — | FK | |
| `method` | ENUM(20) | N | — | | `PaymentMethod` |
| `is_enabled` | BOOL | N | TRUE | | |
| `sort_order` | SMALLINT | N | 0 | | 顯示順序 |

唯一鍵：`UK(store_id, method)`。

#### `banners` 首頁 Banner

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `store_id` | ID | N | — | FK | |
| `title` | VARCHAR(50) | N | — | | 標題（亦作 `alt`） |
| `image_url` | VARCHAR(500) | N | — | | 圖片網址 |
| `link_type` | ENUM(20) | N | `'NONE'` | | `BannerLinkType` |
| `link_value` | VARCHAR(200) | Y | NULL | | 商品 ID / 分類 ID / 網址 |
| `sort_order` | SMALLINT | N | 0 | | |
| `starts_at` | TS | Y | NULL | | 起始時間；`NULL` = 立即 |
| `ends_at` | TS | Y | NULL | | 結束時間；`NULL` = 無期限 |
| `is_active` | BOOL | N | TRUE | | |

### 5.2 菜單與商品

#### `categories` 分類

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `store_id` | ID | N | — | FK, IX | |
| `name` | VARCHAR(30) | N | — | | 分類名稱 |
| `description` | VARCHAR(100) | Y | NULL | | |
| `icon` | VARCHAR(30) | Y | NULL | | 分類圖示（emoji 或圖示代碼）；商品無圖時作為佔位圖的圖示，亦用於分類導覽 |
| `sort_order` | INT | N | 0 | | 顯示順序 |
| `is_visible` | BOOL | N | TRUE | | 是否顯示於菜單 |
| `deleted_at` | TS | Y | NULL | | 軟刪除 |

> 「熱銷」為前端依 `products.tags` 含 `HOT` 產生的**虛擬分類**，不存於此表（FR-MN-05）。

#### `products` 商品

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `store_id` | ID | N | — | FK, IX | |
| `category_id` | ID | N | — | FK→`categories.id`, IX | |
| `name` | VARCHAR(50) | N | — | | 商品名稱 |
| `description` | VARCHAR(300) | Y | NULL | | 簡述；可為空 |
| `image_url` | VARCHAR(500) | Y | NULL | | 圖片；**可為空**，無圖時以分類圖示佔位（03 §6.7） |
| `base_price` | MONEY | N | — | | 基本價（最低價，選項另計加價） |
| `tags` | JSON | N | `[]` | | `ProductTag[]` |
| `allergens` | JSON | N | `[]` | | `Allergen[]` |
| `is_listed` | BOOL | N | TRUE | | 上架 / 下架（下架者不出現在菜單） |
| `is_sold_out` | BOOL | N | FALSE | | 今日售完（店家手動旗標）；**僅約束當前營業日**，不阻擋預約至其他營業日的訂單；當日最後一個營業時段結束後自動重置（Q-12） |
| `daily_limit` | SMALLINT UNSIGNED | Y | NULL | | 每日限量（依**取餐營業日**計，BR-40）；`NULL` = 不限 |
| `sort_order` | INT | N | 0 | | 分類內順序 |
| `deleted_at` | TS | Y | NULL | | 軟刪除 |

> 取餐營業日 `d` 的剩餘份數 `remaining(d) = max(0, daily_limit − consumed)`；`consumed` 為同店、`orders.business_date = d`、屬計入集合（§6.4）的訂單中，該商品 `order_items.quantity` 的加總。由查詢計算，不另存欄位（D-08、BR-11、BR-38）；`daily_limit IS NULL` 代表不限。菜單的 `remainingToday` 取當前營業日的 `remaining`；店家將 `daily_limit` 調降至低於已售份數時，`remaining` 夾為 0，既有訂單不受影響。
>
> `is_sold_out` 為手動旗標，與 `remaining` 為 OR 關係（任一為真即不可購買），**僅約束當前營業日**：預約至其他營業日的訂單不受今日旗標阻擋，該營業日的限量由其自己的 `remaining` 判斷（BR-40）。加入購物車仍以今日剩餘保守判斷（BR-11），結帳 `quote` 才依 `scheduledAt` 的取餐營業日計算。
>
> **最小商品**：只有 `name`、`base_price`、`category_id` 為必要資訊；`description`、`image_url`、`tags`、`allergens`、選項群組皆可為空。缺少這些資料**不得**阻擋上架或下單（FR-MN-10、FR-PD-08）。

#### `option_groups` 選項群組

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `store_id` | ID | N | — | FK | |
| `name` | VARCHAR(30) | N | — | | 例：份量、辣度、加料、甜度 |
| `selection_type` | ENUM(10) | N | — | | `SINGLE` / `MULTIPLE` |
| `min_select` | TINYINT UNSIGNED | N | 0 | | 最少選取數；`≥ 1` 即為「必選」 |
| `max_select` | TINYINT UNSIGNED | N | 1 | | 最多選取數；`SINGLE` 固定為 1 |
| `deleted_at` | TS | Y | NULL | | 軟刪除 |

約束：`min_select ≤ max_select`；`SINGLE` 時 `max_select = 1` 且 `min_select ∈ {0,1}`。API 的 `required` 由 `min_select ≥ 1` 推導。

#### `options` 選項

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `option_group_id` | ID | N | — | FK→`option_groups.id`, IX | |
| `name` | VARCHAR(30) | N | — | | 例：大碗、小辣、滷蛋 |
| `price_delta` | INT | N | 0 | | 加價（可為負） |
| `is_default` | BOOL | N | FALSE | | 預設勾選 |
| `is_available` | BOOL | N | TRUE | | 是否供應（售完時 `FALSE`） |
| `sort_order` | INT | N | 0 | | |

#### `product_option_groups` 商品 ↔ 選項群組

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `product_id` | ID | N | — | PK, FK→`products.id` | |
| `option_group_id` | ID | N | — | PK, FK→`option_groups.id` | |
| `sort_order` | INT | N | 0 | | 群組於該商品中的順序 |

> 無 `updated_at`；僅 `created_at`。

### 5.3 會員

#### `users` 會員（PII）

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `phone` | VARCHAR(10) | N | — | UK | 手機（登入帳號），`^09\d{8}$` |
| `name` | VARCHAR(20) | Y | NULL | | 顯示名稱 |
| `email` | VARCHAR(100) | Y | NULL | | |
| `status` | ENUM(20) | N | `'ACTIVE'` | | `UserStatus` |
| `marketing_opt_in` | BOOL | N | FALSE | | 同意接收行銷訊息 |
| `phone_verified_at` | TS | Y | NULL | | OTP 驗證時間 |
| `last_login_at` | TS | Y | NULL | | |
| `deleted_at` | TS | Y | NULL | | 軟刪除（帳號刪除後去識別化，見 §7） |

#### `user_addresses` 地址簿（PII）

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `user_id` | ID | N | — | FK→`users.id`, IX | |
| `label` | VARCHAR(10) | N | `'家'` | | 家 / 公司 / 其他 |
| `recipient_name` | VARCHAR(20) | N | — | | 收件人 |
| `recipient_phone` | VARCHAR(10) | N | — | | 收件手機 |
| `city` | VARCHAR(10) | N | — | | |
| `district` | VARCHAR(10) | N | — | | |
| `zip_code` | CHAR(3) | N | — | | |
| `address_line` | VARCHAR(100) | N | — | | |
| `note` | VARCHAR(50) | Y | NULL | | 例：管理室代收 |
| `is_default` | BOOL | N | FALSE | | 每位會員至多一筆為 `TRUE` |

#### `favorites` 我的最愛

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `user_id` | ID | N | — | PK, FK→`users.id` | |
| `product_id` | ID | N | — | PK, FK→`products.id` | |
| `created_at` | TS | N | now | | 收藏時間 |

### 5.4 訂單與付款

#### `orders` 訂單（PII）

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `order_no` | VARCHAR(20) | N | — | UK | `ZO` + yyMMdd + 6 碼隨機，BR-14 |
| `store_id` | ID | N | — | FK, IX | |
| `user_id` | ID | Y | NULL | FK→`users.id`, IX | `NULL` = 訪客訂單 |
| `order_type` | ENUM(20) | N | — | | `OrderType` |
| `status` | ENUM(20) | N | — | IX | `OrderStatus` |
| `payment_status` | ENUM(20) | N | `'UNPAID'` | | `PaymentStatus` |
| `payment_method` | ENUM(20) | N | — | | `PaymentMethod` |
| `business_date` | DATE | N | — | IX | **取餐 / 送達所屬營業日**（BR-23、BR-40）：即時單為下單當下所處的營業日；預約單為 `scheduled_at` 所屬營業日；跨午夜時段歸屬開始營業的那一日。限量歸屬與取餐號碼序號皆以此欄為準，不是下單日 |
| `pickup_no` | VARCHAR(8) | N | — | | 取餐號碼，如 `A027`：前綴（A 自取、D 外送、T 內用，BR-14）+ 3 碼序號；序號鍵見下方「取餐號碼序號」 |
| `customer_name` | VARCHAR(20) | Y | NULL | | 聯絡姓名（內用可為空）；PII |
| `customer_phone` | VARCHAR(10) | Y | NULL | IX | 聯絡手機（內用可為空）；PII |
| `scheduled_at` | TS | Y | NULL | | 預約時間；`NULL` = 即時單 |
| `estimated_ready_at` | TS | Y | NULL | | 預估完成時間（接單時更新） |
| `table_id` | ID | Y | NULL | FK→`store_tables.id` | 內用且有提供桌號（或 QR 權杖）時的桌位；沒有桌號的內用單與非內用單為 `NULL` |
| `table_no` | VARCHAR(10) | Y | NULL | | 桌號快照（可為空）：僅在有提供桌號時寫入建單當下 `store_tables.table_no` 的值；內用**不強制**桌號（BR-22），沒有桌號的內用單與非內用單為 `NULL`；叫號與領餐以 `pickup_no` 識別 |
| `delivery_city` | VARCHAR(10) | Y | NULL | | 外送地址快照；PII |
| `delivery_district` | VARCHAR(10) | Y | NULL | | |
| `delivery_zip_code` | CHAR(3) | Y | NULL | | |
| `delivery_address_line` | VARCHAR(100) | Y | NULL | | PII |
| `delivery_note` | VARCHAR(50) | Y | NULL | | 外送備註 |
| `subtotal_amount` | MONEY | N | — | | 折扣前小計 |
| `delivery_fee` | MONEY | N | 0 | | 運費 |
| `discount_amount` | MONEY | N | 0 | | 折扣金額（正數） |
| `total_amount` | MONEY | N | — | | 應付總額 |
| `coupon_id` | ID | Y | NULL | FK→`coupons.id` | |
| `coupon_code` | VARCHAR(20) | Y | NULL | | 折扣碼快照 |
| `need_utensils` | BOOL | N | FALSE | | 是否需要餐具（BR-26） |
| `note` | VARCHAR(100) | Y | NULL | | 整單備註 |
| `marketing_opt_in` | BOOL | N | FALSE | | 下單時是否勾選接收行銷訊息（同意紀錄快照；會員同時同步至 `users.marketing_opt_in`） |
| `cancelled_by` | ENUM(20) | Y | NULL | | `OperatorType` |
| `cancel_reason` | VARCHAR(100) | Y | NULL | | 取消原因 |
| `placed_at` | TS | N | now | IX | 下單時間 |
| `payment_expires_at` | TS | Y | NULL | | 付款期限（線上付款訂單於 `PENDING_PAYMENT` 時必有值，見下方 CHECK）；以資料庫時鐘寫入，到期當下即不計入已售與時段已訂數（§6.4） |
| `pending_at` | TS | Y | NULL | | 進入 `PENDING`（待店家確認）的時間，**接單期限的起算點**（BR-17）：現金單 = 建單時間（等於 `placed_at`）；線上付款單 = 付款成功或改用現金的時間，與該次條件式狀態轉換在同一條 `UPDATE` 以資料庫時鐘寫入（§6.3）。`PENDING_PAYMENT` 期間，以及未曾進入 `PENDING` 即被取消者為 `NULL`。接單期限本身不儲存，由此欄與店家設定推導（§6.4）；API 的 `acceptBy`（僅 `PENDING` 有值）即此推導值 |
| `accepted_at` | TS | Y | NULL | | 接單時間 |
| `ready_at` | TS | Y | NULL | | 出餐時間 |
| `completed_at` | TS | Y | NULL | | 完成時間 |
| `cancelled_at` | TS | Y | NULL | | 取消時間 |
| `idempotency_key` | VARCHAR(64) | Y | NULL | | 冪等鍵（BR-27）；以 `UK(store_id, idempotency_key)` 綁定，不隨時間清除（見下方 UK 說明） |
| `idempotency_request_hash` | CHAR(64) | Y | NULL | | 請求指紋：SHA-256（正規化請求，**排除** `expectedTotal`；`optionIds` 排序、備註去前後空白、`items` 順序保留）的十六進位字串，供 `IDEMPOTENCY_CONFLICT` 比對（BR-27）；與 `idempotency_key` 同時寫入；亦可改採以伺服器祕密為鍵的 HMAC-SHA-256（同為 64 字元）。屬衍生個資，去識別化時置 `NULL`（§7.2）；為 `NULL` 時視為內容相同、不比對指紋 |
| `tracking_token_hash` | CHAR(64) | Y | NULL | | 訪客追蹤權杖的 SHA-256；明文不落庫，僅於簽發當次的回應回傳（建立訂單、冪等重放、`GET /orders/lookup`）。每次簽發即覆寫此雜湊，**僅最後一次簽發的權杖有效**，先前簽發者失效（BR-27）；同一 Key 並行的多個回應，或另一裝置換發新權杖時，皆以最後簽發者為準，持舊權杖者以 `lookup` 重取（06 §1.4、§5.12） |

約束與索引：

- `UK(order_no)`。
- `UK(store_id, business_date, pickup_no)`：取餐號碼不重複；序號鍵見下方「取餐號碼序號」。
- `UK(store_id, idempotency_key)`（`NULL` 不衝突）：冪等鍵**不隨時間清除**，隨訂單存續、不另設清除排程；契約保證**重放有效期 ≥ 24 小時**（BR-27；06 §1.4 的「24 小時」是保證的下限，不是清除時點）。並行同 Key 由店家建單互斥鎖序列化（§6.3），此唯一鍵為最後防線：衝突時轉為重放並比對 `idempotency_request_hash`（相同回傳原訂單；不同回 `409 IDEMPOTENCY_CONFLICT`），不得回 500。
- `CHECK (total_amount = subtotal_amount + delivery_fee - discount_amount)`。
- `CHECK (order_type <> 'DELIVERY' OR delivery_address_line IS NOT NULL)`。
- **內用不設桌號必填約束**（BR-22、01 Q-17）：v0.4.1 起移除 `CHECK (order_type <> 'DINE_IN' OR table_no IS NOT NULL)`；`table_no`、`table_id` 恆可為 `NULL`。有提供桌號時由應用層（建單交易的驗證階段）確認為店家桌位並寫入快照，沒有提供則不檢查、兩欄皆為 `NULL`。
- `CHECK (status <> 'PENDING_PAYMENT' OR payment_expires_at IS NOT NULL)`；`CHECK (status <> 'PENDING' OR pending_at IS NOT NULL)`：付款逾時與接單逾時的條件式更新以 `<=` 比較期限，對 `NULL` 不命中，缺值的訂單會永久占用限量與時段，因此以約束擋下；對帳 3、4 另列此類資料作為最後防線（§6.4）。
- `IX(user_id, placed_at DESC)`（歷史訂單）、`IX(store_id, status, placed_at)`（店家看板）、`IX(customer_phone)`（訪客查詢）、`IX(status, payment_expires_at)`（付款逾時掃描與建單鎖內結算）、`IX(status, pending_at)`（接單逾時掃描與對帳，BR-17）。
- `IX(store_id, business_date, status)`：限量商品已售份數加總（§6.4）。
- `IX(store_id, scheduled_at, status)`：時段已訂數，僅統計計入集合（§6.4）；**取代**舊的 `IX(store_id, scheduled_at)`。

**取餐號碼序號**：`pickup_no = 前綴 + 3 碼序號`（BR-14）。序號以 `(store_id, business_date, 前綴)` 為鍵，於建單交易的店家互斥鎖內取該組合目前最大序號 + 1（§6.3），`UK(store_id, business_date, pickup_no)` 為兜底。因 `business_date` 為取餐營業日，今日下的隔日預約單使用**隔日**營業日的序號，不佔用今日序號，也不會與隔日的即時單重號：隔日尚無自取單時，該預約單即為隔日 `A001`，隔日第一張即時自取單接續為 `A002`。契約測試的斷言為：今日下的隔日預約單取得明日序號（可為明日 `A001`），今日下一張 `A` 序號不受影響；明日第一張即時單為 `A002` 且不重號。Mock 的他人訂單注入單使用前綴 `X`（僅 Demo，見 08 §8），自成一組計數，不影響 A / D / T 的序號。

#### `order_items` 訂單品項

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `order_id` | ID | N | — | FK→`orders.id`, IX | |
| `product_id` | ID | Y | NULL | FK→`products.id`, IX | 商品被刪除時為 `NULL`（快照仍保留） |
| `product_name` | VARCHAR(50) | N | — | | 品名快照 |
| `base_price` | MONEY | N | — | | 基本價快照 |
| `options_price` | INT | N | 0 | | 選項加價合計（單份） |
| `quantity` | SMALLINT UNSIGNED | N | — | | 數量 |
| `line_total` | MONEY | N | — | | `(base_price + options_price) × quantity` |
| `note` | VARCHAR(50) | Y | NULL | | 品項備註 |
| `sort_order` | SMALLINT | N | 0 | | |

索引：`IX(order_id)`、`IX(product_id, order_id)`（限量商品已售份數加總時與 `orders` 的 join，§6.4）。

#### `order_item_options` 品項選項快照

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `order_item_id` | ID | N | — | FK→`order_items.id`, IX | |
| `option_group_id` | ID | Y | NULL | | 來源群組（僅供參考，無 FK） |
| `option_group_name` | VARCHAR(30) | N | — | | 群組名稱快照 |
| `option_id` | ID | Y | NULL | | 來源選項 |
| `option_name` | VARCHAR(30) | N | — | | 選項名稱快照 |
| `price_delta` | INT | N | 0 | | 加價快照 |

> 追加型資料：僅 `created_at`，無 `updated_at`。

#### `order_status_logs` 狀態異動紀錄

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `order_id` | ID | N | — | FK→`orders.id`, IX | |
| `from_status` | ENUM(20) | Y | NULL | | 建立時為 `NULL` |
| `to_status` | ENUM(20) | N | — | | |
| `operator_type` | ENUM(20) | N | — | | `OperatorType` |
| `operator_id` | ID | Y | NULL | | 會員 ID 或店員 ID |
| `note` | VARCHAR(200) | Y | NULL | | 例：取消原因 |
| `created_at` | TS | N | now | | 異動時間 |

> 追加型資料：不可更新或刪除；每次 [FLOW-10](./02-flows.md#flow-10-訂單狀態機) 轉換必寫一筆。

#### `payments` 付款交易

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `order_id` | ID | N | — | FK→`orders.id`, IX | |
| `method` | ENUM(20) | N | — | | `PaymentMethod` |
| `provider` | VARCHAR(30) | Y | NULL | | 金流供應商代碼 |
| `amount` | MONEY | N | — | | 本次交易金額 |
| `status` | ENUM(20) | N | `'PENDING'` | IX | `PaymentTxnStatus`；轉換見下方說明 |
| `provider_txn_id` | VARCHAR(64) | Y | NULL | UK(`provider`,`provider_txn_id`) | 供應商交易序號；不同供應商的序號空間可能重疊，回呼一律以 `(provider, provider_txn_id)` 查交易 |
| `failure_code` | VARCHAR(30) | Y | NULL | | 失敗原因碼。系統值：`SUPERSEDED`（被新付款嘗試取代）、`ORDER_CANCELLED`（訂單已取消）、`EXPIRED`（付款逾時）；其餘為金流供應商代碼（BR-28）；晚到的成功回呼使交易改記 `SUCCESS` 時保留原值 |
| `failure_message` | VARCHAR(200) | Y | NULL | | |
| `paid_at` | TS | Y | NULL | | |
| `refunded_at` | TS | Y | NULL | | |
| `raw_response` | JSON | Y | NULL | | 供應商原始回應（除錯與對帳；不含完整卡號） |

> 交易狀態轉換：`PENDING → SUCCESS / FAILED`、`SUCCESS → REFUNDED`。**唯一例外**：已被作廢為 `FAILED`（`failure_code` 為 `SUPERSEDED` / `ORDER_CANCELLED` / `EXPIRED`）的交易，若其成功回呼晚到且 `(provider, provider_txn_id)` 對得上，依 §6.3 的處理順序改記為 `SUCCESS`（`FAILED → SUCCESS`）；`failure_code` 保留原值作為「晚到入帳」的稽核線索，`paid_at` 寫入回呼時間。同一 `(provider, provider_txn_id)` 已為 `SUCCESS` / `REFUNDED` 時，重複送達的回呼直接回 `200`，不再處理（BR-28 ④）；並行抵達的相同回呼以 §6.3 的交易層級閘門（`UPDATE payments SET status = 'SUCCESS' … WHERE id = ? AND status IN ('PENDING', 'FAILED')`）序列化，只有影響 1 列者才進入後續處理。

約束與索引：`UK(provider, provider_txn_id)`（`NULL` 不衝突：現金交易與尚未取得供應商序號的交易）、`IX(order_id)`、`IX(status)`。

#### `order_invoices` 發票資訊（與 `orders` 1:1，PII）

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `order_id` | ID | N | — | PK, FK→`orders.id` | |
| `invoice_type` | ENUM(20) | N | — | | `InvoiceType` |
| `carrier_code` | VARCHAR(20) | Y | NULL | | 手機條碼 `/ABC1234` 或自然人憑證條碼 |
| `tax_id` | CHAR(8) | Y | NULL | | 統一編號（`COMPANY`） |
| `buyer_name` | VARCHAR(60) | Y | NULL | | 買受人抬頭（選填） |
| `donate_code` | VARCHAR(7) | Y | NULL | | 愛心碼（`DONATION`） |
| `status` | ENUM(20) | N | `'PENDING'` | | `InvoiceStatus` |
| `invoice_no` | VARCHAR(10) | Y | NULL | IX | 發票號碼，如 `AB12345678` |
| `random_code` | CHAR(4) | Y | NULL | | 隨機碼 |
| `issued_at` | TS | Y | NULL | | 開立時間 |

欄位必填條件：`MOBILE_BARCODE`/`CITIZEN_CERT` 需 `carrier_code`；`DONATION` 需 `donate_code`；`COMPANY` 需 `tax_id`。格式驗證見 [VR-11～14](./01-requirements.md#7-資料驗證規則)。

### 5.5 行銷與互動

#### `coupons` 優惠券 / 折扣碼

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `store_id` | ID | N | — | FK | |
| `code` | VARCHAR(20) | N | — | UK(`store_id`,`code`) | 折扣碼，大寫英數 |
| `name` | VARCHAR(50) | N | — | | 顯示名稱 |
| `description` | VARCHAR(200) | Y | NULL | | 條件說明 |
| `discount_type` | ENUM(20) | N | — | | `DiscountType` |
| `discount_value` | INT UNSIGNED | N | 0 | | `PERCENT`：1–100；`FIXED_AMOUNT`：元；`FREE_DELIVERY`：0 |
| `max_discount_amount` | MONEY | Y | NULL | | 百分比折扣上限 |
| `min_order_amount` | MONEY | N | 0 | | 最低消費（以折扣前小計判斷） |
| `applicable_order_types` | JSON | N | 全部 | | `OrderType[]` |
| `member_only` | BOOL | N | FALSE | | 僅限會員 |
| `total_quota` | INT UNSIGNED | Y | NULL | | 總發行量；`NULL` = 不限 |
| `used_count` | INT UNSIGNED | N | 0 | | 已使用次數（訂單取消時返還 −1，BR-29） |
| `per_user_limit` | SMALLINT UNSIGNED | Y | 1 | | 每人可用次數；`NULL` = 不限 |
| `starts_at` | TS | N | — | | 生效時間 |
| `ends_at` | TS | N | — | | 失效時間 |
| `is_active` | BOOL | N | TRUE | | |

#### `user_coupons` 會員優惠券

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `user_id` | ID | N | — | FK→`users.id` | |
| `coupon_id` | ID | N | — | FK→`coupons.id` | |
| `status` | ENUM(20) | N | `'AVAILABLE'` | | `UserCouponStatus` |
| `claimed_at` | TS | N | now | | 領取（或首次使用）時間 |
| `used_at` | TS | Y | NULL | | 使用時間 |
| `order_id` | ID | Y | NULL | FK→`orders.id` | 使用於哪張訂單 |

索引：`IX(user_id, status)`、`IX(coupon_id)`。

#### `reviews` 訂單評價（P2，PII）

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `order_id` | ID | N | — | UK, FK→`orders.id` | 一單一評 |
| `store_id` | ID | N | — | FK | |
| `user_id` | ID | N | — | FK→`users.id` | 僅會員可評 |
| `rating` | TINYINT UNSIGNED | N | — | | 1–5 |
| `comment` | VARCHAR(500) | Y | NULL | | |
| `store_reply` | VARCHAR(500) | Y | NULL | | 店家回覆 |
| `replied_at` | TS | Y | NULL | | |
| `is_visible` | BOOL | N | TRUE | | |

#### `point_transactions` 點數異動（P2）

| 欄位 | 型別 | Null | 預設 | 鍵 | 說明 |
| --- | --- | --- | --- | --- | --- |
| `id` | ID | N | — | PK | |
| `user_id` | ID | N | — | FK→`users.id`, IX | |
| `order_id` | ID | Y | NULL | FK→`orders.id` | |
| `tx_type` | ENUM(20) | N | — | | `PointTxType` |
| `points` | INT | N | — | | 有號：累積為正、折抵 / 到期為負 |
| `balance_after` | INT UNSIGNED | N | — | | 異動後餘額 |
| `expires_at` | TS | Y | NULL | | 此筆點數到期日 |
| `note` | VARCHAR(100) | Y | NULL | | |
| `created_at` | TS | N | now | | |

> 追加型資料：僅 `created_at`。

---

## 6. 外鍵動作與索引摘要

### 6.1 外鍵刪除規則

| 子表.欄位 | 父表 | `ON DELETE` | 理由 |
| --- | --- | --- | --- |
| 營運類（`store_settings`、`store_business_hours`、…）`.store_id` | `stores` | `RESTRICT` | 店家採軟刪除 |
| `products.category_id` | `categories` | `RESTRICT` | 分類下有商品不可刪 |
| `options.option_group_id` | `option_groups` | `CASCADE` | 選項隸屬群組 |
| `product_option_groups.*` | `products` / `option_groups` | `CASCADE` | 純關聯表 |
| `user_addresses.user_id`、`favorites.user_id`、`user_coupons.user_id` | `users` | `CASCADE` | 帳號刪除時一併清除 |
| `orders.user_id` | `users` | `SET NULL` | 保留訂單並去識別化 |
| `orders.table_id`、`orders.coupon_id` | `store_tables` / `coupons` | `SET NULL` | 訂單有快照 |
| `order_items.order_id`、`order_status_logs.order_id` | `orders` | `CASCADE` | 隨訂單 |
| `order_items.product_id`、`order_item_options.option_id` | `products` / `options` | `SET NULL` | 保留快照 |
| `payments.order_id`、`order_invoices.order_id` | `orders` | `RESTRICT` | 財務紀錄不得連帶刪除 |

### 6.2 主要查詢與索引

| 查詢情境 | 索引 |
| --- | --- |
| 載入菜單（分類 + 商品） | `categories(store_id, sort_order)`、`products(store_id, category_id, sort_order)` |
| 取店家營業時間 | `store_business_hours(store_id, weekday)`、`store_special_days(store_id, special_date)` |
| 限量商品已售份數（取餐營業日） | `orders(store_id, business_date, status)`、`order_items(product_id, order_id)`（join 後 `SUM(quantity)`，僅統計計入集合，§6.4） |
| 計算時段已訂數 | `orders(store_id, scheduled_at, status)`（取代舊的 `(store_id, scheduled_at)`；僅統計計入集合，§6.4） |
| 會員歷史訂單 | `orders(user_id, placed_at DESC)` |
| 訪客查詢 | `orders(order_no)` UK + `orders(customer_phone)` |
| 付款逾時掃描與建單鎖內結算 | `orders(status, payment_expires_at)` |
| 接單逾時掃描與每日對帳（BR-17） | `orders(status, pending_at)`；店家看板另用 `orders(store_id, status, placed_at)` |
| 付款回呼查交易（BR-28 ④） | `payments(provider, provider_txn_id)` UK；交易層級閘門以 `payments.id`（PK）條件式更新（§6.3） |
| 折扣碼查詢 | `coupons(store_id, code)` UK |
| 會員常點（`GET /me/frequent-items`） | `orders(user_id, placed_at DESC)`、`order_items(order_id)`、`order_item_options(order_item_id)`；**不需新增資料表**，由近 180 天非取消訂單的快照推導 |
| 取餐號碼遞增 | `orders(store_id, business_date, pickup_no)` UK（序號以 `(store_id, business_date, 前綴)` 為鍵，§5.4） |

### 6.3 建單交易、鎖定與隔離

採「訂單即保留」（[04 D-08](./04-erd.md)）：不新增保留表或計數欄位，計入已售與時段已訂數的時點，就是 `POST /orders` 提交的那個交易。
本節規定後端建單的**最低要求**；語句為 MySQL 8 的參考寫法，PostgreSQL 以 `FOR UPDATE` / `FOR SHARE` 改寫，資料庫時鐘改用 `clock_timestamp()`（`now()` 為交易開始時間，與 MySQL 的 `NOW(3)` 不等價，見下方「時鐘」）。

**不變式**（任何並行情境皆須成立；計入集合見 §6.4）

| 編號 | 不變式 |
| --- | --- |
| I1 | 同店、同取餐營業日、同商品，計入集合內 `order_items.quantity` 的加總 ≤ `products.daily_limit`（限量商品）；店家事後調降限量低於已售時，剩餘份數夾為 0，既有訂單不受影響（BR-40、EC-38；對帳 1-a 與屬性測試的 I1 斷言同樣適用此例外） |
| I2 | 同店、同 `scheduled_at` 時段，計入集合內的預約單數 ≤ `store_settings.max_orders_per_slot`（非 `NULL` 時） |

**交易與鎖定要求**

| 項目 | 規範 |
| --- | --- |
| 隔離等級 | `READ COMMITTED`。若採 `REPEATABLE READ`，取得店家建單互斥鎖之前不得有一般（非鎖定）讀取，否則快照會在鎖前建立 |
| 店家建單互斥鎖 | 交易第一個鎖定語句為 `SELECT store_id FROM store_settings WHERE store_id = ? FOR UPDATE`；同店建單自此序列化，也使「暫停接單」等設定變更與建單線性化。**鎖後才計數與驗證**，不得沿用鎖前讀取的值 |
| 鎖序 | `store_settings` → `orders`（逾期結算）→ `products` → `options` → `coupons`（FLOW-22、06 §6.2 引用此鎖序）。`payments`、`user_coupons` 隨所屬 `orders` 列處理：先鎖定該訂單，再依序處理其 `payments` 與 `user_coupons`，不獨立成層級、不跨訂單交錯；`coupons.used_count` 的增減（含返還）一律排在最後，多筆依 `coupons.id` 升冪。取消、付款回呼、發起付款、改用現金與排程不取店家鎖，第一個資料庫動作一律為 `SELECT … FROM orders WHERE id = ? FOR UPDATE`（鎖定後才以條件判斷與條件式更新），再處理其 `payments`，相對順序與上列相同；**不得**以影響 0 列的條件式更新充當鎖（不符條件的列在 `READ COMMITTED` 下不持鎖，其後寫入 `payments` 會與建單鎖內結算的 `orders` → `payments` 順序相反而互等）。發起付款與改用現金須在同一交易內先鎖定該 `orders` 列，再作廢既有交易與建立新交易，避免與建單鎖內結算交錯而漏掉新交易 |
| 鎖內內容 | 只做資料庫讀寫，**禁止**呼叫金流、簡訊、發票或推播。逾期結算的狀態轉換與後處理（寫入 `order_status_logs`、作廢進行中的付款交易、返還優惠券）皆為資料庫操作，**必須在同一交易內完成**，不得留待排程補做；需要退款者交易內只寫入 `REFUNDING`，對金流的退款呼叫與通知店家一律在 `COMMIT` 之後（鎖外），外部副作用失敗不回復訂單。單店鎖內預期 < 30 ms |
| 鎖逾時與死結 | 等待互斥鎖逾時 5 秒 → 回 `503 SERVICE_UNAVAILABLE` 並附 `retryAfterSeconds`，不建立訂單、**不綁定** Key；死結由伺服器內部最多重試 2 次 |
| 時鐘 | 付款逾期與接單逾期的判斷，以及 `placed_at`、`payment_expires_at`、`pending_at` 的寫入，一律使用**資料庫時鐘**（MySQL 為 `NOW(3)`，語句開始時間），建單、付款回呼、改用現金與排程共用；不使用應用伺服器傳入的時間，避免時鐘偏差使兩邊對「是否逾期」判斷不一致。PostgreSQL 須使用 `clock_timestamp()`（或 `statement_timestamp()`），**不得**用 `now()`：它是交易開始時間，建單交易最多等鎖 5 秒，會使逾期判斷與 `placed_at`、`payment_expires_at` 偏早，與唯讀 `quote` 的判斷不一致 |
| 不查詢的情形 | `daily_limit IS NULL`（不限）的商品不查詢已售份數；`max_orders_per_slot IS NULL` 時不查詢時段已訂數 |

**建單交易（參考實作）**

```sql
-- 建單交易：冪等 → 互斥鎖 → 結算逾期待付款 → 計數 → 驗證 → 寫入
START TRANSACTION;   -- READ COMMITTED；鎖等待逾時 5 秒

-- ① 店家建單互斥鎖（同店建單序列化）
SELECT store_id, max_orders_per_slot, payment_timeout_minutes
  FROM store_settings WHERE store_id = :sid FOR UPDATE;

-- ② 鎖內查冪等鍵（並行同 Key 的第二個請求在此看見已提交訂單）
--    指紋相同 → 重放（回應前先對該訂單做逾期結算，見下方「重放的逾期結算」）；不同 → ROLLBACK 並回 409 IDEMPOTENCY_CONFLICT
SELECT id, idempotency_request_hash FROM orders
 WHERE store_id = :sid AND idempotency_key = :key;

-- ③ 結算逾期待付款：先於計數，且須寫入 CANCELLED（不得只在讀取時排除）
--    狀態轉換與後處理在同一交易內完成，不留待排程補做（排程呼叫同一函式，同樣於單一交易內完成）
--    ③-a 鎖定逾期待付款單；會等待在途的付款交易提交或回復，再以最新狀態判斷
SELECT id, coupon_id FROM orders
 WHERE store_id = :sid AND status = 'PENDING_PAYMENT' AND payment_expires_at <= NOW(3)
 ORDER BY id FOR UPDATE;
--    ③-b 逐筆條件式轉換；cancel_reason 於同一 UPDATE 寫入；影響 0 列者略過 ③-c（已被他方處理）
UPDATE orders
   SET status = 'CANCELLED', cancelled_by = 'SYSTEM', cancelled_at = NOW(3), cancel_reason = '付款逾時'
 WHERE id = :oid AND status = 'PENDING_PAYMENT' AND payment_expires_at <= NOW(3);
--    ③-c 後處理（僅對 ③-b 影響 1 列者；皆為資料庫操作）：
--        寫入 order_status_logs（PENDING_PAYMENT → CANCELLED，operator_type = SYSTEM）
--        作廢該單進行中的付款交易（payments：PENDING → FAILED，failure_code = 'EXPIRED'）
--        返還優惠券：user_coupons 於有效期內回復 AVAILABLE（否則 EXPIRED）；
--        coupons.used_count − 1 依鎖序留到 ⑧，與本單的增量一併處理

-- ④ 鎖後讀取商品與選項（驗證與快照使用同一份值）
SELECT id, is_listed, is_sold_out, daily_limit, base_price FROM products
 WHERE store_id = :sid AND id IN (:productIds) AND deleted_at IS NULL ORDER BY id FOR SHARE;
SELECT id, option_group_id, is_available, price_delta FROM options
 WHERE id IN (:optionIds) ORDER BY id FOR SHARE;

-- ⑤ 限量商品已計入份數（取餐營業日 :d；鎖後才查，不得沿用鎖前快照）
SELECT oi.product_id, SUM(oi.quantity) AS consumed
  FROM order_items oi JOIN orders o ON o.id = oi.order_id
 WHERE o.store_id = :sid AND o.business_date = :d AND oi.product_id IN (:limitedIds)
   AND o.status <> 'CANCELLED'
 GROUP BY oi.product_id;

-- ⑥ 時段已訂單數（預約單）
SELECT COUNT(*) FROM orders
 WHERE store_id = :sid AND scheduled_at = :slot AND status <> 'CANCELLED';

-- ⑦ evaluateOrder（與 quote 同一份邏輯，全部收集、不短路）
--    任一 ERROR → ROLLBACK 並回 422；全數通過後 expectedTotal 不符 → ROLLBACK 並回 409 PRICE_CHANGED

-- ⑧ 寫入 orders、order_items、order_item_options、order_status_logs；payments 僅寫入現金單的 PENDING 現金交易
--    線上付款交易不在本交易內建立（需呼叫金流取得 provider_txn_id，鎖內禁止外部 I/O）：由 POST /orders/{id}/payments 於鎖外建立
--    business_date = 取餐營業日；pickup_no 於鎖內取 (store_id, business_date, 前綴) 的 MAX + 1，UK 為兜底
--    idempotency_key 與 idempotency_request_hash 同時寫入；placed_at = NOW(3)
--    線上付款：status = 'PENDING_PAYMENT'，payment_expires_at = placed_at + payment_timeout_minutes 分鐘，pending_at = NULL
--    現金：status = 'PENDING'，pending_at = placed_at（接單期限自此起算，BR-17）
--    優惠券（鎖序最後；多筆依 coupons.id 升冪，含 ③-c 留下的返還）：
UPDATE user_coupons SET status = 'USED', used_at = NOW(3), order_id = :oid
 WHERE id = :ucid AND status = 'AVAILABLE';   -- 會員使用其持有的券；0 列 = COUPON_USED_UP，整單回復
UPDATE coupons SET used_count = used_count + 1
 WHERE id = :cid AND (total_quota IS NULL OR used_count < total_quota);   -- 0 列 = COUPON_USED_UP，整單回復
COMMIT;
```

`remaining = daily_limit − consumed`；時段額滿條件為 `max_orders_per_slot` 非 `NULL` 且已訂數 ≥ 上限。

**重放的逾期結算**：無鎖前置查詢與 ② 命中、且指紋相同時，回應建構前先對原訂單做逾期結算（與 `GET /orders/{id}` 的 `expireIfDue` 同一函式，轉換與後處理同一交易），`nextAction` 與 `permissions` 以結算後狀態計算；不重驗庫存與價格、不重複計入（BR-27）。

**優惠券寫入（⑧）**：會員使用其持有的券時，`user_coupons` 以條件式更新標記 `USED`（寫入 `used_at`、`order_id`；0 列 = `COUPON_USED_UP`，整單回復），訂單取消時依 BR-29 回復；`per_user_limit` 於 ⑦ 鎖內以該會員對該券的 `USED` 筆數判定（同店建單已被互斥鎖序列化）；尚無持有列的公開折扣碼，於 ⑧ 新增一筆 `USED`（`claimed_at` 與 `used_at` 同值）。`coupons.used_count` 的增減一律最後處理（鎖序）。

**I1、I2 成立的證明前提**

1. **成員只會因建單提交而增加**：取消、拒單、逾時、退款只讓計入集合變小；`PENDING_PAYMENT → PENDING`、`PENDING → ACCEPTED` 等轉換不改變成員。
2. **離開集合者不會回來**：`CANCELLED` 為終態；付款成功與改用現金都是條件式更新（`status = 'PENDING_PAYMENT' AND payment_expires_at > NOW(3)`），已逾期者影響 0 列。
3. **逾期判斷單一時鐘**：建單、付款回呼、改用現金與排程一律使用資料庫時鐘（MySQL `NOW(3)`；PostgreSQL `clock_timestamp()`）。
4. **結算先於計數**：建單鎖內，計數前先把已逾期的 `PENDING_PAYMENT` 寫入 `CANCELLED`；該更新會等待在途的付款交易。若只在讀取時以條件排除而不寫入，另一個尚未提交的付款交易稍後提交成 `PENDING`，已被排除的訂單會重新進入集合，I1、I2 即被破壞。結算的狀態轉換與後處理（狀態紀錄、作廢交易、返還優惠券）在同一交易內完成，不依賴排程補做。
5. **鎖後才計數**：每個建單交易在「計數 → 寫入 → 提交」期間獨佔店家建單互斥鎖，且於取得鎖之後才計數。

在 1 至 5 成立時，建單序列化即足以保證 I1、I2。取消與逾時不需取得互斥鎖，最壞只是讓檢查偏保守（多算而非少算）。契約並行測試須包含「付款交易在途時建單」、「改現金後晚到的線上付款成功」與「兩個相同的成功回呼並行抵達」。

若建單 QPS 使店家鎖成為瓶頸，或需多店共用庫存，改採 [04 D-11](./04-erd.md) 的計數器替代方案（預設不採用）。計數器只降低鎖內成本與支援多店共用庫存，**不消除店家鎖**：時段容量（I2）仍以 `orders` 計數，須對同店序列化；若要去鎖，須連時段容量一併改為計數器。

**條件式狀態轉換（付款與逾時的競態）**

```sql
-- 付款成功回呼 ①：鎖定訂單列（回呼的第一個資料庫動作；取消、發起付款、改用現金與建單鎖內結算皆對同一列取鎖）
SELECT id, status, payment_expires_at FROM orders WHERE id = :id FOR UPDATE;

-- 付款成功回呼 ②：交易層級閘門（之前已以 (provider, provider_txn_id) 唯讀預檢；已 SUCCESS / REFUNDED 即回 200）
--   影響 0 列 = 該交易已被並行的相同回呼處理，回 200 並結束（不更新訂單、不退款）；影響 1 列才進入 ③
UPDATE payments SET status = 'SUCCESS', paid_at = NOW(3)
 WHERE id = :pid AND status IN ('PENDING', 'FAILED');

-- 付款成功回呼 ③：訂單條件式更新
UPDATE orders SET status = 'PENDING', payment_status = 'PAID', pending_at = NOW(3)
 WHERE id = :id AND status = 'PENDING_PAYMENT' AND payment_expires_at > NOW(3);

-- 改用現金（第一個資料庫動作同為 SELECT … FROM orders WHERE id = :id FOR UPDATE）
UPDATE orders SET status = 'PENDING', payment_method = 'CASH', pending_at = NOW(3)
 WHERE id = :id AND status = 'PENDING_PAYMENT' AND payment_expires_at > NOW(3);

-- 付款逾時（排程、存取訂單時的惰性結算與建單鎖內結算共用同一函式與條件；轉換與後處理同一交易）
UPDATE orders SET status = 'CANCELLED', cancelled_by = 'SYSTEM', cancelled_at = NOW(3), cancel_reason = '付款逾時'
 WHERE id = :id AND status = 'PENDING_PAYMENT' AND payment_expires_at <= NOW(3);
```

付款成功回呼的處理順序（BR-28 ④⑤；06 §6.2 同）：

1. **預檢（唯讀、不持鎖）**：以 `(provider, provider_txn_id)` 查交易（`UK`，§5.4）；已為 `SUCCESS` / `REFUNDED` 的重複回呼直接回 `200`，不更新訂單、不退款。預檢只是快速路徑，**不是**防止並行重複的閘門：並行抵達的兩個相同回呼可能同時通過預檢。
2. **鎖定訂單列**：開啟交易，第一個資料庫動作為 `SELECT … FROM orders WHERE id = ? FOR UPDATE`；並行的相同回呼在此序列化，鎖後的重讀與分流所見狀態在交易結束前不會改變。
3. **交易層級閘門**：`UPDATE payments SET status = 'SUCCESS', paid_at = NOW(3) WHERE id = ? AND status IN ('PENDING', 'FAILED')`。影響 0 列 = 該交易已被並行的相同回呼處理，回 `200` 並結束；影響 1 列才進入後續步驟。
4. 對 `orders` 列做上列條件式更新（鎖序先 `orders`、後 `payments`）。影響 1 列 = 正常路徑：同一交易內作廢同訂單其餘 `PENDING` 的線上付款交易（`FAILED`，`failure_code = 'SUPERSEDED'`），避免殘留處理中的交易（對帳 5）。
5. 影響 0 列時，**必須重讀訂單**（訂單列已於步驟 2 鎖定）再分流，不得一律視為逾時：

| 重讀結果 | 路徑 | 處理 |
| --- | --- | --- |
| `CANCELLED`，或 `PENDING_PAYMENT` 且已逾期 | 逾時路徑 | 訂單維持 / 轉為 `CANCELLED`（含後處理）；該交易已於閘門記 `SUCCESS`，自動退款（BR-28 ③、EC-17）；不復活訂單、不重新計入 |
| `PENDING` 或 `ACCEPTED` 以後（例如已改用現金） | 重複付款路徑 | 該交易已於閘門記 `SUCCESS`，退回該筆款項；**不得**變更訂單狀態，也不影響庫存與時段 |

兩條路徑中被記為 `SUCCESS` 的交易，先前多半已被作廢為 `FAILED`（`EXPIRED` / `ORDER_CANCELLED` / `SUPERSEDED`），此即 §5.4 `payments` 說明的 `FAILED → SUCCESS` 例外轉換。退款的金流呼叫與通知在 `COMMIT` 之後（鎖外）；外部呼叫失敗不回復已入帳的交易，由每日對帳 2 追查。契約測試：同一成功回呼連送兩次，以及兩個相同的成功回呼並行抵達，訂單不變，退款次數為 0（正常付款）或 1（逾時路徑，並行時亦只退一次）。

**改用現金**（`POST /orders/{id}/payments`，`method = CASH`）：第一個資料庫動作同為 `SELECT … FROM orders WHERE id = ? FOR UPDATE`，再執行上列「改用現金」條件式更新；影響 1 列時於同一交易內作廢既有 `PENDING` 線上交易（`SUPERSEDED`）並建立 `CASH` 交易（`PENDING`）。影響 0 列時**直接回 `409 ORDER_STATE_CONFLICT`**：改用現金沒有成功交易可記，**不**進入上表分流（BR-28 ⑤、06 §5.13）。

流程見 [FLOW-11](./02-flows.md#flow-11-付款狀態機)。

### 6.4 庫存與時段計入規則與每日對帳

**計入集合**：以 `orders.status` 判定。

| status | 計入已售與時段已訂數？ | 備註 |
| --- | --- | --- |
| `PENDING_PAYMENT`，且資料庫時鐘 < `payment_expires_at` | 是 | 線上付款保留中（預設 15 分鐘） |
| `PENDING_PAYMENT`，且已達 `payment_expires_at` | 否 | 到期當下即釋放（半開區間）。建單鎖內先結算為 `CANCELLED`（轉換與後處理同一交易）；唯讀查詢（`quote`、菜單、商品詳情、可選時段）只以條件排除、不寫入，使剩餘份數在到期當下即回升 |
| `PENDING` | 是 | 含現金訂單與付款完成待接單者；持續計入直到店家接單，或逾接單期限被排程取消。接單期限（BR-17）自 `pending_at` 起算：即時單 = `pending_at + accept_timeout_minutes`；預約單 = `max(pending_at + accept_timeout_minutes, scheduled_at − 前置分鐘)`。前置分鐘**同 BR-08**：外送為該單配送區的 `delivery_zones.estimated_minutes`（以 `orders.delivery_zip_code` 對應），缺值才用 `store_settings.delivery_lead_minutes`；自取為 `pickup_lead_minutes`。期限非儲存欄位，唯讀查詢不做惰性排除，只由排程寫入（後端無模擬器；Mock 的較精確行為見 §8.2 與 06 §7，契約測試不斷言） |
| `ACCEPTED`、`READY`、`DELIVERING`、`COMPLETED` | 是 | `COMPLETED` 亦為已售 |
| `CANCELLED` | 否 | 釋放，與退款進度（`payment_status`）無關 |

**計入規則**

| 項目 | 規則 |
| --- | --- |
| 限量歸屬 | 以 `orders.business_date`（取餐營業日，BR-40）歸屬；預約至其他營業日的訂單不消耗當前營業日的限量 |
| 剩餘份數 | `remaining = max(0, daily_limit − consumed)`；`daily_limit IS NULL` 為不限 |
| 時段已訂數 | 同店、同 `scheduled_at`、計入集合內的預約單數，單位為訂單數；已訂數 ≥ `max_orders_per_slot` 即額滿（`SLOT_UNAVAILABLE`）。即時單（`scheduled_at IS NULL`）暫不計入（Q-11） |
| 同商品多行 | 以 `product_id` 加總各行數量，依請求順序配置剩餘量（BR-40）；為應用層規則，資料表不需額外欄位 |
| 保留起點 | `POST /orders` 提交的交易；加入購物車、進入結帳、`quote` 皆不保留 |
| 保留時長 | 線上付款：至 `payment_expires_at`（預設建單後 15 分鐘）；付款成功或改用現金後轉為 `PENDING`，改以接單期限計，自 `pending_at` 起算。現金（含預約單）：無付款期限，自 `pending_at`（= 建單時間）起保留至店家接單，或逾接單期限被取消，預約單最長可至預約時間前（接單期限為 `pending_at + accept_timeout_minutes` 與 `scheduled_at − 前置分鐘` 的較大者，前置分鐘取值同上列；R-07、Q-14） |
| 付款階段 | 付款失敗、重新付款、改用現金皆**不重驗**庫存（保留仍有效）；已逾 `payment_expires_at` 者以條件式更新擋下（§6.3） |
| 唯讀路徑 | `quote`、菜單、商品詳情、可選時段（`pickup-slots`）、`GET /orders`（列表）**不寫入**：不結算、不寫狀態紀錄，只以上表的計入條件排除（列表為顯示修正）已逾期的待付款單；列表對已逾 `payment_expires_at` 的 `PENDING_PAYMENT` 列，以相同條件顯示為已取消（付款逾時），`tab` 分群亦同（歸入 `cancelled`、不歸 `active`），使其在到期當下即離開進行中，不必等排程或詳情頁結算。`GET /orders/lookup` 只回 `orderId` 與新簽發的權杖，不回狀態、不結算。逾期結算（`settleExpiredOrders` / `expireIfDue`）僅在寫入路徑執行：建單、取消、付款、改用現金與 `GET /orders/{id}`；接單逾時只由排程寫入 |

**釋放路徑**：訂單進入 `CANCELLED` 即釋放，不需額外寫入；每條路徑先以 `SELECT … FOR UPDATE` 鎖定該訂單列（§6.3 鎖序），再以 `WHERE id = ? AND status IN (該路徑允許的來源狀態)` 條件式更新，影響 0 列視為已處理（冪等）。

| 路徑 | 轉換 | 操作者 | 備註 |
| --- | --- | --- | --- |
| 顧客取消 | `PENDING_PAYMENT` / `PENDING` → `CANCELLED` | CUSTOMER | 條件式；冪等 |
| 店家拒單 | `PENDING` → `CANCELLED` | STORE | 同上 |
| 店家取消（缺料） | `ACCEPTED` → `CANCELLED` | STORE | 預設回補（Q-13）；缺料取消時店家同時標示售完，避免已無食材仍被點購 |
| 未取餐 / 配送異常 | `READY` / `DELIVERING` → `CANCELLED` | STORE | 同上 |
| 付款逾時 | `PENDING_PAYMENT` → `CANCELLED` | SYSTEM | 排程、存取訂單時的惰性結算與建單鎖內結算共用同一函式與條件式更新，轉換與後處理在同一交易內完成；`cancel_reason` 於同一 UPDATE 寫入 |
| 接單逾時 | `PENDING` → `CANCELLED` | SYSTEM | 排程（期限自 `pending_at` 起算）；已付款者於同交易寫入 `REFUNDING`，金流退款呼叫在 `COMMIT` 後 |
| 逾時後付款成功 | 維持 `CANCELLED` | SYSTEM | 自動退款，不復活訂單、不重新計入 |

排程每 30 秒掃描 `status = 'PENDING_PAYMENT' AND payment_expires_at <= NOW(3)`（`IX(status, payment_expires_at)`）與接單逾時（以 `status = 'PENDING' AND pending_at <= NOW(3) - INTERVAL accept_timeout_minutes MINUTE` 縮小範圍，走 `IX(status, pending_at)`，再以對帳 4 的算式逐筆確認，前置分鐘取值同 BR-08），逐筆先鎖定該訂單列（`SELECT … FOR UPDATE`）再條件式更新並與後處理同一交易，可重入、可平行；與建單鎖內結算、存取訂單時的 `expireIfDue` 為同一函式。排程落後只會讓檢查偏保守，不會超賣。

**每日對帳**（營業結束、排程之後執行；唯讀報表與告警）

1. **不變式**：依商品與營業日加總計入份數，列出超過 `daily_limit` 者（店家事後調降限量低於已售時屬合法，既有訂單不受影響，見 I1、BR-40、EC-38；須對照店家當日調降限量的紀錄，避免誤報）；依時段列出超過 `max_orders_per_slot` 者。
2. **款項**：(a) 訂單為 `CANCELLED` 但存在 `SUCCESS` 交易，且 `payment_status` 非 `REFUNDING` / `REFUNDED`；(b) 訂單未取消，卻有不應保留的線上付款成功交易：訂單已改為現金，或同一訂單另有一筆未退回的線上付款成功交易（例如改用現金後晚到的線上付款成功、被取代的付款嘗試晚到成功，BR-28 ⑤），超過 5 分鐘仍未 `REFUNDED`。
3. **付款逾時排程健康度**：已逾 `payment_expires_at` 超過 5 分鐘仍為 `PENDING_PAYMENT` 的訂單數，應為 0；`PENDING_PAYMENT` 而 `payment_expires_at IS NULL` 者（資料表 CHECK 的最後防線）一併計入。
4. **接單逾時排程健康度**：已逾接單期限（BR-17；自 `pending_at` 起算，即時單與預約單皆含；預約單的前置分鐘同 BR-08，外送以配送區 `estimated_minutes` 為先）超過 5 分鐘仍為 `PENDING` 的訂單數，應為 0；`PENDING` 而 `pending_at IS NULL` 者一併計入。這類訂單會持續占用限量與時段容量（R-07），非 0 代表接單逾時排程異常或店家長時間未處理。
5. **殘留交易**：訂單已非 `PENDING_PAYMENT`，卻仍有處理中的線上付款交易（`method <> 'CASH'`；訂單為 `CANCELLED` 時含任何 `PENDING` 交易），超過 5 分鐘，應為 0；代表發起付款、取消或結算交錯而漏作廢（BR-28 ①②）；付款成功轉為 `PENDING` 時，同訂單其餘 `PENDING` 的線上交易已於同一交易作廢（§6.3），不應殘留。

```sql
-- 對帳 1-a：計入份數超過每日限量的商品（營業日 :d）
--          店家事後調降限量低於已售屬合法（I1）；命中者須對照調降紀錄再判定
SELECT p.id AS product_id, p.name, p.daily_limit, SUM(oi.quantity) AS consumed
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  JOIN products p ON p.id = oi.product_id
 WHERE o.store_id = :sid AND o.business_date = :d
   AND o.status <> 'CANCELLED'
   AND NOT (o.status = 'PENDING_PAYMENT' AND o.payment_expires_at <= NOW(3))
   AND p.daily_limit IS NOT NULL
 GROUP BY p.id, p.name, p.daily_limit
HAVING SUM(oi.quantity) > p.daily_limit;

-- 對帳 1-b：已訂單數超過單時段上限的時段（營業日 :d）
SELECT o.scheduled_at, COUNT(*) AS booked, s.max_orders_per_slot
  FROM orders o
  JOIN store_settings s ON s.store_id = o.store_id
 WHERE o.store_id = :sid AND o.business_date = :d AND o.scheduled_at IS NOT NULL
   AND o.status <> 'CANCELLED'
   AND NOT (o.status = 'PENDING_PAYMENT' AND o.payment_expires_at <= NOW(3))
   AND s.max_orders_per_slot IS NOT NULL
 GROUP BY o.scheduled_at, s.max_orders_per_slot
HAVING COUNT(*) > s.max_orders_per_slot;

-- 對帳 2-a：訂單已取消，卻有尚未進入退款的成功交易（應為 0）
SELECT o.id AS order_id, p.id AS payment_id
  FROM orders o JOIN payments p ON p.order_id = o.id
 WHERE o.store_id = :sid AND o.status = 'CANCELLED' AND p.status = 'SUCCESS'
   AND o.payment_status NOT IN ('REFUNDING', 'REFUNDED');

-- 對帳 2-b：訂單未取消，卻有不應保留、超過 5 分鐘仍未退回的線上付款成功交易（應為 0）
--         訂單已改為現金，或同一訂單另有一筆線上付款成功交易（晚到的回呼走重複付款路徑，§6.3）
SELECT o.id AS order_id, p.id AS payment_id, p.method
  FROM orders o JOIN payments p ON p.order_id = o.id
 WHERE o.store_id = :sid AND o.status <> 'CANCELLED'
   AND p.status = 'SUCCESS' AND p.method <> 'CASH'
   AND p.paid_at < NOW(3) - INTERVAL 5 MINUTE
   AND (o.payment_method = 'CASH'
        OR EXISTS (SELECT 1 FROM payments p2
                    WHERE p2.order_id = o.id AND p2.id <> p.id
                      AND p2.status = 'SUCCESS' AND p2.method <> 'CASH'));

-- 對帳 3：付款逾時排程健康度（應為 0；含違反 CHECK 的 NULL 期限）
SELECT COUNT(*) FROM orders
 WHERE store_id = :sid AND status = 'PENDING_PAYMENT'
   AND (payment_expires_at IS NULL OR payment_expires_at < NOW(3) - INTERVAL 5 MINUTE);

-- 對帳 4：已逾接單期限超過 5 分鐘仍為 PENDING（應為 0；即時單與預約單皆含）
--         接單期限 = pending_at + accept_timeout_minutes；預約單取其與 scheduled_at − 前置分鐘 的較大者（BR-17）
--         前置分鐘同 BR-08：外送 = 該單配送區（以 delivery_zip_code 對應）的 estimated_minutes，缺值才用 delivery_lead_minutes；其餘取餐方式 = pickup_lead_minutes
--         以目前的 accept_timeout_minutes 與前置分鐘設定估算；排程掃描使用同一算式（不含 5 分鐘緩衝）
SELECT COUNT(*) FROM orders o
  JOIN store_settings s ON s.store_id = o.store_id
  LEFT JOIN delivery_zones z ON z.store_id = o.store_id AND z.zip_code = o.delivery_zip_code
 WHERE o.store_id = :sid AND o.status = 'PENDING'
   AND (o.pending_at IS NULL OR GREATEST(
          o.pending_at + INTERVAL s.accept_timeout_minutes MINUTE,
          COALESCE(o.scheduled_at - INTERVAL (CASE o.order_type
                                                WHEN 'DELIVERY' THEN COALESCE(z.estimated_minutes, s.delivery_lead_minutes)
                                                ELSE s.pickup_lead_minutes END) MINUTE,
                   o.pending_at)
        ) < NOW(3) - INTERVAL 5 MINUTE);

-- 對帳 5：已非待付款的訂單仍有處理中的交易（應為 0；現金單的 PENDING 現金交易於店家完成時才轉 SUCCESS，不在此列）
SELECT o.id AS order_id, p.id AS payment_id, p.method
  FROM orders o JOIN payments p ON p.order_id = o.id
 WHERE o.store_id = :sid AND o.status <> 'PENDING_PAYMENT' AND p.status = 'PENDING'
   AND (o.status = 'CANCELLED' OR p.method <> 'CASH')
   AND p.created_at < NOW(3) - INTERVAL 5 MINUTE;
```

---

## 7. 資料生命週期與個資

### 7.1 個資欄位

| 表 | 欄位 | 處理 |
| --- | --- | --- |
| `users` | `phone`、`name`、`email` | 傳輸加密；列表與日誌中遮罩（`0912***678`） |
| `user_addresses` | 全部 | 同上 |
| `orders` | `customer_name`、`customer_phone`、`delivery_*`、`idempotency_request_hash` | 同上；帳號刪除或保存期限到期後去識別化（`idempotency_request_hash` 涵蓋姓名、手機與地址的衍生值，一併置 `NULL`） |
| `order_invoices` | `carrier_code`、`tax_id`、`buyer_name` | 載具屬個人識別資料，存取需稽核 |
| `reviews` | `user_id`、`comment` | 評論公開時僅顯示去識別化暱稱 |

### 7.2 帳號刪除（FR-AC-07）

1. `users`：設定 `deleted_at`；`phone` 以 `X` + 9 碼雜湊覆寫（共 10 字元，不符手機格式且保持唯一）；`name`、`email` 設為 `NULL`。
2. `user_addresses`、`favorites`、`user_coupons`、`point_transactions`：**實體刪除**。
3. `orders`：`user_id` 設為 `NULL`；`customer_name`、`customer_phone`、`delivery_*` 去識別化，`idempotency_request_hash` 置 `NULL`（請求指紋涵蓋姓名、手機與地址，手機號碼空間小，無鹽雜湊可被離線枚舉還原；重放保證只需涵蓋 ≥ 24 小時，見 §5.4）；保留金額、品項與時間以符合會計與稅務留存。保存期限到期的去識別化沿用本步驟的欄位清單。
4. 寫入稽核紀錄（不含個資內容）。

### 7.3 保存期限（建議，請與法遵 / 會計確認）

| 資料 | 建議保存 |
| --- | --- |
| 訂單、付款、發票 | 會計憑證自年度決算程序終了後保存 5 年、會計帳簿與財務報表 10 年（商業會計法第 38 條）；統一發票另有稅法規定，實際年限請與會計師確認 |
| OTP 驗證碼 | 10 分鐘（置於快取，不落關聯式資料庫） |
| 應用程式與存取日誌 | 90 天，內容須遮罩個資 |
| Demo 前端資料 | 僅存使用者瀏覽器 `localStorage`，可由「重置 Demo 資料」清除 |

---

## 8. 命名與資料來源對照

### 8.1 命名轉換

| 層級 | 風格 | 範例 |
| --- | --- | --- |
| 資料庫 | `snake_case` | `order_no`、`is_sold_out`、`price_delta`、`created_at` |
| API / 前端型別 | `camelCase` | `orderNo`、`isSoldOut`、`priceDelta`、`createdAt` |
| 時間 | DB UTC → API ISO 8601 `+08:00` | `2026-10-14T12:30:00+08:00` |
| 關聯展開 | 關聯表以巢狀物件 / 陣列回傳 | `product.optionGroups[].options[]` |

### 8.2 Phase 1 前端資料來源

Mock Adapter 以**資料表名稱**為集合名稱存放於 `localStorage`，結構與本文件一致，確保串接後欄位不需轉換（細節見 [07 §6](./07-frontend-architecture.md)）。

| 資料表 | Phase 1 來源 | 持久化 |
| --- | --- | --- |
| `stores`、`store_*`、`delivery_zones`、`categories`、`products`、`option_groups`、`options`、`product_option_groups`、`banners`、`coupons` | 種子資料（見 [08](./08-demo-guide.md)） | 記憶體 + 重置時重新載入 |
| `users`、`user_addresses`、`favorites`、`user_coupons` | 種子資料 + 使用者操作 | `localStorage` |
| `orders`、`order_items`、`order_item_options`、`order_status_logs`、`payments`、`order_invoices` | 使用者操作與 Demo 模擬器 | `localStorage` |
| 購物車 | 前端狀態 | `localStorage`（`zaiorder:v1:cart`） |
| `reviews`、`point_transactions` | 不實作（P2） | — |

Mock 的建單與所有其他寫入 db 的路徑（取消、付款、店家模擬動作、惰性推進、會員資料與 Demo 控制）一律經 `withDbLock`（鎖內先 `reload` 再變更再 `flush`），以單一臨界區模擬 §6.3 的建單序列化；不支援 Web Locks 的瀏覽器降級為單分頁保證，可能遺失寫入（07 §6.8、[08 §8](./08-demo-guide.md)）。Mock 與後端共用 §6.4 的計入規則與自 `pending_at` 起算的接單期限（含預約單的前置分鐘取值）；接單逾時在後端只由排程寫入，Mock 另有較精確的行為，列於 06 §7 差異表，契約測試不斷言。後端沒有模擬器：店家未接單且逾接單期限者一律由排程取消。自動模擬為 Mock（Demo）專用，開啟時惰性推進會先補寫模擬接單（`pending_at + 5 秒`）再判斷接單逾時，因此接單逾時只會出現在自動模擬關閉、店家端未接單等情境（07 §6.6、[08 §5](./08-demo-guide.md)）。
