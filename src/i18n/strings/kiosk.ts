// src/i18n/strings/kiosk.ts —— 觸控面板（Kiosk）文案（03 §5.6、§9；繁體中文・台灣用語）
export const kiosk = {
  /** 閒置警示（CMP-37、FLOW-21） */
  idle: {
    title: '還在嗎？',
    /** 大字倒數旁的說明：「{n}」＋此句 */
    countdownSuffix: '秒後將重新開始，購物車會清空',
    /** 純文字版（輔助科技朗讀與對話框描述）：{n} 秒後將重新開始，購物車會清空 */
    description: (seconds: number) => `${seconds} 秒後將重新開始，購物車會清空`,
    /** 送出結果未知時多一行（BR-37、BR-41） */
    unknownResult: '上一筆訂單結果尚未確認，請洽櫃檯確認',
    continue: '繼續點餐',
    restart: '重新開始',
    /** 每 10 秒以 assertive 通報（03 §10.5） */
    announce: (seconds: number) => `${seconds} 秒後將重新開始，按「繼續點餐」可延長`,
  },
  /** 完成畫面（PG-06 觸控面板版型） */
  done: {
    /** 可見倒數文字 */
    countdown: (seconds: number) => `${seconds} 秒後自動回到首頁`,
    /** 剩 20 秒（polite） */
    announceCountdown: (seconds: number) => `${seconds} 秒後自動回到首頁`,
    /** 剩 10 秒（assertive） */
    announceExtend: (seconds: number) => `${seconds} 秒後回到首頁，按「再看一下」可延長`,
    /** 完成畫面按鈕文案，供完成畫面（orders 功能）共用 */
    startNew: '開始新訂單',
    keepLooking: '再看一下',
  },
  /** 重置後通報（03 §10.5）：焦點移到菜單頁標題 */
  reset: {
    announced: '已重新開始',
  },
} as const;
