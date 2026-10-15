// 外殼的頂部列頁名、document.title 與路由播報依賴各頁的 usePageTitle；每頁只有一個 h1
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { pageTitleStore } from '@/app/layouts/pageTitle';
import { useSessionStore } from '@/features/auth/sessionStore';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useGuestOrdersStore } from '../guestOrdersStore';
import { OrderLookupPage } from '../OrderLookupPage';
import { OrderPage } from '../OrderPage';
import { OrdersPage } from '../OrdersPage';
import { makeOrder, makeSummary } from './fixtures';

beforeEach(() => {
  pageTitleStore.setState({ title: null });
  useSessionStore.getState().clear();
  useGuestOrdersStore.getState().clear();
});

describe('usePageTitle：訂單相關頁面', () => {
  it('OrderPage：載入前為「訂單追蹤」，載入後附上取餐號碼；只有一個 h1', async () => {
    useGuestOrdersStore.getState().upsert({
      orderId: 'ord_1',
      orderNo: 'ZO261014K7M3QX',
      trackingToken: 'trk',
      placedAt: '2026-10-14T12:20:00+08:00',
    });
    let resolve: (o: ReturnType<typeof makeOrder>) => void = () => undefined;
    const pending = new Promise<ReturnType<typeof makeOrder>>((r) => {
      resolve = r;
    });
    renderWithProviders(
      <Routes>
        <Route path="/orders/:orderId" element={<OrderPage />} />
      </Routes>,
      { api: createFakeApi({ orders: { get: () => pending } }), route: '/orders/ord_1' },
    );
    await waitFor(() => expect(pageTitleStore.getState().title).toBe('訂單追蹤'));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    resolve(makeOrder({ status: 'PENDING' }));
    await waitFor(() => expect(pageTitleStore.getState().title).toBe('訂單追蹤・A027'));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // 頁面不再自帶返回箭頭 / 頁名列（任務型版面的 TaskHeader 已提供）
    expect(screen.queryByRole('button', { name: /返回/ })).not.toBeInTheDocument();
  });

  it('OrderPage：找不到訂單時標題為「找不到訂單」', async () => {
    useGuestOrdersStore.getState().upsert({
      orderId: 'ord_1',
      orderNo: 'ZO1',
      trackingToken: 'trk',
      placedAt: '2026-10-14T12:20:00+08:00',
    });
    renderWithProviders(
      <Routes>
        <Route path="/orders/:orderId" element={<OrderPage />} />
      </Routes>,
      {
        api: createFakeApi({
          orders: {
            get: async () => {
              throw Object.assign(new Error('x'), { status: 404, code: 'NOT_FOUND' });
            },
          },
        }),
        route: '/orders/ord_1',
      },
    );
    await waitFor(() => expect(pageTitleStore.getState().title).toBe('找不到訂單'));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('OrdersPage：「歷史訂單」，h1 之後的卡片標題為 h2（不跳級）', async () => {
    useSessionStore
      .getState()
      .setSession({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }, {
        id: 'usr_1',
        phone: '0912345678',
        marketingOptIn: false,
        createdAt: '2026-10-01T00:00:00+08:00',
      });
    renderWithProviders(<OrdersPage />, {
      api: createFakeApi({
        orders: {
          list: async () => ({ items: [makeSummary({ status: 'ACCEPTED' })], nextCursor: null }),
          get: async () => makeOrder({ status: 'ACCEPTED' }),
        },
      }),
    });
    await screen.findByRole('article');
    expect(pageTitleStore.getState().title).toBe('歷史訂單');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });

  it('OrderLookupPage：「查詢訂單」', () => {
    renderWithProviders(<OrderLookupPage />, { api: createFakeApi() });
    expect(pageTitleStore.getState().title).toBe('查詢訂單');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
