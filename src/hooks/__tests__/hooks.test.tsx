import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClock, systemClock } from '@/services/clock';
import { useBreakpoint } from '../useBreakpoint';
import { useClockNow } from '../useClockNow';
import { useDebouncedValue } from '../useDebouncedValue';
import { useFieldIds } from '../useFieldIds';
import { useLatest } from '../useLatest';
import { useMediaQuery } from '../useMediaQuery';
import { usePageVisibility } from '../usePageVisibility';
import { useReducedMotion } from '../useReducedMotion';

type Listener = () => void;

/** 以寬度模擬 matchMedia（支援 min-width 與 prefers-reduced-motion） */
function installMatchMedia(state: { width: number; reduceMotion: boolean }) {
  const listeners = new Set<Listener>();
  const evaluate = (query: string): boolean => {
    const min = /\(min-width:\s*(\d+)px\)/.exec(query);
    if (min?.[1] !== undefined) return state.width >= Number(min[1]);
    if (query.includes('prefers-reduced-motion')) return state.reduceMotion;
    return false;
  };
  window.matchMedia = ((query: string) => ({
    get matches() {
      return evaluate(query);
    },
    media: query,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  })) as unknown as typeof window.matchMedia;
  return {
    set(next: Partial<typeof state>) {
      Object.assign(state, next);
      listeners.forEach((l) => l());
    },
  };
}

describe('useMediaQuery / useBreakpoint / useReducedMotion', () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it('沒有 matchMedia 的環境回傳 false / sm', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(renderHook(() => useMediaQuery('(min-width: 768px)')).result.current).toBe(false);
    expect(renderHook(() => useBreakpoint()).result.current).toBe('sm');
  });

  it('依寬度回傳斷點，並在改變時更新', () => {
    const mm = installMatchMedia({ width: 390, reduceMotion: false });
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('sm');
    act(() => mm.set({ width: 800 }));
    expect(result.current).toBe('md');
    act(() => mm.set({ width: 1280 }));
    expect(result.current).toBe('lg');
    act(() => mm.set({ width: 767 }));
    expect(result.current).toBe('sm');
  });

  it('useReducedMotion 讀系統偏好', () => {
    const mm = installMatchMedia({ width: 1024, reduceMotion: false });
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => mm.set({ reduceMotion: true }));
    expect(result.current).toBe(true);
  });
});

describe('usePageVisibility', () => {
  it('隨 visibilitychange 更新', () => {
    let state: DocumentVisibilityState = 'visible';
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
    const { result } = renderHook(() => usePageVisibility());
    expect(result.current).toBe(true);
    act(() => {
      state = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe(false);
    spy.mockRestore();
  });
});

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('停止變動 delay 毫秒後才更新', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: 'a' },
    });
    expect(result.current).toBe('a');
    rerender({ v: 'ab' });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('a');
    rerender({ v: 'abc' });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('a');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('abc');
  });

  it('delay <= 0 立即反映', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 0), {
      initialProps: { v: 1 },
    });
    rerender({ v: 2 });
    expect(result.current).toBe(2);
  });
});

describe('useClockNow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    setClock(systemClock);
    vi.useRealTimers();
  });

  it('以 getClock().now() 週期更新（尊重 setClock，不讀系統時間）', () => {
    let current = new Date('2026-10-14T12:00:00+08:00');
    setClock({ now: () => current });
    const { result } = renderHook(() => useClockNow(1000));
    expect(result.current.toISOString()).toBe(current.toISOString());

    current = new Date('2026-10-14T12:00:05+08:00');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.toISOString()).toBe(current.toISOString());
  });

  it('intervalMs=null 暫停；恢復時立即同步', () => {
    let current = new Date('2026-10-14T12:00:00+08:00');
    setClock({ now: () => current });
    const { result, rerender } = renderHook(({ ms }) => useClockNow(ms), {
      initialProps: { ms: null as number | null },
    });
    current = new Date('2026-10-14T12:30:00+08:00');
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.toISOString()).toBe(new Date('2026-10-14T12:00:00+08:00').toISOString());
    rerender({ ms: 1000 });
    expect(result.current.toISOString()).toBe(current.toISOString());
  });
});

describe('useLatest / useFieldIds', () => {
  it('useLatest 永遠指向最新值', () => {
    const { result, rerender } = renderHook(({ v }) => useLatest(v), { initialProps: { v: 1 } });
    expect(result.current.current).toBe(1);
    rerender({ v: 2 });
    expect(result.current.current).toBe(2);
  });

  it('useFieldIds：id 唯一，describedBy 依存在的說明組合，全無時為 undefined', () => {
    function Probe() {
      const a = useFieldIds('name');
      const b = useFieldIds('name');
      return (
        <div>
          <span data-testid="a">{a.id}</span>
          <span data-testid="b">{b.id}</span>
          <span data-testid="both">{a.describedBy({ hint: true, error: true })}</span>
          <span data-testid="none">{String(a.describedBy({}))}</span>
          <span data-testid="hint">{a.hintId}</span>
          <span data-testid="err">{a.errorId}</span>
        </div>
      );
    }
    render(<Probe />);
    expect(screen.getByTestId('a').textContent).toMatch(/^name-/);
    expect(screen.getByTestId('a').textContent).not.toBe(screen.getByTestId('b').textContent);
    expect(screen.getByTestId('both').textContent).toBe(
      `${screen.getByTestId('hint').textContent} ${screen.getByTestId('err').textContent}`,
    );
    expect(screen.getByTestId('none').textContent).toBe('undefined');
  });
});
