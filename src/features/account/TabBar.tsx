// src/features/account/TabBar.tsx —— 頁籤列（歷史訂單的「進行中 / 已完成 / 已取消」、優惠券的「可用 / 已使用 / 已過期」）
//
// ARIA 頁籤樣式：tablist / tab / tabpanel；roving tabindex、← → Home End 移動並選取（自動啟用）。
// 內容區由呼叫端以 `tabPanelProps(idPrefix, value)` 取得 role="tabpanel" 所需屬性。
import clsx from 'clsx';
import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

export interface TabBarProps<T extends string> {
  tabs: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  /** tablist 的可存取名稱 */
  label: string;
  /** id 前綴：同一頁多組頁籤時避免衝突 */
  idPrefix: string;
  className?: string;
}

const tabId = (prefix: string, id: string): string => `${prefix}-tab-${id}`;
const panelId = (prefix: string): string => `${prefix}-panel`;

/** 頁籤內容區的屬性：`<div {...tabPanelProps('orders', tab)}>` */
export function tabPanelProps(
  prefix: string,
  value: string,
): { id: string; role: 'tabpanel'; 'aria-labelledby': string; tabIndex: 0 } {
  return { id: panelId(prefix), role: 'tabpanel', 'aria-labelledby': tabId(prefix, value), tabIndex: 0 };
}

export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
  className,
}: TabBarProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (index: number): void => {
    const count = tabs.length;
    const next = ((index % count) + count) % count;
    const target = tabs[next];
    if (target === undefined) return;
    onChange(target.id);
    refs.current[next]?.focus();
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLButtonElement>): void => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        move(index + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        move(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        move(0);
        break;
      case 'End':
        e.preventDefault();
        move(tabs.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={clsx('flex border-b border-border', className)}
    >
      {tabs.map((tab, i) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.id)}
            aria-selected={selected}
            aria-controls={panelId(idPrefix)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className={clsx(
              '-mb-px min-h-(--hit-size) flex-1 border-b-2 px-3 text-base leading-6 whitespace-nowrap select-none',
              'transition-colors duration-150',
              selected
                ? 'border-brand font-bold text-brand-text'
                : 'border-transparent font-medium text-text-sub hover:bg-bg-muted',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
