// src/components/Button.tsx —— 按鈕（CMP-01）與連結按鈕（LinkButton）
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import type {
  ComponentPropsWithRef,
  ComponentPropsWithoutRef,
  ElementType,
  MouseEvent,
  ReactNode,
} from 'react';
import { hasPositionClass } from './internal';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

export interface ButtonStyleOptions {
  /**
   * primary：品牌色填滿（同一畫面最多 1 個）；secondary：品牌色外框；ghost：無框；
   * danger：危險 / 破壞性動作（固定 `--color-danger`，不使用品牌色）。
   */
  variant?: ButtonVariant;
  /** md：高 ≥ 44（觸控面板 56）；lg：高 ≥ 48（觸控面板 64，主要動作用） */
  size?: ButtonSize;
  fullWidth?: boolean;
  /** 以 `aria-disabled` 呈現的停用外觀（灰底灰字）；`loading` 時不使用，維持原色並顯示 spinner */
  inactive?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-brand text-on-brand hover:bg-brand-hover active:bg-brand-hover focus-ring-fill',
  secondary: 'border-brand bg-bg text-brand-text hover:bg-brand-soft active:bg-brand-soft',
  ghost:
    'border-transparent bg-transparent font-medium text-text-sub hover:bg-bg-muted hover:text-text active:bg-bg-muted',
  danger: 'border-transparent bg-danger text-white hover:bg-danger-hover active:bg-danger-hover focus-ring-fill',
};

const INACTIVE =
  'cursor-not-allowed border-transparent! bg-bg-muted! text-text-disabled! hover:bg-bg-muted! hover:text-text-disabled!';

/**
 * 取得 Button 的 class 字串，供需要「看起來像按鈕」的 `<a>` / router `<Link>` 使用
 * （components 層不得 import router）。
 * @example <Link to={ROUTES.cart} className={buttonClassName({ variant: 'primary', size: 'lg' })}>前往結帳</Link>
 */
export function buttonClassName({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  inactive = false,
  className,
}: ButtonStyleOptions & { className?: string } = {}): string {
  return clsx(
    !hasPositionClass(className) && 'relative',
    'items-center justify-center gap-2 rounded-pill border px-5 text-center text-base leading-6 font-semibold whitespace-nowrap no-underline select-none',
    'transition-colors duration-150',
    'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-bg-muted disabled:text-text-disabled',
    size === 'lg' ? 'min-h-(--hit-size-lg)' : 'min-h-(--hit-size)',
    fullWidth ? 'flex w-full' : 'inline-flex',
    VARIANT[variant],
    inactive && INACTIVE,
    className,
  );
}

export interface ButtonProps
  extends
    Omit<ComponentPropsWithRef<'button'>, 'onClick' | 'children'>,
    Omit<ButtonStyleOptions, 'inactive'> {
  /**
   * 送出中：`aria-busy` + `aria-disabled`（焦點保留、不使用 disabled），並忽略後續點擊（03 §5.6）。
   * 另外：`onClick` 若回傳 Promise，Button 會在其完成前自動視為 loading，避免重複觸發。
   */
  loading?: boolean;
  /** loading 時顯示的文字（例：「確認餐點與時段中…」）；未提供則沿用 children */
  loadingLabel?: ReactNode;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /** 可回傳 Promise；`aria-disabled="true"` 或 loading 時不會被呼叫 */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void | Promise<unknown>;
  children?: ReactNode;
}

const isTrue = (value: unknown): boolean => value === true || value === 'true';

/**
 * 預設 `type="button"`（避免在表單內誤送出）；送出請明確傳 `type="submit"`。
 * 停用有兩種：原生 `disabled`（不可聚焦）與 `aria-disabled="true"`（保留焦點與說明，點擊不動作，用於送出鈕等）。
 */
export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  loadingLabel,
  leadingIcon,
  trailingIcon,
  type = 'button',
  className,
  children,
  onClick,
  disabled,
  'aria-disabled': ariaDisabled,
  ...rest
}: ButtonProps) {
  const [pending, setPending] = useState(false);
  const lockRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const busy = loading || pending;
  const softDisabled = busy || isTrue(ariaDisabled);

  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (softDisabled || lockRef.current) {
      event.preventDefault();
      return;
    }
    const result = onClick?.(event);
    if (result !== undefined && typeof (result as Promise<unknown>).then === 'function') {
      lockRef.current = true;
      setPending(true);
      const settle = (): void => {
        lockRef.current = false;
        if (mountedRef.current) setPending(false);
      };
      (result as Promise<unknown>).then(settle, settle);
    }
  };

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-disabled={softDisabled ? true : undefined}
      aria-busy={busy ? true : undefined}
      onClick={handleClick}
      className={buttonClassName({
        variant,
        size,
        fullWidth,
        inactive: isTrue(ariaDisabled) && !busy,
        className,
      })}
    >
      {busy ? <Spinner size="sm" decorative /> : leadingIcon}
      {busy && loadingLabel !== undefined ? loadingLabel : children}
      {busy ? null : trailingIcon}
    </button>
  );
}

type LinkButtonOwnProps = ButtonStyleOptions & {
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export type LinkButtonProps<C extends ElementType = 'a'> = LinkButtonOwnProps & {
  /** 實際渲染的元素或元件，預設 `<a>`；例：`as={Link}`（react-router）並傳入 `to` */
  as?: C;
} & Omit<ComponentPropsWithoutRef<C>, keyof LinkButtonOwnProps | 'as'>;

/**
 * 外觀同 Button 的連結。components 層不依賴 router，因此以 `as` 注入連結元件：
 * @example <LinkButton as={Link} to="/cart" variant="secondary">看購物車</LinkButton>
 */
export function LinkButton<C extends ElementType = 'a'>({
  as,
  variant,
  size,
  fullWidth,
  inactive,
  leadingIcon,
  trailingIcon,
  className,
  children,
  ...rest
}: LinkButtonProps<C>) {
  const Tag: ElementType = as ?? 'a';
  return (
    <Tag className={buttonClassName({ variant, size, fullWidth, inactive, className })} {...rest}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </Tag>
  );
}
