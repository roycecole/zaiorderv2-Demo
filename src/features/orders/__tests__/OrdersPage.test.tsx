// PG-07 歷史訂單：會員分頁籤與游標分頁、訪客導向查詢訂單、清單狀態同步、再來一單
import { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderSummary } from '@/domain/types';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useCartStore } from '@/features/cart/cartStore';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useGuestOrdersStore } from '../guestOrdersStore';
import { OrdersPage } from '../OrdersPage';
import { lurouDetail, makeOrder, makeSummary, teaDetail } from './fixtures';

const user = {
  id: 'usr_1',
  phone: '0912345678',
  name: '王小明',
  marketingOptIn: false,
  createdAt: '2026-10-01T00:00:00+08:00',
};

function Probe() {
  const loc = useLocation();
  return <p data-testid="location">{`${loc.pathname}${loc.search}`}</p>;
}

function renderOrders(api: ReturnType<typeof createFakeApi>, route = '/orders') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 60_000 }, mutations: { retry: false } },
  });
  return renderWithProviders(
    <Routes>
      <Route path="/orders" element={<OrdersPage />} />
      <Route path="*" element={<Probe />} />
    </Routes>,
    { api, route, queryClient },
  );
}

const page = (items: OrderSummary[], nextCursor: string | null = null) => ({ items, nextCursor });

beforeEach(() => {
  useSessionStore
    .getState()
    .setSession({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }, user);
  useGuestOrdersStore.getState().clear();
  useCartStore.getState().clear();
});

afterEach(() => {
  vi.useRealTimers();
  useSessionStore.getState().clear();
});

describe('OrdersPage', () => {
  it('訪客導向查詢訂單（PG-08）', async () => {
    useSessionStore.getState().clear();
    const list = vi.fn();
    renderOrders(createFakeApi({ orders: { list } }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/orders/lookup'));
    expect(list).not.toHaveBeenCalled();
  });

  it('會員：預設「進行中」，卡片顯示編號、類型、狀態、摘要與金額，並連到訂單詳情', async () => {
    const list = vi.fn(async () =>
      page([
        makeSummary({
          id: 'ord_9',
          orderNo: 'ZO261014AAAAAA',
          status: 'ACCEPTED',
          paymentStatus: 'UNPAID',
          pickupNo: 'A009',
          orderType: 'DELIVERY',
          itemsPreview: '紅燒牛肉麵 等 3 項',
          total: 297,
        }),
      ]),
    );
    renderOrders(createFakeApi({ orders: { list, get: async () => makeOrder({ id: 'ord_9', status: 'ACCEPTED' }) } }));
    const card = await screen.findByRole('article');
    expect(list).toHaveBeenCalledWith({ tab: 'active', limit: 10 });
    expect(within(card).getByText('ZO261014AAAAAA')).toBeInTheDocument();
    expect(within(card).getByText('製作中')).toBeInTheDocument();
    expect(within(card).getByText('外送')).toBeInTheDocument();
    expect(within(card).getByText('紅燒牛肉麵 等 3 項')).toBeInTheDocument();
    expect(within(card).getByText('NT$ 297')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /查看詳情/ })).toHaveAttribute('href', '/orders/ord_9');
  });

  it('分頁籤切換：ARIA tab 樣式、依分頁載入、網址帶 tab', async () => {
    const u = userEvent.setup();
    const list = vi.fn(async (p: { tab: string }) =>
      page(p.tab === 'completed' ? [makeSummary({ id: 'ord_c', orderNo: 'ZOCOMPLETED' })] : []),
    );
    renderOrders(createFakeApi({ orders: { list } }));
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['進行中', '已完成', '已取消']);
    expect(screen.getByRole('tab', { name: '進行中' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('還沒有訂單')).toBeInTheDocument();

    await u.click(screen.getByRole('tab', { name: '已完成' }));
    expect(await screen.findByText('ZOCOMPLETED')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ tab: 'completed', limit: 10 });
    expect(screen.getByRole('tab', { name: '已完成' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', screen.getByRole('tab', { name: '已完成' }).id);
  });

  it('分頁籤可用方向鍵切換', async () => {
    const u = userEvent.setup();
    const list = vi.fn(async () => page([]));
    renderOrders(createFakeApi({ orders: { list } }));
    const active = await screen.findByRole('tab', { name: '進行中' });
    active.focus();
    await u.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '已完成' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: '已完成' })).toHaveAttribute('aria-selected', 'true');
  });

  it('?tab=cancelled 直接進入該分頁', async () => {
    const list = vi.fn(async () => page([]));
    renderOrders(createFakeApi({ orders: { list } }), '/orders?tab=cancelled');
    await screen.findByText('還沒有訂單');
    expect(list).toHaveBeenCalledWith({ tab: 'cancelled', limit: 10 });
    expect(screen.getByRole('tab', { name: '已取消' })).toHaveAttribute('aria-selected', 'true');
  });

  it('空狀態：「還沒有訂單」與「回菜單」', async () => {
    renderOrders(createFakeApi({ orders: { list: async () => page([]) } }));
    expect(await screen.findByText('還沒有訂單')).toBeInTheDocument();
    expect(screen.getByText('現在就去點餐吧')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回菜單' })).toHaveAttribute('href', '/');
  });

  it('游標分頁：「載入更多」帶上 nextCursor 並附加在清單後', async () => {
    const u = userEvent.setup();
    const list = vi.fn(async (p: { cursor?: string }) =>
      p.cursor === undefined
        ? page([makeSummary({ id: 'ord_1', orderNo: 'ZOFIRST', status: 'COMPLETED' })], 'cur_1')
        : page([makeSummary({ id: 'ord_2', orderNo: 'ZOSECOND', status: 'COMPLETED' })], null),
    );
    renderOrders(createFakeApi({ orders: { list } }), '/orders?tab=completed');
    expect(await screen.findByText('ZOFIRST')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: '載入更多' }));
    expect(await screen.findByText('ZOSECOND')).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith({ tab: 'completed', limit: 10, cursor: 'cur_1' });
    expect(screen.getByText('ZOFIRST')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '載入更多' })).not.toBeInTheDocument();
  });

  it('載入失敗：顯示錯誤與重試', async () => {
    const u = userEvent.setup();
    let fail = true;
    const list = vi.fn(async () => {
      if (fail) throw Object.assign(new Error('x'), { status: 503, code: 'SERVICE_UNAVAILABLE' });
      return page([makeSummary({ orderNo: 'ZORETRY' })]);
    });
    renderOrders(createFakeApi({ orders: { list } }));
    expect(await screen.findByText('暫時無法載入訂單')).toBeInTheDocument();
    fail = false;
    await u.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByText('ZORETRY')).toBeInTheDocument();
  });

  it('進行中分頁：對各筆訂單呼叫 orders.get 結算，狀態有變動就重新載入清單', async () => {
    const get = vi.fn(async () =>
      makeOrder({ id: 'ord_1', status: 'ACCEPTED', payment: { method: 'CASH', status: 'UNPAID', expiresAt: null } }),
    );
    // list 不推進模擬：伺服器端要等到 orders.get 結算之後，清單才會反映新狀態
    const list = vi.fn(async () =>
      page([
        makeSummary({
          id: 'ord_1',
          orderNo: 'ZOSYNC',
          status: get.mock.calls.length > 0 ? 'ACCEPTED' : 'PENDING',
          paymentStatus: 'UNPAID',
        }),
      ]),
    );
    renderOrders(createFakeApi({ orders: { list, get } }));
    expect(await screen.findByText('製作中')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('ord_1');
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('進行中分頁頁面可見期間每 15 秒同步一次', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const list = vi.fn(async () =>
      page([makeSummary({ id: 'ord_1', orderNo: 'ZOSYNC', status: 'PENDING', paymentStatus: 'UNPAID' })]),
    );
    const get = vi.fn(async () =>
      makeOrder({ id: 'ord_1', status: 'PENDING', payment: { method: 'CASH', status: 'UNPAID', expiresAt: null } }),
    );
    renderOrders(createFakeApi({ orders: { list, get } }));
    await screen.findByText('ZOSYNC');
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_100);
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('卡片的「再來一單」：取訂單、取商品、加入購物車並前往購物車', async () => {
    const u = userEvent.setup();
    const list = vi.fn(async () => page([makeSummary({ id: 'ord_1', status: 'COMPLETED' })]));
    const get = vi.fn(async () => makeOrder({ id: 'ord_1', status: 'COMPLETED' }));
    const getProduct = vi.fn(async (id: string) => (id === 'prd_lurou' ? lurouDetail() : teaDetail()));
    renderOrders(
      createFakeApi({ orders: { list, get }, store: { getProduct } }),
      '/orders?tab=completed',
    );
    await u.click(await screen.findByRole('button', { name: /再來一單/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/cart'));
    expect(useCartStore.getState().lines.map((l) => l.productId)).toEqual(['prd_lurou', 'prd_tea']);
  });
});
