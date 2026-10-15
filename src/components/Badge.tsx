// src/components/Badge.tsx —— 標籤（CMP-09）：HOT / NEW / 售完 / 剩 n 份…
import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { ProductTag } from '@/domain/types';
import { t } from '@/i18n/zh-TW';

export type BadgeTone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger' | 'inverse';

export interface BadgeProps {
  /**
   * neutral：灰底（店長推薦）；brand：品牌色填滿（熱銷）；info：新品；success：素食；
   * warning：辣、限量、剩 n 份；danger：錯誤 / 暫停；inverse：深色底白字（今日售完）。
   */
  tone?: BadgeTone;
  /** 前置圖示（lucide，請自行加 aria-hidden） */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-bg-muted text-text-sub',
  brand: 'bg-brand text-on-brand',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  inverse: 'bg-text text-bg',
};

/** 狀態一律「文字 + 顏色」並用，不只靠顏色。純展示，不可互動。 */
export function Badge({ tone = 'neutral', icon, children, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex min-h-5 shrink-0 items-center gap-1 rounded-pill px-2 text-xs leading-4 font-semibold whitespace-nowrap',
        'forced-colors:border forced-colors:border-[CanvasText] kiosk:min-h-7 kiosk:px-3',
        TONE[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

const PRODUCT_TAG_TONE: Record<ProductTag, BadgeTone> = {
  HOT: 'brand',
  NEW: 'info',
  CHEF_PICK: 'neutral',
  SPICY: 'warning',
  VEGETARIAN: 'success',
  LIMITED: 'warning',
};

export interface ProductTagBadgeProps {
  tag: ProductTag;
  className?: string;
}

/** 商品標籤（03 §6.6 標籤配色）：以 `ProductTag` 直接對應文案與色調；未知列舉降級為中性色與原字串（前向相容）。 */
export function ProductTagBadge({ tag, className }: ProductTagBadgeProps) {
  const labels: Record<string, string> = t.common.productTag;
  const tone: BadgeTone = PRODUCT_TAG_TONE[tag] ?? 'neutral';
  return (
    <Badge tone={tone} className={className}>
      {labels[tag] ?? tag}
    </Badge>
  );
}
