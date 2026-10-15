// src/features/auth/OtpInput.tsx —— 驗證碼輸入（CMP-29）：6 格、自動跳格、貼上分配、完成自動送出
//
// 每一格是獨立的 <input>，對輔助科技為一組（role="group"）：
//   · 第一格 `autocomplete="one-time-code"`，行動裝置的簡訊自動帶入（整串驗證碼落在同一格）會被分配到各格；
//   · 輸入數字自動跳到下一格；Backspace 刪除並退回上一格；← → Home End 在格間移動；
//   · 可由任何一格貼上整串驗證碼（空白、連字號會被忽略）；
//   · 值永遠是連續的數字字串（不會有中間空格），元件為受控：由父層持有 `value`。
import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import type { ClipboardEvent, FocusEvent, KeyboardEvent } from 'react';
import { useLatest } from '@/hooks/useLatest';

export interface OtpInputProps {
  /** 目前的數字字串（0～length 碼） */
  value: string;
  onChange: (value: string) => void;
  /** 輸入滿 length 碼的當下呼叫一次（完成自動送出） */
  onComplete?: (value: string) => void;
  /** 群組名稱，例：「驗證碼」 */
  label: string;
  /** 每一格的可存取名稱；預設「{label}第 n 碼，共 m 碼」 */
  cellLabel?: (index: number, length: number) => string;
  length?: number;
  disabled?: boolean;
  /** 驗證失敗：每格輸出 aria-invalid 與錯誤外觀（錯誤文字由父層以 aria-describedby 關聯） */
  invalid?: boolean;
  /** 關聯到錯誤 / 說明文字的 id（輸出在群組與每一格） */
  describedBy?: string;
  /** 掛載時聚焦第一個空格 */
  initialFocus?: boolean;
  /** 遞增時聚焦第一個空格（驗證失敗清空後使用） */
  focusSignal?: number;
}

const digitsOnly = (s: string): string => s.replace(/\D/g, '');

export function OtpInput({
  value,
  onChange,
  onComplete,
  label,
  cellLabel,
  length = 6,
  disabled = false,
  invalid = false,
  describedBy,
  initialFocus = false,
  focusSignal,
}: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const latestValue = useLatest(value);

  const focusCell = (index: number): void => {
    const target = refs.current[Math.max(0, Math.min(length - 1, index))];
    if (target) {
      target.focus();
      target.select();
    }
  };

  // 掛載與外部要求聚焦時，移到第一個空格（全滿則最後一格）
  useEffect(() => {
    if (initialFocus || focusSignal !== undefined) {
      const index = Math.min(latestValue.current.length, length - 1);
      refs.current[index]?.focus();
    }
  }, [initialFocus, focusSignal, length, latestValue]);

  const commit = (next: string, focusIndex: number): void => {
    const clipped = next.slice(0, length);
    if (clipped !== value) onChange(clipped);
    focusCell(focusIndex);
    if (clipped.length === length && clipped !== value) onComplete?.(clipped);
  };

  /** 把 chunk 蓋在位置 pos 開始的格子上（超出長度的部分捨棄） */
  const applyChunk = (pos: number, chunk: string): void => {
    if (chunk === '') return;
    const next = `${value.slice(0, pos)}${chunk}${value.slice(pos + chunk.length)}`.slice(0, length);
    commit(next, pos + chunk.length);
  };

  const handleChange = (index: number, raw: string): void => {
    if (disabled) return;
    const typed = digitsOnly(raw);
    const pos = Math.min(index, value.length);
    if (typed === '') {
      // 清除該格（例如行動鍵盤的刪除）：後面的數字往前補
      if (index < value.length) commit(`${value.slice(0, index)}${value.slice(index + 1)}`, index);
      return;
    }
    // 在已有數字的格子再輸入：瀏覽器會得到「舊+新」，去掉舊的那一個字元
    const old = value[index];
    let chunk = typed;
    if (old !== undefined && typed.length === 2) {
      const at = typed.indexOf(old);
      chunk = at >= 0 ? `${typed.slice(0, at)}${typed.slice(at + 1)}` : typed.slice(-1);
    }
    applyChunk(pos, chunk);
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>): void => {
    if (disabled) return;
    switch (e.key) {
      case 'Backspace': {
        e.preventDefault();
        if (index < value.length) {
          commit(`${value.slice(0, index)}${value.slice(index + 1)}`, index);
        } else if (index > 0) {
          // 空格上按 Backspace：刪除前一格的數字並退回
          commit(`${value.slice(0, index - 1)}${value.slice(index)}`, index - 1);
        }
        break;
      }
      case 'Delete': {
        e.preventDefault();
        if (index < value.length) commit(`${value.slice(0, index)}${value.slice(index + 1)}`, index);
        break;
      }
      case 'ArrowLeft':
        e.preventDefault();
        focusCell(index - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        focusCell(index + 1);
        break;
      case 'Home':
        e.preventDefault();
        focusCell(0);
        break;
      case 'End':
        e.preventDefault();
        focusCell(Math.min(value.length, length - 1));
        break;
      default:
        break;
    }
  };

  const handlePaste = (index: number, e: ClipboardEvent<HTMLInputElement>): void => {
    if (disabled) return;
    const pasted = digitsOnly(e.clipboardData.getData('text'));
    e.preventDefault();
    if (pasted === '') return;
    // 整串驗證碼：一律從第一格開始；不足整串時從目前的格子接續
    const chunk = pasted.slice(0, length);
    applyChunk(chunk.length >= length ? 0 : Math.min(index, value.length), chunk);
  };

  const handleFocus = (e: FocusEvent<HTMLInputElement>): void => {
    e.target.select();
  };

  const nameOf = cellLabel ?? ((i: number, n: number) => `${label}第 ${i + 1} 碼，共 ${n} 碼`);

  return (
    <div role="group" aria-label={label} aria-describedby={describedBy} className="flex gap-2 kiosk:gap-3">
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          enterKeyHint="done"
          aria-label={nameOf(i, length)}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          value={value[i] ?? ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={handleFocus}
          className={clsx(
            'h-12 w-11 min-w-0 rounded-md border bg-bg text-center text-h2 font-semibold text-text tabular-nums',
            'kiosk:h-16 kiosk:w-14',
            'focus-visible:border-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-text',
            'disabled:cursor-not-allowed disabled:border-border disabled:bg-bg-muted disabled:text-text-disabled',
            invalid
              ? 'border-danger shadow-[inset_0_0_0_1px_var(--color-danger)]'
              : 'border-border-input',
          )}
        />
      ))}
    </div>
  );
}
