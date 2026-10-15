// src/components/overlay.ts —— 浮層專用匯出：Sheet 與標題 / 說明元件（Radix Dialog）
//
// 與 `@/components` 主匯出分開：主匯出若 re-export 這些模組，首屏的共用 chunk 就會依賴 Radix 的 chunk
// （NFR-03 首次載入 JS 預算）。只在浮層內容（商品面板、Demo 面板、地址簿編輯面板…）中引用這裡。
// Dialog / ConfirmDialog 仍由 `@/components` 取用（內部延後載入實作）。
export { Sheet, SheetDescription, SheetTitle } from './Sheet';
export type { SheetProps } from './Sheet';
export { DialogDescription, DialogTitle } from './dialogParts';
