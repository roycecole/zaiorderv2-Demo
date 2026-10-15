// src/components/Checkbox.tsx —— 勾選與開關（CMP-06）：標籤可點擊、原生 input（鍵盤與輔助科技行為由瀏覽器負責）
import clsx from 'clsx';
import { Check } from 'lucide-react';
import type { ChangeEvent, ComponentPropsWithRef, ReactNode } from 'react';
import { useFieldIds } from '@/hooks/useFieldIds';
import { FieldError } from './fieldParts';

interface CheckLikeBase extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'children' | 'size'> {
  label: ReactNode;
  /** 標籤下方的補充說明（以 aria-describedby 關聯） */
  description?: ReactNode;
  /** 便利回呼：直接取得布林值 */
  onCheckedChange?: (checked: boolean) => void;
  containerClassName?: string;
}

export interface CheckboxProps extends CheckLikeBase {
  /** 錯誤文字（例：同意條款未勾選）；有值即套用 `aria-invalid` */
  error?: string | null | undefined;
}

/** 整列可點（≥ --hit-size）；選取狀態以「勾號 + 填色」呈現，不只靠顏色。 */
export function Checkbox({
  label,
  description,
  error,
  onCheckedChange,
  onChange,
  containerClassName,
  className,
  id: idProp,
  disabled,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: CheckboxProps) {
  const ids = useFieldIds('checkbox');
  const id = idProp ?? ids.id;
  const hasError = typeof error === 'string' && error.length > 0;
  const labelId = `${id}-label`;
  const descId = `${id}-desc`;
  const describedBy = [
    description !== undefined && description !== null ? descId : undefined,
    hasError ? ids.errorId : undefined,
    ariaDescribedBy,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={clsx('min-w-0', containerClassName)}>
      <label
        className={clsx(
          'group relative flex min-h-(--hit-size) items-center gap-3',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        <input
          {...rest}
          id={id}
          type="checkbox"
          disabled={disabled}
          aria-labelledby={labelId}
          aria-invalid={hasError ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            onChange?.(event);
            onCheckedChange?.(event.target.checked);
          }}
          className={clsx(
            'peer absolute inset-0 m-0 size-full cursor-[inherit] opacity-0',
            className,
          )}
        />
        <span
          aria-hidden="true"
          className={clsx(
            'grid size-6 shrink-0 place-items-center rounded-[6px] border-[1.5px] border-border-input bg-bg text-on-brand',
            'peer-checked:border-brand peer-checked:bg-brand peer-checked:[&_svg]:opacity-100',
            'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-text',
            'peer-disabled:border-border peer-disabled:bg-bg-muted peer-disabled:text-text-disabled',
            'kiosk:size-7',
            hasError && 'border-danger',
          )}
        >
          <Check className="size-4 opacity-0" strokeWidth={3} />
        </span>
        <span className={clsx('min-w-0 text-base leading-6', disabled && 'text-text-disabled')}>
          <span id={labelId}>{label}</span>
          {description !== undefined && description !== null ? (
            <small id={descId} className="block text-sm leading-5 text-text-muted">
              {description}
            </small>
          ) : null}
        </span>
      </label>
      {hasError ? <FieldError id={ids.errorId}>{error}</FieldError> : null}
    </div>
  );
}

export interface SwitchProps extends CheckLikeBase {
  /** 開關名稱放在左側、開關在右側（設定列）；`false` 時開關在左 */
  labelFirst?: boolean;
}

/**
 * 開關（`<input type="checkbox" role="switch">`）：Space 切換、狀態以旋鈕位置 + 勾號呈現。
 * 立即生效的偏好（PG-19）使用；需要送出才生效的選項請用 Checkbox。
 */
export function Switch({
  label,
  description,
  onCheckedChange,
  onChange,
  labelFirst = true,
  containerClassName,
  className,
  id: idProp,
  disabled,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: SwitchProps) {
  const ids = useFieldIds('switch');
  const id = idProp ?? ids.id;
  const labelId = `${id}-label`;
  const descId = `${id}-desc`;
  const describedBy = [
    description !== undefined && description !== null ? descId : undefined,
    ariaDescribedBy,
  ]
    .filter(Boolean)
    .join(' ');

  const text = (
    <span className={clsx('min-w-0 flex-1 text-base leading-6', disabled && 'text-text-disabled')}>
      <span id={labelId} className="block font-semibold">
        {label}
      </span>
      {description !== undefined && description !== null ? (
        <small id={descId} className="block text-sm leading-5 font-normal text-text-muted">
          {description}
        </small>
      ) : null}
    </span>
  );
  const track = (
    <span
      aria-hidden="true"
      className={clsx(
        'relative h-8 w-13 shrink-0 rounded-pill bg-border-input transition-colors duration-150',
        'peer-checked:bg-brand peer-disabled:bg-border',
        'peer-checked:[&>span]:translate-x-5 peer-checked:[&_svg]:opacity-100',
        'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-text',
      )}
    >
      <span
        className={clsx(
          'absolute top-1 left-1 grid size-6 place-items-center rounded-full bg-white text-brand-text shadow-sm',
          'transition-transform duration-150',
        )}
      >
        <Check className="size-3.5 opacity-0" strokeWidth={3.5} />
      </span>
    </span>
  );

  return (
    <label
      className={clsx(
        'relative flex min-h-(--hit-size) items-center gap-4',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        containerClassName,
      )}
    >
      <input
        {...rest}
        id={id}
        type="checkbox"
        role="switch"
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={describedBy || undefined}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onChange?.(event);
          onCheckedChange?.(event.target.checked);
        }}
        className={clsx(
          'peer absolute inset-0 m-0 size-full cursor-[inherit] opacity-0',
          className,
        )}
      />
      {labelFirst ? text : track}
      {labelFirst ? track : text}
    </label>
  );
}
