// src/components/TextField.tsx —— 單行文字輸入（CMP-03）
import clsx from 'clsx';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useFieldIds } from '@/hooks/useFieldIds';
import { FieldCounter, FieldError, FieldHint, FieldLabel, INPUT_CLASS } from './fieldParts';

export interface TextFieldProps extends Omit<ComponentPropsWithRef<'input'>, 'size' | 'children'> {
  /** 可見標籤（必填；每個欄位都要有可見 label，03 §10.6 #10） */
  label: ReactNode;
  /** 說明文字（欄位下方，以 aria-describedby 關聯） */
  hint?: ReactNode;
  /** 錯誤文字；有值即套用 `aria-invalid="true"` 與錯誤樣式 */
  error?: string | null | undefined;
  /** 必填：標籤後以文字「（必填）」標示，並輸出 `aria-required` */
  required?: boolean;
  /** 選填：標籤後以文字「（選填）」標示 */
  optional?: boolean;
  /** 字數計數（顯示於欄位下方）：`current` 為目前字數，`max` 為上限 */
  counter?: { current: number; max: number };
  /** 輸入框右側的附屬內容（清除鈕、單位等；自行確保可存取名稱） */
  endAdornment?: ReactNode;
  /** 外層容器 class（`className` 套用於 input 本身） */
  containerClassName?: string;
}

/**
 * 輸入框字級固定 ≥ 16px（避免 iOS 聚焦縮放）。常用屬性請明確給：
 * `type` / `inputMode` / `autoComplete` / `enterKeyHint`（例：手機 `type="tel" inputMode="numeric" autoComplete="tel"`）。
 * 與 react-hook-form 搭配：`<TextField label="姓名" {...register('name')} error={errors.name?.message} />`。
 */
export function TextField({
  label,
  hint,
  error,
  required = false,
  optional = false,
  counter,
  endAdornment,
  containerClassName,
  className,
  id: idProp,
  type = 'text',
  'aria-describedby': ariaDescribedBy,
  ...rest
}: TextFieldProps) {
  const ids = useFieldIds('textfield');
  const id = idProp ?? ids.id;
  const hasError = typeof error === 'string' && error.length > 0;
  const describedBy = [
    ids.describedBy({
      hint: hint !== undefined && hint !== null,
      error: hasError,
      counter: counter !== undefined,
    }),
    ariaDescribedBy,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={clsx('block min-w-0', containerClassName)}>
      <FieldLabel htmlFor={id} required={required} optional={optional}>
        {label}
      </FieldLabel>
      <div className="relative">
        <input
          {...rest}
          id={id}
          type={type}
          aria-required={required ? true : undefined}
          aria-invalid={hasError ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={clsx(INPUT_CLASS, endAdornment !== undefined && 'pr-12', className)}
        />
        {endAdornment !== undefined ? (
          <div className="absolute inset-y-0 right-1 flex items-center">{endAdornment}</div>
        ) : null}
      </div>
      {hint !== undefined && hint !== null ? <FieldHint id={ids.hintId}>{hint}</FieldHint> : null}
      {hasError ? <FieldError id={ids.errorId}>{error}</FieldError> : null}
      {counter ? (
        <FieldCounter id={ids.counterId} current={counter.current} max={counter.max} />
      ) : null}
    </div>
  );
}
