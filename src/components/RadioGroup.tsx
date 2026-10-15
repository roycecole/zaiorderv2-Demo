// src/components/RadioGroup.tsx —— 單選群組與選項卡（CMP-05 RadioCard、CMP-15 OptionGroup 的 SINGLE）
import { createContext, useContext } from 'react';
import { OptionCard, OptionGroupShell } from './optionParts';
import type { OptionCardCommonProps, OptionGroupShellProps } from './optionParts';

interface RadioContextValue {
  name: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
  disabled: boolean;
  stacked: boolean;
}

const RadioContext = createContext<RadioContextValue | null>(null);

export interface RadioGroupProps extends OptionGroupShellProps {
  /** 同一組 radio 的 name（必須唯一於頁面） */
  name: string;
  /** 目前選取的值；null / undefined 表示未選 */
  value: string | null | undefined;
  onChange: (value: string) => void;
}

/**
 * 單選群組：`<fieldset role="radiogroup">` + `<legend>`（群組名稱與規則文字）。
 * 方向鍵切換為原生 radio 行為；整張卡片可點。
 * @example
 * <RadioGroup name="size" legend="份量" rule="必選・單選" ruleTone="required" value={size} onChange={setSize}>
 *   <RadioCard value="S" label="小碗" />
 *   <RadioCard value="L" label="大碗" priceDelta={20} />
 *   <RadioCard value="XL" label="特大" disabled disabledReason="暫無供應" />
 * </RadioGroup>
 */
export function RadioGroup({
  name,
  value,
  onChange,
  columns = 1,
  disabled = false,
  ...shell
}: RadioGroupProps) {
  return (
    <RadioContext.Provider value={{ name, value, onChange, disabled, stacked: columns !== 1 }}>
      <OptionGroupShell {...shell} role="radiogroup" columns={columns} disabled={disabled}>
        {shell.children}
      </OptionGroupShell>
    </RadioContext.Provider>
  );
}

export interface RadioCardProps extends OptionCardCommonProps {
  value: string;
}

export function RadioCard({ value, disabled = false, ...rest }: RadioCardProps) {
  const ctx = useContext(RadioContext);
  if (ctx === null) throw new Error('RadioCard 必須放在 <RadioGroup> 內');
  return (
    <OptionCard
      {...rest}
      type="radio"
      name={ctx.name}
      value={value}
      checked={ctx.value === value}
      onSelect={() => ctx.onChange(value)}
      disabled={disabled || ctx.disabled}
      stacked={ctx.stacked}
    />
  );
}
