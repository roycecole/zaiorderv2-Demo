// src/components/IconButton.tsx —— 圖示按鈕（CMP-02）：必附 aria-label，熱區 ≥ --hit-size
import clsx from 'clsx';
import { useState } from 'react';
import type { ComponentPropsWithRef, FocusEvent, KeyboardEvent, ReactNode } from 'react';
import { useFieldIds } from '@/hooks/useFieldIds';
import { hasPositionClass } from './internal';
import { Spinner } from './Spinner';

export interface IconButtonStyleOptions {
  /** ghost：透明底（預設）；soft：淡灰底；outline：細邊框；filled：品牌色填滿 */
  variant?: 'ghost' | 'soft' | 'outline' | 'filled';
  /** md：44（觸控面板 56）；sm：視覺 36，但熱區仍擴大至 --hit-size */
  size?: 'md' | 'sm';
  className?: string;
}

const VARIANT = {
  ghost: 'border-transparent bg-transparent text-text hover:bg-bg-muted active:bg-bg-muted',
  soft: 'border-transparent bg-bg-muted text-text hover:bg-border active:bg-border',
  outline: 'border-border-strong bg-bg text-text hover:bg-bg-muted active:bg-bg-muted',
  filled: 'border-transparent bg-brand text-on-brand hover:bg-brand-hover active:bg-brand-hover focus-ring-fill',
} as const;

/** 取得 IconButton 的 class，供 router `<Link>` 做成圖示連結（例：購物車圖示連到 /cart）。 */
export function iconButtonClassName({
  variant = 'ghost',
  size = 'md',
  className,
}: IconButtonStyleOptions = {}): string {
  return clsx(
    !hasPositionClass(className) && 'relative',
    'inline-grid shrink-0 place-items-center rounded-full border select-none',
    'transition-colors duration-150 disabled:cursor-not-allowed disabled:text-text-disabled',
    size === 'md' ? 'size-(--hit-size)' : 'hit-area size-9 kiosk:size-(--hit-size)',
    VARIANT[variant],
    className,
  );
}

export interface IconButtonProps
  extends
    Omit<ComponentPropsWithRef<'button'>, 'children' | 'aria-label'>,
    Omit<IconButtonStyleOptions, 'className'> {
  /** 可存取名稱（必填）：說明這顆按鈕做什麼，例如「開啟購物車」 */
  label: string;
  /** 圖示（lucide，不需自行加 aria-hidden） */
  icon: ReactNode;
  /**
   * 顯示文字提示：`true` 以 label 為內容；字串則為自訂內容（不同於 label 時以 aria-describedby 關聯）。
   * hover 與鍵盤焦點皆會顯示、Esc 可關閉、可懸停（WCAG 1.4.13）；必要資訊不可只放在提示。
   */
  tooltip?: boolean | string;
  tooltipPlacement?: 'top' | 'bottom';
  /** 右上角計數徽章（例：購物車數量）；請同時把數量放進 label，例如「購物車，3 項」 */
  badge?: ReactNode;
  loading?: boolean;
}

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  tooltip,
  tooltipPlacement = 'bottom',
  badge,
  loading = false,
  type = 'button',
  className,
  onClick,
  onKeyDown,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: IconButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const { id, describedBy } = useFieldIds('icon-btn');

  const tooltipText =
    tooltip === undefined || tooltip === false ? null : tooltip === true ? label : tooltip;
  const tipId = `${id}-tip`;
  const tipDescribes = tooltipText !== null && tooltipText !== label;
  const showTip = tooltipText !== null && !dismissed && (hovered || focused);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    onKeyDown?.(event);
    if (event.key === 'Escape' && showTip) {
      setDismissed(true);
      event.stopPropagation();
    }
  };

  return (
    <button
      type={type}
      aria-label={label}
      aria-describedby={describedBy({ extra: tipDescribes && showTip ? tipId : undefined })}
      aria-busy={loading ? true : undefined}
      aria-disabled={loading ? true : undefined}
      className={iconButtonClassName({ variant, size, className })}
      onClick={(event) => {
        if (loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      onKeyDown={handleKeyDown}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        setHovered(true);
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        setHovered(false);
        setDismissed(false);
      }}
      onFocus={(event: FocusEvent<HTMLButtonElement>) => {
        onFocus?.(event);
        if (isFocusVisible(event.currentTarget)) setFocused(true);
      }}
      onBlur={(event: FocusEvent<HTMLButtonElement>) => {
        onBlur?.(event);
        setFocused(false);
        setDismissed(false);
      }}
      {...rest}
    >
      {loading ? (
        <Spinner size="sm" decorative />
      ) : (
        <span
          aria-hidden="true"
          className="inline-grid place-items-center [&>svg]:size-(--icon-size)"
        >
          {icon}
        </span>
      )}
      {badge !== undefined && badge !== null && badge !== false ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-0.5 -right-0.5 min-w-5 rounded-pill bg-brand px-1 text-center text-xs leading-5 font-bold text-on-brand tabular-nums shadow-[0_0_0_2px_var(--color-bg)] forced-colors:border"
        >
          {badge}
        </span>
      ) : null}
      {showTip ? (
        <span
          id={tipId}
          role="tooltip"
          className={clsx(
            'absolute left-1/2 z-60 -translate-x-1/2 rounded-sm bg-text px-2 py-1 text-xs leading-4 font-medium whitespace-nowrap text-bg shadow-md',
            tooltipPlacement === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
          )}
        >
          {tooltipText}
        </span>
      ) : null}
    </button>
  );
}
