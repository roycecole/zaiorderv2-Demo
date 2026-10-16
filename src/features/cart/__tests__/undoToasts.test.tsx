// 「復原」類 Toast 換頁即關閉（dismissOnNavigate）：加入、移除、清空購物車的 Toast 都帶旗標；
// 警告 / 錯誤類沒有旗標（換頁後照常保留到計時結束）
import { act, screen } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToast } from '@/components';
import type { ToastApi } from '@/components';
import { renderWithProviders } from '@/test/renderWithProviders';
import { addToCart } from '../addToCart';
import type { AddRequest } from '../addToCart';
import { useCartStore } from '../cartStore';
import { removeLineWithUndo } from '../removeLine';
import { useCartFeedback } from '../useCartFeedback';
import type { CartFeedback } from '../useCartFeedback';
import { useCartLineActions } from '../useCartLineActions';
import type { CartLineActions } from '../useCartLineActions';

const handles: { feedback?: CartFeedback; toast?: ToastApi; actions?: CartLineActions } = {};

function Probe() {
  const feedback = useCartFeedback();
  const toast = useToast();
  const listRef = useRef<HTMLUListElement>(null);
  const actions = useCartLineActions(listRef);
  useEffect(() => {
    handles.feedback = feedback;
    handles.toast = toast;
    handles.actions = actions;
  });
  return <ul ref={listRef} />;
}

const request = (overrides: Partial<AddRequest> = {}): AddRequest => ({
  productId: 'prd_lurou',
  name: '招牌滷肉飯',
  remaining: null,
  optionIds: [],
  optionLabels: [],
  unitPrice: 35,
  quantity: 1,
  ...overrides,
});

/** 模擬外殼在換頁時的呼叫（useDismissToastsOnNavigate 做的事） */
const navigate = (): void => {
  act(() => {
    handles.toast?.dismissOnNavigate();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  useCartStore.setState({ lines: [], orderType: 'PICKUP', updatedAt: Date.now() });
  renderWithProviders(<Probe />);
});
afterEach(() => {
  vi.useRealTimers();
  handles.feedback = undefined;
  handles.toast = undefined;
  handles.actions = undefined;
});

describe('復原類 Toast 帶 dismissOnNavigate', () => {
  it('加入購物車：「已加入購物車・復原」換頁即關閉', () => {
    act(() => {
      handles.feedback?.add(request());
    });
    expect(screen.getByRole('status')).toHaveTextContent('已加入購物車');
    expect(screen.getByRole('button', { name: '復原' })).toBeInTheDocument();

    navigate();
    expect(screen.queryByText('已加入購物車')).not.toBeInTheDocument();
    // 沒有按「復原」：品項仍在購物車
    expect(useCartStore.getState().lines).toHaveLength(1);
  });

  it('再點一份（kind = repeat）的 Toast 也帶旗標', () => {
    act(() => {
      handles.feedback?.add(request(), 'add');
    });
    act(() => {
      handles.feedback?.add(request(), 'repeat');
    });
    expect(screen.getByRole('status')).toHaveTextContent('已再點');
    navigate();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('數量夾到上限的加入（「已加入購物車…」附說明）同樣帶旗標', () => {
    act(() => {
      handles.feedback?.add(request({ quantity: 18 }));
    });
    act(() => {
      handles.feedback?.add(request({ quantity: 5 }));
    });
    expect(screen.getByRole('button', { name: '復原' })).toBeInTheDocument();
    navigate();
    expect(screen.queryByRole('button', { name: '復原' })).not.toBeInTheDocument();
  });

  it('移除品項：「已移除…・復原」換頁即關閉', () => {
    const outcome = addToCart(request());
    expect(outcome.ok).toBe(true);
    const [line] = useCartStore.getState().lines;
    expect(line).toBeDefined();
    act(() => {
      handles.actions?.removeNow(line!);
    });
    expect(screen.getByRole('status')).toHaveTextContent('已移除');
    expect(screen.getByRole('button', { name: '復原' })).toBeInTheDocument();

    navigate();
    expect(screen.queryByRole('button', { name: '復原' })).not.toBeInTheDocument();
    // 換頁只是關掉提示：購物車維持移除後的樣子（不會被復原）
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it('removeLineWithUndo（菜單卡片、訂單面板共用）的 Toast 帶旗標', () => {
    addToCart(request());
    const [line] = useCartStore.getState().lines;
    act(() => {
      removeLineWithUndo(line!, {
        toast: (options) => handles.toast!.toast(options),
        announce: () => undefined,
      });
    });
    expect(screen.getByRole('button', { name: '復原' })).toBeInTheDocument();
    navigate();
    expect(screen.queryByRole('button', { name: '復原' })).not.toBeInTheDocument();
  });

  it('清空購物車：「購物車已清空・復原」換頁即關閉', () => {
    addToCart(request());
    addToCart(request({ productId: 'prd_egg', name: '滷蛋' }));
    act(() => {
      handles.actions?.clearAll();
    });
    expect(screen.getByRole('status')).toHaveTextContent('購物車已清空');
    navigate();
    expect(screen.queryByText('購物車已清空')).not.toBeInTheDocument();
  });

  it('換頁前按「復原」仍然有效（旗標只影響換頁）', () => {
    act(() => {
      handles.feedback?.add(request());
    });
    act(() => {
      screen.getByRole('button', { name: '復原' }).click();
    });
    expect(useCartStore.getState().lines).toHaveLength(0);
  });
});

describe('不帶旗標：警告 / 錯誤類 Toast 換頁後照常保留', () => {
  it('無法加入（已達單行 20 份上限）的警告 Toast', () => {
    act(() => {
      handles.feedback?.add(request({ quantity: 20 }));
    });
    navigate();
    act(() => {
      handles.feedback?.add(request());
    });
    expect(screen.getByRole('status')).toHaveTextContent('此品項已達上限 20 份');
    navigate();
    expect(screen.getByRole('status')).toHaveTextContent('此品項已達上限 20 份');
  });

  it('fail()：呼叫端自行說明的失敗', () => {
    act(() => {
      handles.feedback?.fail('暫時無法取得商品資料');
    });
    navigate();
    expect(screen.getByText('暫時無法取得商品資料')).toBeInTheDocument();
  });
});
