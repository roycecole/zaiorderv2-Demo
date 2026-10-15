// src/components/Chip.tsx —— 膠囊標籤（CMP-08）：分類 / 篩選
import clsx from 'clsx';
import type { ComponentPropsWithRef, ReactNode } from 'react';

export interface ChipProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  /** 選取狀態：品牌淺底 + 品牌邊框 + brand-text 粗體字（不只靠顏色） */
  selected?: boolean;
  /**
   * `toggle`（預設）：篩選開關，輸出 `aria-pressed`；
   * `current`：導覽（目前所在分類），輸出 `aria-current="true"`，用於 `nav` 內的分類列（03 §10.4）。
   */
  semantic?: 'toggle' | 'current';
  /** 前置圖示 / emoji（分類圖示） */
  icon?: ReactNode;
  /** 計數（例：商品數）；請把完整名稱放進 `aria-label`，例「飯類，5 項」 */
  count?: number;
  children: ReactNode;
}

/** 高 `--chip-h`（40 / 觸控面板 56），以偽元素擴大點擊範圍至 ≥ 44。 */
export function Chip({
  selected = false,
  semantic = 'toggle',
  icon,
  count,
  type = 'button',
  className,
  children,
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={semantic === 'toggle' ? selected : undefined}
      aria-current={semantic === 'current' && selected ? 'true' : undefined}
      className={clsx(
        'hit-area inline-flex h-(--chip-h) shrink-0 items-center gap-1.5 rounded-pill border px-4 text-sm leading-5 whitespace-nowrap select-none',
        'transition-colors duration-150 kiosk:px-7 kiosk:text-base kiosk:leading-6',
        selected
          ? 'border-brand bg-brand-soft font-semibold text-brand-text'
          : 'border-border-strong bg-bg font-medium text-text-sub hover:bg-bg-muted',
        'disabled:cursor-not-allowed disabled:border-border disabled:bg-bg-muted disabled:text-text-disabled',
        className,
      )}
      {...rest}
    >
      {icon !== undefined && icon !== null ? <span aria-hidden="true">{icon}</span> : null}
      {children}
      {count !== undefined ? (
        <span
          className={clsx('text-xs tabular-nums', selected ? 'text-brand-text' : 'text-text-muted')}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
