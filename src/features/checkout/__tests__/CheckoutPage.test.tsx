// 結帳頁（PG-04）：表單驗證、送出管線（預檢、被退回、價格差異、結果未知、冪等重送）、成功後的本機狀態與觸控面板重置
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import type { CreateOrderRequest, QuoteResponse } from '@/domain/types';
import { pageTitleStore } from '@/app/layouts/pageTitle';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useCartStore } from '@/features/cart/cartStore';
import { dispatchKioskReset } from '@/features/kiosk/resetEvent';
import { useGuestOrdersStore } from '@/features/orders/guestOrdersStore';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { setClock, systemClock } from '@/services/clock';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { clearDraft, loadDraft } from '../checkoutDraft';
import { CheckoutPage } from '../CheckoutPage';
import {
  COMBO,
  FakeApiError,
  INFO,
  LUROU,
  NOW_MS,
  SLOTS,
  TEA,
  createdResponse,
  okQuote,
  orderOf,
  soldOutQuote,
} from './fixtures';

function Probe() {
  const loc = useLocation();
  return <div data-testid="probe">{loc.pathname}</div>;
}

type CreateFn = (req: CreateOrderRequest, key: string) => Promise<unknown>;

interface Setup {
  create: ReturnType<typeof vi.fn>;
  quote: ReturnType<typeof vi.fn>;
}

function mount(
  opts: {
    quote?: (lines: ReturnType<typeof cartLines>) => QuoteResponse;
    create?: CreateFn;
    slots?: () => typeof SLOTS;
    info?: typeof INFO;
    status?: typeof INFO.status;
    store?: Record<string, unknown>;
    route?: string;
  } = {},
): Setup {
  const quote = vi.fn(async () => (opts.quote ?? okQuote)(cartLines()));
  const create = vi.fn<CreateFn>(opts.create ?? (async () => createdResponse()));
  const api = createFakeApi({
    store: {
      getInfo: async () => opts.info ?? INFO,
      getStatus: async () => opts.status ?? (opts.info ?? INFO).status,
      getPickupSlots: async () => (opts.slots ?? (() => SLOTS))(),
      getDeliveryZones: async () => ({ items: [] }),
      checkDelivery: async () => ({ deliverable: false, reason: 'OUT_OF_DELIVERY_AREA' as const }),
      ...opts.store,
    },
    orders: { quote, create },
    me: {
      addresses: { list: async () => ({ items: [] }) },
      coupons: { list: async () => ({ items: [] }) },
    },
  } as never);
  renderWithProviders(
    <Routes>
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="*" element={<Probe />} />
    </Routes>,
    { api, route: opts.route ?? '/checkout' },
  );
  return { create, quote };
}

const cartLines = () => useCartStore.getState().lines;

const submitButton = () =>
  screen.getByRole('button', { name: /送出訂單|確認新價格|還有|重新計價/ });
const nameBox = () => screen.getByRole('textbox', { name: /^姓名/ });
const phoneBox = () => screen.getByRole('textbox', { name: /^手機/ });

async function waitReady() {
  await screen.findByText('餐點與時段可供應');
}

async function fillContact(user: ReturnType<typeof userEvent.setup>) {
  await user.type(nameBox(), '王小明');
  await user.type(phoneBox(), '0912345678');
}

beforeEach(() => {
  setClock({ now: () => new Date(NOW_MS) });
  clearDraft();
  useCartStore.setState({ lines: [LUROU, TEA], orderType: 'PICKUP', updatedAt: NOW_MS });
  usePrefsStore.getState().reset();
  useGuestOrdersStore.setState({ orders: [] });
  useSessionStore.setState({ user: null, tokens: null });
  useInputModeStore.setState({ inputMode: 'AUTO' });
});
afterEach(() => {
  setClock(systemClock);
  vi.useRealTimers();
});

describe('頁面標題（外殼 TaskHeader 顯示頁名）', () => {
  it('以 usePageTitle 宣告頁名；頁面只有一個視覺隱藏的 h1，不再自帶返回列', async () => {
    mount();
    await waitReady();
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent('結帳');
    expect(h1[0]).toHaveClass('sr-only');
    expect(pageTitleStore.getState().title).toBe('結帳');
    expect(screen.queryByRole('button', { name: '返回購物車' })).toBeNull();
  });
});

describe('表單驗證（03 §8.3）', () => {
  it('必填：送出時對全表單驗證，不送出、聚焦第一個錯誤欄位並於頁首彙整錯誤數', async () => {
    const user = userEvent.setup();
    const { create } = mount();
    await waitReady();
    await user.click(submitButton());

    expect(await screen.findByText('請輸入姓名（最多 20 字）')).toBeInTheDocument();
    expect(screen.getByText('請輸入正確的手機號碼（09 開頭，共 10 碼）')).toBeInTheDocument();
    expect(screen.getByText('有 2 個欄位需要修正')).toBeInTheDocument();
    await waitFor(() => expect(nameBox()).toHaveFocus());
    expect(nameBox()).toHaveAttribute('aria-invalid', 'true');
    expect(create).not.toHaveBeenCalled();
  });

  it('欄位離開焦點（blur）時驗證格式：手機', async () => {
    const user = userEvent.setup();
    mount();
    await waitReady();
    await user.type(phoneBox(), '0812345678');
    await user.tab();
    expect(
      await screen.findByText('請輸入正確的手機號碼（09 開頭，共 10 碼）'),
    ).toBeInTheDocument();
  });

  it('手機輸入即時插入連字號', async () => {
    const user = userEvent.setup();
    mount();
    await waitReady();
    await user.type(phoneBox(), '0912345678');
    expect(phoneBox()).toHaveValue('0912-345-678');
  });

  it('發票統編檢查碼（UAT-12）', async () => {
    const user = userEvent.setup();
    mount();
    await waitReady();
    await user.click(screen.getByRole('radio', { name: '統編' }));
    const tax = screen.getByRole('textbox', { name: /^統一編號/ });
    await user.type(tax, '04595258');
    await user.tab();
    expect(await screen.findByText('統一編號格式不正確')).toBeInTheDocument();
    await user.clear(tax);
    await user.type(tax, '04595257');
    await user.tab();
    await waitFor(() => expect(screen.queryByText('統一編號格式不正確')).toBeNull());
  });
});

describe('送出管線', () => {
  it('成功（現金）：POST 帶 expectedTotal 與 Idempotency-Key；寫入 guestOrders、清購物車與草稿、導向訂單頁', async () => {
    const user = userEvent.setup();
    const { create } = mount();
    await waitReady();
    await fillContact(user);
    await user.click(submitButton());

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/orders/o1'));
    expect(create).toHaveBeenCalledTimes(1);
    const [req, key] = create.mock.calls[0] as [CreateOrderRequest, string];
    expect(key).toMatch(/[0-9a-f-]{8,}/);
    expect(req).toMatchObject({
      orderType: 'PICKUP',
      scheduledAt: null,
      contact: { name: '王小明', phone: '0912345678' },
      paymentMethod: 'CASH',
      invoice: { type: 'PAPER' },
      expectedTotal: 92,
    });
    expect(useGuestOrdersStore.getState().orders).toEqual([
      expect.objectContaining({ orderId: 'o1', trackingToken: 'trk_abc' }),
    ]);
    expect(cartLines()).toHaveLength(0);
    expect(loadDraft().idempotencyKey).toBeNull();
    expect(usePrefsStore.getState().lastPaymentMethod).toBe('CASH');
    // 點餐記憶：訂單成立時寫入（BR-35）
    expect(Object.keys(usePrefsStore.getState().lastChoices)).toEqual(
      expect.arrayContaining(['prd_lurou', 'prd_tea']),
    );
  });

  it('線上付款：nextAction = PAY 導向付款頁', async () => {
    const user = userEvent.setup();
    mount({
      create: async () =>
        createdResponse({
          nextAction: 'PAY',
          order: orderOf({
            id: 'o2',
            status: 'PENDING_PAYMENT',
            payment: {
              method: 'LINE_PAY',
              status: 'UNPAID',
              expiresAt: '2026-10-14T12:15:00+08:00',
            },
          }),
        }),
    });
    await waitReady();
    await fillContact(user);
    await user.click(screen.getByRole('radio', { name: /LINE Pay/ }));
    await user.click(submitButton());
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/payment/o2'));
  });

  it('預約時段：額滿時段不可選；選取後送出 scheduledAt', async () => {
    const user = userEvent.setup();
    const { create } = mount();
    await waitReady();
    await fillContact(user);
    await user.click(screen.getByRole('radio', { name: '預約' }));
    const full = screen.getByRole('radio', { name: /12:45 額滿/ });
    expect(full).toHaveAttribute('aria-disabled', 'true');
    await user.click(full);
    expect(full).not.toBeChecked();
    await user.click(screen.getByRole('radio', { name: '13:00' }));
    await user.click(submitButton());
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect((create.mock.calls[0] as [CreateOrderRequest])[0].scheduledAt).toBe(
      '2026-10-14T13:00:00+08:00',
    );
  });

  it('預檢發現異動：不送出、留在結帳頁、展開清單並聚焦標題（FR-CK-16）', async () => {
    const user = userEvent.setup();
    let sold = false;
    const { create, quote } = mount({
      quote: (lines) => (sold ? soldOutQuote(lines, 1) : okQuote(lines)),
    });
    await waitReady();
    await fillContact(user);
    sold = true; // 進入結帳後才被訂走：此時狀態列尚未更新
    await user.click(submitButton());

    const list = await screen.findByTestId('availability-issue-list');
    expect(within(list).getByRole('heading', { level: 2 })).toHaveTextContent(
      '有 1 項餐點需要調整',
    );
    await waitFor(() => expect(within(list).getByRole('heading', { level: 2 })).toHaveFocus());
    expect(within(list).getByText('剛剛被訂走了')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    expect(quote.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('背景偵測的異動只更新狀態列，不展開清單；點「查看」才展開，鎖定的送出鈕點擊也展開', async () => {
    const user = userEvent.setup();
    useCartStore.setState({ lines: [LUROU, TEA] });
    mount({ quote: (lines) => soldOutQuote(lines, 1) });
    await screen.findByText('有 1 項需要調整');
    expect(screen.queryByTestId('availability-issue-list')).toBeNull();
    const btn = submitButton();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('還有 1 項需要處理')).toBeInTheDocument();

    await user.click(btn);
    expect(await screen.findByTestId('availability-issue-list')).toBeInTheDocument();
  });

  it('單項移除 → 就地處理後可再送出，並提供「復原」', async () => {
    const user = userEvent.setup();
    mount({
      quote: (lines) =>
        lines.some((l) => l.lineId === 'l2')
          ? soldOutQuote(
              lines,
              lines.findIndex((l) => l.lineId === 'l2'),
            )
          : okQuote(lines),
    });
    await screen.findByText('有 1 項需要調整');
    await user.click(screen.getByRole('button', { name: '查看需要調整的項目' }));
    const list = await screen.findByTestId('availability-issue-list');
    await user.click(within(list).getByRole('button', { name: '移除古早味紅茶' }));
    expect(cartLines().map((l) => l.lineId)).toEqual(['l1']);
    expect(await screen.findByRole('button', { name: '復原' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '復原' }));
    expect(cartLines().map((l) => l.lineId)).toEqual(['l1', 'l2']);
  });

  /** 古早味紅茶（l2）售完；雙人分享餐（l3）超過 2 份時為數量不足（只剩 2 份） */
  function stockIssuesQuote(lines: ReturnType<typeof cartLines>): QuoteResponse {
    const base = okQuote(lines);
    const checks: QuoteResponse['checks'] = [];
    const items = base.items.map((i) => {
      const l = lines[i.index];
      if (l?.lineId === 'l2') {
        checks.push({
          code: 'ITEM_SOLD_OUT',
          severity: 'ERROR',
          message: '已售完',
          field: 'items',
          lineIndex: i.index,
        });
        return {
          ...i,
          available: false,
          availableQuantity: 0,
          lineTotal: 0,
          issue: 'ITEM_SOLD_OUT' as const,
        };
      }
      if (l?.lineId === 'l3' && l.quantity > 2) {
        checks.push({
          code: 'ITEM_STOCK_INSUFFICIENT',
          severity: 'ERROR',
          message: '數量不足',
          field: 'items',
          lineIndex: i.index,
        });
        return {
          ...i,
          available: false,
          availableQuantity: 2,
          remaining: 2,
          lineTotal: i.unitPrice * 2,
          issue: 'ITEM_STOCK_INSUFFICIENT' as const,
        };
      }
      return i;
    });
    const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
    return { ...base, valid: checks.length === 0, items, subtotal, total: subtotal, checks };
  }

  it('全部套用建議 → 復原：數量回到原值，清單重新展開並把焦點移到標題（03 §10.2）', async () => {
    const user = userEvent.setup();
    useCartStore.setState({ lines: [COMBO], orderType: 'PICKUP', updatedAt: NOW_MS });
    mount({ quote: stockIssuesQuote });
    await screen.findByText('有 1 項需要調整');
    await user.click(screen.getByRole('button', { name: '查看需要調整的項目' }));
    const list = await screen.findByTestId('availability-issue-list');
    await user.click(within(list).getByRole('button', { name: '全部套用建議' }));
    await waitFor(() => expect(cartLines()[0]?.quantity).toBe(2));
    const summary = await screen.findByTestId('adjusted-summary');

    await user.click(within(summary).getByRole('button', { name: '復原' }));
    expect(cartLines()[0]?.quantity).toBe(3);
    const reopened = await screen.findByTestId('availability-issue-list');
    await waitFor(() => expect(within(reopened).getByRole('heading', { level: 2 })).toHaveFocus());
    expect(within(reopened).getByRole('button', { name: '全部套用建議' })).toBeInTheDocument();
  });

  it('單項處理後焦點移到下一個異動項的主要動作；最後一項處理完回到送出鈕（UAT-26）', async () => {
    const user = userEvent.setup();
    useCartStore.setState({ lines: [TEA, COMBO], orderType: 'PICKUP', updatedAt: NOW_MS });
    mount({ quote: stockIssuesQuote });
    await screen.findByText('有 2 項需要調整');
    await user.click(screen.getByRole('button', { name: '查看需要調整的項目' }));
    const list = await screen.findByTestId('availability-issue-list');

    // 先處理雙人分享餐（改為 2 份）：該項消失，焦點移到下一項「移除古早味紅茶」
    const fit = within(list).getByRole('button', { name: '將雙人分享餐改為 2 份' });
    fit.focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(
        within(screen.getByTestId('availability-issue-list')).getByRole('button', {
          name: '移除古早味紅茶',
        }),
      ).toHaveFocus(),
    );

    // 最後一項處理完：焦點回到送出鈕
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByTestId('availability-issue-list')).toBeNull());
    await waitFor(() => expect(submitButton()).toHaveFocus());
  });

  it('422 被退回：以 error.quote 更新清單；留在結帳頁、保留 Key 與購物車', async () => {
    const user = userEvent.setup();
    const { create } = mount({
      create: async () => {
        throw new FakeApiError(422, 'ITEM_SOLD_OUT', '已售完', {
          quote: soldOutQuote(cartLines(), 1),
        });
      },
    });
    await waitReady();
    await fillContact(user);
    await user.click(submitButton());

    const list = await screen.findByTestId('availability-issue-list');
    expect(within(list).getByText('古早味紅茶')).toBeInTheDocument();
    expect(within(list).getByText('剛剛被訂走了')).toBeInTheDocument();
    expect(screen.queryByTestId('probe')).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    expect(loadDraft().idempotencyKey).toBe((create.mock.calls[0] as [unknown, string])[1]);
    expect(cartLines()).toHaveLength(2);
    expect(nameBox()).toHaveValue('王小明'); // 表單內容保留
  });

  it('422 時段額滿且僅此一項：清除原選取、不自動選取、焦點到時段選擇區（EC-07）', async () => {
    const user = userEvent.setup();
    let filled = false;
    const withFull = (): typeof SLOTS => ({
      ...SLOTS,
      days: SLOTS.days.map((d) => ({
        ...d,
        slots: d.slots.map((s) =>
          filled && s.startAt === '2026-10-14T12:30:00+08:00'
            ? { ...s, status: 'FULL' as const }
            : s,
        ),
      })),
    });
    mount({
      slots: withFull,
      create: async () => {
        filled = true; // 送出當下才被他人占滿
        throw new FakeApiError(422, 'SLOT_UNAVAILABLE', '額滿', {
          quote: {
            ...okQuote(cartLines()),
            valid: false,
            checks: [
              {
                code: 'SLOT_UNAVAILABLE',
                severity: 'ERROR',
                message: '12:30 這個時段已額滿',
                field: 'scheduledAt',
              },
            ],
          },
        });
      },
    });
    await waitReady();
    await fillContact(user);
    await user.click(screen.getByRole('radio', { name: '預約' }));
    await user.click(screen.getByRole('radio', { name: '12:30' }));
    await user.click(submitButton());

    const list = await screen.findByTestId('availability-issue-list');
    expect(within(list).getByText('12:30 這個時段已額滿')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: '改選 13:00' })).toBeInTheDocument();
    const first = () => screen.getByRole('radio', { name: '13:00' });
    // 原選取（12:30）已清除且不自動選取；焦點落在第一個可選項
    expect(screen.getByRole('radio', { name: /12:30/ })).not.toBeChecked();
    expect(first()).not.toBeChecked();
    await waitFor(() => expect(first()).toHaveFocus());
  });

  it('409 PRICE_CHANGED：顯示新總額並要求再次確認；第二次才送出，沿用同一把 Key', async () => {
    const user = userEvent.setup();
    let n = 0;
    let repriced = false; // 店家在顧客送出時調價（之後的報價與 POST 都反映新價格）
    const priced = (): QuoteResponse => {
      const q = okQuote(cartLines());
      const items = q.items.map((i) =>
        i.index === 0 ? { ...i, unitPrice: 72, lineTotal: 72 } : i,
      );
      return { ...q, items, subtotal: 97, total: 97 };
    };
    const { create } = mount({
      quote: (lines) => (repriced ? priced() : okQuote(lines)),
      create: async () => {
        n += 1;
        if (n === 1) {
          repriced = true;
          throw new FakeApiError(409, 'PRICE_CHANGED', '價格已更新', { quote: priced() });
        }
        return createdResponse();
      },
    });
    await waitReady();
    await fillContact(user);
    await user.click(submitButton());

    const list = await screen.findByTestId('availability-issue-list');
    expect(within(list).getAllByText(/價格已更新：NT\$ 67 → NT\$ 72/).length).toBeGreaterThan(0);
    expect(create).toHaveBeenCalledTimes(1);
    const confirm = await screen.findByRole('button', { name: '確認新價格並送出 · NT$ 97' });
    await user.click(confirm);

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/orders/o1'));
    expect(create).toHaveBeenCalledTimes(2);
    const calls = create.mock.calls as Array<[CreateOrderRequest, string]>;
    expect(calls[1]?.[1]).toBe(calls[0]?.[1]);
    expect(calls[1]?.[0].expectedTotal).toBe(97);
  });

  it('總額增加時，第一次點擊只展開差異不送出（BR-25）', async () => {
    const user = userEvent.setup();
    // 購物車快照 $67，店家已調價為 $72
    const { create } = mount({
      quote: (lines) => {
        const q = okQuote(lines);
        const items = q.items.map((i) =>
          i.index === 0 ? { ...i, unitPrice: 72, lineTotal: 72 } : i,
        );
        return { ...q, items, subtotal: 97, total: 97 };
      },
    });
    await screen.findByText('有 1 項價格更新');
    await fillContact(user);
    await user.click(submitButton());
    expect(await screen.findByTestId('availability-issue-list')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: '確認新價格並送出 · NT$ 97' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect((create.mock.calls[0] as [CreateOrderRequest])[0].expectedTotal).toBe(97);
  });
});

describe('結果未知與冪等重送（FLOW-24）', () => {
  it('結果未知：保留 Key；再試一次沿用同一把 Key，2xx 後作廢並清除草稿', async () => {
    const user = userEvent.setup();
    let n = 0;
    const { create } = mount({
      create: async () => {
        n += 1;
        if (n === 1) throw new FakeApiError(0, 'SERVICE_UNAVAILABLE', '網路');
        return createdResponse({ replayed: true });
      },
    });
    await waitReady();
    await fillContact(user);
    await user.click(submitButton());

    expect(await screen.findByText(/再試一次不會重複下單/)).toBeInTheDocument();
    const call = screen.getByRole('link', { name: /致電巷仔內小吃部確認/ });
    expect(call).toHaveAttribute('href', 'tel:0200000000');
    const keyAfterUnknown = loadDraft().idempotencyKey;
    expect(keyAfterUnknown).not.toBeNull();
    expect(loadDraft().unknownBodies).toHaveLength(1);
    expect(screen.queryByTestId('probe')).toBeNull();

    await user.click(screen.getByRole('button', { name: '再試一次' }));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/orders/o1'));
    const keys = (create.mock.calls as Array<[unknown, string]>).map((c) => c[1]);
    expect(keys).toEqual([keyAfterUnknown, keyAfterUnknown]);
    expect(loadDraft().idempotencyKey).toBeNull();
    expect(cartLines()).toHaveLength(0);
  });

  it('結果未知後修改內容再送，遇 IDEMPOTENCY_CONFLICT 不換 Key，改以同 Key 重放記下的內容', async () => {
    const user = userEvent.setup();
    let n = 0;
    const { create } = mount({
      create: async (req) => {
        n += 1;
        if (n === 1) throw new FakeApiError(0, 'SERVICE_UNAVAILABLE', '網路');
        if (req.note === '少辣') throw new FakeApiError(409, 'IDEMPOTENCY_CONFLICT', '內容不同');
        return createdResponse({ replayed: true });
      },
    });
    await waitReady();
    await fillContact(user);
    await user.click(submitButton());
    await screen.findByText(/再試一次不會重複下單/);
    const key = loadDraft().idempotencyKey;

    // 修改訂單備註（內容不同）後再送出
    await user.type(screen.getByRole('textbox', { name: /^訂單備註/ }), '少辣');
    await user.click(submitButton());

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/orders/o1'));
    const calls = create.mock.calls as Array<[CreateOrderRequest, string]>;
    expect(calls.map((c) => c[1])).toEqual([key, key, key]);
    expect(calls[1]?.[0].note).toBe('少辣');
    expect(calls[2]?.[0].note).toBeUndefined(); // 重放的是先前記下的內容
    expect(loadDraft().idempotencyKey).toBeNull();
  });

  it('429：確定未建立，不記下送出內容；送出鈕依秒數暫停（aria-disabled），沿用同一把 Key', async () => {
    const user = userEvent.setup();
    const { create } = mount({
      create: async () => {
        throw new FakeApiError(429, 'RATE_LIMITED', '太頻繁', { retryAfterSeconds: 30 });
      },
    });
    await waitReady();
    await fillContact(user);
    await user.click(submitButton());

    expect(await screen.findByText('操作太頻繁，請稍後再按一次送出訂單')).toBeInTheDocument();
    expect(loadDraft().unknownBodies).toEqual([]);
    expect(loadDraft().idempotencyKey).not.toBeNull();
    const btn = submitButton();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/請等 \d+ 秒後再按一次送出訂單/)).toBeInTheDocument();
    await user.click(btn);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('503 附 retryAfterSeconds：鎖逾時文案，不進結果未知', async () => {
    const user = userEvent.setup();
    mount({
      create: async () => {
        throw new FakeApiError(503, 'SERVICE_UNAVAILABLE', '忙碌', { retryAfterSeconds: 5 });
      },
    });
    await waitReady();
    await fillContact(user);
    await user.click(submitButton());
    expect(await screen.findByText('目前點餐人數較多，請稍後再按一次送出訂單')).toBeInTheDocument();
    expect(screen.queryByText(/再試一次不會重複下單/)).toBeNull();
  });

  it('重新整理後（草稿含記下的送出內容）仍顯示結果未知提示並可再試一次', async () => {
    const user = userEvent.setup();
    let n = 0;
    const first = mount({
      create: async () => {
        n += 1;
        throw new FakeApiError(500, 'INTERNAL_ERROR', '壞了');
      },
    });
    await waitReady();
    await fillContact(user);
    await user.click(submitButton());
    await screen.findByText(/再試一次不會重複下單/);
    expect(first.create).toHaveBeenCalledTimes(1);
    expect(n).toBe(1);
  });
});

describe('觸控面板重置（FLOW-21）', () => {
  it('收到重置事件：丟棄 Key 與記下的送出內容、清空表單並回首頁', async () => {
    const user = userEvent.setup();
    mount({
      create: async () => {
        throw new FakeApiError(0, 'SERVICE_UNAVAILABLE', '網路');
      },
    });
    await waitReady();
    await fillContact(user);
    await user.click(submitButton());
    await screen.findByText(/再試一次不會重複下單/);
    expect(loadDraft().idempotencyKey).not.toBeNull();

    act(() => dispatchKioskReset());
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/'));
    const d = loadDraft();
    expect(d.idempotencyKey).toBeNull();
    expect(d.unknownBodies).toEqual([]);
    expect(d.form).toEqual({});
  });
});

describe('會員', () => {
  it('以會員資料預填聯絡資訊，不顯示「記住我的資料」與登入提示', async () => {
    useSessionStore.setState({
      tokens: { accessToken: 't', expiresIn: 900 },
      user: {
        id: 'u1',
        phone: '0911222333',
        name: '林會員',
        marketingOptIn: false,
        createdAt: '2026-01-01T00:00:00+08:00',
      },
    });
    mount();
    await waitReady();
    await waitFor(() => expect(nameBox()).toHaveValue('林會員'));
    expect(phoneBox()).toHaveValue('0911-222-333');
    expect(screen.queryByText(/記住我的資料/)).toBeNull();
    expect(screen.queryByText(/已有帳號？/)).toBeNull();
  });
});

describe('訪客資料記憶（FR-CK-14）', () => {
  it('預設不勾選；勾選後成功送出才寫入 prefs.guestProfile', async () => {
    const user = userEvent.setup();
    mount();
    await waitReady();
    const remember = screen.getByRole('checkbox', { name: /記住我的資料/ });
    expect(remember).not.toBeChecked();
    expect(usePrefsStore.getState().guestProfile).toBeNull();
    await fillContact(user);
    await user.click(remember);
    expect(usePrefsStore.getState().guestProfile).toBeNull(); // 送出前不寫入
    await user.click(submitButton());
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/orders/o1'));
    expect(usePrefsStore.getState().guestProfile).toMatchObject({
      name: '王小明',
      phone: '0912345678',
      paymentMethod: 'CASH',
    });
  });

  it('未勾選時不寫入訪客資料', async () => {
    const user = userEvent.setup();
    mount();
    await waitReady();
    await fillContact(user);
    await user.click(submitButton());
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/orders/o1'));
    expect(usePrefsStore.getState().guestProfile).toBeNull();
  });
});

describe('店家狀態（FR-CK-12、EC-01）', () => {
  it('休息中：盡快停用並預設選取第一個可預約時段；說明可預約時間', async () => {
    const closed = {
      ...INFO.status,
      status: 'CLOSED' as const,
      closedReason: 'OUT_OF_HOURS' as const,
      nextOpenAt: '2026-10-14T12:30:00+08:00',
    };
    mount({
      status: closed,
      slots: () => ({
        ...SLOTS,
        asap: { available: false, unavailableReason: 'STORE_CLOSED' as const },
      }),
    });
    await waitFor(() => expect(screen.getByRole('radio', { name: '預約' })).toBeChecked());
    expect(screen.getByRole('radio', { name: /盡快/ })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('radio', { name: '12:30' })).toBeChecked());
    expect(await screen.findByText('目前休息中，可預約 12:30 後取餐')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '改預約' })).toBeInTheDocument();
  });

  it('暫停接單：整頁唯讀、送出鈕停用（唯一使用 disabled）並顯示店家電話', async () => {
    mount({ status: { ...INFO.status, status: 'PAUSED' as const } });
    const note = await screen.findByText(/暫停接單/, { selector: 'div' });
    expect(note).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /致電巷仔內小吃部（02-0000-0000）/ })).toHaveAttribute(
      'href',
      'tel:0200000000',
    );
    expect(nameBox()).toBeDisabled();
    expect(screen.getByRole('button', { name: /送出訂單|店家暫停接單/ })).toBeDisabled();
  });
});

describe('外送、內用與折扣碼', () => {
  const zone = {
    zipCode: '106',
    city: '臺北市',
    district: '大安區',
    deliveryFee: 30,
    minOrderAmount: 150,
    freeDeliveryThreshold: 400,
    estimatedMinutes: 35,
  };

  it('外送：選擇行政區後檢查範圍並顯示外送費、免運門檻與預估分鐘；請求帶入地址', async () => {
    const user = userEvent.setup();
    useCartStore.setState({ orderType: 'DELIVERY' });
    const checkDelivery = vi.fn(async (zip: string) =>
      zip === '106'
        ? { deliverable: true, zone }
        : { deliverable: false, reason: 'OUT_OF_DELIVERY_AREA' as const },
    );
    const { create } = mount({
      store: { checkDelivery },
      quote: (lines) => okQuote(lines, { deliveryFee: 30, total: 122 }),
    });
    await user.selectOptions(await screen.findByRole('combobox', { name: /縣市/ }), '臺北市');
    await user.selectOptions(screen.getByRole('combobox', { name: /行政區/ }), '大安區');
    expect(
      await screen.findByText(/外送費 NT\$ 30（滿 NT\$ 400 免運）・預估 35 分鐘/),
    ).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /^詳細地址/ }), '示範路 5 號 3 樓');
    await fillContact(user);
    await screen.findByText('餐點與時段可供應');
    await user.click(submitButton());
    await waitFor(() => expect(create).toHaveBeenCalled());
    const req = (create.mock.calls[0] as [CreateOrderRequest])[0];
    expect(req.orderType).toBe('DELIVERY');
    expect(req.delivery).toEqual({
      city: '臺北市',
      district: '大安區',
      zipCode: '106',
      line: '示範路 5 號 3 樓',
    });
    expect(req.expectedTotal).toBe(122);
  });

  it('外送超出範圍：顯示錯誤與「改為自取」（EC-08）', async () => {
    const user = userEvent.setup();
    useCartStore.setState({ orderType: 'DELIVERY' });
    mount();
    await user.selectOptions(await screen.findByRole('combobox', { name: /縣市/ }), '新北市');
    await user.selectOptions(screen.getByRole('combobox', { name: /行政區/ }), '板橋區');
    expect(await screen.findByText('此地址不在外送範圍內，可改為自取')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '改為自取' }));
    expect(useCartStore.getState().orderType).toBe('PICKUP');
    expect(await screen.findByText('取餐地點')).toBeInTheDocument();
  });

  it('QR 桌號（?table=）：解析後鎖定為內用並帶入桌號與 qrToken（FR-CK-05）', async () => {
    const user = userEvent.setup();
    const resolveTable = vi.fn(async () => ({ tableNo: 'A3', seats: 4 }));
    const { create } = mount({
      route: '/checkout?table=QR-A3',
      store: { resolveTable },
    });
    expect(await screen.findByText('桌號 A3')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('radio', { name: '內用' })).toBeChecked());
    expect(screen.getByRole('radio', { name: '自取' })).toBeDisabled();
    await waitReady();
    await user.click(submitButton());
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect((create.mock.calls[0] as [CreateOrderRequest])[0]).toMatchObject({
      orderType: 'DINE_IN',
      dineIn: { tableNo: 'A3', qrToken: 'QR-A3' },
      scheduledAt: null,
    });
  });

  it('QR 桌號無法辨識：維持一般點餐並提示（03 PG-01）', async () => {
    const resolveTable = vi.fn(async () => {
      throw new FakeApiError(404, 'TABLE_NOT_FOUND', '找不到桌號');
    });
    mount({ route: '/checkout?table=Z9', store: { resolveTable } });
    expect(await screen.findByText(/找不到 QR 帶入的桌號，已改為一般點餐/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '自取' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '內用' })).not.toBeChecked();
  });

  it('QR 桌號有效但店家未開放內用：不鎖定，回到一般點餐並說明（03 PG-01）', async () => {
    const resolveTable = vi.fn(async () => ({ tableNo: 'A3', seats: 4 }));
    mount({
      route: '/checkout?table=QR-A3',
      info: { ...INFO, services: { pickup: true, delivery: true, dineIn: false } },
      store: { resolveTable },
    });
    expect(await screen.findByText('店家目前未開放內用，已改為一般點餐')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '自取' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '自取' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: '外送' })).toBeEnabled();
    expect(screen.queryByText(/已由 QR 帶入桌號/)).toBeNull();
  });

  it('折扣碼：轉大寫套用並帶入報價；錯誤碼對應訊息並鎖定送出（FR-PR-01）', async () => {
    const user = userEvent.setup();
    const { quote } = mount({
      quote: (lines) => {
        const base = okQuote(lines);
        return {
          ...base,
          valid: false,
          checks: [
            { code: 'COUPON_EXPIRED', severity: 'ERROR', message: 'x', field: 'couponCode' },
          ],
        };
      },
    });
    await user.type(await screen.findByRole('textbox', { name: /^折扣碼/ }), 'old2025');
    await user.click(screen.getByRole('button', { name: '套用' }));
    await waitFor(() =>
      expect(quote).toHaveBeenCalledWith(expect.objectContaining({ couponCode: 'OLD2025' })),
    );
    expect(await screen.findAllByText('這個折扣碼已過期或尚未生效')).not.toHaveLength(0);
    // 折扣碼有錯誤時不說「已套用」，避免與下方的錯誤訊息矛盾
    expect(screen.getByText('折扣碼 OLD2025')).toBeInTheDocument();
    expect(screen.queryByText(/已套用 OLD2025/)).toBeNull();
    await waitFor(() => expect(submitButton()).toHaveAttribute('aria-disabled', 'true'));
    await user.click(screen.getByRole('button', { name: '移除折扣碼 OLD2025' }));
    expect(screen.queryByText('折扣碼 OLD2025')).toBeNull();
  });
});

describe('觸控面板模式（BR-36、03 §5.6）', () => {
  it('取餐方式為「外帶 / 內用」不含外送；付款僅現金（櫃檯付款）；無「記住我的資料」與登入提示', async () => {
    useInputModeStore.setState({ inputMode: 'KIOSK' });
    useCartStore.setState({ orderType: 'DELIVERY' }); // 不可用的方式回退為可用項
    mount();
    await waitReady();
    expect(screen.getByRole('radio', { name: '外帶' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '內用' })).toBeChecked(); // 預設內用
    expect(useCartStore.getState().orderType).toBe('DINE_IN');
    expect(screen.queryByRole('radio', { name: '外送' })).toBeNull();
    expect(screen.getByRole('radio', { name: /現金（櫃檯付款）/ })).toBeChecked();
    expect(screen.queryByRole('radio', { name: /LINE Pay/ })).toBeNull();
    expect(screen.queryByText(/記住我的資料/)).toBeNull();
    expect(screen.queryByText(/已有帳號？/)).toBeNull();
    expect(screen.queryByText('Ctrl/⌘ + Enter')).toBeNull();
  });
});
