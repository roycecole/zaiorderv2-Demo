// src/components/Select.tsx —— 原生 select 包裝（CMP-04；行動裝置體驗優先使用原生）
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useFieldIds } from '@/hooks/useFieldIds';
import { FieldError, FieldHint, FieldLabel, INPUT_CLASS } from './fieldParts';
import { ICON } from './internal';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'children'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null | undefined;
  required?: boolean;
  optional?: boolean;
  /** 選項清單；或改以 `children` 傳入 `<option>` / `<optgroup>` */
  options?: ReadonlyArray<SelectOption>;
  /** 空值提示（value 為空字串的第一個選項）：例「請選擇縣市」 */
  placeholder?: string;
  children?: ReactNode;
  containerClassName?: string;
}

export function Select({
  label,
  hint,
  error,
  required = false,
  optional = false,
  options,
  placeholder,
  children,
  containerClassName,
  className,
  id: idProp,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: SelectProps) {
  const ids = useFieldIds('select');
  const id = idProp ?? ids.id;
  const hasError = typeof error === 'string' && error.length > 0;
  const describedBy = [
    ids.describedBy({ hint: hint !== undefined && hint !== null, error: hasError }),
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
        <select
          {...rest}
          id={id}
          aria-required={required ? true : undefined}
          aria-invalid={hasError ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={clsx(INPUT_CLASS, 'appearance-none pr-10', className)}
        >
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options?.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className={`${ICON} pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-text-muted`}
        />
      </div>
      {hint !== undefined && hint !== null ? <FieldHint id={ids.hintId}>{hint}</FieldHint> : null}
      {hasError ? <FieldError id={ids.errorId}>{error}</FieldError> : null}
    </div>
  );
}
