// src/app/layouts/TaskLayout.tsx —— 任務型頁面（結帳、付款、訂單詳情）的外殼（03 §3.3）
import { ShellFrame } from './ShellFrame';

export interface TaskLayoutProps {
  /** 沒有站內歷史（直接開啟網址）時，返回鈕前往的路徑；預設回菜單 */
  backTo?: string;
  /** 返回鈕的可存取名稱，預設「返回」 */
  backLabel?: string;
}

/**
 * 精簡頂部列（返回 + 頁名 + ⌨）、無底部 Tab、無登入 / 查詢訂單；同樣保留 ⌨、跳過連結（無「跳到購物車」）
 * 與頁尾「鍵盤快速鍵」，位置與一般頁面一致（WCAG 3.2.6）。與 AppShell 為兄弟版面，各自完整（含 Provider 堆疊）。
 */
export function TaskLayout({ backTo, backLabel }: TaskLayoutProps) {
  return <ShellFrame variant="task" backTo={backTo} backLabel={backLabel} />;
}
