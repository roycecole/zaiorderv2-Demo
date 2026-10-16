// 換頁時關閉帶 dismissOnNavigate 旗標的 Toast（「已加入購物車・復原」跨頁殘留）
import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { Outlet, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToast } from '@/components';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useDismissToastsOnNavigate } from '../useDismissToastsOnNavigate';

/** 外殼的替身：和 ShellFrame 一樣由 pathname 驅動 hook */
function ShellFrame({ name }: { name: string }) {
  const { pathname } = useLocation();
  useDismissToastsOnNavigate(pathname);
  return (
    <div data-testid={`shell-${name}`}>
      <Outlet />
    </div>
  );
}

// 與正式環境一樣用「不同的元件」當兩個版面（AppShell / TaskLayout），切換時 ShellFrame 會整個重新掛載
const AppLayout = () => <ShellFrame name="app" />;
const TaskLayout = () => <ShellFrame name="task" />;

function Controls() {
  const { toast } = useToast();
  const navigate = useNavigate();
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          toast({
            message: '已加入購物車',
            tone: 'success',
            action: { label: '復原', onAction: () => undefined },
            dismissOnNavigate: true,
          })
        }
      >
        顯示復原提示
      </button>
      <button type="button" onClick={() => toast({ message: '登入成功', tone: 'success' })}>
        顯示一般提示
      </button>
      <button type="button" onClick={() => navigate('/cart')}>
        前往購物車
      </button>
      <button type="button" onClick={() => navigate('/checkout')}>
        前往結帳
      </button>
      <button type="button" onClick={() => navigate('/?product=prd_lurou')}>
        開啟商品面板
      </button>
      <button type="button" onClick={() => navigate('/')}>
        回到菜單
      </button>
      <button type="button" onClick={() => navigate('/cart', { replace: true })}>
        取代為購物車
      </button>
    </div>
  );
}

/** 兩個兄弟版面（對應 AppShell 與 TaskLayout）：在它們之間換頁時整個外殼會重新掛載 */
function Tree() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Controls />} />
        <Route path="cart" element={<Controls />} />
      </Route>
      <Route element={<TaskLayout />}>
        <Route path="checkout" element={<Controls />} />
      </Route>
    </Routes>
  );
}

function click(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useDismissToastsOnNavigate', () => {
  it('pathname 變更時關閉帶旗標的 Toast', () => {
    renderWithProviders(<Tree />);
    click('顯示復原提示');
    expect(screen.getByRole('status')).toHaveTextContent('已加入購物車');

    click('前往購物車');
    expect(screen.queryByText('已加入購物車')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('兄弟版面之間換頁（外殼重新掛載，例如菜單 → 結帳）同樣關閉', () => {
    renderWithProviders(<Tree />);
    expect(screen.getByTestId('shell-app')).toBeInTheDocument();
    click('顯示復原提示');
    expect(screen.getByText('已加入購物車')).toBeInTheDocument();

    click('前往結帳');
    expect(screen.getByTestId('shell-task')).toBeInTheDocument();
    expect(screen.queryByTestId('shell-app')).not.toBeInTheDocument();
    expect(screen.queryByText('已加入購物車')).not.toBeInTheDocument();
  });

  it('沒有旗標的 Toast（登入成功、再來一單導向購物車的提示…）換頁後保留，直到自己的計時結束', () => {
    renderWithProviders(<Tree />);
    click('顯示一般提示');
    click('前往購物車');
    expect(screen.getByText('登入成功')).toBeInTheDocument();
    click('前往結帳');
    expect(screen.getByText('登入成功')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.queryByText('登入成功')).not.toBeInTheDocument();
  });

  it('只有 pathname 算換頁：查詢字串變化（開關商品面板的 ?product=）不關閉', () => {
    renderWithProviders(<Tree />);
    click('顯示復原提示');

    click('開啟商品面板');
    expect(screen.getByText('已加入購物車')).toBeInTheDocument();
    click('回到菜單');
    expect(screen.getByText('已加入購物車')).toBeInTheDocument();
  });

  it('同一路徑再導覽一次（pathname 沒變）不關閉；取代式導覽換了 pathname 就關閉', () => {
    renderWithProviders(<Tree />);
    click('前往購物車');
    click('顯示復原提示');
    click('前往購物車');
    expect(screen.getByText('已加入購物車')).toBeInTheDocument();

    click('回到菜單');
    expect(screen.queryByText('已加入購物車')).not.toBeInTheDocument();

    click('顯示復原提示');
    click('取代為購物車');
    expect(screen.queryByText('已加入購物車')).not.toBeInTheDocument();
  });

  it('略過首次掛載：Toast 先於 hook 出現，掛載當下不會被關閉', () => {
    function LateShell() {
      const [mounted, setMounted] = useState(false);
      const { toast } = useToast();
      const { pathname } = useLocation();
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              toast({ message: '先出現的提示', dismissOnNavigate: true });
              setMounted(true);
            }}
          >
            顯示並掛載
          </button>
          {mounted ? <Watch pathname={pathname} /> : null}
        </div>
      );
    }
    function Watch({ pathname }: { pathname: string }) {
      useDismissToastsOnNavigate(pathname);
      return null;
    }
    renderWithProviders(<LateShell />, { route: '/cart' });
    click('顯示並掛載');
    expect(screen.getByText('先出現的提示')).toBeInTheDocument();
  });

  it('沒有 Toast 時換頁無害', () => {
    renderWithProviders(<Tree />);
    expect(() => {
      click('前往購物車');
      click('前往結帳');
      click('回到菜單');
    }).not.toThrow();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('換頁後新出現的復原提示不會被前一次換頁的結果影響', () => {
    renderWithProviders(<Tree />);
    click('前往購物車');
    click('顯示復原提示');
    expect(screen.getByText('已加入購物車')).toBeInTheDocument();
    click('前往結帳');
    expect(screen.queryByText('已加入購物車')).not.toBeInTheDocument();

    click('顯示復原提示');
    expect(screen.getByText('已加入購物車')).toBeInTheDocument();
    click('回到菜單');
    expect(screen.queryByText('已加入購物車')).not.toBeInTheDocument();
  });
});
