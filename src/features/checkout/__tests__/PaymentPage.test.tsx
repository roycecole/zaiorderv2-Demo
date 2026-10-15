// 模擬金流頁（PG-05）：應付金額與保留說明、付款期限倒數、MANUAL 結果、失敗重試與改現金、逾時、HTTP 模式導向
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import type { CreatePaymentResponse, Order, PaymentAttempt } from '@/domain/types';
import type { ApiClient } from '@/services/api/ApiClient';
import { pageTitleStore } from '@/app/layouts/pageTitle';
import { useGuestOrdersStore } from '@/features/orders/guestOrdersStore';
import { setClock, systemClock } from '@/services/clock';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { PaymentPage } from '../PaymentPage';
import { FakeApiError, INFO, NOW_MS, orderOf } from './fixtures';

function Probe() {
  const loc = useLocation();
  return <div data-testid="probe">{loc.pathname}</div>;
}

const EXPIRES = '2026-10-14T12:15:00+08:00';

const pendingOrder = (over: Partial<Order> = {}): Order =>
  orderOf({
    id: 'o9',
    status: 'PENDING_PAYMENT',
    amounts: { subtotal: 92, deliveryFee: 0, discount: 0, total: 92 },
    payment: { method: 'LINE_PAY', status: 'UNPAID', expiresAt: EXPIRES },
    permissions: { canCancel: true, canPay: true, canReorder: true, canReview: false },
    ...over,
  });

const attempt = (over: Partial<PaymentAttempt> = {}): PaymentAttempt => ({
  id: 'p1',
  method: 'LINE_PAY',
  status: 'PENDING',
  amount: 92,
  createdAt: '2026-10-14T12:00:00+08:00',
  ...over,
});

interface Ctl {
  pay: ReturnType<typeof vi.fn>;
  settle: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

function mount(opts: {
  order: Order;
  pay?: (id: string, req: { method: string }) => Promise<CreatePaymentResponse>;
  settle?: (id: string, result: 'SUCCESS' | 'FAILED', method?: string) => Promise<Order>;
  next?: 'MANUAL' | 'SUCCESS' | 'FAILED' | 'TIMEOUT';
  demo?: boolean;
  route?: string;
}): Ctl {
  let current = opts.order;
  const get = vi.fn(async () => current);
  const pay = vi.fn(async (id: string, req: { method: string }) => {
    if (opts.pay) {
      const res = await opts.pay(id, req);
      current = res.order;
      return res;
    }
    throw new Error('pay 未提供');
  });
  const settle = vi.fn(async (id: string, result: 'SUCCESS' | 'FAILED', method?: string) => {
    if (!opts.settle) throw new Error('settle 未提供');
    current = await opts.settle(id, result, method);
    return current;
  });
  const demo = {
    getState: () => ({ nextPaymentResult: opts.next ?? 'MANUAL' }),
    settlePayment: settle,
  };
  // HTTP 模式：ApiClient 沒有 demo 屬性（getDemoControl 回傳 null）；fakeApi 的 Proxy 會對任何屬性回應，改用一般物件
  const api =
    opts.demo === false
      ? ({ store: { getInfo: async () => INFO }, orders: { get, pay } } as unknown as ApiClient)
      : createFakeApi({
          store: { getInfo: async () => INFO },
          orders: { get, pay },
          demo,
        } as never);
  renderWithProviders(
    <Routes>
      <Route path="/payment/:orderId" element={<PaymentPage />} />
      <Route path="*" element={<Probe />} />
    </Routes>,
    { api, route: opts.route ?? '/payment/o9?method=LINE_PAY' },
  );
  return { pay, settle, get };
}

beforeEach(() => {
  setClock({ now: () => new Date(NOW_MS) });
  useGuestOrdersStore.setState({
    orders: [
      {
        orderId: 'o9',
        orderNo: 'ZO1',
        trackingToken: 'trk_9',
        placedAt: '2026-10-14T12:00:00+08:00',
      },
    ],
  });
});
afterEach(() => {
  setClock(systemClock);
  vi.useRealTimers();
});

describe('付款頁內容', () => {
  it('以 usePageTitle 宣告「付款」；h1 視覺隱藏且唯一', async () => {
    mount({
      order: pendingOrder({
        payment: { method: 'LINE_PAY', status: 'UNPAID', expiresAt: EXPIRES, latest: attempt() },
      }),
    });
    await screen.findByText('NT$ 92');
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent('付款');
    expect(h1[0]).toHaveClass('sr-only');
    expect(pageTitleStore.getState().title).toBe('付款');
  });

  it('顯示應付金額、付款方式、保留說明（取 payment.expiresAt）與倒數；訂單以追蹤權杖讀取', async () => {
    const { get } = mount({
      order: pendingOrder({
        payment: { method: 'LINE_PAY', status: 'UNPAID', expiresAt: EXPIRES, latest: attempt() },
      }),
    });
    expect(await screen.findByText('NT$ 92')).toBeInTheDocument();
    expect(screen.getAllByText('LINE Pay').length).toBeGreaterThan(0);
    expect(screen.getByText('已保留餐點與取餐時段，請於 12:15 前完成付款')).toBeInTheDocument();
    expect(screen.getByText('15:00')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('o9', { trackingToken: 'trk_9' });
  });

  it('剩餘不足 2 分鐘：以 role="alert" 通報「付款時間剩 2 分鐘」', async () => {
    setClock({ now: () => new Date(Date.parse(EXPIRES) - 90_000) });
    mount({
      order: pendingOrder({
        payment: { method: 'LINE_PAY', status: 'UNPAID', expiresAt: EXPIRES, latest: attempt() },
      }),
    });
    const alert = await screen.findByText('付款時間剩 2 分鐘');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(screen.getByText('01:30')).toBeInTheDocument();
  });
});

describe('付款結果', () => {
  it('尚無付款交易：進入時依訂單付款方式發起付款；MANUAL 顯示結果按鈕，付款成功 → 訂單頁', async () => {
    const user = userEvent.setup();
    const { pay, settle } = mount({
      order: pendingOrder(),
      pay: async () => ({
        paymentId: 'p1',
        status: 'PENDING',
        redirectUrl: '/payment/o9?method=LINE_PAY',
        expiresAt: EXPIRES,
        order: pendingOrder({
          payment: { method: 'LINE_PAY', status: 'UNPAID', expiresAt: EXPIRES, latest: attempt() },
        }),
      }),
      settle: async () => orderOf({ id: 'o9', status: 'PENDING' }),
    });
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(1));
    expect(pay.mock.calls[0]?.[1]).toMatchObject({ method: 'LINE_PAY' });
    await user.click(await screen.findByRole('button', { name: '付款成功' }));
    expect(settle).toHaveBeenCalledWith('o9', 'SUCCESS', 'LINE_PAY');
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/orders/o9'));
  });

  it('付款失敗：訂單維持待付款，提供「重新付款」與「改用現金」；改用現金 → 訂單頁', async () => {
    const user = userEvent.setup();
    const failed = attempt({
      status: 'FAILED',
      failureMessage: '付款未完成，可重新付款或改用現金',
    });
    const { pay } = mount({
      order: pendingOrder({
        payment: { method: 'LINE_PAY', status: 'UNPAID', expiresAt: EXPIRES, latest: failed },
      }),
      pay: async (_id, req) =>
        req.method === 'CASH'
          ? {
              paymentId: 'p2',
              status: 'PENDING',
              order: orderOf({
                id: 'o9',
                status: 'PENDING',
                payment: { method: 'CASH', status: 'UNPAID', expiresAt: null },
              }),
            }
          : {
              paymentId: 'p3',
              status: 'PENDING',
              redirectUrl: '/payment/o9',
              order: pendingOrder({
                payment: {
                  method: 'CREDIT_CARD',
                  status: 'UNPAID',
                  expiresAt: EXPIRES,
                  latest: attempt({ method: 'CREDIT_CARD' }),
                },
              }),
            },
    });
    expect(await screen.findByText('付款未完成')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新付款' })).toBeInTheDocument();
    expect(pay).not.toHaveBeenCalled(); // 失敗後不自動重發

    await user.click(screen.getByRole('button', { name: '改用現金' }));
    await waitFor(() =>
      expect(pay).toHaveBeenCalledWith('o9', { method: 'CASH' }, { trackingToken: 'trk_9' }),
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/orders/o9'));
  });

  it('可變更付款方式後重新付款', async () => {
    const user = userEvent.setup();
    const failed = attempt({ status: 'FAILED' });
    const { pay } = mount({
      order: pendingOrder({
        payment: { method: 'LINE_PAY', status: 'UNPAID', expiresAt: EXPIRES, latest: failed },
      }),
      pay: async (_id, req) => ({
        paymentId: 'p3',
        status: 'PENDING',
        redirectUrl: '/payment/o9',
        order: pendingOrder({
          payment: {
            method: 'CREDIT_CARD',
            status: 'UNPAID',
            expiresAt: EXPIRES,
            latest: attempt({ method: req.method as 'CREDIT_CARD' }),
          },
        }),
      }),
    });
    await user.click(await screen.findByRole('radio', { name: '信用卡' }));
    await user.click(screen.getByRole('button', { name: '重新付款' }));
    await waitFor(() => expect(pay).toHaveBeenCalled());
    expect(pay.mock.calls[0]?.[1]).toMatchObject({ method: 'CREDIT_CARD' });
  });

  it('TIMEOUT 情境：不提供結果按鈕，顯示「等待金流回應…」', async () => {
    mount({
      order: pendingOrder(),
      next: 'TIMEOUT',
      pay: async () => ({
        paymentId: 'p1',
        status: 'PENDING',
        redirectUrl: '/payment/o9?method=LINE_PAY&sim=timeout',
        order: pendingOrder({
          payment: { method: 'LINE_PAY', status: 'UNPAID', expiresAt: EXPIRES, latest: attempt() },
        }),
      }),
    });
    expect(await screen.findByText('等待金流回應…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '付款成功' })).toBeNull();
  });

  it('Demo 預設結果 SUCCESS：約 1 秒「處理中」後自動導向訂單頁', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const { pay } = mount({
      order: pendingOrder(),
      next: 'SUCCESS',
      pay: async () => ({
        paymentId: 'p1',
        status: 'SUCCESS',
        order: orderOf({
          id: 'o9',
          status: 'PENDING',
          payment: { method: 'LINE_PAY', status: 'PAID', expiresAt: null },
        }),
      }),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(pay).toHaveBeenCalled();
    expect(screen.queryByTestId('probe')).toBeNull();
    expect(screen.getByText('處理中…', { selector: 'span.font-semibold' })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('/orders/o9');
  });

  it('HTTP 模式（無 DemoControl）：導向金流業者的 redirectUrl', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, origin: 'http://localhost' });
    mount({
      order: pendingOrder(),
      demo: false,
      pay: async () => ({
        paymentId: 'p1',
        status: 'PENDING',
        redirectUrl: 'https://pay.example.com/checkout/abc',
        order: pendingOrder({
          payment: { method: 'LINE_PAY', status: 'UNPAID', expiresAt: EXPIRES, latest: attempt() },
        }),
      }),
    });
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://pay.example.com/checkout/abc'),
    );
    vi.unstubAllGlobals();
  });
});

describe('逾時與守衛', () => {
  it('已逾付款期限（canPay = false）：顯示逾時說明與訂單連結，不發起付款', async () => {
    const { pay } = mount({
      order: pendingOrder({
        permissions: { canCancel: true, canPay: false, canReorder: true, canReview: false },
      }),
    });
    expect(await screen.findByText('付款時間已過')).toBeInTheDocument();
    expect(
      screen.getByText(
        '超過付款時間，訂單已自動取消，保留的餐點與時段已釋出。想再訂可按「再來一單」',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看訂單' })).toHaveAttribute('href', '/orders/o9');
    expect(pay).not.toHaveBeenCalled();
  });

  it('訂單已非待付款（例如已付款）：導向訂單頁', async () => {
    mount({ order: orderOf({ id: 'o9', status: 'PENDING' }) });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/orders/o9'));
  });

  it('付款逾時由系統取消：顯示逾時說明；顧客自行取消者直接導向訂單頁', async () => {
    mount({
      order: orderOf({
        id: 'o9',
        status: 'CANCELLED',
        cancellation: { by: 'SYSTEM', reason: '付款逾時', at: '2026-10-14T12:15:00+08:00' },
      }),
    });
    expect(await screen.findByText('付款時間已過')).toBeInTheDocument();
  });

  it('顧客自行取消的訂單：導向訂單頁', async () => {
    mount({
      order: orderOf({
        id: 'o9',
        status: 'CANCELLED',
        cancellation: { by: 'CUSTOMER', at: '2026-10-14T12:05:00+08:00' },
      }),
    });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/orders/o9'));
  });

  it('找不到訂單（404）：說明並提供查詢訂單', async () => {
    const api = createFakeApi({
      store: { getInfo: async () => INFO },
      orders: {
        get: async () => {
          throw new FakeApiError(404, 'NOT_FOUND', '找不到');
        },
      },
      demo: { getState: () => ({ nextPaymentResult: 'MANUAL' }) },
    } as never);
    renderWithProviders(
      <Routes>
        <Route path="/payment/:orderId" element={<PaymentPage />} />
      </Routes>,
      { api, route: '/payment/zzz' },
    );
    expect(await screen.findByText('找不到訂單，請確認編號與手機')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查詢訂單' })).toHaveAttribute(
      'href',
      '/orders/lookup',
    );
  });
});
