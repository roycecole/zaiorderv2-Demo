// PG-03 購物車：逐行狀態（預檢不阻擋前往結帳）、數量 / 移除 / 復原 / 清空、取餐方式、24 小時過期、編輯
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CART_TTL_MS } from '@/domain/cart';
import type { CartLine } from '@/domain/cart';
import type { QuoteRequest } from '@/domain/types';
import { LiveAnnouncer, resetAnnouncer } from '@/features/a11y';
import {
  LUROU,
  LUROU_DETAIL,
  detailOf,
  fakeApi,
  menuOf,
  product,
  quoteFor,
  storeInfo,
} from '@/features/menu/__tests__/fixtures';
import { LocationProbe, resetStores } from '@/features/menu/__tests__/helpers';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { setClock, systemClock } from '@/services/clock';
import { appSessionStorage, STORAGE_KEYS } from '@/services/storage/appStorage';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CartPage } from '../CartPage';
import { useCartStore } from '../cartStore';

const PORK = product({ id: 'prd_pork', name: '古早味排骨飯', basePrice: 110, displayPrice: 110 });
const TEA = product({ id: 'prd_tea', name: '古早味紅茶', basePrice: 25, displayPrice: 25 });

const PRICES: Record<string, number> = { prd_lurou: 67, prd_pork: 110, prd_tea: 25 };

const seed = (lines: Array<Omit<CartLine, 'lineId'>>): string[] => {
  lines.forEach((l) => useCartStore.getState().addLine(l));
  return useCartStore.getState().lines.map((l) => l.lineId);
};

const porkLine = (overrides: Partial<Omit<CartLine, 'lineId'>> = {}): Omit<CartLine, 'lineId'> => ({
  productId: 'prd_pork',
  quantity: 1,
  optionIds: [],
  snapshot: { name: '古早味排骨飯', unitPrice: 110, optionLabels: [] },
  ...overrides,
});
const luLine = (overrides: Partial<Omit<CartLine, 'lineId'>> = {}): Omit<CartLine, 'lineId'> => ({
  productId: 'prd_lurou',
  quantity: 1,
  optionIds: ['opt_l', 'opt_egg'],
  note: '不要蔥',
  snapshot: { name: '招牌滷肉飯', unitPrice: 67, optionLabels: ['大碗', '滷蛋'] },
  ...overrides,
});

interface RenderOptions {
  quote?: (req: QuoteRequest) => ReturnType<typeof quoteFor> | Promise<ReturnType<typeof quoteFor>>;
  route?: string;
  resolveTable?: (qrToken: string) => Promise<{ tableNo: string; seats?: number }>;
  info?: ReturnType<typeof storeInfo>;
}

function renderCart({ quote, route = '/cart', resolveTable, info }: RenderOptions = {}) {
  const api = fakeApi({
    ...(resolveTable === undefined ? {} : { resolveTable }),
    ...(info === undefined ? {} : { info }),
    menu: menuOf({ id: 'cat', name: '飯類', products: [LUROU, PORK, TEA] }),
    details: [LUROU_DETAIL, detailOf(PORK), detailOf(TEA)],
    quote: quote ?? ((req) => quoteFor(req, (id) => PRICES[id] ?? 0)),
  });
  return renderWithProviders(
    <>
      <LocationProbe />
      <Routes>
        <Route path="/cart" element={<CartPage />} />
        <Route path="/" element={<p>首頁</p>} />
      </Routes>
      <LiveAnnouncer />
    </>,
    { api, route },
  );
}

beforeEach(() => {
  resetStores();
  resetAnnouncer();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setClock(systemClock);
  appSessionStorage.removeItem(STORAGE_KEYS.table);
});

describe('清單與空狀態', () => {
  it('空購物車：EmptyState 與「回菜單」', async () => {
    renderCart();
    expect(screen.getByRole('heading', { level: 1, name: '購物車（0）' })).toBeInTheDocument();
    expect(screen.getByText('購物車還是空的')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回菜單' })).toHaveAttribute('href', '/');
    // 空車時沒有取餐方式、結帳鈕與「清空」
    expect(screen.queryByRole('link', { name: /前往結帳/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '清空' })).toBeNull();
  });

  it('品項：品名、選項摘要、備註與金額；無選項時不輸出空的選項行（FR-CT-08）', async () => {
    seed([luLine({ quantity: 2 }), porkLine()]);
    const { container } = renderCart();
    expect(screen.getByRole('heading', { level: 1, name: '購物車（2）' })).toBeInTheDocument();
    const rows = container.querySelectorAll<HTMLElement>('li[data-line-id]');
    expect(rows).toHaveLength(2);
    const [lurou, pork] = Array.from(rows) as [HTMLElement, HTMLElement];
    expect(
      within(lurou).getByRole('heading', { level: 2, name: '招牌滷肉飯' }),
    ).toBeInTheDocument();
    expect(within(lurou).getByText('大碗・滷蛋')).toBeInTheDocument();
    expect(within(lurou).getByText('備註：不要蔥')).toBeInTheDocument();
    expect(within(lurou).getByText('NT$ 134')).toBeInTheDocument();
    // 無選項、無備註、無縮圖：只有品名與價格
    expect(within(pork).getByText('NT$ 110')).toBeInTheDocument();
    expect(pork.querySelectorAll('p')).toHaveLength(0);
    expect(pork.querySelector('img')).toBeNull();
    expect(screen.getByText(/購物車內容會保留 24 小時/)).toBeInTheDocument();
  });

  it('前往結帳：連結帶小計；以預檢結果的可成立內容計', async () => {
    seed([luLine(), porkLine()]);
    renderCart();
    const checkout = screen.getByRole('link', { name: /前往結帳/ });
    expect(checkout).toHaveAttribute('href', '/checkout');
    expect(checkout).toHaveTextContent('前往結帳 · NT$ 177');
  });
});

describe('數量、移除與清空', () => {
  it('步進器增減份數並更新小計', async () => {
    const user = userEvent.setup();
    const [lineId] = seed([porkLine()]);
    renderCart();
    await user.click(screen.getByRole('button', { name: '增加一份 古早味排骨飯' }));
    expect(useCartStore.getState().lines.find((l) => l.lineId === lineId)?.quantity).toBe(2);
    expect(await screen.findByRole('link', { name: /前往結帳 · NT\$ 220/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '減少一份 古早味排骨飯' }));
    expect(useCartStore.getState().lines[0]?.quantity).toBe(1);
  });

  it('數量為 1 時 − 變為「移除」並先詢問確認；取消則保留', async () => {
    const user = userEvent.setup();
    seed([porkLine()]);
    renderCart();
    // 於 1 份時，− 的名稱為「移除 品名」
    const buttons = screen.getAllByRole('button', { name: '移除 古早味排骨飯' });
    await user.click(buttons[0] as HTMLElement);
    // 前一個是步進器的移除鈕（先詢問確認）
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('要移除這個品項嗎？')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(useCartStore.getState().lines).toHaveLength(1);

    await user.click(
      screen.getAllByRole('button', { name: '移除 古早味排骨飯' })[0] as HTMLElement,
    );
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: '移除' }),
    );
    expect(useCartStore.getState().lines).toHaveLength(0);
    // 購物車變空：焦點移到「回菜單」並通報
    expect(await screen.findByRole('link', { name: '回菜單' })).toHaveFocus();
  });

  it('「移除」立即移除並提供「復原」，放回原本的位置', async () => {
    const user = userEvent.setup();
    seed([
      luLine(),
      porkLine(),
      {
        ...porkLine(),
        productId: 'prd_tea',
        snapshot: { name: '古早味紅茶', unitPrice: 25, optionLabels: [] },
      },
    ]);
    const { container } = renderCart();
    const second = container.querySelectorAll<HTMLElement>('li[data-line-id]')[1] as HTMLElement;
    const buttons = within(second).getAllByRole('button', { name: '移除 古早味排骨飯' });
    await user.click(buttons[buttons.length - 1] as HTMLElement); // 列尾的「移除」文字鈕
    // 「移除」文字鈕為立即移除（不再詢問）
    expect(useCartStore.getState().lines.map((l) => l.productId)).toEqual(['prd_lurou', 'prd_tea']);
    // 焦點移到下一個品項
    await waitFor(() =>
      expect(container.querySelector('li[data-line-id]:nth-child(2)')).toHaveFocus(),
    );
    await user.click(await screen.findByRole('button', { name: '復原' }));
    expect(useCartStore.getState().lines.map((l) => l.productId)).toEqual([
      'prd_lurou',
      'prd_pork',
      'prd_tea',
    ]);
  });

  it('清空需確認，並提供「復原」', async () => {
    const user = userEvent.setup();
    seed([luLine(), porkLine()]);
    renderCart();
    await user.click(screen.getByRole('button', { name: '清空' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('要清空購物車嗎？')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '清空' }));
    expect(useCartStore.getState().lines).toHaveLength(0);
    await user.click(await screen.findByRole('button', { name: '復原' }));
    expect(useCartStore.getState().lines).toHaveLength(2);
  });
});

describe('背景預檢（不阻擋前往結帳）', () => {
  it('售完：該行標示「今日售完」與「移除」，前往結帳仍可用', async () => {
    seed([luLine(), porkLine()]);
    renderCart({
      quote: (req) =>
        quoteFor(req, (id) => PRICES[id] ?? 0, {
          1: { available: false, availableQuantity: 0, issue: 'ITEM_SOLD_OUT', remaining: 0 },
        }),
    });
    expect(await screen.findByText('今日售完')).toBeInTheDocument();
    // 不可購買的行不計入小計
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /前往結帳/ })).toHaveTextContent('前往結帳 · NT$ 67'),
    );
    const checkout = screen.getByRole('link', { name: /前往結帳/ });
    expect(checkout).toHaveAttribute('href', '/checkout');
    expect(checkout).not.toHaveAttribute('aria-disabled');
  });

  it('數量不足：「今日只剩 n 份（已選 m 份）」，「改為 n 份」就地調整並可復原', async () => {
    const user = userEvent.setup();
    seed([porkLine({ quantity: 3 })]);
    renderCart({
      quote: (req) =>
        quoteFor(req, (id) => PRICES[id] ?? 0, {
          0: {
            available: false,
            availableQuantity: 1,
            issue: 'ITEM_STOCK_INSUFFICIENT',
            remaining: 1,
            lineTotal: 110,
          },
        }),
    });
    expect(await screen.findByText('今日只剩 1 份（已選 3 份）')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '將古早味排骨飯改為 1 份' }));
    expect(useCartStore.getState().lines[0]?.quantity).toBe(1);
    expect(await screen.findByText('已調整為 1 份')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '復原古早味排骨飯的份數調整' }));
    expect(useCartStore.getState().lines[0]?.quantity).toBe(3);
  });

  it('同商品多行：顯示合計已選份數，配置為 0 的行說明被其他行占用', async () => {
    seed([
      luLine({ quantity: 2 }),
      luLine({
        quantity: 1,
        optionIds: ['opt_s'],
        note: undefined,
        snapshot: { name: '招牌滷肉飯', unitPrice: 35, optionLabels: ['小碗'] },
      }),
    ]);
    renderCart({
      quote: (req) =>
        quoteFor(req, (id) => PRICES[id] ?? 0, {
          0: {
            available: false,
            availableQuantity: 1,
            issue: 'ITEM_STOCK_INSUFFICIENT',
            remaining: 1,
            lineTotal: 67,
          },
          1: {
            available: false,
            availableQuantity: 0,
            issue: 'ITEM_STOCK_INSUFFICIENT',
            remaining: 1,
            lineTotal: 0,
          },
        }),
    });
    expect(await screen.findByText('合計已選 3 份，今日只剩 1 份')).toBeInTheDocument();
    expect(screen.getByText('已被同商品其他行占用')).toBeInTheDocument();
  });

  it('價格已更新：頁面層級警示列出差異，不阻擋', async () => {
    seed([porkLine()]);
    renderCart({ quote: (req) => quoteFor(req, () => 120) });
    expect(await screen.findByText('部分商品價格已更新')).toBeInTheDocument();
    const alert = screen.getByText('部分商品價格已更新').closest('div') as HTMLElement;
    expect(alert).toHaveTextContent('古早味排骨飯');
    expect(alert).toHaveTextContent('NT$ 110 → NT$ 120');
    expect(screen.getByRole('link', { name: /前往結帳/ })).toBeInTheDocument();
  });

  it('預檢失敗（逾時 / 5xx）：說明送出時會再確認，仍可前往結帳', async () => {
    seed([porkLine()]);
    renderCart({
      quote: () => {
        throw Object.assign(new Error('timeout'), { code: 'SERVICE_UNAVAILABLE' });
      },
    });
    expect(
      await screen.findByText(
        '暫時無法預先確認餐點狀態，送出訂單時會再確認',
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /前往結帳/ })).toHaveAttribute('href', '/checkout');
  });

  it('預檢請求帶目前的取餐方式；切換取餐方式寫入購物車與偏好', async () => {
    const user = userEvent.setup();
    seed([porkLine()]);
    const requests: QuoteRequest[] = [];
    renderCart({
      quote: (req) => {
        requests.push(req);
        return quoteFor(req, (id) => PRICES[id] ?? 0);
      },
    });
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    expect(requests[0]?.orderType).toBe('PICKUP');
    await user.click(screen.getByRole('radio', { name: '內用' }));
    expect(useCartStore.getState().orderType).toBe('DINE_IN');
    expect(usePrefsStore.getState().lastOrderType).toBe('DINE_IN');
    await waitFor(() => expect(requests.at(-1)?.orderType).toBe('DINE_IN'));
  });

  it('店家休息中：頁首說明，仍可前往結帳', async () => {
    seed([porkLine()]);
    renderCart({
      quote: (req) => ({
        ...quoteFor(req, (id) => PRICES[id] ?? 0),
        valid: false,
        checks: [{ code: 'STORE_CLOSED', severity: 'ERROR', message: '休息中' }],
      }),
    });
    expect(await screen.findByText('目前休息中，可預約營業時段後取餐')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /前往結帳/ })).toBeInTheDocument();
  });
});

describe('其他', () => {
  it('進入頁面時購物車超過 24 小時未更新：清空並說明（FR-CT-04）', async () => {
    const now = Date.parse('2026-10-14T12:00:00+08:00');
    setClock({ now: () => new Date(now) });
    seed([porkLine()]);
    useCartStore.setState({ updatedAt: now - CART_TTL_MS - 1000 });
    renderCart();
    await waitFor(() => expect(useCartStore.getState().lines).toHaveLength(0));
    expect(await screen.findByText('購物車超過 24 小時未更新，已自動清空')).toBeInTheDocument();
    expect(screen.getByText('購物車還是空的')).toBeInTheDocument();
  });

  it('「編輯」開啟商品面板（?edit=）並帶入該行內容', async () => {
    const user = userEvent.setup();
    const [lineId] = seed([luLine({ quantity: 2 })]);
    renderCart();
    await user.click(screen.getByRole('button', { name: '編輯 招牌滷肉飯' }));
    expect(screen.getByTestId('location')).toHaveTextContent(`/cart?edit=${lineId}`);
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    expect(
      await within(dialog).findByRole('button', { name: '更新購物車 · NT$ 134' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /備註/ })).toHaveValue('不要蔥');
    // 返回鍵優先關閉面板
    fireEvent.click(screen.getByRole('button', { name: '測試返回鍵', hidden: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/cart$/);
  });

  it('桌機（≥ 1024）：導向首頁並保留網址參數，由右側訂單面板呈現', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: /min-width:\s*(768|1024)px/.test(query),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    }));
    seed([porkLine()]);
    renderCart();
    expect(await screen.findByText('首頁')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  });
});

describe('QR 桌號（?table=，03 PG-01、FR-CK-05）', () => {
  it('桌號有效：取餐方式固定為內用，其餘停用並說明原因；預檢以內用計價', async () => {
    const user = userEvent.setup();
    seed([porkLine()]);
    const requests: QuoteRequest[] = [];
    renderCart({
      route: '/cart?table=A3',
      resolveTable: async () => ({ tableNo: 'A3', seats: 4 }),
      quote: (req) => {
        requests.push(req);
        return quoteFor(req, (id) => PRICES[id] ?? 0);
      },
    });
    expect(await screen.findByText('已由 QR 帶入桌號 A3，取餐方式固定為內用')).toBeInTheDocument();
    const dineIn = screen.getByRole('radio', { name: '內用' });
    expect(dineIn).toBeChecked();
    expect(dineIn).toBeEnabled();
    expect(screen.getByRole('radio', { name: '自取' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '外送' })).toBeDisabled();
    expect(screen.getByRole('group', { name: '取餐方式' })).toHaveAccessibleDescription(
      '已由 QR 帶入桌號 A3，取餐方式固定為內用',
    );
    expect(useCartStore.getState().orderType).toBe('DINE_IN');
    await waitFor(() => expect(requests.at(-1)?.orderType).toBe('DINE_IN'));

    // 停用的選項不可切換；也不改寫偏好
    await user.click(screen.getByRole('radio', { name: '自取' }));
    expect(useCartStore.getState().orderType).toBe('DINE_IN');
    expect(usePrefsStore.getState().lastOrderType).toBeNull();
  });

  it('桌號確認中：先停用切換並說明，確認後才固定為內用', async () => {
    seed([porkLine()]);
    let release: (v: { tableNo: string }) => void = () => undefined;
    renderCart({
      route: '/cart?table=A3',
      resolveTable: () => new Promise((resolve) => (release = resolve)),
    });
    expect(await screen.findByText('正在確認桌號…')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '外送' })).toBeDisabled();
    expect(useCartStore.getState().orderType).toBe('PICKUP');
    release({ tableNo: 'A3' });
    expect(await screen.findByText('已由 QR 帶入桌號 A3，取餐方式固定為內用')).toBeInTheDocument();
    await waitFor(() => expect(useCartStore.getState().orderType).toBe('DINE_IN'));
  });

  it('站內導覽不帶 ?table=：沿用本分頁記下的桌位權杖', async () => {
    appSessionStorage.setItem(STORAGE_KEYS.table, 'A5');
    seed([porkLine()]);
    renderCart({ resolveTable: async () => ({ tableNo: 'A5' }) });
    expect(await screen.findByText('已由 QR 帶入桌號 A5，取餐方式固定為內用')).toBeInTheDocument();
  });

  it('桌號無法辨識：提示回退為一般點餐，取餐方式可自由切換', async () => {
    const user = userEvent.setup();
    seed([porkLine()]);
    renderCart({
      route: '/cart?table=Z9',
      resolveTable: async () => {
        throw new Error('找不到桌號');
      },
    });
    expect(await screen.findByText(/找不到 QR 帶入的桌號，已改為一般點餐/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '自取' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '外送' })).toBeEnabled();
    await user.click(screen.getByRole('radio', { name: '外送' }));
    expect(useCartStore.getState().orderType).toBe('DELIVERY');
  });

  it('桌號有效但店家未開放內用：說明並維持一般取餐方式', async () => {
    seed([porkLine()]);
    renderCart({
      route: '/cart?table=A3',
      resolveTable: async () => ({ tableNo: 'A3' }),
      info: storeInfo({ services: { pickup: true, delivery: true, dineIn: false } }),
    });
    expect(await screen.findByText('店家目前未開放內用，已改為一般點餐')).toBeInTheDocument();
    expect(screen.queryByText(/已由 QR 帶入桌號/)).toBeNull();
    expect(useCartStore.getState().orderType).toBe('PICKUP');
    expect(screen.getByRole('radio', { name: '自取' })).toBeEnabled();
  });
});
