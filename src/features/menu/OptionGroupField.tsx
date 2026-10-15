// src/features/menu/OptionGroupField.tsx —— 選項群組（CMP-15、03 §6.5）：把 `OptionGroup` 對應到單選 / 複選群組
import { CheckboxCard, CheckboxGroup, RadioCard, RadioGroup } from '@/components';
import type { ID, OptionGroup } from '@/domain/types';
import { t } from '@/i18n/zh-TW';

const NONE_VALUE = '__none__';

/** 標頭規則徽章：「必選・單選」「選填・最多 3 項」「必選・至少 2 項・最多 3 項」（必選不使用 danger 色） */
export function groupRuleText(group: OptionGroup): string {
  const required = group.required || group.minSelect >= 1;
  const parts: string[] = [required ? t.menu.sheet.required : t.menu.sheet.optional];
  if (group.selectionType === 'SINGLE') {
    parts.push(t.menu.sheet.singleChoice);
  } else {
    if (group.minSelect >= 2) parts.push(t.menu.sheet.atLeast(group.minSelect));
    if (group.maxSelect > 0) parts.push(t.menu.sheet.atMost(group.maxSelect));
  }
  return parts.join('・');
}

/** 選取數是否滿足群組的最少 / 最多限制；不滿足時回傳錯誤文字（顯示於群組標頭下方） */
export function groupErrorText(group: OptionGroup, selectedCount: number): string | null {
  if (selectedCount < group.minSelect) {
    return group.minSelect >= 2
      ? t.menu.sheet.pickAtLeast(group.name, group.minSelect)
      : t.menu.sheet.pickOne(group.name);
  }
  if (selectedCount > group.maxSelect) return t.menu.sheet.pickAtMost(group.name, group.maxSelect);
  return null;
}

export interface OptionGroupFieldProps {
  /** 商品 ID：組成 radio 的 name，避免不同群組互相影響 */
  productId: ID;
  group: OptionGroup;
  selected: ReadonlyArray<ID>;
  onChange: (next: ID[]) => void;
  error?: string | null | undefined;
  /** 唯讀（今日售完的商品只能瀏覽） */
  disabled?: boolean | undefined;
}

export function OptionGroupField({
  productId,
  group,
  selected,
  onChange,
  error,
  disabled = false,
}: OptionGroupFieldProps) {
  const required = group.required || group.minSelect >= 1;
  const rule = groupRuleText(group);
  const ruleTone = required ? 'required' : 'optional';

  if (group.selectionType === 'SINGLE') {
    return (
      <RadioGroup
        name={`${productId}-${group.id}`}
        legend={group.name}
        rule={rule}
        ruleTone={ruleTone}
        required={required}
        columns="auto"
        error={error}
        disabled={disabled}
        value={selected[0] ?? (required ? null : NONE_VALUE)}
        onChange={(value) => onChange(value === NONE_VALUE ? [] : [value])}
      >
        {required ? null : <RadioCard value={NONE_VALUE} label={t.menu.sheet.noneOption} />}
        {group.options.map((option) => (
          <RadioCard
            key={option.id}
            value={option.id}
            label={option.name}
            priceDelta={option.priceDelta}
            disabled={!option.isAvailable}
            disabledReason={t.common.unavailable}
          />
        ))}
      </RadioGroup>
    );
  }

  return (
    <CheckboxGroup
      legend={group.name}
      rule={rule}
      ruleTone={ruleTone}
      required={required}
      columns="auto"
      error={error}
      disabled={disabled}
      values={selected}
      max={group.maxSelect > 0 ? group.maxSelect : undefined}
      onChange={onChange}
    >
      {group.options.map((option) => (
        <CheckboxCard
          key={option.id}
          value={option.id}
          label={option.name}
          priceDelta={option.priceDelta}
          disabled={!option.isAvailable}
          disabledReason={t.common.unavailable}
        />
      ))}
    </CheckboxGroup>
  );
}
