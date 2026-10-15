// src/components/fieldParts.tsx —— 表單欄位共用的 label / 說明 / 錯誤 / 計數（TextField、TextArea、Select、Checkbox；不對外匯出）
import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '@/i18n/zh-TW';
import { ICON_SM } from './internal';

interface FieldLabelProps {
  htmlFor: string;
  required?: boolean | undefined;
  optional?: boolean | undefined;
  children: ReactNode;
}

/** 必填 / 選填以文字說明，而非僅靠「*」（03 §10.6 #10）。 */
export function FieldLabel({ htmlFor, required, optional, children }: FieldLabelProps) {
  return (
    <label htmlFor={htmlFor} className="mb-2 block text-sm leading-5 font-semibold text-text">
      {children}
      {required === true ? (
        <span className="ml-1 font-normal text-text-muted">（{t.common.required}）</span>
      ) : optional === true ? (
        <span className="ml-1 font-normal text-text-muted">（{t.common.optional}）</span>
      ) : null}
    </label>
  );
}

export function FieldHint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 text-xs leading-4 text-text-muted">
      {children}
    </p>
  );
}

/** 錯誤一律「圖示 + 文字 + 顏色」，不只靠顏色（WCAG 1.4.1）；以 aria-describedby 關聯而非 live region。 */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 flex items-start gap-1 text-sm leading-5 text-danger">
      <CircleAlert aria-hidden="true" className={`${ICON_SM} mt-0.5`} />
      <span>{children}</span>
    </p>
  );
}

export function FieldCounter({ id, current, max }: { id: string; current: number; max: number }) {
  return (
    <p
      id={id}
      className={
        current > max
          ? 'mt-1 text-right text-xs leading-4 font-semibold text-danger tabular-nums'
          : 'mt-1 text-right text-xs leading-4 text-text-muted tabular-nums'
      }
    >
      {current}/{max}
    </p>
  );
}

/** 輸入元件共用的外觀（TextField / TextArea / Select）。 */
export const INPUT_CLASS =
  'block w-full min-h-(--hit-size) rounded-md border border-border-input bg-bg px-3 py-2 text-base leading-6 text-text ' +
  'placeholder:text-text-muted ' +
  'focus-visible:border-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-text ' +
  'disabled:cursor-not-allowed disabled:border-border disabled:bg-bg-muted disabled:text-text-disabled ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--color-danger)] ' +
  'read-only:bg-bg-subtle';
