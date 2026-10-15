// src/features/orders/OrderTimeline.tsx —— CMP-23 訂單進度時間軸（03 §6.4）
//
// 垂直有序清單：完成 ✔、進行中 ●、未達 ○、取消 ✕；目前步驟 `aria-current="step"`，
// 狀態同時以視覺隱藏的文字輸出（不只靠圖示與顏色）。
import clsx from 'clsx';
import { Check, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { VisuallyHidden } from '@/components';
import { formatTime } from '@/domain/format';
import { orders as tOrders } from '@/i18n/strings/orders';
import { buildTimeline } from './orderView';
import type { TimelineSource, TimelineStepState } from './orderView';

export interface OrderTimelineProps {
  order: TimelineSource;
  /** PENDING_PAYMENT 時顯示在「等待付款」列的倒數文字（例：「剩餘 12:30」）；省略則不顯示 */
  paymentCountdown?: ReactNode;
  className?: string;
}

type RowState = TimelineStepState | 'cancelled';

function Marker({ state }: { state: RowState }) {
  const base = 'relative z-10 grid size-7 shrink-0 place-items-center rounded-full border-2';
  switch (state) {
    case 'done':
      return (
        <span aria-hidden="true" className={clsx(base, 'border-brand bg-brand text-on-brand')}>
          <Check className="size-4" strokeWidth={3} />
        </span>
      );
    case 'current':
      return (
        <span
          aria-hidden="true"
          className={clsx(base, 'border-brand bg-bg shadow-[0_0_0_4px_var(--color-brand-soft-strong)]')}
        >
          <span className="size-3 rounded-full bg-brand" />
        </span>
      );
    case 'cancelled':
      return (
        <span aria-hidden="true" className={clsx(base, 'border-danger bg-danger text-white')}>
          <X className="size-4" strokeWidth={3} />
        </span>
      );
    default:
      return <span aria-hidden="true" className={clsx(base, 'border-border-strong bg-bg')} />;
  }
}

interface RowProps {
  state: RowState;
  last: boolean;
  label: string;
  time?: string | undefined;
  detail?: ReactNode;
  testId?: string;
}

function Row({ state, last, label, time, detail, testId }: RowProps) {
  const stateText = tOrders.stepState[state];
  return (
    <li
      aria-current={state === 'current' ? 'step' : undefined}
      data-state={state}
      data-testid={testId}
      className={clsx('relative flex gap-4 pb-5', last && 'pb-0')}
    >
      {!last ? (
        <span
          aria-hidden="true"
          className={clsx(
            'absolute top-7 bottom-0 left-[13px] w-0.5',
            state === 'done' ? 'bg-brand' : 'bg-border-strong',
          )}
        />
      ) : null}
      <Marker state={state} />
      <div className="flex min-w-0 flex-1 items-start justify-between gap-3 pt-0.5">
        <div className="min-w-0">
          <p
            className={clsx(
              'text-base leading-6',
              state === 'current' && 'font-bold text-text',
              state === 'done' && 'font-medium text-text',
              state === 'upcoming' && 'text-text-muted',
              state === 'cancelled' && 'font-bold text-danger',
            )}
          >
            {label}
            <VisuallyHidden>（{stateText}）</VisuallyHidden>
          </p>
          {detail !== undefined && detail !== null ? (
            <div className="mt-0.5 text-sm leading-5 text-text-sub">{detail}</div>
          ) : null}
        </div>
        {time !== undefined ? (
          <span className="shrink-0 pt-0.5 text-sm leading-5 text-text-muted tabular-nums">
            {time}
          </span>
        ) : null}
      </div>
    </li>
  );
}

interface RowModel {
  key: string;
  state: RowState;
  label: string;
  time?: string | undefined;
  detail?: ReactNode;
  testId: string;
}

export function OrderTimeline({ order, paymentCountdown, className }: OrderTimelineProps) {
  const model = buildTimeline(order);
  const s = tOrders.timeline;

  const rows: RowModel[] = [];
  if (model.awaitingPayment) {
    rows.push({
      key: 'awaiting-payment',
      state: 'current',
      label: s.awaitingPayment,
      detail: paymentCountdown,
      testId: 'timeline-awaiting-payment',
    });
  }
  for (const step of model.steps) {
    rows.push({
      key: step.key,
      state: step.state,
      label: step.label,
      time:
        step.at !== undefined
          ? formatTime(step.at)
          : step.expectedAt !== undefined
            ? s.expectedAt(formatTime(step.expectedAt))
            : undefined,
      testId: `timeline-${step.key}`,
    });
  }
  if (model.cancelled !== null) {
    const { by, reason, at } = model.cancelled;
    rows.push({
      key: 'cancelled',
      state: 'cancelled',
      label: s.cancelled,
      time: at !== undefined ? formatTime(at) : undefined,
      detail: (
        <>
          <span className="block">{tOrders.tracking.cancelledBy[by]}</span>
          {reason !== undefined ? (
            <span className="block">{tOrders.tracking.cancelReason(reason)}</span>
          ) : null}
        </>
      ),
      testId: 'timeline-cancelled',
    });
  }

  return (
    <ol aria-label={s.label} className={clsx('m-0 list-none p-0', className)}>
      {rows.map((row, i) => (
        <Row
          key={row.key}
          state={row.state}
          last={i === rows.length - 1}
          label={row.label}
          time={row.time}
          detail={row.detail}
          testId={row.testId}
        />
      ))}
    </ol>
  );
}
