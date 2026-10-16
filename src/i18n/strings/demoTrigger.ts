// src/i18n/strings/demoTrigger.ts —— Demo 入口鈕（頂部列）的文案（03 PG-18；繁體中文・台灣用語）
//
// 獨立成檔：頂部列的 DemoTrigger 會靜態匯入主 bundle，不能把整份 demo.ts（工具面板的全部文案）一起拉進首屏。
// demo.ts 以 `demo.fab` 重新匯出同一份，面板與測試仍可由 tDemo.fab 取得。
export const demoTrigger = {
  /** 可存取名稱；E2E 與測試以 `/^Demo 工具/` 找入口，前綴必須維持 */
  label: 'Demo 工具',
  /** ≥ 768 膠囊上的可見文字 */
  short: 'Demo',
  /** 有預備項目或「下一次送出訂單」不是「正常」時（03 PG-18） */
  armed: (n: number) => `Demo 工具，已預備 ${n} 項下次送出的模擬`,
} as const;
