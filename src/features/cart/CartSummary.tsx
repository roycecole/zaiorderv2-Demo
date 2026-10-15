// src/features/cart/CartSummary.tsx —— 費用摘要（CMP-18 `PriceSummary` 的購物車版）：小計 / 運費 / 折扣 / 總計
import clsx from 'clsx';
import { formatTWD } from '@/domain/format';
import type { OrderType } from '@/domain/types';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { t } from '@/i18n/zh-TW';
import { orderTypeLabel } from './OrderTypeSwitch';

export interface CartSummaryProps {
  /** 小計（以可成立內容計；quote 尚未回來時為快照價） */
  subtotal: number;
  orderType: OrderType;
  /**
   * 運費：`null` / 省略 = 尚未決定（購物車沒有外送地址）顯示「—」；0 = 免運（成功色）。
   * 非外送一律顯示「—」（03 §6.2）。
   */
  deliveryFee?: number | null | undefined;
  /** 折扣金額（正數）；0 / 省略顯示「—」 */
  discount?: number | null | undefined;
  /** 差多少達最低消費；有值才顯示「還差 NT$ 58 可外送」（FR-CT-06） */
  shortfall?: number | null | undefined;
  /** 重新計價中：小計旁加註並以 aria-busy 標示 */
  loading?: boolean | undefined;
  className?: string | undefined;
}

function Row({
  label,
  children,
  muted = false,
  tone,
}: {
  label: string;
  children: string;
  muted?: boolean;
  tone?: 'success';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm leading-5 text-text-sub">
      <dt>{label}</dt>
      <dd
        className={clsx(
          'tabular-nums',
          tone === 'success' ? 'font-medium text-success' : muted ? 'text-text-muted' : 'text-text',
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export function CartSummary({
  subtotal,
  orderType,
  deliveryFee,
  discount,
  shortfall,
  loading = false,
  className,
}: CartSummaryProps) {
  const kiosk = useIsKioskUi();
  const fee =
    orderType === 'DELIVERY' && deliveryFee !== null && deliveryFee !== undefined
      ? deliveryFee
      : null;
  const off = discount !== null && discount !== undefined && discount > 0 ? discount : 0;
  const total = Math.max(0, subtotal + (fee ?? 0) - off);

  return (
    <div className={clsx('min-w-0', className)} aria-busy={loading ? true : undefined}>
      <dl className="grid gap-1">
        <Row label={t.cart.summary.subtotal}>{formatTWD(subtotal)}</Row>
        {fee === null ? (
          <Row label={t.cart.summary.deliveryFee} muted>
            {t.common.noValue}
          </Row>
        ) : fee === 0 ? (
          <Row label={t.cart.summary.deliveryFee} tone="success">
            {t.common.free}
          </Row>
        ) : (
          <Row label={t.cart.summary.deliveryFee}>{formatTWD(fee)}</Row>
        )}
        {off > 0 ? (
          <Row label={t.cart.summary.discount} tone="success">
            {formatTWD(-off)}
          </Row>
        ) : (
          <Row label={t.cart.summary.discount} muted>
            {t.common.noValue}
          </Row>
        )}
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-border pt-2">
          <dt className="text-base leading-6 font-semibold text-text">{t.cart.summary.total}</dt>
          <dd className="text-h2 font-bold text-text tabular-nums">{formatTWD(total)}</dd>
        </div>
      </dl>
      {shortfall !== null && shortfall !== undefined && shortfall > 0 ? (
        <p className="mt-2 text-sm leading-5 font-medium text-warning">
          {t.cart.summary.shortfall(formatTWD(shortfall), orderTypeLabel(orderType, kiosk))}
        </p>
      ) : null}
      {orderType === 'DELIVERY' && fee === null ? (
        <p className="mt-2 text-xs leading-4 text-text-muted">{t.cart.summary.feeAtCheckout}</p>
      ) : null}
    </div>
  );
}
