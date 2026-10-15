// src/features/menu/MenuSearchBox.tsx —— 菜單搜尋框（FR-MN-03）：網址 `?q=` 為唯一事實來源
//
// 輸入穩定 250ms 後寫入 `?q=`（replace，不污染歷史）；`s` / `/` 聚焦（全域 `search` 動作）；
// 搜尋框內 ↓ 或 Enter 把焦點移到第一個結果商品卡，Esc 清除文字並失焦（PG-01 互動）。
// 外殼若在頂欄自備搜尋框，只要寫入同一個 `?q=` 即可，此元件可由 MenuPage 的 `showSearch={false}` 關閉。
import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import { KeyHint, useAnnounce, useHotkeyAction } from '@/features/a11y';
import { t } from '@/i18n/zh-TW';

export const SEARCH_PARAM = 'q';
const DEBOUNCE_MS = 250;

export interface MenuSearchBoxProps {
  className?: string;
}

export function MenuSearchBox({ className }: MenuSearchBoxProps) {
  const [params, setParams] = useSearchParams();
  const announce = useAnnounce();
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusFirstAfterApply = useRef(false);
  const urlQuery = params.get(SEARCH_PARAM) ?? '';

  // 輸入中的草稿綁定「寫入前的網址值」：網址被外部改變（返回、清除）時草稿自動失效，輸入框跟隨網址
  const [draft, setDraft] = useState<{ text: string; base: string } | null>(null);
  const value = draft !== null && draft.base === urlQuery ? draft.text : urlQuery;

  const cancelTimer = (): void => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  // 「↓ / Enter」時輸入尚未寫入網址：網址更新、結果渲染後才把焦點移到第一張結果卡
  useEffect(() => {
    if (!focusFirstAfterApply.current) return;
    focusFirstAfterApply.current = false;
    document.querySelector<HTMLElement>('[data-product-card]')?.focus();
  }, [urlQuery]);

  const writeQuery = (text: string): void => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (text.trim() === '') next.delete(SEARCH_PARAM);
        else next.set(SEARCH_PARAM, text);
        return next;
      },
      { replace: true },
    );
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const text = event.target.value;
    setDraft({ text, base: urlQuery });
    cancelTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      writeQuery(text);
    }, DEBOUNCE_MS);
  };

  const clear = (blur: boolean): void => {
    cancelTimer();
    setDraft(null);
    writeQuery('');
    if (blur) inputRef.current?.blur();
    announce(t.menu.search.cleared);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      if (value !== '') {
        event.preventDefault();
        clear(true);
      }
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'Enter') && !event.shiftKey) {
      event.preventDefault();
      if (timerRef.current !== null) {
        // 輸入尚未寫入網址：立即套用，等結果渲染完成後再聚焦第一張結果卡
        cancelTimer();
        focusFirstAfterApply.current = true;
        writeQuery(value);
        return;
      }
      document.querySelector<HTMLElement>('[data-product-card]')?.focus();
    }
  };

  useHotkeyAction('search', () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  });

  return (
    <div className={className}>
      <div role="search" className="relative w-full md:max-w-90">
        <label htmlFor="menu-search" className="sr-only">
          {t.menu.search.label}
        </label>
        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-text-muted">
          <KeyHint action="search">
            <Search aria-hidden="true" className="size-5" />
          </KeyHint>
        </span>
        <input
          ref={inputRef}
          id="menu-search"
          data-zo-search=""
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          value={value}
          placeholder={t.menu.search.placeholder}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className="block min-h-(--hit-size) w-full appearance-none rounded-pill border border-border-input bg-bg pr-11 pl-12 text-base leading-6 text-text placeholder:text-text-muted focus-visible:border-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-text [&::-webkit-search-cancel-button]:hidden"
        />
        {value !== '' ? (
          <button
            type="button"
            aria-label={t.menu.search.clear}
            onClick={() => {
              clear(false);
              inputRef.current?.focus();
            }}
            className="hit-area absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-text-muted hover:bg-bg-muted hover:text-text"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
