import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox, Switch } from '../Checkbox';
import { CheckboxCard, CheckboxGroup } from '../CheckboxGroup';
import { RadioCard, RadioGroup } from '../RadioGroup';
import { Select } from '../Select';
import { TextArea } from '../TextArea';
import { TextField } from '../TextField';

describe('TextField', () => {
  it('label 與 input 關聯，說明與錯誤以 aria-describedby 關聯，並輸出 aria-invalid', () => {
    render(
      <TextField
        label="手機號碼"
        hint="用於取餐通知"
        error="請輸入 10 碼手機號碼"
        inputMode="numeric"
        autoComplete="tel"
      />,
    );
    const input = screen.getByLabelText('手機號碼');
    expect(input).toBe(screen.getByRole('textbox', { name: '手機號碼' }));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'tel');
    expect(input).toHaveAccessibleDescription('用於取餐通知 請輸入 10 碼手機號碼');
    // 錯誤是文字（不只顏色）
    expect(screen.getByText('請輸入 10 碼手機號碼')).toBeVisible();
  });

  it('無錯誤時不輸出 aria-invalid；必填以文字標示並輸出 aria-required', () => {
    render(<TextField label="姓名" required />);
    const input = screen.getByRole('textbox', { name: /姓名/ });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(screen.getByText('（必填）')).toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('選填標示與計數', () => {
    render(<TextField label="備註" optional counter={{ current: 3, max: 50 }} />);
    expect(screen.getByText('（選填）')).toBeInTheDocument();
    expect(screen.getByText('3/50')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription('3/50');
  });

  it('輸入會觸發 onChange；錯誤清除後移除關聯', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<TextField label="姓名" error="必填" onChange={onChange} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    await user.type(screen.getByRole('textbox'), 'A');
    expect(onChange).toHaveBeenCalled();
    rerender(<TextField label="姓名" error={null} onChange={onChange} />);
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-describedby');
  });
});

describe('TextArea / Select', () => {
  it('TextArea：label、說明與錯誤關聯', () => {
    render(<TextArea label="備註" optional hint="例如：不要蔥" error="最多 50 字" />);
    const el = screen.getByRole('textbox', { name: /備註/ });
    expect(el.tagName).toBe('TEXTAREA');
    expect(el).toHaveAccessibleDescription('例如：不要蔥 最多 50 字');
    expect(el).toHaveAttribute('aria-invalid', 'true');
  });

  it('Select：原生 select，包含 placeholder 與選項，錯誤關聯', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select
        label="縣市"
        placeholder="請選擇縣市"
        options={[
          { value: 'tpe', label: '臺北市' },
          { value: 'ntp', label: '新北市' },
        ]}
        error="請選擇縣市"
        onChange={onChange}
        defaultValue=""
      />,
    );
    const select = screen.getByRole('combobox', { name: '縣市' });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    await user.selectOptions(select, 'ntp');
    expect(onChange).toHaveBeenCalled();
    expect(select).toHaveValue('ntp');
  });
});

describe('Checkbox / Switch', () => {
  it('Checkbox：點擊標籤切換並回報布林值', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Checkbox
        label="需要餐具"
        description="環保提醒：不一定要"
        onCheckedChange={onCheckedChange}
      />,
    );
    const box = screen.getByRole('checkbox', { name: /需要餐具/ });
    expect(box).toHaveAccessibleDescription('環保提醒：不一定要');
    await user.click(screen.getByText('需要餐具'));
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    expect(box).toBeChecked();
    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });

  it('Checkbox：錯誤以文字顯示並關聯', () => {
    render(<Checkbox label="我已閱讀條款" error="請勾選同意" />);
    const box = screen.getByRole('checkbox');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription('請勾選同意');
  });

  it('Switch：role=switch，Space 切換', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Switch label="啟用單鍵快速鍵" description="預設關閉" onCheckedChange={onCheckedChange} />,
    );
    const sw = screen.getByRole('switch', { name: /啟用單鍵快速鍵/ });
    expect(sw).not.toBeChecked();
    await user.tab();
    expect(sw).toHaveFocus();
    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    expect(sw).toBeChecked();
  });
});

describe('RadioGroup / RadioCard', () => {
  function Harness({ onChange }: { onChange?: (v: string) => void }) {
    const [value, setValue] = useState<string | null>('S');
    return (
      <RadioGroup
        name="size"
        legend="份量"
        rule="必選・單選"
        ruleTone="required"
        value={value}
        onChange={(v) => {
          onChange?.(v);
          setValue(v);
        }}
      >
        <RadioCard value="S" label="小碗" priceDelta={0} />
        <RadioCard value="L" label="大碗" priceDelta={20} />
        <RadioCard value="X" label="特大" disabled disabledReason="暫無供應" />
        <RadioCard value="D" label="折價" priceDelta={-10} />
      </RadioGroup>
    );
  }

  it('radiogroup 名稱含群組名稱與規則；價差：+ / − / 0 不顯示；不可選顯示原因', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: '份量 必選・單選' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '小碗' })).toBeChecked();
    const large = screen.getByRole('radio', { name: '大碗' });
    expect(large).toHaveAccessibleDescription('+NT$ 20');
    expect(screen.getByRole('radio', { name: '折價' })).toHaveAccessibleDescription('−NT$ 10');
    expect(screen.getByRole('radio', { name: '小碗' })).not.toHaveAttribute('aria-describedby');
    const disabled = screen.getByRole('radio', { name: '特大' });
    expect(disabled).toBeDisabled();
    expect(disabled).toHaveAccessibleDescription('暫無供應');
  });

  it('點選與方向鍵切換', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByText('大碗'));
    expect(onChange).toHaveBeenLastCalledWith('L');
    expect(screen.getByRole('radio', { name: '大碗' })).toBeChecked();
    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith('S');
  });

  it('群組錯誤顯示於標頭下方並與 radiogroup 關聯', () => {
    render(
      <RadioGroup
        name="pay"
        legend="付款方式"
        value={null}
        onChange={() => undefined}
        error="請選擇付款方式"
      >
        <RadioCard value="CASH" label="現金" description="取餐時付款" />
      </RadioGroup>,
    );
    const group = screen.getByRole('radiogroup', { name: '付款方式' });
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAccessibleDescription('請選擇付款方式');
    expect(screen.getByRole('radio', { name: '現金' })).toHaveAccessibleDescription('取餐時付款');
  });

  it('RadioCard 不在 RadioGroup 內會擲出錯誤', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<RadioCard value="a" label="a" />)).toThrow(
      'RadioCard 必須放在 <RadioGroup> 內',
    );
    spy.mockRestore();
  });
});

describe('CheckboxGroup / CheckboxCard', () => {
  function Harness() {
    const [values, setValues] = useState<string[]>([]);
    return (
      <CheckboxGroup
        legend="加料"
        rule="選填・最多 2 項"
        max={2}
        values={values}
        onChange={setValues}
      >
        <CheckboxCard value="egg" label="滷蛋" priceDelta={12} />
        <CheckboxCard value="tofu" label="滷豆干" priceDelta={10} />
        <CheckboxCard value="veg" label="燙青菜" priceDelta={15} />
      </CheckboxGroup>
    );
  }

  it('達上限時其餘未選項停用並顯示「已達上限」；取消勾選後恢復', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText('滷蛋'));
    await user.click(screen.getByText('滷豆干'));
    const third = screen.getByRole('checkbox', { name: '燙青菜' });
    expect(third).toBeDisabled();
    expect(third).toHaveAccessibleDescription('已達上限');
    // 已選項仍可取消
    expect(screen.getByRole('checkbox', { name: '滷蛋' })).toBeEnabled();

    await user.click(screen.getByText('滷蛋'));
    expect(third).toBeEnabled();
    expect(third).toHaveAccessibleDescription('+NT$ 15');
  });
});
