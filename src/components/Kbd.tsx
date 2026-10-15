// src/components/Kbd.tsx —— 鍵帽文字（例：c、Esc、Ctrl）；快速鍵說明對話框與徽章共用
import clsx from 'clsx';
import type { ComponentPropsWithRef } from 'react';

export interface KbdProps extends ComponentPropsWithRef<'kbd'> {
  /** `onBrand`：位於主色填滿的按鈕內，改為透明底 + 同字色邊框（03 §10.3 KeyHint 樣式） */
  tone?: 'default' | 'onBrand';
}

/** 行內鍵帽：最小 20×20、圓角 6、等寬字型。純文字呈現，不帶任何狀態。 */
export function Kbd({ tone = 'default', className, ...rest }: KbdProps) {
  return (
    <kbd
      className={clsx(
        'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[6px] border px-1.5',
        'font-mono text-xs leading-4 font-semibold whitespace-nowrap not-italic',
        tone === 'onBrand'
          ? 'border-current/60 bg-transparent text-on-brand'
          : 'border-border-strong bg-bg-muted text-text-sub',
        'forced-colors:border-[CanvasText]',
        className,
      )}
      {...rest}
    />
  );
}
