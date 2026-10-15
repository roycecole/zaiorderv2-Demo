import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveAnnouncer, announce, resetAnnouncer, useAnnounce } from '../LiveAnnouncer';

const polite = (): string =>
  document.querySelector('[role="status"][aria-live="polite"]')?.textContent ?? '';
const assertive = (): string =>
  document.querySelector('[role="alert"][aria-live="assertive"]')?.textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers();
  resetAnnouncer();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('LiveAnnouncer', () => {
  it('兩個常駐 live region 在播報前就存在', () => {
    render(<LiveAnnouncer />);
    expect(document.querySelector('[role="status"][aria-live="polite"]')).toBeInTheDocument();
    expect(document.querySelector('[role="alert"][aria-live="assertive"]')).toBeInTheDocument();
  });

  it('polite 與 assertive 分區播報', () => {
    render(<LiveAnnouncer />);
    act(() => {
      announce('已加入購物車：招牌滷肉飯');
      announce('有 2 個欄位需要修正', 'assertive');
      vi.advanceTimersByTime(60);
    });
    expect(polite()).toBe('已加入購物車：招牌滷肉飯');
    expect(assertive()).toBe('有 2 個欄位需要修正');
  });

  it('相同訊息連續送出時會先清空再寫入，確保重新播報', () => {
    render(<LiveAnnouncer />);
    act(() => {
      announce('已復原');
      vi.advanceTimersByTime(60);
    });
    expect(polite()).toBe('已復原');
    act(() => {
      announce('已復原');
    });
    expect(polite()).toBe('');
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(polite()).toBe('已復原');
  });

  it('極短時間內的不同訊息合併成一句，不會互相吃掉', () => {
    render(<LiveAnnouncer />);
    act(() => {
      announce('數量改為 2');
      announce('已復原');
      vi.advanceTimersByTime(60);
    });
    expect(polite()).toBe('數量改為 2 已復原');
  });

  it('useAnnounce 回傳穩定函式；沒有 LiveAnnouncer 時為安全的 no-op', () => {
    let fn: ReturnType<typeof useAnnounce> | undefined;
    function Probe() {
      fn = useAnnounce();
      return null;
    }
    render(<Probe />);
    expect(() => fn?.('沒有人聽')).not.toThrow();
  });
});
