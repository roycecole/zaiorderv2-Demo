// src/features/demo/DemoFab.tsx —— Demo 浮動入口鈕（03 PG-18）
//
// ≥ 768 位於左下 16px（右側訂單面板的「前往結帳」不被遮擋）；< 768 位於 CartBar / 底部 Tab 上方，
// 與 Toast、鍵盤提醒共用的浮動槽（`--toast-offset-bottom`）等高；不使用品牌色，避免預覽主題時失去辨識。
import clsx from 'clsx';
import { FlaskConical } from 'lucide-react';
import type { RefObject } from 'react';
import { demo as tDemo } from '@/i18n/strings/demo';
import { DEMO_PANEL_ID } from './constants';

export interface DemoFabProps {
  open: boolean;
  /** 「下一次送出」預備項目數（> 0 顯示小圓點並同步 aria-label） */
  armedCount: number;
  onToggle: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
}

export function DemoFab({ open, armedCount, onToggle, buttonRef }: DemoFabProps) {
  const label = armedCount > 0 ? tDemo.fab.armed(armedCount) : tDemo.fab.label;
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-controls={open ? DEMO_PANEL_ID : undefined}
      onClick={onToggle}
      className={clsx(
        'fixed left-4 z-40 inline-flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-pill px-3 select-none kiosk:min-h-14 kiosk:min-w-14',
        'bg-text text-bg shadow-lg transition-colors duration-150 hover:bg-text-sub',
        'bottom-(--toast-offset-bottom) md:bottom-4',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-text',
      )}
    >
      <FlaskConical aria-hidden="true" className="size-6 shrink-0" />
      <span aria-hidden="true" className="hidden text-sm font-semibold md:inline">
        {tDemo.fab.short}
      </span>
      {armedCount > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 size-3.5 rounded-full bg-danger ring-2 ring-bg"
          data-testid="demo-fab-dot"
        />
      ) : null}
    </button>
  );
}
