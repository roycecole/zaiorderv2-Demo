// src/components/Stepper.tsx —— 數量步進器（CMP-07）：`− n ＋`
import clsx from 'clsx';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useFieldIds } from '@/hooks/useFieldIds';
import { t } from '@/i18n/zh-TW';
import { VisuallyHidden } from './VisuallyHidden';

export interface StepperProps {
  value: number;
  onChange: (next: number) => void;
  /** 最小值，預設 1（購物車 / 商品面板不允許 0；0 = 移除請用 `onRemove`） */
  min?: number;
  /**
   * 最大值，預設 20。呼叫端傳入 `min(20, maxAddable)`（剩餘份數扣除購物車內同商品其他行，04 `maxAddable`）。
   * 達上限時 `＋` 以 `aria-disabled` 停用（保留焦點）。
   */
  max?: number;
  /** 達上限的原因文字（例：「今日只剩 5 份，已達上限」）；與「此品項已達上限 20 份」分開傳入 */
  maxReason?: string;
  /** `false`：不顯示原因文字，但仍以視覺隱藏方式關聯到 `＋`（呼叫端自行在別處顯示） */
  showMaxReason?: boolean;
  /** md：按鈕視覺 36（熱區 ≥ 44）；lg：44（商品面板 footer、購物車） */
  size?: 'md' | 'lg';
  /** 可存取名稱，建議為「{品名} 數量」 */
  label: string;
  /**
   * 購物車變體：數量為最小值時，`−` 變為「移除」（垃圾桶圖示）並呼叫此函式
   * （通常用來開確認對話框，不要直接刪除）。
   */
  onRemove?: () => void;
  /** 移除鈕的名稱，預設「移除」；建議含品名，例「移除招牌滷肉飯」 */
  removeLabel?: string;
  decreaseLabel?: string;
  increaseLabel?: string;
  disabled?: boolean;
  /** 是否以 aria-live 播報數量變動（使用者操作後），預設 true；已由 LiveAnnouncer 統一播報時設 false */
  announce?: boolean;
  className?: string;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * 鍵盤：焦點在步進器內（`−`、`＋` 或數量）時 `↑` / `↓` 增減；數量元素（`role="spinbutton"`）上 `Home` / `End` 跳到最小 / 最大。
 * `+` / `-` 字元鍵由全域快速鍵登錄表處理（03 §10.3），元件不監聽。
 * 可處理的方向鍵會 `stopPropagation`，避免同時觸發商品網格的 roving tabindex。
 */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 20,
  maxReason,
  showMaxReason = true,
  size = 'md',
  label,
  onRemove,
  removeLabel,
  decreaseLabel,
  increaseLabel,
  disabled = false,
  announce = true,
  className,
}: StepperProps) {
  const ids = useFieldIds('stepper');
  const [announcement, setAnnouncement] = useState('');

  const atMax = value >= max;
  const atMin = value <= min;
  const removeMode = atMin && onRemove !== undefined;
  const reasonVisible = atMax && maxReason !== undefined && maxReason.length > 0;

  const commit = (next: number): void => {
    const target = clamp(next, min, max);
    if (target === value) return;
    onChange(target);
    if (announce) setAnnouncement(`${label} ${target}`);
  };

  const handleMinus = (event: MouseEvent<HTMLButtonElement>): void => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    if (removeMode) {
      onRemove();
      return;
    }
    if (!atMin) commit(value - 1);
  };
  const handlePlus = (event: MouseEvent<HTMLButtonElement>): void => {
    if (disabled || atMax) {
      event.preventDefault();
      return;
    }
    commit(value + 1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (disabled) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (!atMax) commit(value + 1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      if (!atMin) commit(value - 1);
    } else if (event.key === 'Home' && event.currentTarget.getAttribute('role') === 'spinbutton') {
      event.preventDefault();
      commit(min);
    } else if (event.key === 'End' && event.currentTarget.getAttribute('role') === 'spinbutton') {
      event.preventDefault();
      commit(max);
    }
  };

  const btn = clsx(
    'relative grid shrink-0 place-items-center rounded-full select-none transition-colors duration-150',
    size === 'lg' ? 'size-(--hit-size)' : 'hit-area size-9 kiosk:size-(--hit-size)',
  );
  const inactive = 'cursor-not-allowed bg-bg-muted text-text-disabled';

  const minusInactive = disabled || (atMin && !removeMode);
  const plusInactive = disabled || atMax;

  return (
    <div className={clsx('inline-flex flex-col items-end gap-1', className)}>
      <div role="group" aria-label={label} className="inline-flex items-center">
        <button
          type="button"
          aria-label={
            removeMode
              ? (removeLabel ?? t.common.remove)
              : (decreaseLabel ?? t.common.stepper.decrease)
          }
          aria-disabled={minusInactive ? true : undefined}
          onClick={handleMinus}
          onKeyDown={handleKeyDown}
          className={clsx(
            btn,
            minusInactive
              ? inactive
              : removeMode
                ? 'bg-bg-muted text-danger hover:bg-danger-soft active:bg-danger-soft'
                : 'bg-bg-muted text-text hover:bg-border active:bg-border',
          )}
        >
          {removeMode ? (
            <Trash2 aria-hidden="true" className="size-5 kiosk:size-6" />
          ) : (
            <Minus aria-hidden="true" className="size-5 kiosk:size-6" strokeWidth={2.5} />
          )}
        </button>
        <span
          role="spinbutton"
          tabIndex={-1}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-disabled={disabled ? true : undefined}
          onKeyDown={handleKeyDown}
          className={clsx(
            'text-center text-base leading-6 font-semibold text-text tabular-nums',
            size === 'lg' ? 'min-w-9 kiosk:min-w-(--hit-size)' : 'min-w-7 kiosk:min-w-(--hit-size)',
            'kiosk:flex kiosk:min-h-(--hit-size) kiosk:items-center kiosk:justify-center kiosk:text-h3',
          )}
        >
          {value}
        </span>
        <button
          type="button"
          aria-label={increaseLabel ?? t.common.stepper.increase}
          aria-disabled={plusInactive ? true : undefined}
          aria-describedby={atMax && maxReason ? ids.hintId : undefined}
          onClick={handlePlus}
          onKeyDown={handleKeyDown}
          className={clsx(
            btn,
            plusInactive
              ? inactive
              : 'bg-brand text-on-brand hover:bg-brand-hover active:bg-brand-hover focus-ring-fill',
          )}
        >
          <Plus aria-hidden="true" className="size-5 kiosk:size-6" strokeWidth={2.5} />
        </button>
      </div>
      {reasonVisible && showMaxReason ? (
        <p id={ids.hintId} className="max-w-48 text-right text-xs leading-4 text-warning">
          {maxReason}
        </p>
      ) : null}
      {reasonVisible && !showMaxReason ? (
        <VisuallyHidden id={ids.hintId}>{maxReason}</VisuallyHidden>
      ) : null}
      {announce ? (
        <VisuallyHidden aria-live="polite" aria-atomic="true">
          {announcement}
        </VisuallyHidden>
      ) : null}
    </div>
  );
}
