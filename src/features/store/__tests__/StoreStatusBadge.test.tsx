import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClock, systemClock } from '@/services/clock';
import { StoreStatusBadge } from '../StoreStatusBadge';
import { NOON_MS, makeStatus } from './fixtures';

beforeEach(() => {
  setClock({ now: () => new Date(NOON_MS) });
});
afterEach(() => {
  setClock(systemClock);
  vi.useRealTimers();
});

describe('StoreStatusBadge', () => {
  it('尚未載入：顯示佔位文字', () => {
    render(<StoreStatusBadge status={undefined} />);
    expect(screen.getByText('載入營業狀態中…')).toBeInTheDocument();
  });

  it('營業中：圖示為裝飾、文字完整（不只靠顏色）', () => {
    const { container } = render(<StoreStatusBadge status={makeStatus()} />);
    expect(screen.getByText('營業中・今日 11:00–14:00、17:00–21:00')).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild).toHaveAttribute('data-zo-store-status', 'OPEN');
  });

  it.each([
    [
      '休息中',
      makeStatus({
        status: 'CLOSED',
        closedReason: 'OUT_OF_HOURS',
        nextOpenAt: '2026-10-14T17:00:00+08:00',
      }),
      '休息中・今日 17:00 開始營業',
    ],
    [
      '今日公休',
      makeStatus({
        status: 'CLOSED',
        closedReason: 'HOLIDAY',
        nextOpenAt: '2026-10-15T11:00:00+08:00',
      }),
      '今日公休・明日 11:00 營業',
    ],
    [
      '停止接單',
      makeStatus({
        status: 'CLOSED',
        closedReason: 'LAST_ORDER_PASSED',
        nextOpenAt: '2026-10-15T11:00:00+08:00',
      }),
      '已停止接單・可預約 明日 11:00',
    ],
    [
      '暫停接單（有預計恢復）',
      makeStatus({ status: 'PAUSED', pausedUntil: '2026-10-14T12:20:00+08:00' }),
      '暫停接單・預計 12:20 恢復（約 20 分鐘後）',
    ],
  ])('%s', (_name, status, text) => {
    render(<StoreStatusBadge status={status} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('compact 變體使用精簡文案', () => {
    render(<StoreStatusBadge status={makeStatus()} variant="compact" />);
    expect(screen.getByText('營業中・今日 14:00 打烊')).toBeInTheDocument();
  });

  it('announce 時以 role=status 通報變更', () => {
    render(<StoreStatusBadge status={makeStatus()} announce />);
    expect(screen.getByRole('status')).toHaveTextContent('營業中');
  });

  it('隨時鐘更新「約 n 分鐘後恢復營業」', async () => {
    vi.useFakeTimers();
    let nowMs = NOON_MS;
    setClock({ now: () => new Date(nowMs) });
    render(
      <StoreStatusBadge
        variant="compact"
        status={makeStatus({ status: 'PAUSED', pausedUntil: '2026-10-14T12:30:00+08:00' })}
      />,
    );
    expect(screen.getByText('暫停接單・約 30 分鐘後恢復營業')).toBeInTheDocument();
    nowMs += 10 * 60_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByText('暫停接單・約 20 分鐘後恢復營業')).toBeInTheDocument();
  });
});
