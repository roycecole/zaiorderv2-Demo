// CMP-29：6 格、自動跳格、貼上分配、Backspace、完成自動送出
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OtpInput } from '../OtpInput';

function Harness({ onComplete = () => undefined, disabled = false, invalid = false }: {
  onComplete?: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [value, setValue] = useState('');
  return (
    <>
      <OtpInput
        value={value}
        onChange={setValue}
        onComplete={onComplete}
        label="驗證碼"
        disabled={disabled}
        invalid={invalid}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

const cells = (): HTMLInputElement[] => screen.getAllByRole('textbox') as HTMLInputElement[];

describe('OtpInput', () => {
  it('為一組 6 格，每格有可存取名稱，第一格啟用 one-time-code', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: '驗證碼' })).toBeInTheDocument();
    expect(cells()).toHaveLength(6);
    expect(cells()[0]).toHaveAccessibleName('驗證碼第 1 碼，共 6 碼');
    expect(cells()[5]).toHaveAccessibleName('驗證碼第 6 碼，共 6 碼');
    expect(cells()[0]).toHaveAttribute('autocomplete', 'one-time-code');
    expect(cells()[1]).toHaveAttribute('autocomplete', 'off');
    for (const c of cells()) expect(c).toHaveAttribute('inputmode', 'numeric');
  });

  it('輸入數字自動跳到下一格，滿 6 碼時呼叫 onComplete 一次', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    await user.click(cells()[0] as HTMLElement);
    await user.keyboard('123');
    expect(cells()[3]).toHaveFocus();
    expect(onComplete).not.toHaveBeenCalled();
    await user.keyboard('456');
    expect(screen.getByTestId('value')).toHaveTextContent('123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('忽略非數字', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(cells()[0] as HTMLElement);
    await user.keyboard('a1-b2');
    expect(screen.getByTestId('value')).toHaveTextContent('12');
  });

  it('貼上整串驗證碼分配到各格並完成（含空白與連字號）', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    await user.click(cells()[2] as HTMLElement);
    await user.paste('123 456');
    expect(screen.getByTestId('value')).toHaveTextContent('123456');
    expect(cells().map((c) => c.value)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('Backspace 刪除目前的數字；在空格上則退回前一格並刪除', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(cells()[0] as HTMLElement);
    await user.keyboard('123');
    // 目前在第 4 格（空）：Backspace 刪掉第 3 格的 3 並退回
    await user.keyboard('{Backspace}');
    expect(screen.getByTestId('value')).toHaveTextContent('12');
    expect(cells()[2]).toHaveFocus();
    await user.keyboard('{Backspace}');
    expect(screen.getByTestId('value')).toHaveTextContent('1');
  });

  it('方向鍵在格間移動', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(cells()[0] as HTMLElement);
    await user.keyboard('12');
    await user.keyboard('{ArrowLeft}');
    expect(cells()[1]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(cells()[2]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(cells()[0]).toHaveFocus();
  });

  it('invalid 時每格輸出 aria-invalid；disabled 時不接受輸入', async () => {
    const user = userEvent.setup();
    render(<Harness invalid disabled />);
    for (const c of cells()) {
      expect(c).toHaveAttribute('aria-invalid', 'true');
      expect(c).toBeDisabled();
    }
    await user.keyboard('123');
    expect(screen.getByTestId('value')).toHaveTextContent('');
  });
});
