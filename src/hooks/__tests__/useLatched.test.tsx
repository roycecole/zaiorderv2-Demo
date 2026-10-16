import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLatched } from '../useLatched';

describe('useLatched：條件第一次成立後維持 true', () => {
  it('一開始就成立 → true；之後變回 false 仍為 true', () => {
    const { result, rerender } = renderHook(({ v }) => useLatched(v), { initialProps: { v: true } });
    expect(result.current).toBe(true);
    rerender({ v: false });
    expect(result.current).toBe(true);
  });

  it('一開始不成立 → false；成立的那次渲染就是 true；之後不再退回', () => {
    const { result, rerender } = renderHook(({ v }) => useLatched(v), { initialProps: { v: false } });
    expect(result.current).toBe(false);
    rerender({ v: true });
    expect(result.current).toBe(true);
    rerender({ v: false });
    expect(result.current).toBe(true);
    rerender({ v: true });
    expect(result.current).toBe(true);
  });

  it('一直不成立就一直是 false', () => {
    const { result, rerender } = renderHook(({ v }) => useLatched(v), { initialProps: { v: false } });
    rerender({ v: false });
    expect(result.current).toBe(false);
  });
});
