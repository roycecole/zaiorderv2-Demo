import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../ConfirmDialog';
import { Dialog } from '../Dialog';
import { Sheet } from '../Sheet';

function DialogHarness({
  withInitialFocus = false,
  dismissible = true,
}: {
  withInitialFocus?: boolean;
  dismissible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        開啟
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="鍵盤快速鍵與偏好"
        description="調整顯示與輸入偏好"
        dismissible={dismissible}
        initialFocusRef={withInitialFocus ? inputRef : undefined}
        footer={<button type="button">完成</button>}
      >
        <label>
          名稱
          <input ref={inputRef} />
        </label>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('開啟後有 dialog 名稱與說明，焦點移到標題；背景被隱藏', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole('button', { name: '開啟' }));

    const dialog = await screen.findByRole('dialog', { name: '鍵盤快速鍵與偏好' });
    expect(dialog).toHaveAccessibleDescription('調整顯示與輸入偏好');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '鍵盤快速鍵與偏好' })).toHaveFocus(),
    );
    // 背景（觸發按鈕）對輔助科技隱藏
    expect(screen.queryByRole('button', { name: '開啟' })).not.toBeInTheDocument();
  });

  it('Esc 關閉，並把焦點還原給觸發者', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: '開啟' });
    await user.click(trigger);
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('關閉鈕關閉，焦點同樣還原', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: '開啟' });
    await user.click(trigger);
    await user.click(await screen.findByRole('button', { name: '關閉' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('initialFocusRef 指定初始焦點', async () => {
    const user = userEvent.setup();
    render(<DialogHarness withInitialFocus />);
    await user.click(screen.getByRole('button', { name: '開啟' }));
    await screen.findByRole('dialog');
    await waitFor(() => expect(screen.getByLabelText('名稱')).toHaveFocus());
  });

  it('焦點陷阱：Tab 只在對話框內循環', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole('button', { name: '開啟' }));
    const dialog = await screen.findByRole('dialog');
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('dismissible=false：Esc 不會關閉', async () => {
    const user = userEvent.setup();
    render(<DialogHarness dismissible={false} />);
    await user.click(screen.getByRole('button', { name: '開啟' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  function ConfirmHarness({
    onConfirm,
    tone = 'danger',
  }: {
    onConfirm: () => void | Promise<unknown>;
    tone?: 'default' | 'danger';
  }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          清空購物車
        </button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          tone={tone}
          title="要清空購物車嗎？"
          description="3 項餐點會一併移除"
          confirmLabel="清空"
          onConfirm={onConfirm}
        />
      </>
    );
  }

  it('role=alertdialog，預設焦點在較安全的「取消」', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness onConfirm={() => undefined} />);
    await user.click(screen.getByRole('button', { name: '清空購物車' }));
    const dialog = await screen.findByRole('alertdialog', { name: '要清空購物車嗎？' });
    expect(dialog).toHaveAccessibleDescription('3 項餐點會一併移除');
    await waitFor(() => expect(screen.getByRole('button', { name: '取消' })).toHaveFocus());
  });

  it('danger 外觀使用 danger 色，不使用品牌色', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness onConfirm={() => undefined} />);
    await user.click(screen.getByRole('button', { name: '清空購物車' }));
    const confirm = await screen.findByRole('button', { name: '清空' });
    expect(confirm.className).toContain('bg-danger');
    expect(confirm.className).not.toContain('bg-brand');
  });

  it('確認：呼叫 onConfirm 並關閉', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmHarness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: '清空購物車' }));
    await user.click(await screen.findByRole('button', { name: '清空' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('取消與 Esc 都不會呼叫 onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmHarness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: '清空購物車' }));
    await user.click(await screen.findByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '清空購物車' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('onConfirm 回傳 Promise：等待期間 loading、對話框保持開啟，完成後關閉', async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(<ConfirmHarness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: '清空購物車' }));
    const confirm = await screen.findByRole('button', { name: '清空' });
    await user.click(confirm);
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    resolve();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});

describe('Sheet', () => {
  it('以 dialog 呈現，標題、說明、頁尾皆在內，Esc 關閉並還原焦點', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            商品卡
          </button>
          <Sheet
            open={open}
            onOpenChange={setOpen}
            title="招牌滷肉飯"
            description="古早味滷肉燥"
            footer={<button type="button">加入購物車</button>}
          >
            <p>內容</p>
          </Sheet>
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '商品卡' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    expect(dialog).toHaveAccessibleDescription('古早味滷肉燥');
    expect(screen.getByRole('button', { name: '加入購物車' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: '招牌滷肉飯' })).toHaveFocus());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('returnFocusRef 可指定還原目標', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      const target = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            開啟
          </button>
          <button type="button" ref={target}>
            指定目標
          </button>
          <Sheet open={open} onOpenChange={setOpen} title="標題" returnFocusRef={target} />
        </>
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '開啟' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: '指定目標' })).toHaveFocus());
  });
});
