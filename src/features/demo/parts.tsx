// src/features/demo/parts.tsx —— Demo 面板內的小元件：可收合區塊與單選群組
import clsx from 'clsx';
import { Check, ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';

export interface DemoSectionProps {
  title: string;
  defaultOpen?: boolean;
  /** 區塊內容；收合時不渲染（查詢與輪詢一併停止） */
  children: ReactNode;
}

/**
 * 可收合區塊：標題為 `h3` 內的 `aria-expanded` 按鈕；內容以 `fieldset` / `legend` 分組（03 PG-18）。
 * 預設收合（「訂單模擬」例外），手機 Bottom Sheet 內部捲動。
 */
export function DemoSection({ title, defaultOpen = false, children }: DemoSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className="border-t border-border">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
          className="-mx-1 flex min-h-(--hit-size) w-[calc(100%+0.5rem)] items-center justify-between gap-2 rounded-md px-1 py-2 text-left text-base font-semibold text-text hover:bg-bg-muted"
        >
          {title}
          <ChevronDown
            aria-hidden="true"
            className={clsx(
              'size-5 shrink-0 text-text-muted transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
      </h3>
      <div id={bodyId} hidden={!open}>
        {open ? (
          <fieldset className="m-0 min-w-0 space-y-4 border-0 p-0 pt-1 pb-4">
            <legend className="sr-only">{title}</legend>
            {children}
          </fieldset>
        ) : null}
      </div>
    </section>
  );
}

export interface Choice<T extends string | number> {
  value: T;
  label: string;
}

export interface ChoiceGroupProps<T extends string | number> {
  legend: string;
  choices: ReadonlyArray<Choice<T>>;
  value: T | null;
  onChange: (value: T) => void;
  hint?: string;
  disabled?: boolean;
  /** 前置色點（例：主題色）；回傳 CSS 色碼或 undefined */
  swatch?: (value: T) => string | undefined;
}

/**
 * 單選群組：原生 radio（方向鍵切換、群組名稱由 legend 提供）外觀為膠囊；
 * 選取狀態以「勾號 + 填色 + 粗體」呈現，不只靠顏色。
 */
export function ChoiceGroup<T extends string | number>({
  legend,
  choices,
  value,
  onChange,
  hint,
  disabled = false,
  swatch,
}: ChoiceGroupProps<T>) {
  const name = useId();
  const hintId = useId();
  return (
    <fieldset
      className="m-0 min-w-0 border-0 p-0"
      aria-describedby={hint !== undefined ? hintId : undefined}
      disabled={disabled}
    >
      <legend className="mb-2 p-0 text-sm font-semibold text-text">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => {
          const selected = value === choice.value;
          const color = swatch?.(choice.value);
          return (
            <label key={String(choice.value)} className="relative inline-flex">
              <input
                type="radio"
                name={name}
                value={String(choice.value)}
                checked={selected}
                onChange={() => onChange(choice.value)}
                className="peer absolute inset-0 m-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              />
              <span
                className={clsx(
                  'inline-flex min-h-(--chip-h) items-center gap-1.5 rounded-pill border px-3 text-sm leading-5',
                  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-text',
                  'peer-disabled:border-border peer-disabled:bg-bg-muted peer-disabled:text-text-disabled',
                  selected
                    ? 'border-brand bg-brand-soft font-semibold text-brand-text'
                    : 'border-border-strong bg-bg font-medium text-text-sub',
                )}
              >
                {color !== undefined ? (
                  <span
                    aria-hidden="true"
                    className="size-4 shrink-0 rounded-full border border-border-strong"
                    style={{ backgroundColor: color }}
                  />
                ) : null}
                {selected ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
                {choice.label}
              </span>
            </label>
          );
        })}
      </div>
      {hint !== undefined ? (
        <p id={hintId} className="mt-1.5 text-sm leading-5 text-text-muted">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}

/** 區塊內的小標題群組（fieldset + legend） */
export function SubGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 min-w-0 space-y-3 border-0 border-t border-border p-0 pt-3">
      <legend className="mb-1 p-0 pr-2 text-sm font-semibold text-text">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** 解析 min～max 的整數輸入；無效回傳 null（空字串亦為 null） */
export function parseIntInRange(value: string, min: number, max: number): number | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}
