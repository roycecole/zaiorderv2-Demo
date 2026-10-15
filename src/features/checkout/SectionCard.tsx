// src/features/checkout/SectionCard.tsx —— 結帳頁區塊外框：編號圓章 + h2 標題（03 PG-04）
import type { ReactNode } from 'react';
import clsx from 'clsx';

export interface SectionCardProps {
  /** 區塊編號（①～⑨）；僅視覺，標題已足以辨識 */
  index: number;
  title: ReactNode;
  headingId: string;
  /** 標題右側的補充（例：店家地址、訂單項數） */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SectionCard({
  index,
  title,
  headingId,
  aside,
  children,
  className,
}: SectionCardProps) {
  return (
    <section
      aria-labelledby={headingId}
      className={clsx('rounded-lg border border-border bg-bg p-4 kiosk:p-6', className)}
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          aria-hidden="true"
          className="grid size-6 shrink-0 place-items-center rounded-full bg-bg-muted text-xs leading-4 font-semibold text-text-sub"
        >
          {index}
        </span>
        <h2 id={headingId} className="text-h3 font-semibold text-text">
          {title}
        </h2>
        {aside !== undefined && aside !== null ? (
          <span className="ml-auto text-sm leading-5 text-text-muted">{aside}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}
