// src/components/Price.tsx —— 價格顯示（03 §6.2）：NT$ 與「起」、刪除線舊價、加價差
import clsx from 'clsx';
import { formatTWD } from '@/domain/format';
import type { TWD } from '@/domain/types';
import { t } from '@/i18n/zh-TW';
import { VisuallyHidden } from './VisuallyHidden';

export interface PriceProps {
  amount: TWD;
  /** 顯示「起」：商品有「必選且價格不同」的選項群組時（03 §6.2） */
  from?: boolean;
  /** 原價；大於現價時以刪除線顯示（折扣前價格） */
  originalAmount?: TWD;
  /** 不設定則沿用所在層級的字級（03 §4.2 `price`：同所在層級、粗體、等寬數字） */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** muted：說明用金額（例：價格註記）；success：折扣 */
  tone?: 'default' | 'muted' | 'success';
  className?: string;
}

const SIZE = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-h3',
  xl: 'text-h2',
} as const;

const TONE = {
  default: 'text-text',
  muted: 'text-text-muted',
  success: 'text-success',
} as const;

/**
 * 金額一律使用 `formatTWD`（NT$ 1,250；負數為 −NT$ 40），等寬數字、不換行。
 * 金額為 0 時的「免運」「—」等語意由呼叫端決定，本元件只負責格式。
 */
export function Price({
  amount,
  from = false,
  originalAmount,
  size,
  tone = 'default',
  className,
}: PriceProps) {
  const showOriginal = originalAmount !== undefined && originalAmount > amount;
  return (
    <span
      className={clsx(
        'font-bold whitespace-nowrap tabular-nums',
        size && SIZE[size],
        TONE[tone],
        className,
      )}
    >
      {showOriginal ? (
        <>
          <del className="mr-1.5 text-sm font-normal text-text-muted">
            <VisuallyHidden>{t.common.originalPrice} </VisuallyHidden>
            {formatTWD(originalAmount)}
          </del>
          <VisuallyHidden>{t.common.currentPrice} </VisuallyHidden>
        </>
      ) : null}
      {formatTWD(amount)}
      {from ? (
        <small className="ml-1 text-xs font-medium text-text-muted">{t.common.priceFrom}</small>
      ) : null}
    </span>
  );
}

/**
 * 選項加價顯示：> 0 為「+NT$ 12」、< 0 為「−NT$ 12」（U+2212）、0 或未提供回傳 null（不顯示，03 §6.5）。
 */
export function formatPriceDelta(delta: TWD | null | undefined): string | null {
  if (delta === null || delta === undefined || Math.round(delta) === 0) return null;
  return delta > 0 ? `+${formatTWD(delta)}` : formatTWD(delta);
}
