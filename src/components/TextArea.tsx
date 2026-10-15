// src/components/TextArea.tsx —— 多行文字輸入（備註等）
import clsx from 'clsx';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useFieldIds } from '@/hooks/useFieldIds';
import { FieldCounter, FieldError, FieldHint, FieldLabel, INPUT_CLASS } from './fieldParts';

export interface TextAreaProps extends Omit<ComponentPropsWithRef<'textarea'>, 'children'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null | undefined;
  required?: boolean;
  optional?: boolean;
  /** 字數計數；常搭配 `maxLength`（例：備註 0/50） */
  counter?: { current: number; max: number };
  containerClassName?: string;
}

/** 預設 3 列、不可手動調整大小（版面穩定）；其餘規則同 TextField。 */
export function TextArea({
  label,
  hint,
  error,
  required = false,
  optional = false,
  counter,
  containerClassName,
  className,
  id: idProp,
  rows = 3,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: TextAreaProps) {
  const ids = useFieldIds('textarea');
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
      <textarea
        {...rest}
        id={id}
        rows={rows}
        aria-required={required ? true : undefined}
        aria-invalid={hasError ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={clsx(INPUT_CLASS, 'min-h-[72px] resize-none kiosk:min-h-[88px]', className)}
      />
      {hint !== undefined && hint !== null ? <FieldHint id={ids.hintId}>{hint}</FieldHint> : null}
      {hasError ? <FieldError id={ids.errorId}>{error}</FieldError> : null}
      {counter ? (
        <FieldCounter id={ids.counterId} current={counter.current} max={counter.max} />
      ) : null}
    </div>
  );
}
