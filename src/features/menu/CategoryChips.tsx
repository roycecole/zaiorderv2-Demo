// src/features/menu/CategoryChips.tsx —— 分類膠囊列（CMP-12）：sticky、橫向捲動、scroll-spy 強調、roving tabindex
//
// `nav[aria-label="菜單分類"]` 內的清單，每個膠囊是 button（不用 tablist：它不切換面板，§10.4）；
// 目前所在分類 `aria-current="true"`，名稱含數量（例：「飯類，5 項」）。方向鍵 / Home / End 移動焦點，Enter 選取。
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Chip, IconButton } from '@/components';
import { KeyHint } from '@/features/a11y';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { t } from '@/i18n/zh-TW';
import type { ChipItem } from './menuModel';

export interface CategoryChipsProps {
  chips: ReadonlyArray<ChipItem>;
  /** 目前強調的膠囊（scroll-spy 或使用者剛選取的分類） */
  activeId: string;
  onSelect: (chip: ChipItem) => void;
  /** 右側附加控制（版面切換） */
  trailing?: ReactNode;
  /** 觸控面板：兩端加「‹ ›」翻頁鈕（手勢皆有按鈕替代，§5.6） */
  kiosk?: boolean;
  /** 版面類（例如與上方元件的間距）；sticky 必須是長內容容器的直接子元素，不可再包一層 */
  className?: string;
}

export function CategoryChips({
  chips,
  activeId,
  onSelect,
  trailing,
  kiosk = false,
  className,
}: CategoryChipsProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const tabStopId = focusedId ?? activeId;

  // 強調的膠囊自動捲入可視範圍（只動橫向，不干擾頁面的垂直捲動）
  useEffect(() => {
    const scroller = scrollerRef.current;
    const current = scroller?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!scroller || !current || typeof scroller.scrollTo !== 'function') return;
    const target = current.offsetLeft - (scroller.clientWidth - current.clientWidth) / 2;
    scroller.scrollTo({ left: Math.max(0, target), behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [activeId, reducedMotion]);

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = chips.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = Math.min(last, index + 1);
    else if (event.key === 'ArrowLeft') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    const target = chips[next];
    if (target === undefined) return;
    setFocusedId(target.id);
    scrollerRef.current?.querySelector<HTMLElement>(`[data-chip-id="${target.id}"]`)?.focus();
  };

  const page = (direction: 1 | -1): void => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof scroller.scrollBy !== 'function') return;
    scroller.scrollBy({
      left: direction * Math.max(160, scroller.clientWidth * 0.8),
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  };

  return (
    <nav
      aria-label={t.menu.chips.label}
      className={clsx(
        'sticky top-[var(--appbar-offset,var(--appbar-h))] z-20 flex items-center border-b border-border bg-bg md:top-(--topbar-h)',
        className,
      )}
    >
      {kiosk ? (
        <IconButton
          label={t.menu.chips.prev}
          icon={<ChevronLeft />}
          className="ml-2"
          onClick={() => page(-1)}
        />
      ) : null}
      <div
        ref={scrollerRef}
        className="min-w-0 flex-1 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)] md:px-8 md:py-3"
      >
        <ul className="flex w-max gap-2">
          {chips.map((chip, index) => (
            <li key={chip.id}>
              <Chip
                semantic="current"
                selected={chip.id === activeId}
                icon={chip.icon}
                aria-label={t.menu.chips.itemLabel(chip.name, chip.count)}
                data-chip-id={chip.id}
                tabIndex={chip.id === tabStopId ? 0 : -1}
                onFocus={() => setFocusedId(chip.id)}
                onBlur={(event) => {
                  const next = event.relatedTarget;
                  if (!(next instanceof Node) || !scrollerRef.current?.contains(next))
                    setFocusedId(null);
                }}
                onKeyDown={(event) => moveFocus(event, index)}
                onClick={() => onSelect(chip)}
              >
                {chip.hotkey !== null ? (
                  <KeyHint action="jumpCategory" arg={chip.hotkey}>
                    {chip.name}
                  </KeyHint>
                ) : (
                  chip.name
                )}
              </Chip>
            </li>
          ))}
        </ul>
      </div>
      {kiosk ? (
        <IconButton
          label={t.menu.chips.next}
          icon={<ChevronRight />}
          className="mr-2"
          onClick={() => page(1)}
        />
      ) : null}
      {trailing !== undefined ? (
        <div className="flex shrink-0 items-center pr-4 md:pr-8">{trailing}</div>
      ) : null}
    </nav>
  );
}
