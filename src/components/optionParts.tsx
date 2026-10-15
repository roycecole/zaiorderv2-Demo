// src/components/optionParts.tsx —— RadioGroup / CheckboxGroup 共用的群組外殼與選項卡（不對外匯出）
import clsx from 'clsx';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { useFieldIds } from '@/hooks/useFieldIds';
import { FieldError, FieldHint } from './fieldParts';
import { formatPriceDelta } from './Price';

export type OptionColumns = 1 | 2 | 3 | 'auto';

export interface OptionGroupShellProps {
  /** 群組名稱（`<legend>`，群組的可存取名稱；規則文字會一併成為名稱的一部分） */
  legend: ReactNode;
  /** 規則徽章文字，例：「必選・單選」「選填・最多 3 項」（03 §6.5） */
  rule?: ReactNode;
  /** required：深色底白字（必選，**不用 danger 色**）；optional：淡灰底 */
  ruleTone?: 'required' | 'optional';
  hint?: ReactNode;
  /** 群組層級錯誤（顯示於標頭下方；送出時由呼叫端捲動並聚焦第一個錯誤群組） */
  error?: string | null | undefined;
  /** 欄數：1 = 清單（價差於右側）；2、3 = 並排卡片；auto = 依寬度自動（最小 104px） */
  columns?: OptionColumns;
  /** 視覺隱藏 legend（名稱仍保留給輔助科技） */
  hideLegend?: boolean;
  required?: boolean;
  disabled?: boolean;
  role?: 'radiogroup';
  className?: string;
  children: ReactNode;
}

const GRID: Record<OptionColumns, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  auto: 'grid-cols-[repeat(auto-fit,minmax(104px,1fr))] kiosk:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]',
};

export function OptionGroupShell({
  legend,
  rule,
  ruleTone = 'optional',
  hint,
  error,
  columns = 1,
  hideLegend = false,
  required = false,
  disabled = false,
  role,
  className,
  children,
}: OptionGroupShellProps) {
  const ids = useFieldIds('optgroup');
  const hasError = typeof error === 'string' && error.length > 0;
  const hasHint = hint !== undefined && hint !== null;
  return (
    <fieldset
      role={role}
      disabled={disabled}
      aria-required={required && role === 'radiogroup' ? true : undefined}
      aria-invalid={hasError ? true : undefined}
      aria-describedby={ids.describedBy({ hint: hasHint, error: hasError })}
      className={clsx('m-0 min-w-0 border-0 p-0', className)}
    >
      <legend
        className={clsx(
          'float-left mb-2 flex items-center justify-between gap-2 p-0',
          hideLegend ? 'sr-only' : 'w-full',
        )}
      >
        <span className="text-base leading-6 font-semibold text-text">{legend}</span>
        {rule !== undefined && rule !== null ? ' ' : null}
        {rule !== undefined && rule !== null ? (
          <span
            className={clsx(
              'inline-flex h-5 shrink-0 items-center rounded-pill px-2 text-xs leading-4 whitespace-nowrap',
              ruleTone === 'required'
                ? 'bg-text font-semibold text-bg'
                : 'bg-bg-muted font-medium text-text-sub',
              'forced-colors:border forced-colors:border-[CanvasText]',
            )}
          >
            {rule}
          </span>
        ) : null}
      </legend>
      <div className="clear-both">
        {hasHint ? <FieldHint id={ids.hintId}>{hint}</FieldHint> : null}
        {hasError ? <FieldError id={ids.errorId}>{error}</FieldError> : null}
        <div
          className={clsx(
            'grid gap-2',
            hasHint || hasError ? 'mt-2' : null,
            GRID[columns],
            'kiosk:gap-3',
          )}
        >
          {children}
        </div>
      </div>
    </fieldset>
  );
}

export interface OptionCardCommonProps {
  label: ReactNode;
  /** 標題下方的補充說明（付款方式的說明等） */
  description?: ReactNode;
  /** 前置圖示（付款方式、取餐方式；lucide，不需自行加 aria-hidden） */
  icon?: ReactNode;
  /** 價差：> 0 顯示「+NT$ 12」、< 0 顯示「−NT$ 12」、0 / 未提供不顯示 */
  priceDelta?: number;
  /** 不可選；搭配 `disabledReason` 說明原因（例：「暫無供應」） */
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}

interface OptionCardProps extends OptionCardCommonProps {
  type: 'radio' | 'checkbox';
  name: string | undefined;
  value: string;
  checked: boolean;
  onSelect: () => void;
  /** 價差 / 原因放在標題下方（並排欄位）而非右側（清單） */
  stacked: boolean;
}

export function OptionCard({
  type,
  name,
  value,
  checked,
  onSelect,
  label,
  description,
  icon,
  priceDelta,
  disabled = false,
  disabledReason,
  stacked,
  className,
}: OptionCardProps) {
  const ids = useFieldIds('opt');
  const side = disabled && disabledReason ? disabledReason : formatPriceDelta(priceDelta);
  const hasDescription = description !== undefined && description !== null;
  const labelId = `${ids.id}-label`;
  const descId = `${ids.id}-desc`;
  const sideId = `${ids.id}-side`;
  const describedBy = [hasDescription ? descId : undefined, side ? sideId : undefined]
    .filter(Boolean)
    .join(' ');

  return (
    <label
      className={clsx(
        'group relative flex min-h-13 min-w-0 items-center gap-2 rounded-md border px-3 py-2 transition-colors duration-150',
        'kiosk:min-h-16 kiosk:gap-3 kiosk:px-4',
        disabled
          ? 'cursor-not-allowed border-border bg-bg-muted'
          : 'cursor-pointer border-border-strong bg-bg hover:bg-bg-subtle',
        'has-[:checked]:border-brand has-[:checked]:bg-brand-soft',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-text',
        className,
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        aria-labelledby={labelId}
        aria-describedby={describedBy || undefined}
        className="absolute inset-0 m-0 size-full cursor-[inherit] opacity-0"
      />
      <span
        aria-hidden="true"
        className={clsx(
          'grid size-5 shrink-0 place-items-center border-[1.5px] bg-bg text-on-brand kiosk:size-7',
          type === 'radio' ? 'rounded-full' : 'rounded-[6px]',
          disabled ? 'border-border' : 'border-border-input',
          'group-has-[:checked]:border-brand group-has-[:checked]:bg-brand',
        )}
      >
        <Check
          strokeWidth={3}
          className="size-3.5 opacity-0 group-has-[:checked]:opacity-100 kiosk:size-5"
        />
      </span>
      {icon !== undefined && icon !== null ? (
        <span
          aria-hidden="true"
          className={clsx(
            'shrink-0 [&>svg]:size-(--icon-size)',
            disabled
              ? 'text-text-disabled'
              : 'text-text-muted group-has-[:checked]:text-brand-text',
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          id={labelId}
          className={clsx(
            'text-sm leading-5 [overflow-wrap:anywhere] kiosk:text-base kiosk:leading-6',
            disabled
              ? 'font-medium text-text-disabled'
              : 'font-medium text-text group-has-[:checked]:font-semibold group-has-[:checked]:text-brand-text',
          )}
        >
          {label}
        </span>
        {hasDescription ? (
          <span id={descId} className="text-xs leading-4 text-text-muted">
            {description}
          </span>
        ) : null}
        {stacked && side ? (
          <span id={sideId} className="text-xs leading-4 text-text-muted tabular-nums">
            {side}
          </span>
        ) : null}
      </span>
      {!stacked && side ? (
        <span
          id={sideId}
          className="shrink-0 text-sm leading-5 whitespace-nowrap text-text-muted tabular-nums"
        >
          {side}
        </span>
      ) : null}
    </label>
  );
}
