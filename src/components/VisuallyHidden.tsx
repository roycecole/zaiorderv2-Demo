// src/components/VisuallyHidden.tsx —— 僅供輔助科技讀取的文字（CMP-39 LiveAnnouncer、補充說明等）
import clsx from 'clsx';
import type { ComponentPropsWithRef, ElementType } from 'react';

export interface VisuallyHiddenProps extends ComponentPropsWithRef<'span'> {
  /** 渲染的元素，預設 span */
  as?: ElementType;
}

/** 視覺隱藏、但保留於可存取性樹。需要「取得焦點才顯示」（跳過連結）請用 `className="sr-only focus:not-sr-only"`。 */
export function VisuallyHidden({ as, className, ...rest }: VisuallyHiddenProps) {
  const Tag: ElementType = as ?? 'span';
  return <Tag className={clsx('sr-only', className)} {...rest} />;
}
