// PG-06 訂單追蹤：狀態與時間軸、acceptBy、permissions 控制按鈕、輪詢、權杖 404 → lookup 換發、取消、再來一單
import { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order, StoreInfo } from '@/domain/types';
import type * as A11yNs from '@/features/a11y';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useCartStore } from '@/features/cart/cartStore';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { qk } from '@/services/api/queryKeys';
import { setClock, systemClock } from '@/services/clock';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useGuestOrdersStore } from '../guestOrdersStore';
import { OrderPage } from '../OrderPage';
import { lurouDetail, log, makeOrder, teaDetail } from './fixtures';

const hotkeys = vi.hoisted(() => ({
  scopes: [] as string[],
  actions: new Map<string, { handler: () => void; enabled: boolean }>(),
}));
vi.mock('@/features/a11y', async (orig) => {
  const actual = await orig<typeof A11yNs>();
  return {
    ...actual,
    useHotkeyScope: (scope: string) => {
      hotkeys.scopes.push(scope);
    },
    useHotkeyAction: (
      action: string,
      handler: () => void,
      options?: { enabled?: boolean },
    ) => {
      hotkeys.actions.set(action, { handler, enabled: options?.enabled !== false });
    },
  };
});
vi.mock('@/features/kiosk', () => ({
  KioskDoneCountdown: ({ active }: { active: boolean }) =>
    active ? <div data-testid="kiosk-countdown" /> : null,
}));

const T = (hm: string) => `2026-10-14T${hm}:00+08:00`;

const store = {
  name: '巷仔內小吃部',
  phone: '02-0000-0000',
  address: { city: '臺北市', district: '大安區', zipCode: '106', line: '示範路 100 號' },
} as StoreInfo;

const user = {
  id: 'usr_1',
  phone: '0912345678',
  name: '王小明',
  marketingOptIn: false,
  createdAt: '2026-10-01T00:00:00+08:00',
};

const apiError = (status: number, code: string) =>
  Object.assign(new Error(code), { status, code, body: { code } });

function Probe() {
  const loc = useLocation();
  return <p data-testid="location">{`${loc.pathname}${loc.search}`}</p>;
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 60_000 }, mutations: { retry: false } },
  });
}

function renderOrder(api: ReturnType<typeof createFakeApi>, queryClient = newClient()) {
  return renderWithProviders(
    <Routes>
      <Route path="/orders/lookup" element={<Probe />} />
      <Route path="/orders/:orderId" element={<OrderPage />} />
      <Route path="*" element={<Probe />} />
    </Routes>,
    { api, route: '/orders/ord_1', queryClient },
  );
}

function guestHolds(token = 'trk_old') {
  useGuestOrdersStore.getState().upsert({
    orderId: 'ord_1',
    orderNo: 'ZO261014K7M3QX',
    trackingToken: token,
    placedAt: T('12:20'),
  });
}

/** 等待訂單載入完成（載入中的 h1 沒有取餐號碼） */
const pickupHeading = () => screen.findByRole('heading', { level: 1, name: /取餐號碼/ });

function login() {
  useSessionStore
    .getState()
    .setSession({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }, user);
}

beforeEach(() => {
  useSessionStore.getState().clear();
  useGuestOrdersStore.getState().clear();
  useCartStore.getState().clear();
  usePrefsStore.getState().reset();
  useInputModeStore.setState({ inputMode: 'AUTO' });
  hotkeys.scopes.length = 0;
  hotkeys.actions.clear();
  setClock({ now: () => new Date(T('12:25')) });
});

afterEach(() => {
  vi.useRealTimers();
  setClock(systemClock);
});

const pending = (over: Partial<Order> = {}) => makeOrder({ status: 'PENDING', ...over });

describe('OrderPage：內容與權限', () => {
  it('顯示取餐號碼（朗讀以空白分隔）、狀態、訂單編號、acceptBy 與時間軸', async () => {
    guestHolds();
    renderOrder(
      createFakeApi({
        orders: { get: async () => pending() },
        store: { getInfo: async () => store },
      }),
    );
    const heading = await screen.findByRole('heading', { level: 1, name: '取餐號碼 A 0 2 7' });
    expect(heading).toHaveTextContent('A027');
    expect(screen.getByText('等待店家確認', { selector: 'span span, span' })).toBeInTheDocument();
    expect(screen.getByText('ZO261014K7M3QX')).toBeInTheDocument();
    // acceptBy 取伺服器值，不自行推算
    expect(screen.getByText('店家將於 12:30 前確認')).toBeInTheDocument();
    const timeline = screen.getByRole('list', { name: '訂單進度' });
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(4);
    expect(within(timeline).getByText(/訂單已送出，等待店家確認/)).toBeInTheDocument();
  });

  it('首次載入完成後焦點移到取餐號碼標題', async () => {
    guestHolds();
    renderOrder(createFakeApi({ orders: { get: async () => pending() } }));
    const heading = await pickupHeading();
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('PENDING 且 canCancel：顯示「取消訂單」與「致電店家」；canReorder 顯示「再來一單」', async () => {
    guestHolds();
    renderOrder(
      createFakeApi({
        orders: { get: async () => pending() },
        store: { getInfo: async () => store },
      }),
    );
    expect(await screen.findByRole('button', { name: '取消訂單' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再來一單' })).toBeInTheDocument();
    const call = await screen.findByRole('link', { name: /致電店家/ });
    expect(call).toHaveAttribute('href', 'tel:0200000000');
  });

  it('ACCEPTED（canCancel 為 false）：不顯示取消，改保留致電店家', async () => {
    guestHolds();
    renderOrder(
      createFakeApi({
        orders: {
          get: async () =>
            makeOrder({
              status: 'ACCEPTED',
              timeline: [log('PENDING', T('12:20'), 'CUSTOMER'), log('ACCEPTED', T('12:21'))],
              permissions: { canCancel: false, canPay: false, canReorder: true, canReview: false },
            }),
        },
        store: { getInfo: async () => store },
      }),
    );
    await pickupHeading();
    expect(screen.queryByRole('button', { name: '取消訂單' })).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /致電店家/ })).toBeInTheDocument();
    // 預計時間：「製作中・預計 12:35 可取餐（約 10 分鐘）」
    expect(screen.getByText(/預計 12:35 可取餐（約 10 分鐘）/)).toBeInTheDocument();
  });

  it('canReorder 為 false 時不顯示「再來一單」', async () => {
    guestHolds();
    renderOrder(
      createFakeApi({
        orders: {
          get: async () =>
            pending({
              permissions: { canCancel: true, canPay: false, canReorder: false, canReview: false },
            }),
        },
      }),
    );
    await pickupHeading();
    expect(screen.queryByRole('button', { name: '再來一單' })).not.toBeInTheDocument();
  });

  it('PENDING_PAYMENT 且 canPay：付款提醒、倒數與「前往付款」連到付款頁', async () => {
    guestHolds();
    renderOrder(
      createFakeApi({
        orders: {
          get: async () =>
            makeOrder({
              status: 'PENDING_PAYMENT',
              acceptBy: null,
              payment: { method: 'LINE_PAY', status: 'UNPAID', expiresAt: T('12:35') },
              timeline: [log('PENDING_PAYMENT', T('12:20'), 'CUSTOMER')],
              permissions: { canCancel: true, canPay: true, canReorder: true, canReview: false },
            }),
        },
      }),
    );
    expect(
      await screen.findByText('已保留餐點與取餐時段，請於 12:35 前完成付款'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('剩餘 10:00').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: '前往付款' })).toHaveAttribute('href', '/payment/ord_1');
    // 等待付款列
    expect(screen.getByTestId('timeline-awaiting-payment')).toBeInTheDocument();
  });

  it('PENDING_PAYMENT 但 canPay 為 false（已逾期）：不顯示「前往付款」', async () => {
    guestHolds();
    renderOrder(
      createFakeApi({
        orders: {
          get: async () =>
            makeOrder({
              status: 'PENDING_PAYMENT',
              acceptBy: null,
              payment: { method: 'LINE_PAY', status: 'UNPAID', expiresAt: T('12:20') },
              permissions: { canCancel: true, canPay: false, canReorder: true, canReview: false },
            }),
        },
      }),
    );
    await pickupHeading();
    expect(screen.queryByRole('link', { name: '前往付款' })).not.toBeInTheDocument();
  });

  it('CANCELLED：顯示取消者與原因；付款逾時顯示「再來一單」說明', async () => {
    guestHolds();
    renderOrder(
      createFakeApi({
        orders: {
          get: async () =>
            makeOrder({
              status: 'CANCELLED',
              acceptBy: null,
              estimatedReadyAt: null,
              timeline: [
                log('PENDING_PAYMENT', T('12:20'), 'CUSTOMER'),
                log('CANCELLED', T('12:35'), 'SYSTEM', '付款逾時'),
              ],
              cancellation: { by: 'SYSTEM', reason: '付款逾時', at: T('12:35') },
              permissions: { canCancel: false, canPay: false, canReorder: true, canReview: false },
            }),
        },
      }),
    );
    expect(
      await screen.findByText(
        '超過付款時間，訂單已自動取消，保留的餐點與時段已釋出。想再訂可按「再來一單」',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再來一單' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消訂單' })).not.toBeInTheDocument();
  });

  it('預約單固定顯示預約時間', async () => {
    guestHolds();
    renderOrder(
      createFakeApi({
        orders: { get: async () => pending({ scheduledAt: T('18:30') }) },
      }),
    );
    expect((await screen.findAllByText('預約 18:30 取餐')).length).toBeGreaterThan(0);
  });

  it('內用有桌號：「內用資訊」顯示「內用・店名・桌號 A3」', async () => {
    guestHolds();
    renderOrder(
      createFakeApi({
        orders: {
          get: async () =>
            pending({ orderType: 'DINE_IN', pickupNo: 'T001', table: { tableNo: 'A3' } }),
        },
        store: { getInfo: async () => store },
      }),
    );
    await pickupHeading();
    const info = await screen.findByRole('region', { name: '內用資訊' });
    expect(info).toHaveTextContent('內用・巷仔內小吃部・桌號 A3');
    expect(info).not.toHaveTextContent('取餐號碼');
  });

  it('內用沒有桌號：不顯示桌號列（沒有 undefined 或空白），以「內用・店名・取餐號碼 T001」呈現', async () => {
    guestHolds();
    renderOrder(
      createFakeApi({
        orders: { get: async () => pending({ orderType: 'DINE_IN', pickupNo: 'T001' }) },
        store: { getInfo: async () => store },
      }),
    );
    await pickupHeading();
    const info = await screen.findByRole('region', { name: '內用資訊' });
    expect(info).toHaveTextContent('內用・巷仔內小吃部・取餐號碼 T001');
    expect(info).not.toHaveTextContent('桌號');
    expect(info).not.toHaveTextContent('undefined');
    // 取餐號碼仍是頁面的主角（朗讀版本）
    expect(
      screen.getByRole('heading', { level: 1, name: '取餐號碼 T 0 0 1' }),
    ).toBeInTheDocument();
  });

  it('可展開訂單明細：品項、選項、備註與金額', async () => {
    const u = userEvent.setup();
    guestHolds();
    renderOrder(createFakeApi({ orders: { get: async () => pending() } }));
    await u.click(await screen.findByRole('button', { name: /訂單明細/ }));
    expect(screen.getByText('招牌滷肉飯')).toBeInTheDocument();
    expect(screen.getByText('大碗・滷蛋')).toBeInTheDocument();
    expect(screen.getByText('備註：不要蔥')).toBeInTheDocument();
    expect(screen.getByText('古早味紅茶')).toBeInTheDocument();
    expect(screen.getAllByText('NT$ 135').length).toBeGreaterThan(0);
  });

  it('訪客顯示「保存訂單」提示，可關閉並記住；會員不顯示', async () => {
    const u = userEvent.setup();
    guestHolds();
    const { unmount } = renderOrder(createFakeApi({ orders: { get: async () => pending() } }));
    expect(await screen.findByText('想保存這筆訂單？')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: '關閉保存提示' }));
    expect(screen.queryByText('想保存這筆訂單？')).not.toBeInTheDocument();
    expect(usePrefsStore.getState().orderSavePromptDismissed).toBe(true);
    unmount();

    usePrefsStore.getState().reset();
    login();
    renderOrder(createFakeApi({ orders: { get: async () => pending() } }));
    await pickupHeading();
    expect(screen.queryByText('想保存這筆訂單？')).not.toBeInTheDocument();
  });

  it('快速鍵：宣告 order 範圍；u 立即更新、a 再來一單（canReorder 才啟用）', async () => {
    guestHolds();
    const get = vi.fn(async () => pending());
    renderOrder(createFakeApi({ orders: { get }, store: { getInfo: async () => store } }));
    await pickupHeading();
    expect(hotkeys.scopes).toContain('order');
    expect(hotkeys.actions.get('again')?.enabled).toBe(true);
    const before = get.mock.calls.length;
    await act(async () => {
      hotkeys.actions.get('refresh')?.handler();
    });
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before));
  });
});

describe('OrderPage：輪詢（FLOW-16）', () => {
  it('非終態每 5 秒更新；狀態變更時 Toast，進入終態後停止輪詢', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    guestHolds();
    let current: Order = pending();
    const get = vi.fn(async () => current);
    renderOrder(createFakeApi({ orders: { get } }));
    await pickupHeading();
    expect(get).toHaveBeenCalledTimes(1);

    current = makeOrder({
      status: 'ACCEPTED',
      timeline: [log('PENDING', T('12:20'), 'CUSTOMER'), log('ACCEPTED', T('12:21'))],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('訂單狀態更新：製作中')).toBeInTheDocument();

    current = makeOrder({
      status: 'COMPLETED',
      timeline: [
        log('PENDING', T('12:20'), 'CUSTOMER'),
        log('ACCEPTED', T('12:21')),
        log('READY', T('12:33')),
        log('COMPLETED', T('12:40')),
      ],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(get).toHaveBeenCalledTimes(3);
    // 終態且無退款進行中：不再輪詢
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('終態但退款進行中（REFUNDING）仍持續輪詢，REFUNDED 後停止', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    guestHolds();
    const cancelledPaid = (status: 'REFUNDING' | 'REFUNDED') =>
      makeOrder({
        status: 'CANCELLED',
        acceptBy: null,
        timeline: [log('PENDING', T('12:20'), 'CUSTOMER'), log('CANCELLED', T('12:22'), 'CUSTOMER')],
        cancellation: { by: 'CUSTOMER', at: T('12:22') },
        payment: { method: 'LINE_PAY', status, expiresAt: null },
        permissions: { canCancel: false, canPay: false, canReorder: true, canReview: false },
      });
    let current = cancelledPaid('REFUNDING');
    const get = vi.fn(async () => current);
    renderOrder(createFakeApi({ orders: { get } }));
    expect(await screen.findByText('款項正在退回原付款方式，完成後會更新狀態')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(get).toHaveBeenCalledTimes(2);

    current = cancelledPaid('REFUNDED');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(get).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('頁面隱藏時暫停輪詢', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    guestHolds();
    const get = vi.fn(async () => pending());
    renderOrder(createFakeApi({ orders: { get } }));
    await pickupHeading();

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(get).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it('「立即更新」按鈕在輪詢之外手動刷新', async () => {
    const u = userEvent.setup();
    guestHolds();
    const get = vi.fn(async () => pending());
    renderOrder(createFakeApi({ orders: { get } }));
    await pickupHeading();
    await u.click(screen.getByRole('button', { name: '立即更新' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});

describe('OrderPage：存取與 404 取回（BR-27、EC-36）', () => {
  it('以記下的訂單編號與手機（prefs.guestProfile）換新權杖並重試一次，期間不顯示錯誤', async () => {
    guestHolds('trk_old');
    usePrefsStore.getState().patch({ guestProfile: { name: '王小明', phone: '0912345678' } });
    const get = vi.fn(async (_id: string, opts?: { trackingToken?: string }) => {
      if (opts?.trackingToken === 'trk_old') throw apiError(404, 'NOT_FOUND');
      return pending();
    });
    const lookup = vi.fn(async () => ({ orderId: 'ord_1', trackingToken: 'trk_new' }));
    renderOrder(createFakeApi({ orders: { get, lookup } }));
    expect(await screen.findByRole('heading', { level: 1, name: /取餐號碼/ })).toBeInTheDocument();
    expect(screen.queryByText('找不到訂單')).not.toBeInTheDocument();
    expect(lookup).toHaveBeenCalledWith('ZO261014K7M3QX', '0912345678');
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenLastCalledWith('ord_1', { trackingToken: 'trk_new' });
    expect(useGuestOrdersStore.getState().tokenFor('ord_1')).toBe('trk_new');
  });

  it('手機取自同一次載入內的 order.customer.phone（Query 快取）', async () => {
    guestHolds('trk_old');
    const queryClient = newClient();
    queryClient.setQueryData(
      qk.orders.detail('ord_1'),
      pending({ customer: { name: '王小明', phone: '0933333333' } }),
    );
    const get = vi.fn(async (_id: string, opts?: { trackingToken?: string }) => {
      if (opts?.trackingToken === 'trk_old') throw apiError(404, 'NOT_FOUND');
      return pending();
    });
    const lookup = vi.fn(async () => ({ orderId: 'ord_1', trackingToken: 'trk_new' }));
    renderOrder(createFakeApi({ orders: { get, lookup } }), queryClient);
    await waitFor(() => expect(lookup).toHaveBeenCalled());
    expect(lookup).toHaveBeenCalledWith('ZO261014K7M3QX', '0933333333');
  });

  it('換發後仍失敗：顯示「找不到訂單」並提供「查詢訂單」入口、停止輪詢', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    guestHolds('trk_old');
    usePrefsStore.getState().patch({ guestProfile: { phone: '0912345678' } });
    const get = vi.fn(async () => {
      throw apiError(404, 'NOT_FOUND');
    });
    const lookup = vi.fn(async () => ({ orderId: 'ord_1', trackingToken: 'trk_new' }));
    renderOrder(createFakeApi({ orders: { get, lookup } }));
    expect(await screen.findByRole('heading', { name: '找不到訂單' })).toBeInTheDocument();
    expect(screen.getByText('找不到訂單，請確認編號與手機')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查詢訂單' })).toHaveAttribute('href', '/orders/lookup');
    // 只重試一次：1 次原請求 + 1 次換發後重試
    expect(get).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('沒有手機可換發：直接顯示找不到訂單（不呼叫 lookup）', async () => {
    guestHolds('trk_old');
    const get = vi.fn(async () => {
      throw apiError(404, 'NOT_FOUND');
    });
    const lookup = vi.fn();
    renderOrder(createFakeApi({ orders: { get, lookup } }));
    expect(await screen.findByRole('heading', { name: '找不到訂單' })).toBeInTheDocument();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('訪客沒有此訂單的權杖：導向查詢訂單，不呼叫 API', async () => {
    const get = vi.fn();
    renderOrder(createFakeApi({ orders: { get } }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/orders/lookup'));
    expect(get).not.toHaveBeenCalled();
  });

  it('會員不需要權杖即可載入', async () => {
    login();
    const get = vi.fn(async () => pending());
    renderOrder(createFakeApi({ orders: { get } }));
    await screen.findByRole('heading', { level: 1, name: /取餐號碼/ });
    expect(get).toHaveBeenCalledWith('ord_1', undefined);
  });
});

describe('OrderPage：取消訂單', () => {
  it('二次確認（預設焦點在「保留訂單」）、帶原因取消，成功後更新畫面', async () => {
    const u = userEvent.setup();
    guestHolds();
    const cancelled = makeOrder({
      status: 'CANCELLED',
      acceptBy: null,
      timeline: [
        log('PENDING', T('12:20'), 'CUSTOMER'),
        log('CANCELLED', T('12:26'), 'CUSTOMER', '不小心點錯了'),
      ],
      cancellation: { by: 'CUSTOMER', reason: '不小心點錯了', at: T('12:26') },
      permissions: { canCancel: false, canPay: false, canReorder: true, canReview: false },
    });
    const cancel = vi.fn(async () => cancelled);
    renderOrder(createFakeApi({ orders: { get: async () => pending(), cancel } }));
    await u.click(await screen.findByRole('button', { name: '取消訂單' }));

    const dialog = await screen.findByRole('alertdialog', { name: '確定要取消這筆訂單嗎？' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '保留訂單' })).toHaveFocus());
    await u.selectOptions(within(dialog).getByLabelText(/取消原因/), '不小心點錯了');
    await u.click(within(dialog).getByRole('button', { name: '確認取消' }));

    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith('ord_1', '不小心點錯了', { trackingToken: 'trk_old' }),
    );
    expect(await screen.findByText('訂單已取消', { selector: 'span' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: '取消訂單' })).not.toBeInTheDocument());
    expect(screen.getByTestId('timeline-cancelled')).toHaveTextContent('原因：不小心點錯了');
  });

  it('「保留訂單」不呼叫 API', async () => {
    const u = userEvent.setup();
    guestHolds();
    const cancel = vi.fn();
    renderOrder(createFakeApi({ orders: { get: async () => pending(), cancel } }));
    await u.click(await screen.findByRole('button', { name: '取消訂單' }));
    await u.click(await screen.findByRole('button', { name: '保留訂單' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(cancel).not.toHaveBeenCalled();
  });

  it('已付款訂單的確認說明款項會退回', async () => {
    const u = userEvent.setup();
    guestHolds();
    renderOrder(
      createFakeApi({
        orders: {
          get: async () =>
            pending({ payment: { method: 'LINE_PAY', status: 'PAID', expiresAt: null } }),
        },
      }),
    );
    await u.click(await screen.findByRole('button', { name: '取消訂單' }));
    expect(await screen.findByText(/已付款的金額會退回原付款方式/)).toBeInTheDocument();
  });

  it('店家已接單（409 ORDER_STATE_CONFLICT）：提示致電店家並重新載入狀態', async () => {
    const u = userEvent.setup();
    guestHolds();
    const get = vi.fn(async () => pending());
    const cancel = vi.fn(async () => {
      throw apiError(409, 'ORDER_STATE_CONFLICT');
    });
    renderOrder(createFakeApi({ orders: { get, cancel } }));
    await u.click(await screen.findByRole('button', { name: '取消訂單' }));
    await u.click(await screen.findByRole('button', { name: '確認取消' }));
    expect(await screen.findByText('店家已接單，無法自行取消，請致電店家')).toBeInTheDocument();
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1));
  });
});

describe('OrderPage：再來一單', () => {
  const getProduct = (map: Record<string, ReturnType<typeof lurouDetail> | null>) =>
    vi.fn(async (id: string) => {
      const detail = map[id];
      if (detail === null || detail === undefined) throw apiError(404, 'NOT_FOUND');
      return detail;
    });

  it('全部可用：加入購物車並前往購物車', async () => {
    const u = userEvent.setup();
    guestHolds();
    renderOrder(
      createFakeApi({
        orders: { get: async () => pending() },
        store: { getProduct: getProduct({ prd_lurou: lurouDetail(), prd_tea: teaDetail() }) },
      }),
    );
    await u.click(await screen.findByRole('button', { name: '再來一單' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/cart'));
    const lines = useCartStore.getState().lines;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ productId: 'prd_lurou', quantity: 2, note: '不要蔥' });
    expect([...(lines[0]?.optionIds ?? [])].sort()).toEqual(['o_egg', 'o_large']);
    expect(lines[1]).toMatchObject({ productId: 'prd_tea', quantity: 1 });
  });

  it('部分失效：加入可用品項，並以對話框說明已調整與略過的品項', async () => {
    const u = userEvent.setup();
    guestHolds();
    renderOrder(
      createFakeApi({
        orders: { get: async () => pending() },
        store: {
          getProduct: getProduct({
            prd_lurou: lurouDetail({ remainingToday: 1 }),
            prd_tea: null, // 已下架
          }),
        },
      }),
    );
    await u.click(await screen.findByRole('button', { name: '再來一單' }));
    const dialog = await screen.findByRole('dialog', { name: '再來一單' });
    expect(within(dialog).getByText('已將「招牌滷肉飯」調整為 1 份（今日限量）')).toBeInTheDocument();
    expect(within(dialog).getByText('古早味紅茶 已下架')).toBeInTheDocument();
    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(useCartStore.getState().lines[0]?.quantity).toBe(1);

    await u.click(within(dialog).getByRole('button', { name: '前往購物車' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/cart'));
  });

  it('全部無法加入：提示並不改動購物車', async () => {
    const u = userEvent.setup();
    guestHolds();
    renderOrder(
      createFakeApi({
        orders: { get: async () => pending() },
        store: {
          getProduct: getProduct({
            prd_lurou: lurouDetail({ isSoldOut: true }),
            prd_tea: teaDetail({ isSoldOut: true }),
          }),
        },
      }),
    );
    await u.click(await screen.findByRole('button', { name: '再來一單' }));
    const dialog = await screen.findByRole('dialog', { name: '再來一單' });
    expect(within(dialog).getByText('這筆訂單的餐點目前都無法加入購物車')).toBeInTheDocument();
    expect(within(dialog).getByText('招牌滷肉飯 今日售完')).toBeInTheDocument();
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it('快速鍵 a 觸發再來一單', async () => {
    guestHolds();
    renderOrder(
      createFakeApi({
        orders: { get: async () => pending() },
        store: { getProduct: getProduct({ prd_lurou: lurouDetail(), prd_tea: teaDetail() }) },
      }),
    );
    await pickupHeading();
    await act(async () => {
      hotkeys.actions.get('again')?.handler();
    });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/cart'));
  });
});

describe('OrderPage：觸控面板完成畫面', () => {
  it('超大取餐號碼、櫃檯付款說明與倒數元件；不顯示保存提示與登入入口', async () => {
    useInputModeStore.setState({ inputMode: 'KIOSK' });
    guestHolds();
    renderOrder(createFakeApi({ orders: { get: async () => pending() } }));
    const heading = await screen.findByRole('heading', { level: 1, name: '取餐號碼 A 0 2 7' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText('請至櫃檯付款並等候叫號')).toBeInTheDocument();
    expect(screen.getByTestId('kiosk-countdown')).toBeInTheDocument();
    expect(screen.queryByText('想保存這筆訂單？')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /建立會員|登入/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '訂單進度' })).not.toBeInTheDocument();
  });

  it('閒置重置清掉本機訂單記錄後導回首頁，不落在被隱藏的「查詢訂單」', async () => {
    useInputModeStore.setState({ inputMode: 'KIOSK' });
    guestHolds();
    renderOrder(createFakeApi({ orders: { get: async () => pending() } }));
    await screen.findByRole('heading', { level: 1, name: '取餐號碼 A 0 2 7' });
    act(() => {
      useGuestOrdersStore.getState().clear();
    });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
  });

  it('一般模式不渲染倒數元件', async () => {
    guestHolds();
    renderOrder(createFakeApi({ orders: { get: async () => pending() } }));
    await pickupHeading();
    expect(screen.queryByTestId('kiosk-countdown')).not.toBeInTheDocument();
  });
});
