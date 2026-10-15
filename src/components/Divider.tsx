// src/components/Divider.tsx —— 分隔線（僅裝飾，--color-border）
import clsx from 'clsx';

export interface DividerProps {
  /** 垂直分隔線需放在 flex 容器內 */
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

/** 純視覺分隔：`aria-hidden`，不進入可存取性樹；章節切分請用標題與 landmark。 */
export function Divider({ orientation = 'horizontal', className }: DividerProps) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch',
        className,
      )}
    />
  );
}
