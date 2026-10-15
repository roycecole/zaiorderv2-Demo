// src/app/layouts/TopbarSlot.tsx —— 頂部列的插槽（例：菜單頁的常駐搜尋膠囊，03 §3.3）
//
// 外殼在頂部列放一個空容器並以 context 提供；頁面以 <TopbarSlot>…</TopbarSlot> 把內容傳送進去
// （portal），頁面卸載即移除。外殼之外（獨立渲染、測試）不渲染任何內容。
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const TopbarSlotContext = createContext<HTMLElement | null>(null);

export interface TopbarSlotProps {
  children: ReactNode;
}

export function TopbarSlot({ children }: TopbarSlotProps) {
  const target = useContext(TopbarSlotContext);
  if (target === null) return null;
  return createPortal(children, target);
}
