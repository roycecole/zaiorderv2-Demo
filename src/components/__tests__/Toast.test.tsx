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
  dismissOnNavigate: () => (holder.current as ToastApi).dismissOnNavigate(),
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

  describe('dismissOnNavigate（換頁即關閉，復原類 Toast）', () => {
    const undo = { label: '復原', onAction: () => undefined };

    it('帶旗標的 Toast：dismissOnNavigate() 立即關閉，live region 清空、visible 回到 false', () => {
      const onVisibleChange = vi.fn();
      setup(onVisibleChange);
      act(() => {
        api.toast({
          message: '已加入購物車',
          tone: 'success',
          action: undo,
          dismissOnNavigate: true,
        });
      });
      expect(screen.getByRole('status')).toHaveTextContent('已加入購物車');
      expect(screen.getByTestId('visible')).toHaveTextContent('true');

      act(() => {
        api.dismissOnNavigate();
      });
      expect(screen.queryByText('已加入購物車')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
      expect(screen.getByRole('alert')).toBeEmptyDOMElement();
      expect(screen.getByTestId('visible')).toHaveTextContent('false');
      expect(onVisibleChange).toHaveBeenLastCalledWith(false);
    });

    it('沒有旗標（預設 false）的 Toast 不受影響，仍依自己的計時關閉', () => {
      setup();
      act(() => {
        api.toast({ message: '登入成功', tone: 'success' });
      });
      act(() => {
        api.dismissOnNavigate();
      });
      expect(screen.getByText('登入成功')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(3100);
      });
      expect(screen.queryByText('登入成功')).not.toBeInTheDocument();
    });

    it('error（assertive）帶旗標時同樣關閉；沒有旗標的 error 保留', () => {
      setup();
      act(() => {
        api.toast({ message: '無法加入', tone: 'error', dismissOnNavigate: true });
      });
      expect(screen.getByRole('alert')).toHaveTextContent('無法加入');
      act(() => {
        api.dismissOnNavigate();
      });
      expect(screen.getByRole('alert')).toBeEmptyDOMElement();

      act(() => {
        api.toast({ message: '網路不穩', tone: 'error' });
      });
      act(() => {
        api.dismissOnNavigate();
      });
      expect(screen.getByRole('alert')).toHaveTextContent('網路不穩');
    });

    it('沒有 Toast 時呼叫無害：不報錯、不觸發 onVisibleChange，之後的 Toast 照常顯示', () => {
      const onVisibleChange = vi.fn();
      setup(onVisibleChange);
      expect(() => {
        act(() => {
          api.dismissOnNavigate();
          api.dismissOnNavigate();
        });
      }).not.toThrow();
      expect(onVisibleChange).not.toHaveBeenCalled();
      act(() => {
        api.toast({ message: '之後的 Toast', dismissOnNavigate: true });
      });
      expect(screen.getByText('之後的 Toast')).toBeInTheDocument();
    });

    it('連續兩則：新的取代舊的，只看目前顯示的那一則的旗標', () => {
      setup();
      // 帶旗標的被沒有旗標的取代 → 換頁不關閉
      act(() => {
        api.toast({ message: '第一則（旗標）', dismissOnNavigate: true });
      });
      act(() => {
        api.toast({ message: '第二則（無旗標）' });
      });
      act(() => {
        api.dismissOnNavigate();
      });
      expect(screen.queryByText('第一則（旗標）')).not.toBeInTheDocument();
      expect(screen.getByText('第二則（無旗標）')).toBeInTheDocument();

      // 沒有旗標的被帶旗標的取代 → 換頁關閉
      act(() => {
        api.toast({ message: '第三則（旗標）', dismissOnNavigate: true });
      });
      act(() => {
        api.dismissOnNavigate();
      });
      expect(screen.queryByText('第二則（無旗標）')).not.toBeInTheDocument();
      expect(screen.queryByText('第三則（旗標）')).not.toBeInTheDocument();
    });

    it('相同 id 的取代也以新的那一則為準', () => {
      setup();
      act(() => {
        api.toast({ id: 'cart-undo', message: '舊的', dismissOnNavigate: true });
      });
      act(() => {
        api.toast({ id: 'cart-undo', message: '新的' });
      });
      act(() => {
        api.dismissOnNavigate();
      });
      expect(screen.getByText('新的')).toBeInTheDocument();
    });

    it('關閉後舊計時器不會誤關新的 Toast；新的 Toast 依自己的時間關閉', () => {
      setup();
      act(() => {
        api.toast({ message: '舊的（旗標）', action: undo, dismissOnNavigate: true });
      });
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      act(() => {
        api.dismissOnNavigate();
      });
      expect(screen.queryByText('舊的（旗標）')).not.toBeInTheDocument();

      // 舊 Toast 的 6 秒計時若還在，會在再過 2 秒時誤關新的 Toast（不含動作 3 秒）
      act(() => {
        api.toast({ message: '新的' });
      });
      act(() => {
        vi.advanceTimersByTime(2500);
      });
      expect(screen.getByText('新的')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(screen.queryByText('新的')).not.toBeInTheDocument();
    });

    it('取代時也不會被舊計時器誤關：舊 Toast 到期的時間點，新 Toast 仍在', () => {
      setup();
      act(() => {
        api.toast({ message: '舊的', action: undo, dismissOnNavigate: true });
      });
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      act(() => {
        api.toast({ message: '新的', action: undo });
      });
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(screen.getByText('新的')).toBeInTheDocument();
      act(() => {
        api.dismissOnNavigate();
      });
      expect(screen.getByText('新的')).toBeInTheDocument();
    });

    it('hover 暫停中的 Toast 也會被關閉，之後再出現的 Toast 不受暫停狀態影響', () => {
      setup();
      act(() => {
        api.toast({ message: '暫停中', dismissOnNavigate: true });
      });
      fireEvent.mouseEnter(screen.getByText('暫停中').parentElement as HTMLElement);
      act(() => {
        api.dismissOnNavigate();
      });
      expect(screen.queryByText('暫停中')).not.toBeInTheDocument();

      act(() => {
        api.toast({ message: '新的' });
      });
      act(() => {
        vi.advanceTimersByTime(3100);
      });
      expect(screen.queryByText('新的')).not.toBeInTheDocument();
    });

    it('useToast() 回傳的 API 物件在重新渲染間保持穩定（可作為記憶化的依賴）', () => {
      const seen: ToastApi[] = [];
      function Collect() {
        seen.push(useToast());
        return null;
      }
      const { rerender } = render(
        <ToastProvider>
          <Collect />
        </ToastProvider>,
      );
      rerender(
        <ToastProvider>
          <Collect />
        </ToastProvider>,
      );
      expect(seen.length).toBeGreaterThanOrEqual(2);
      expect(new Set(seen).size).toBe(1);
    });
  });

  it('在 ToastProvider 外使用 useToast 會擲出明確錯誤', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Capture />)).toThrow('useToast 必須在 <ToastProvider> 內使用');
    spy.mockRestore();
  });
});
