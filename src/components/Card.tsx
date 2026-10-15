// src/components/Card.tsx —— 卡片容器：白底 + 細邊框 + 極淺陰影（03 §4.4）
import clsx from 'clsx';
import type { ComponentPropsWithRef, ElementType } from 'react';

export interface CardProps extends ComponentPropsWithRef<'div'> {
  /** 渲染的元素，預設 div；清單項目用 `li`、獨立內容用 `article` / `section` */
  as?: ElementType;
  /** 內距：none 0、sm 12、md 16（預設）、lg 24 */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /**
   * default：白底實線框；subtle：淡灰底（次要區塊）；dashed：虛線框（提示卡，例如訂單保存提示）。
   */
  tone?: 'default' | 'subtle' | 'dashed';
  /** 可點擊 / 可聚焦的卡片：hover 時加深陰影（僅 hover 裝置）。實際可互動性由使用者在內部放按鈕或連結。 */
  interactive?: boolean;
}

const PADDING = { none: 'p-0', sm: 'p-3', md: 'p-4', lg: 'p-6' } as const;

export function Card({
  as,
  padding = 'md',
  tone = 'default',
  interactive = false,
  className,
  ...rest
}: CardProps) {
  const Tag: ElementType = as ?? 'div';
  return (
    <Tag
      className={clsx(
        'min-w-0 rounded-lg border',
        PADDING[padding],
        tone === 'default' && 'border-border bg-bg shadow-sm',
        tone === 'subtle' && 'border-border bg-bg-subtle',
        tone === 'dashed' && 'border-dashed border-border-strong bg-bg-subtle',
        interactive && 'transition-shadow duration-150 hover:shadow-md',
        className,
      )}
      {...rest}
    />
  );
}
