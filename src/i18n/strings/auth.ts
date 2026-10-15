// src/i18n/strings/auth.ts —— 登入與 Session 文案（03 PG-09、§9；繁體中文・台灣用語）
// 通用的錯誤碼訊息請用 `t.errors.message(code)`；這裡只放登入頁專屬文字。

/** 秒數轉為「n 分 m 秒」或「m 秒」 */
function waitText(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${m} 分鐘` : `${m} 分 ${rest} 秒`;
}

export const auth = {
  pageTitle: '登入會員',
  intro: '登入為選用，可直接以訪客點餐。登入後可保存訂單、地址與我的最愛。',
  guestContinue: '以訪客身分繼續',

  // 步驟 ①：手機
  phoneLabel: '手機號碼',
  phoneHint: '我們會傳送 6 位數驗證碼到這支手機',
  phoneInvalid: '請輸入正確的手機號碼（09 開頭，共 10 碼）',
  sendOtp: '發送驗證碼',
  sendingOtp: '發送中…',
  otpSent: (phone: string, seconds: number) =>
    `驗證碼已傳送到 ${phone}，${seconds} 秒後可重新發送`,

  // 步驟 ②：驗證碼
  otpTitle: '輸入驗證碼',
  otpSentTo: (phone: string) => `已傳送 6 位數驗證碼到 ${phone}`,
  changePhone: '變更手機號碼',
  otpLabel: '驗證碼',
  otpCell: (index: number, total: number) => `驗證碼第 ${index} 碼，共 ${total} 碼`,
  verify: '登入',
  verifying: '驗證中…',
  resendIn: (seconds: number) => `${seconds} 秒後可重新發送`,
  resend: '重新發送驗證碼',
  resent: '已重新發送驗證碼',
  otpIncomplete: '請輸入完整的 6 位數驗證碼',
  /** OTP_INVALID 附剩餘次數 */
  otpInvalidRemaining: (n: number) => `驗證碼不正確，還可以再試 ${n} 次`,
  otpInvalid: '驗證碼不正確或已過期，請重新輸入',
  /** OTP_LOCKED / OTP_RATE_LIMITED：主訊息固定，剩餘時間另以計時文字呈現（不放進 live region，避免每秒朗讀） */
  otpLocked: '驗證錯誤次數過多，請稍後再試',
  otpRateLimited: '驗證碼發送太頻繁，請稍後再試',
  retryIn: (seconds: number) => `請等 ${waitText(seconds)}後再試`,
  /** 發送被限流但先前已發送過驗證碼：讓使用者直接輸入 */
  haveCode: '我已收到驗證碼',

  // 步驟 ③：新會員補姓名（選填）
  welcomeTitle: '歡迎加入',
  welcomeIntro: '想怎麼稱呼你？之後可以在個人資料修改，也可以略過。',
  nameLabel: '姓名',
  nameInvalid: '請輸入姓名（最多 20 字）',
  saveName: '儲存',
  skip: '略過',

  // 結果
  loggedIn: '已登入',
  welcome: '歡迎加入！',
  loginFailed: '登入沒有成功，請稍後再試',

  // Demo（FR-DM-08）
  demoTitle: 'Demo 模式',
  demoCode: 'Demo 驗證碼：123456',
  demoQuickLogin: '快速登入示範會員',
  demoQuickLoginHint: '以示範會員登入，帶有歷史訂單、地址與優惠券',

  // 頁尾告知（FR-SY-06）
  privacyNote: '蒐集手機號碼僅用於登入驗證與訂單聯絡。',
  privacyLink: '隱私權政策',
  termsLink: '服務條款',
} as const;
