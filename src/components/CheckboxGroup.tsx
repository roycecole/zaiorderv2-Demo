// src/components/CheckboxGroup.tsx —— 複選群組與選項卡（CMP-15 OptionGroup 的 MULTIPLE）
import { createContext, useContext } from 'react';
import { t } from '@/i18n/zh-TW';
import { OptionCard, OptionGroupShell } from './optionParts';
import type { OptionCardCommonProps, OptionGroupShellProps } from './optionParts';

interface CheckboxContextValue {
  values: ReadonlyArray<string>;
  toggle: (value: string) => void;
  limitReached: boolean;
  limitText: string;
  disabled: boolean;
  stacked: boolean;
}

const CheckboxContext = createContext<CheckboxContextValue | null>(null);

export interface CheckboxGroupProps extends OptionGroupShellProps {
  /** 已勾選的值 */
  values: ReadonlyArray<string>;
  onChange: (values: string[]) => void;
  /** 最多可選數量；達上限時其餘「未選」項自動停用並顯示 `limitReachedText`（03 §6.5） */
  max?: number;
  /** 達上限時未選項的說明，預設「已達上限」 */
  limitReachedText?: string;
}

/**
 * 複選群組：`<fieldset>` + `<legend>`。Space 勾選 / 取消。
 * @example
 * <CheckboxGroup legend="加料" rule="選填・最多 3 項" max={3} values={addons} onChange={setAddons}>
 *   <CheckboxCard value="egg" label="滷蛋" priceDelta={12} />
 *   <CheckboxCard value="tofu" label="滷豆干" priceDelta={10} />
 * </CheckboxGroup>
 */
export function CheckboxGroup({
  values,
  onChange,
  max,
  limitReachedText,
  columns = 1,
  disabled = false,
  ...shell
}: CheckboxGroupProps) {
  const limitReached = max !== undefined && values.length >= max;
  const toggle = (value: string): void => {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  };
  return (
    <CheckboxContext.Provider
      value={{
        values,
        toggle,
        limitReached,
        limitText: limitReachedText ?? t.common.limitReached,
        disabled,
        stacked: columns !== 1,
      }}
    >
      <OptionGroupShell {...shell} columns={columns} disabled={disabled}>
        {shell.children}
      </OptionGroupShell>
    </CheckboxContext.Provider>
  );
}

export interface CheckboxCardProps extends OptionCardCommonProps {
  value: string;
}

export function CheckboxCard({
  value,
  disabled = false,
  disabledReason,
  ...rest
}: CheckboxCardProps) {
  const ctx = useContext(CheckboxContext);
  if (ctx === null) throw new Error('CheckboxCard 必須放在 <CheckboxGroup> 內');
  const checked = ctx.values.includes(value);
  const blockedByLimit = ctx.limitReached && !checked;
  return (
    <OptionCard
      {...rest}
      type="checkbox"
      name={undefined}
      value={value}
      checked={checked}
      onSelect={() => ctx.toggle(value)}
      disabled={disabled || ctx.disabled || blockedByLimit}
      disabledReason={
        disabled || ctx.disabled ? disabledReason : blockedByLimit ? ctx.limitText : undefined
      }
      stacked={ctx.stacked}
    />
  );
}
