// CMP-23：有序清單、目前步驟 aria-current="step"、狀態以文字呈現、取消以 ✕ 與原因
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrderTimeline } from '../OrderTimeline';
import { log, makeOrder } from './fixtures';

const T = (hm: string) => `2026-10-14T${hm}:00+08:00`;

describe('OrderTimeline', () => {
  it('進行中的步驟標示 aria-current，每一步以文字說明狀態（不只靠顏色）', () => {
    render(
      <OrderTimeline
        order={makeOrder({
          status: 'ACCEPTED',
          timeline: [log('PENDING', T('12:20'), 'CUSTOMER'), log('ACCEPTED', T('12:21'))],
        })}
      />,
    );
    const list = screen.getByRole('list', { name: '訂單進度' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('訂單已送出');
    expect(items[0]).toHaveTextContent('已完成');
    expect(items[0]).toHaveTextContent('12:20');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[1]).toHaveTextContent('製作中');
    expect(items[1]).toHaveTextContent('目前進度');
    expect(items[2]).not.toHaveAttribute('aria-current');
    expect(items[2]).toHaveTextContent('可取餐');
    expect(items[2]).toHaveTextContent('尚未開始');
    expect(items[2]).toHaveTextContent('預計 12:35');
  });

  it('PENDING_PAYMENT：先顯示「等待付款」與倒數', () => {
    render(
      <OrderTimeline
        order={makeOrder({
          status: 'PENDING_PAYMENT',
          timeline: [log('PENDING_PAYMENT', T('12:20'), 'CUSTOMER')],
        })}
        paymentCountdown="剩餘 12:30"
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('等待付款');
    expect(items[0]).toHaveTextContent('剩餘 12:30');
    expect(items[0]).toHaveAttribute('aria-current', 'step');
  });

  it('CANCELLED：以「已取消」結尾並呈現取消者與原因', () => {
    render(
      <OrderTimeline
        order={makeOrder({
          status: 'CANCELLED',
          timeline: [
            log('PENDING', T('12:20'), 'CUSTOMER'),
            log('CANCELLED', T('12:22'), 'CUSTOMER', '不小心點錯了'),
          ],
          cancellation: { by: 'CUSTOMER', reason: '不小心點錯了', at: T('12:22') },
        })}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const cancelled = items[1];
    expect(cancelled).toHaveTextContent('已取消');
    expect(cancelled).toHaveTextContent('你取消了這筆訂單');
    expect(cancelled).toHaveTextContent('原因：不小心點錯了');
    expect(cancelled).toHaveTextContent('12:22');
    expect(cancelled).toHaveAttribute('data-state', 'cancelled');
  });
});
