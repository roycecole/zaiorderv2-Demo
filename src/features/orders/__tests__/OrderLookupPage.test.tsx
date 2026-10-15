// PG-08 訪客查詢訂單：編號 + 手機（VR-01）、錯誤不洩漏欄位、限流、本機記錄
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/auth/sessionStore';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useGuestOrdersStore } from '../guestOrdersStore';
import { OrderLookupPage } from '../OrderLookupPage';
import { makeOrder } from './fixtures';

const apiError = (status: number, code: string, body: Record<string, unknown> = {}) =>
  Object.assign(new Error(code), { status, code, body: { code, ...body } });

function Probe() {
  const loc = useLocation();
  return <p data-testid="location">{loc.pathname}</p>;
}

function renderLookup(api = createFakeApi()) {
  return renderWithProviders(
    <Routes>
      <Route path="/orders/lookup" element={<OrderLookupPage />} />
      <Route path="*" element={<Probe />} />
    </Routes>,
    { api, route: '/orders/lookup' },
  );
}

async function fill(u: ReturnType<typeof userEvent.setup>, orderNo: string, phone: string) {
  await u.type(screen.getByLabelText(/訂單編號/), orderNo);
  await u.type(screen.getByLabelText(/手機號碼/), phone);
  await u.click(screen.getByRole('button', { name: '查詢' }));
}

beforeEach(() => {
  useSessionStore.getState().clear();
  useGuestOrdersStore.getState().clear();
});

describe('OrderLookupPage', () => {
  it('欄位驗證：訂單編號必填、手機格式（VR-01）；不呼叫 API', async () => {
    const u = userEvent.setup();
    const lookup = vi.fn();
    renderLookup(createFakeApi({ orders: { lookup } }));
    await u.type(screen.getByLabelText(/手機號碼/), '123');
    await u.click(screen.getByRole('button', { name: '查詢' }));
    expect(await screen.findByText('請輸入訂單編號')).toBeInTheDocument();
    expect(screen.getByText('請輸入正確的手機號碼（09 開頭，共 10 碼）')).toBeInTheDocument();
    expect(screen.getByLabelText(/訂單編號/)).toHaveAttribute('aria-invalid', 'true');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('成功：正規化編號與手機後查詢，寫入本機記錄並導向訂單頁', async () => {
    const u = userEvent.setup();
    const lookup = vi.fn(async () => ({ orderId: 'ord_77', trackingToken: 'trk_77' }));
    const get = vi.fn(async () =>
      makeOrder({ id: 'ord_77', orderNo: 'ZO261014K7M3QX', placedAt: '2026-10-14T12:20:00+08:00' }),
    );
    renderLookup(createFakeApi({ orders: { lookup, get } }));
    await fill(u, 'zo261014-k7m3qx', '0912-345-678');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/orders/ord_77'));
    expect(lookup).toHaveBeenCalledWith('ZO261014K7M3QX', '0912345678');
    expect(get).toHaveBeenCalledWith('ord_77', { trackingToken: 'trk_77' });
    expect(useGuestOrdersStore.getState().orders).toEqual([
      {
        orderId: 'ord_77',
        orderNo: 'ZO261014K7M3QX',
        trackingToken: 'trk_77',
        placedAt: '2026-10-14T12:20:00+08:00',
      },
    ]);
  });

  it('查無資料：一律顯示同一句，不揭露是哪個欄位錯誤', async () => {
    const u = userEvent.setup();
    renderLookup(
      createFakeApi({
        orders: {
          lookup: async () => {
            throw apiError(404, 'NOT_FOUND');
          },
        },
      }),
    );
    await fill(u, 'ZO000000AAAAAA', '0912345678');
    expect(await screen.findByText('找不到訂單，請確認編號與手機')).toBeInTheDocument();
    expect(screen.getByLabelText(/訂單編號/)).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText(/手機號碼/)).not.toHaveAttribute('aria-invalid');
    expect(useGuestOrdersStore.getState().orders).toEqual([]);
  });

  it('限流（RATE_LIMITED）：顯示冷卻說明並暫停查詢', async () => {
    const u = userEvent.setup();
    const lookup = vi.fn(async () => {
      throw apiError(429, 'RATE_LIMITED', { retryAfterSeconds: 120 });
    });
    renderLookup(createFakeApi({ orders: { lookup } }));
    await fill(u, 'ZO000000AAAAAA', '0912345678');
    expect(await screen.findByText('查詢太頻繁，請稍後再試')).toBeInTheDocument();
    expect(screen.getByText(/請等 (2 分鐘|1 分 \d+ 秒)後再試/)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: '查詢' });
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    await u.click(submit);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('列出本機記錄的近期訂單，可直接點入', () => {
    useGuestOrdersStore.getState().upsert({
      orderId: 'ord_1',
      orderNo: 'ZOAAAAAA111111',
      trackingToken: 't1',
      placedAt: '2026-10-14T12:20:00+08:00',
    });
    useGuestOrdersStore.getState().upsert({
      orderId: 'ord_2',
      orderNo: 'ZOBBBBBB222222',
      trackingToken: 't2',
      placedAt: '2026-10-14T13:00:00+08:00',
    });
    renderLookup();
    const section = screen.getByRole('region', { name: '本機記錄的近期訂單' });
    const links = within(section).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/orders/ord_2');
    expect(links[0]).toHaveTextContent('ZOBBBBBB222222');
    expect(links[0]).toHaveTextContent('10/14（三） 13:00');
  });

  it('沒有記錄時顯示說明', () => {
    renderLookup();
    expect(screen.getByText('這個裝置上還沒有訂單記錄')).toBeInTheDocument();
  });
});
