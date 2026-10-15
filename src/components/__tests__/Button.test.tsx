import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, LinkButton, buttonClassName } from '../Button';

describe('Button', () => {
  it('預設 type=button，不會在表單內誤送出', () => {
    render(<Button>加入</Button>);
    expect(screen.getByRole('button', { name: '加入' })).toHaveAttribute('type', 'button');
  });

  it('點擊會呼叫 onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>加入</Button>);
    await user.click(screen.getByRole('button', { name: '加入' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('loading：aria-busy + aria-disabled、保留焦點、點擊與鍵盤都不會觸發', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading loadingLabel="確認餐點與時段中…" onClick={onClick}>
        送出訂單
      </Button>,
    );
    const button = screen.getByRole('button', { name: '確認餐點與時段中…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();

    button.focus();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
  });

  it('aria-disabled 為 true 時不呼叫 onClick，但仍可聚焦', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button aria-disabled="true" onClick={onClick}>
        送出訂單
      </Button>,
    );
    const button = screen.getByRole('button', { name: '送出訂單' });
    await user.tab();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
  });

  it('原生 disabled 不可聚焦也不觸發', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        暫停接單
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('onClick 回傳 Promise：完成前自動 loading，連點只觸發一次', async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => undefined;
    const onClick = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(<Button onClick={onClick}>送出</Button>);
    const button = screen.getByRole('button', { name: '送出' });
    await user.click(button);
    await user.click(button);
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('aria-busy', 'true');

    resolve();
    await vi.waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(2);
    resolve();
  });

  it('buttonClassName 可套用在其他元素；LinkButton 以 as 注入連結元件', () => {
    expect(buttonClassName({ variant: 'danger', size: 'lg', fullWidth: true })).toContain(
      'bg-danger',
    );
    render(
      <LinkButton href="/cart" variant="secondary">
        前往購物車
      </LinkButton>,
    );
    const link = screen.getByRole('link', { name: '前往購物車' });
    expect(link).toHaveAttribute('href', '/cart');
    expect(link.className).toContain('border-brand');
  });
});
