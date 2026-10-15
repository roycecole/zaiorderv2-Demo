// src/features/orders/OrderCard.tsx —— CMP-24 歷史訂單卡：編號、時間、類型、狀態、摘要、金額、動作（PG-07）
import { RotateCcw } from 'lucide-react';
import { Link } from 'react-router';
import { ROUTES } from '@/app/routes';
import { Button, Card, Price, buttonClassName } from '@/components';
import { formatDateTime } from '@/domain/format';
import type { OrderSummary } from '@/domain/types';
import { orders as tOrders } from '@/i18n/strings/orders';
import { OrderStatusBadge } from './OrderStatusBadge';

export interface OrderCardProps {
  order: OrderSummary;
  /** 提供則顯示「再來一單」；可回傳 Promise（按鈕在完成前顯示 loading） */
  onReorder?: (order: OrderSummary) => void | Promise<unknown>;
  /** 此張卡片正在處理再來一單（由父層持有，供多張卡片互斥） */
  reordering?: boolean;
}

export function OrderCard({ order, onReorder, reordering = false }: OrderCardProps) {
  const s = tOrders.history.card;
  const type = tOrders.orderType[order.orderType];
  const titleId = `order-card-${order.id}`;

  return (
    <Card as="article" aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base leading-6 font-bold text-text">
            <span className="text-text-sub font-medium">{tOrders.orderNo} </span>
            <span className="font-mono [overflow-wrap:anywhere]">{order.orderNo}</span>
          </h2>
          <p className="mt-0.5 text-sm leading-5 text-text-muted">
            {s.placedAt(formatDateTime(order.placedAt))}
          </p>
        </div>
        <OrderStatusBadge status={order.status} orderType={order.orderType} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-5 text-text-sub">
        <span className="font-semibold text-text">{type}</span>
        <span>
          {tOrders.pickupNo} <span className="font-mono font-semibold text-text">{order.pickupNo}</span>
        </span>
        {order.scheduledAt !== null ? <span>{s.scheduled(formatDateTime(order.scheduledAt))}</span> : null}
      </div>

      <p className="text-base leading-6 text-text [overflow-wrap:anywhere]">{order.itemsPreview}</p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Price amount={order.total} size="lg" />
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={ROUTES.order(order.id)}
            aria-label={s.detailLabel(order.orderNo)}
            className={buttonClassName({ variant: 'secondary' })}
          >
            {s.detail}
          </Link>
          {onReorder !== undefined ? (
            <Button
              variant="primary"
              aria-label={s.reorderLabel(order.orderNo)}
              leadingIcon={<RotateCcw aria-hidden="true" className="size-4" />}
              loading={reordering}
              onClick={() => onReorder(order)}
            >
              {s.reorder}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
