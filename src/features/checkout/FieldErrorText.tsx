// src/features/checkout/FieldErrorText.tsx —— 區塊層級的欄位錯誤文字（圖示 + 文字 + 顏色；components 內的 FieldError 為內部元件）
import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

export function FieldErrorText({ id, children }: { id?: string | undefined; children: ReactNode }) {
  return (
    <p id={id} className="mt-2 flex items-start gap-1 text-sm leading-5 text-danger">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
