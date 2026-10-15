// src/features/checkout/QrTableStrip.tsx —— 菜單 / 購物車頁頂部的 QR 桌號提示（03 PG-01、FR-CK-05；08 S10）
//
// 辨識成功：「內用・桌號 A3」徽章 + 取餐方式已固定的說明；確認中：同高度的狀態列，避免版面位移；
// 無法辨識或店家未開放內用：警示並說明已回到一般點餐（文案與結帳頁一致）。
// 購物車頁（variant="cart"）的鎖定原因由取餐方式切換自己說明，這裡只在需要回退時提示。
import clsx from 'clsx';
import { UtensilsCrossed } from 'lucide-react';
import { InlineAlert } from '@/components';
import { t } from '@/i18n/zh-TW';
import { useQrTable } from './useQrTable';

export interface QrTableStripProps {
  /** `menu`：顯示徽章與說明；`cart`：只在回退時提示 */
  variant?: 'menu' | 'cart';
  className?: string;
}

export function QrTableStrip({ variant = 'menu', className }: QrTableStripProps) {
  const { status, tableNo } = useQrTable();

  if (status === 'notFound' || status === 'dineInOff') {
    return (
      <div className={className}>
        <InlineAlert tone="warning" role="status">
          {status === 'notFound' ? t.menu.table.notFoundFallback : t.menu.table.unavailableFallback}
        </InlineAlert>
      </div>
    );
  }
  if (variant === 'cart' || status === 'none') return null;

  return (
    <section
      aria-label={t.menu.table.label}
      aria-busy={status === 'checking' ? true : undefined}
      className={clsx('flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1', className)}
    >
      <span className="inline-flex h-7 items-center gap-1.5 rounded-pill border border-brand bg-brand-soft px-3 text-sm leading-5 font-semibold text-brand-text">
        <UtensilsCrossed aria-hidden="true" className="size-4 shrink-0" />
        {status === 'locked' && tableNo !== null
          ? t.menu.table.badge(tableNo)
          : t.menu.table.checking}
      </span>
      {status === 'locked' ? (
        <span className="text-sm leading-5 text-text-sub">{t.menu.table.hint}</span>
      ) : null}
    </section>
  );
}
