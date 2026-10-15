import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast, useToastVisible } from '../Toast';
import type { ToastApi } from '../Toast';

const holder: { current: ToastApi | null } = { current: null };
/** 測試用：永遠取得最新的 ToastApi */
const api: ToastApi = {
  toast: (options) => (holder.current as ToastApi).toast(options),
  dismiss: (id) => (holder.current as ToastApi).dismiss(id),
};
function Capture() {
  const toastApi = useToast();
  useEffect(() => {
    holder.current = toastApi;
  });
  const visible = useToastVisible();
  return <span data-testid="visible">{String(visible)}</span>;
}

function setup(onVisibleChange?: (v: boolean) => void) {
  return render(
    <ToastProvider {...(onVisibleChange ? { onVisibleChange } : {})}>
      <Capture />
    </ToastProvider>,
  );
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('live region 在 Toast 出現前就存在（polite 與 assertive 各一）', () => {
    setup();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });

  it('一般訊息進入 polite 區域；error 進入 assertive 區域', () => {
    setup();
    act(() => {
      api.toast({ message: '已加入購物車', tone: 'success' });
    });
    expect(screen.getByRole('status')).toHaveTextContent('已加入購物車');
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();

    act(() => {
      api.toast({ message: '網路好像不太穩，請稍後再試', tone: 'error' });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('網路好像不太穩');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('一次只顯示一則：新的取代舊的', () => {
    setup();
    act(() => {
      api.toast({ message: '第一則' });
    });
    act(() => {
      api.toast({ message: '第二則' });
    });
    expect(screen.queryByText('第一則')).not.toBeInTheDocument();
    expect(screen.getByText('第二則')).toBeInTheDocument();
  });

  it('不含動作 3 秒後自動關閉', () => {
    setup();
    act(() => {
      api.toast({ message: '已加入' });
    });
    act(() => {
      vi.advanceTimersByTime(2900);
    });
    expect(screen.getByText('已加入')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText('已加入')).not.toBeInTheDocument();
  });

  it('含動作 6 秒後關閉', () => {
    setup();
    act(() => {
      api.toast({ message: '已加入', action: { label: '復原', onAction: () => undefined } });
    });
    act(() => {
      vi.advanceTimersByTime(5900);
    });
    expect(screen.getByText('已加入')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText('已加入')).not.toBeInTheDocument();
  });

  it('滑鼠移入暫停、移出後以剩餘時間繼續', () => {
    setup();
    act(() => {
      api.toast({ message: '已加入' });
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const card = screen.getByText('已加入').parentElement as HTMLElement;
    fireEvent.mouseEnter(card);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('已加入')).toBeInTheDocument();

    fireEvent.mouseLeave(card);
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(screen.getByText('已加入')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText('已加入')).not.toBeInTheDocument();
  });

  it('取得焦點時暫停', () => {
    setup();
    act(() => {
      api.toast({ message: '已加入', action: { label: '復原', onAction: () => undefined } });
    });
    const undo = screen.getByRole('button', { name: '復原' });
    act(() => {
      undo.focus();
    });
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByText('已加入')).toBeInTheDocument();
    act(() => {
      undo.blur();
    });
    act(() => {
      vi.advanceTimersByTime(6100);
    });
    expect(screen.queryByText('已加入')).not.toBeInTheDocument();
  });

  it('動作按鈕：呼叫 onAction 並關閉', () => {
    setup();
    const onAction = vi.fn();
    act(() => {
      api.toast({ message: '已加入', action: { label: '復原', onAction } });
    });
    fireEvent.click(screen.getByRole('button', { name: '復原' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('已加入')).not.toBeInTheDocument();
  });

  it('durationMs=0 不自動關閉，提供關閉鈕', () => {
    setup();
    act(() => {
      api.toast({ message: '請留意', durationMs: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('請留意')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    expect(screen.queryByText('請留意')).not.toBeInTheDocument();
  });

  it('dismiss(id) 只關閉對應的 Toast；onVisibleChange 與 useToastVisible 同步', () => {
    const onVisibleChange = vi.fn();
    setup(onVisibleChange);
    expect(screen.getByTestId('visible')).toHaveTextContent('false');
    let id = '';
    act(() => {
      id = api.toast({ message: 'A', id: 'a' });
    });
    expect(id).toBe('a');
    expect(screen.getByTestId('visible')).toHaveTextContent('true');
    expect(onVisibleChange).toHaveBeenLastCalledWith(true);

    act(() => {
      api.dismiss('not-a');
    });
    expect(screen.getByText('A')).toBeInTheDocument();
    act(() => {
      api.dismiss('a');
    });
    expect(screen.queryByText('A')).not.toBeInTheDocument();
    expect(onVisibleChange).toHaveBeenLastCalledWith(false);
  });

  it('字串簡寫', () => {
    setup();
    act(() => {
      api.toast('已儲存');
    });
    expect(screen.getByText('已儲存')).toBeInTheDocument();
  });

  it('在 ToastProvider 外使用 useToast 會擲出明確錯誤', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Capture />)).toThrow('useToast 必須在 <ToastProvider> 內使用');
    spy.mockRestore();
  });
});
