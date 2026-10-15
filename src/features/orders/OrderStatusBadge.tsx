// src/features/orders/OrderStatusBadge.tsx —— 訂單狀態徽章：圖示 + 文字 + 顏色（狀態不只靠顏色；03 §10.5）
import clsx from 'clsx';
import {
  CircleCheck,
  CircleX,
  ChefHat,
  Clock,
  Hourglass,
  PackageCheck,
  Truck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { OrderStatus, OrderType } from '@/domain/types';
import { statusLabel } from './orderView';

const STYLE: Record<OrderStatus, { box: string; Icon: LucideIcon }> = {
  PENDING_PAYMENT: { box: 'bg-warning-soft text-warning', Icon: Clock },
  PENDING: { box: 'bg-info-soft text-info', Icon: Hourglass },
  ACCEPTED: { box: 'bg-brand-soft text-brand-text', Icon: ChefHat },
  READY: { box: 'bg-success-soft text-success', Icon: PackageCheck },
  DELIVERING: { box: 'bg-info-soft text-info', Icon: Truck },
  COMPLETED: { box: 'bg-bg-muted text-text-sub', Icon: CircleCheck },
  CANCELLED: { box: 'bg-danger-soft text-danger', Icon: CircleX },
};

export interface OrderStatusBadgeProps {
  status: OrderStatus;
  orderType: OrderType;
  /** md：清單卡片；lg：訂單頁狀態卡 */
  size?: 'md' | 'lg';
  /** 狀態名稱之後的補充（例：「・預計 12:35 可取餐」） */
  suffix?: string;
  className?: string;
}

export function OrderStatusBadge({
  status,
  orderType,
  size = 'md',
  suffix,
  className,
}: OrderStatusBadgeProps) {
  const { box, Icon } = STYLE[status];
  return (
    <span
      className={clsx(
        'inline-flex max-w-full items-center gap-1.5 rounded-pill font-semibold',
        'forced-colors:border forced-colors:border-[CanvasText]',
        size === 'lg'
          ? 'min-h-9 px-3 py-1 text-sm leading-5 kiosk:min-h-11 kiosk:px-4 kiosk:text-base'
          : 'min-h-6 px-2.5 py-0.5 text-xs leading-4',
        box,
        className,
      )}
    >
      <Icon aria-hidden="true" className={size === 'lg' ? 'size-4 shrink-0' : 'size-3.5 shrink-0'} />
      <span className="min-w-0">
        {statusLabel(status, orderType)}
        {suffix !== undefined ? suffix : null}
      </span>
    </span>
  );
}
