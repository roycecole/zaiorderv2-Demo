import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Stepper } from '../Stepper';
import type { StepperProps } from '../Stepper';

function Controlled(
  props: Partial<StepperProps> & { initial?: number; onChangeSpy?: (n: number) => void },
) {
  const { initial = 2, onChangeSpy, ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <Stepper
      label="招牌滷肉飯 數量"
      {...rest}
      value={value}
      onChange={(n) => {
        onChangeSpy?.(n);
        setValue(n);
      }}
    />
  );
}

describe('Stepper', () => {
  it('以 spinbutton 提供名稱與 aria-value*', () => {
    render(<Controlled initial={3} min={1} max={5} />);
    const spin = screen.getByRole('spinbutton', { name: '招牌滷肉飯 數量' });
    expect(spin).toHaveAttribute('aria-valuenow', '3');
    expect(spin).toHaveAttribute('aria-valuemin', '1');
    expect(spin).toHaveAttribute('aria-valuemax', '5');
    expect(spin).toHaveTextContent('3');
  });

  it('＋ 與 − 各增減 1', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Controlled initial={2} onChangeSpy={spy} />);
    await user.click(screen.getByRole('button', { name: '增加數量' }));
    expect(spy).toHaveBeenLastCalledWith(3);
    await user.click(screen.getByRole('button', { name: '減少數量' }));
    expect(spy).toHaveBeenLastCalledWith(2);
  });

  it('達最大值：＋ 以 aria-disabled 停用、不觸發，並顯示原因且與 ＋ 關聯', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <Controlled initial={5} max={5} maxReason="今日只剩 5 份，已達上限" onChangeSpy={spy} />,
    );
    const plus = screen.getByRole('button', { name: '增加數量' });
    expect(plus).toHaveAttribute('aria-disabled', 'true');
    expect(plus).not.toBeDisabled();
    await user.click(plus);
    expect(spy).not.toHaveBeenCalled();
    const reason = screen.getByText('今日只剩 5 份，已達上限');
    expect(plus).toHaveAttribute('aria-describedby', reason.id);
  });

  it('未達上限時不顯示原因；showMaxReason=false 時視覺隱藏但仍關聯', () => {
    const { rerender } = render(
      <Stepper value={1} onChange={() => undefined} label="x" max={5} maxReason="已達上限" />,
    );
    expect(screen.queryByText('已達上限')).not.toBeInTheDocument();
    rerender(
      <Stepper
        value={5}
        onChange={() => undefined}
        label="x"
        max={5}
        maxReason="已達上限"
        showMaxReason={false}
      />,
    );
    expect(screen.getByText('已達上限')).toHaveClass('sr-only');
  });

  it('達最小值：− 停用；有 onRemove 時改為「移除」並呼叫 onRemove', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const onRemove = vi.fn();
    const { rerender } = render(<Controlled initial={1} onChangeSpy={spy} />);
    const minus = screen.getByRole('button', { name: '減少數量' });
    expect(minus).toHaveAttribute('aria-disabled', 'true');
    await user.click(minus);
    expect(spy).not.toHaveBeenCalled();

    rerender(
      <Stepper
        value={1}
        onChange={spy}
        label="x"
        onRemove={onRemove}
        removeLabel="移除招牌滷肉飯"
      />,
    );
    await user.click(screen.getByRole('button', { name: '移除招牌滷肉飯' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('鍵盤：焦點在按鈕或數量上時 ↑ / ↓ 增減；數量上 Home / End 跳到邊界', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Controlled initial={3} min={1} max={8} onChangeSpy={spy} />);

    screen.getByRole('button', { name: '增加數量' }).focus();
    await user.keyboard('{ArrowUp}');
    expect(spy).toHaveBeenLastCalledWith(4);
    await user.keyboard('{ArrowDown}');
    expect(spy).toHaveBeenLastCalledWith(3);

    const spin = screen.getByRole('spinbutton');
    spin.focus();
    await user.keyboard('{End}');
    expect(spy).toHaveBeenLastCalledWith(8);
    await user.keyboard('{Home}');
    expect(spy).toHaveBeenLastCalledWith(1);
  });

  it('方向鍵不會冒泡（避免商品網格的 roving tabindex 同時移動焦點）', () => {
    const parentKey = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onKeyDown={parentKey}>
        <Controlled initial={3} />
      </div>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: '增加數量' }), { key: 'ArrowUp' });
    expect(parentKey).not.toHaveBeenCalled();
  });

  it('使用者操作後以 aria-live 播報數量；announce=false 時不輸出', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(<Controlled initial={2} />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent('');
    await user.click(screen.getByRole('button', { name: '增加數量' }));
    expect(live).toHaveTextContent('招牌滷肉飯 數量 3');

    rerender(<Controlled initial={2} announce={false} />);
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();
  });

  it('disabled：不觸發任何變更', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Controlled initial={2} disabled onChangeSpy={spy} />);
    await user.click(screen.getByRole('button', { name: '增加數量' }));
    await user.click(screen.getByRole('button', { name: '減少數量' }));
    expect(spy).not.toHaveBeenCalled();
  });
});
