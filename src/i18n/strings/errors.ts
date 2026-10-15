// src/i18n/strings/errors.ts —— 錯誤文案（03 §9；06 §3.2 錯誤碼表）
// 語氣：說明「發生什麼事」＋「可以怎麼做」，不暴露技術細節。
// 已知錯誤碼的文案由前端依 code 決定；伺服器回傳的 message 僅作「未知錯誤碼」的降級文字（06 §1.2、03 §9）。
import type { ErrorCode } from '@/domain/types';

/** 每個 `ErrorCode` 都有一則通用訊息（`satisfies` 保證新增錯誤碼時編譯失敗而不是漏掉）。 */
const byCode = {
  // 400
  VALIDATION_FAILED: '資料格式有誤，請檢查標示的欄位後再試一次',
  OTP_INVALID: '驗證碼不正確或已過期，請重新輸入',
  // 401 / 403 / 404
  UNAUTHORIZED: '登入已逾時，請重新登入',
  FORBIDDEN: '帳號已停用，請聯絡店家',
  NOT_FOUND: '找不到你要的內容，請確認後再試一次',
  // 409
  PRICE_CHANGED: '部分商品價格已更新，請確認後再送出',
  ORDER_STATE_CONFLICT: '訂單狀態已有變動，已為你重新載入最新狀態',
  IDEMPOTENCY_CONFLICT:
    '稍早送出的訂單已成立，內容與目前購物車不同。如需調整，請先取消該訂單再重新下單',
  // 422：店家與取餐方式
  STORE_PAUSED: '店家目前較忙，暫停接單。可稍後再試或直接來電',
  STORE_CLOSED: '目前休息中，可預約營業時段後取餐',
  SERVICE_NOT_AVAILABLE: '店家目前未開放這個取餐方式，請改選其他取餐方式',
  // 422：品項
  ITEM_UNLISTED: '這項餐點已下架',
  ITEM_SOLD_OUT: '這項餐點今日售完',
  ITEM_STOCK_INSUFFICIENT: '這項餐點剩餘份數不足，請調整份數',
  OPTION_INVALID: '選項不符合規則，請重新選擇',
  OPTION_UNAVAILABLE: '部分選項暫無供應，請重新選擇',
  QUANTITY_EXCEEDED: '數量超過上限，請調整後再試一次',
  // 422：條件
  MIN_ORDER_NOT_MET: '還沒有達到最低消費，請再加點餐點',
  OUT_OF_DELIVERY_AREA: '此地址不在外送範圍內，可改為自取',
  SLOT_UNAVAILABLE: '此時段已額滿，請選擇其他時段',
  TABLE_NOT_FOUND: '找不到這個桌號，請洽店員協助',
  PAYMENT_METHOD_NOT_ALLOWED: '這個付款方式目前無法使用，請重新選擇',
  INVOICE_INVALID: '發票資料有誤，請檢查後再試一次',
  // 422：折扣
  COUPON_NOT_FOUND: '找不到這個折扣碼，請確認後再輸入',
  COUPON_EXPIRED: '這個折扣碼已過期或尚未生效',
  COUPON_NOT_APPLICABLE: '這個折扣碼不適用於目前的取餐方式',
  COUPON_MIN_NOT_MET: '還沒有達到這個折扣碼的最低消費',
  COUPON_USED_UP: '這個折扣碼已被使用完畢',
  LOGIN_REQUIRED: '這項功能需要登入會員，登入後即可使用',
  // 423 / 429
  OTP_LOCKED: '驗證錯誤次數過多，請稍後再試',
  OTP_RATE_LIMITED: '驗證碼發送太頻繁，請稍後再試',
  RATE_LIMITED: '操作太頻繁，請稍後再試',
  // 5xx
  INTERNAL_ERROR: '發生了一點問題，請稍後再試',
  SERVICE_UNAVAILABLE: '網路好像不太穩，請稍後再試',
} as const satisfies Record<ErrorCode, string>;

/** 無法判斷時的通用訊息（與 http/request.ts 的降級文字一致） */
const GENERIC = '發生了一點問題，請稍後再試';

const isKnownCode = (code: string): code is ErrorCode =>
  Object.prototype.hasOwnProperty.call(byCode, code);

/**
 * 錯誤碼 → 使用者訊息。
 * - 已知錯誤碼：回傳對照表文案（忽略伺服器 `message`）
 * - 未知 / 缺少錯誤碼（後端新增列舉的前向相容）：回傳 `fallback`（通常是伺服器的 `message`），再沒有則回傳通用訊息
 * @example errorMessage(error.code, error.message)
 */
export function errorMessage(code: string | null | undefined, fallback?: string | null): string {
  if (code !== null && code !== undefined && isKnownCode(code)) return byCode[code];
  if (typeof fallback === 'string' && fallback.trim().length > 0) return fallback;
  return GENERIC;
}

/**
 * 由任何被擲出的值取得使用者訊息：具有 `code`（如 `ApiError`）者依錯誤碼，
 * 未知碼時使用其 `message`；其餘（TypeError 等技術性錯誤）一律用通用訊息，不暴露技術細節。
 */
export function errorMessageOf(error: unknown, fallback?: string): string {
  if (typeof error === 'object' && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (typeof code === 'string') {
      return errorMessage(code, typeof message === 'string' ? message : fallback);
    }
  }
  return fallback ?? GENERIC;
}

export const errors = {
  /** 通用訊息 */
  generic: GENERIC,
  /** 無網路 / 逾時（無回應，status 0） */
  network: '網路好像不太穩，請稍後再試',
  /** 錯誤碼對照表（直接取值請用 `errorMessage`，以便處理未知碼） */
  byCode,
  /** 同 `errorMessage`：`t.errors.message(code, fallback)` */
  message: errorMessage,
  messageOf: errorMessageOf,

  // 需要帶入數值的變體（文案由前端組成，03 §9）
  /** `OTP_INVALID` 附剩餘次數（`error.remainingAttempts`） */
  otpInvalidRemaining: (n: number) => `驗證碼不正確，還可以再試 ${n} 次`,
  /** `OTP_LOCKED` / `OTP_RATE_LIMITED` 附冷卻秒數（`retryAfterSeconds`） */
  retryAfter: (seconds: number) => `請等 ${seconds} 秒後再試`,
  /** `STORE_CLOSED`：下次可預約的時間（例「17:00」） */
  storeClosedUntil: (time: string) => `目前休息中，可預約 ${time} 後取餐`,
  /** `STORE_PAUSED` 送出被退回（店家剛剛暫停接單） */
  storePausedJustNow: '店家剛剛暫停接單，目前無法送出訂單。可稍後再試或直接來電',
  /** `STORE_PAUSED` 附預計恢復時間 */
  storePausedUntil: (time: string) =>
    `店家目前較忙，暫停接單，預計 ${time} 恢復。可稍後再試或直接來電`,
  /** `STORE_CLOSED` 送出被退回（店家剛剛休息了） */
  storeClosedJustNow: (time: string) => `店家剛剛休息了，可預約 ${time} 後取餐`,
  /** `SERVICE_NOT_AVAILABLE`：{取餐方式} 例「外送」 */
  serviceNotAvailable: (orderType: string) => `店家目前未開放${orderType}，請改選其他取餐方式`,
  /** `MIN_ORDER_NOT_MET` / 外送未達門檻：還差多少元 */
  minOrderShortfall: (amount: number) => `還差 NT$ ${amount.toLocaleString('en-US')} 可外送`,
  /** `QUANTITY_EXCEEDED`：單行上限 */
  quantityExceededLine: (max: number) => `此品項最多 ${max} 份`,
  /** `QUANTITY_EXCEEDED`：品項行數上限（整單項） */
  quantityExceededLines: (max: number) => `購物車最多 ${max} 項品項，請移除部分品項`,
  /** `ITEM_STOCK_INSUFFICIENT`：{品名} 今日只剩 {n} 份（已選 {m} 份） */
  stockInsufficient: (name: string, remaining: number, selected: number) =>
    `${name}\u3000今日只剩 ${remaining} 份（已選 ${selected} 份）`,
  /** `ITEM_SOLD_OUT` */
  soldOutItem: (name: string) => `${name}\u3000今日售完`,
  /** `ITEM_SOLD_OUT` 送出被退回且該品原本可買 */
  justSoldOut: (name: string) => `${name}\u3000剛剛被訂走了`,
  /** `ITEM_UNLISTED` */
  unlistedItem: (name: string) => `${name}\u3000已下架`,
  /** `OPTION_UNAVAILABLE` */
  optionUnavailable: (name: string, option: string) => `${name}\u3000的「${option}」暫無供應`,
  /** `SLOT_UNAVAILABLE`：額滿 */
  slotFull: (time: string) => `${time} 這個時段已額滿`,
  /** `SLOT_UNAVAILABLE`：已來不及準備 */
  slotPassed: (time: string) => `${time} 已來不及準備，請重新選擇時段`,
  /** `NOT_FOUND`：查詢訂單 */
  orderNotFound: '找不到訂單，請確認編號與手機',
  /** `LOGIN_REQUIRED`：會員專屬折扣碼未登入 */
  couponMemberOnly: '此折扣碼僅限會員',
  /** `POST /orders` 的 `429` */
  orderRateLimited: '操作太頻繁，請稍後再按一次送出訂單',
  /** `POST /orders` 的 `503` 且附 `retryAfterSeconds`（確定未建立） */
  orderLockTimeout: '目前點餐人數較多，請稍後再按一次送出訂單',
  /** `POST /orders` 結果未知（無回應 / 逾時 / 5xx 不附 retryAfterSeconds） */
  orderResultUnknown: '網路不太穩，無法確認訂單是否已送出。再試一次不會重複下單',
  orderResultUnknownKiosk: '無法確認訂單是否已送出，請洽櫃檯確認',
  /** 付款 */
  paymentFailed: '付款未完成，可重新付款或改用現金',
  paymentExpired: '超過付款時間，訂單已自動取消，保留的餐點與時段已釋出。想再訂可按「再來一單」',
} as const;
