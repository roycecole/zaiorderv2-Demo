// CMP-31 訂單面板（≥ 1024）與 CMP-16 浮動購物車列（< 1024）
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CartLine } from '@/domain/cart';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import {
  LUROU,
  LUROU_DETAIL,
  detailOf,
  fakeApi,
  menuOf,
  product,
  quoteFor,
} from '@/features/menu/__tests__/fixtures';
import { LocationProbe, resetStores } from '@/features/menu/__tests__/helpers';
import { appSessionStorage, STORAGE_KEYS } from '@/services/storage/appStorage';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CartBar } from '../CartBar';
import { CartPanel, focusOrderPanel } from '../CartPanel';
import { useCartStore } from '../cartStore';

const PORK = product({ id: 'prd_pork', name: '古早味排骨飯', basePrice: 110, displayPrice: 110 });

const porkLine: Omit<CartLine, 'lineId'> = {
  productId: 'prd_pork',
  quantity: 1,
  optionIds: [],
  snapshot: { name: '古早味排骨飯', unitPrice: 110, optionLabels: [] },
};
const luLine: Omit<CartLine, 'lineId'> = {
  productId: 'prd_lurou',
  quantity: 2,
  optionIds: ['opt_l', 'opt_egg'],
  note: '不要蔥',
  snapshot: { name: '招牌滷肉飯', unitPrice: 67, optionLabels: ['大碗', '滷蛋'] },
};

const api = (soldOutIndex?: number) =>
  fakeApi({
    menu: menuOf({ id: 'cat', name: '飯類', products: [LUROU, PORK] }),
    details: [LUROU_DETAIL, detailOf(PORK)],
    quote: (req) =>
      quoteFor(req, (id) => (id === 'prd_pork' ? 110 : 67), {
        ...(soldOutIndex === undefined
          ? {}
          : {
              [soldOutIndex]: {
                available: false,
                availableQuantity: 0,
                issue: 'ITEM_SOLD_OUT' as const,
                remaining: 0,
              },
            }),
      }),
  });

beforeEach(() => {
  resetStores();
  document.documentElement.style.removeProperty('--toast-offset-bottom');
});
afterEach(() => appSessionStorage.removeItem(STORAGE_KEYS.table));

describe('CartPanel', () => {
  it('空購物車：說明與停用的結帳鈕；訪客顯示「不需登入即可結帳」', () => {
    renderWithProviders(<CartPanel />, { api: api() });
    const panel = screen.getByRole('complementary', { name: '我的訂單' });
    expect(within(panel).getByText('購物車還是空的')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '前往結帳' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(panel).getByText('不需登入即可結帳')).toBeInTheDocument();
    expect(within(panel).getByText('自取')).toBeInTheDocument();
  });

  it('品項列：份數 ×、品名、選項、備註與金額；費用摘要與前往結帳', async () => {
    useCartStore.getState().addLine(luLine);
    useCartStore.getState().addLine(porkLine);
    renderWithProviders(<CartPanel />, { api: api() });
    const panel = screen.getByRole('complementary', { name: '我的訂單' });
    expect(within(panel).getByText('2×')).toBeInTheDocument();
    expect(within(panel).getByText('大碗・滷蛋')).toBeInTheDocument();
    expect(within(panel).getByText('備註：不要蔥')).toBeInTheDocument();
    expect(within(panel).getByText('NT$ 134')).toBeInTheDocument();
    // 小計 244、運費與折扣為「—」
    const subtotal = within(panel).getByText('小計').parentElement as HTMLElement;
    expect(subtotal).toHaveTextContent('NT$ 244');
    const cta = within(panel).getByRole('link', { name: /前往結帳/ });
    expect(cta).toHaveAttribute('href', '/checkout');
    expect(cta).toHaveTextContent('前往結帳 · NT$ 244');
  });

  it('「編輯」「移除」恆可見；編輯開啟商品面板網址，移除可復原', async () => {
    const user = userEvent.setup();
    useCartStore.getState().addLine(luLine);
    renderWithProviders(
      <>
        <LocationProbe />
        <CartPanel />
      </>,
      { api: api() },
    );
    const lineId = useCartStore.getState().lines[0]?.lineId as string;
    await user.click(screen.getByRole('button', { name: '編輯 招牌滷肉飯' }));
    expect(screen.getByTestId('location')).toHaveTextContent(`?edit=${lineId}`);

    await user.click(screen.getByRole('button', { name: '移除 招牌滷肉飯' }));
    expect(useCartStore.getState().lines).toHaveLength(0);
    await user.click(await screen.findByRole('button', { name: '復原' }));
    expect(useCartStore.getState().lines).toHaveLength(1);
  });

  it('品項異動以逐行狀態標示，前往結帳維持可用', async () => {
    useCartStore.getState().addLine(luLine);
    useCartStore.getState().addLine(porkLine);
    renderWithProviders(<CartPanel />, { api: api(1) });
    expect(await screen.findByText('今日售完')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /前往結帳/ })).toBeInTheDocument();
  });

  it('觸控面板：以「外帶」稱呼自取、不顯示登入說明', () => {
    useInputModeStore.setState({ inputMode: 'KIOSK' });
    renderWithProviders(<CartPanel />, { api: api() });
    expect(screen.getByText('外帶')).toBeInTheDocument();
    expect(screen.queryByText('不需登入即可結帳')).toBeNull();
  });

  it('focusOrderPanel：把焦點移到第一個品項行（`c` 於桌機）', async () => {
    useCartStore.getState().addLine(luLine);
    const { container } = renderWithProviders(<CartPanel />, { api: api() });
    expect(container.querySelector('#orderpanel')).not.toBeNull();
    act(() => {
      expect(focusOrderPanel()).toBe(true);
    });
    expect(container.querySelector('li[data-line-id]')).toHaveFocus();
  });
});

describe('CartPanel：QR 桌號（03 PG-01）', () => {
  const tableApi = (resolveTable: () => Promise<{ tableNo: string }>) =>
    fakeApi({
      menu: menuOf({ id: 'cat', name: '飯類', products: [LUROU, PORK] }),
      details: [LUROU_DETAIL, detailOf(PORK)],
      quote: (req) => quoteFor(req, (id) => (id === 'prd_pork' ? 110 : 67)),
      resolveTable,
    });

  it('桌號有效：標題右側顯示「內用・桌號 A3」，並以內用計價', async () => {
    useCartStore.getState().addLine(porkLine);
    renderWithProviders(<CartPanel />, {
      api: tableApi(async () => ({ tableNo: 'A3' })),
      route: '/?table=A3',
    });
    const panel = screen.getByRole('complementary', { name: '我的訂單' });
    expect(await within(panel).findByText('內用・桌號 A3')).toBeInTheDocument();
    expect(within(panel).queryByText('自取')).toBeNull();
  });

  it('桌號無法辨識：維持取餐方式徽章（自取）', async () => {
    useCartStore.getState().addLine(porkLine);
    renderWithProviders(<CartPanel />, {
      api: tableApi(async () => {
        throw new Error('找不到桌號');
      }),
      route: '/?table=Z9',
    });
    const panel = screen.getByRole('complementary', { name: '我的訂單' });
    expect(within(panel).getByText('自取')).toBeInTheDocument();
    await waitFor(() => expect(within(panel).queryByText(/桌號/)).toBeNull());
  });
});

describe('CartBar', () => {
  it('購物車為空時不顯示', () => {
    renderWithProviders(<CartBar />, { api: api() });
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('顯示品項數與小計，並連到購物車頁', async () => {
    useCartStore.getState().addLine(luLine);
    useCartStore.getState().addLine(porkLine);
    renderWithProviders(<CartBar />, { api: api() });
    const bar = screen.getByRole('link', { name: /查看購物車/ });
    expect(bar).toHaveTextContent('2 項');
    expect(bar).toHaveTextContent('NT$ 244');
    expect(bar).toHaveAttribute('href', '/cart');
  });

  it('把占用的底部空間寫入 --toast-offset-bottom；隱藏或卸載時還原', async () => {
    const root = document.documentElement;
    root.style.setProperty('--toast-offset-bottom', '24px');
    const { unmount } = renderWithProviders(<CartBar />, { api: api() });
    expect(root.style.getPropertyValue('--toast-offset-bottom')).toBe('24px');

    act(() => {
      useCartStore.getState().addLine(porkLine);
    });
    await waitFor(() =>
      expect(root.style.getPropertyValue('--toast-offset-bottom')).toMatch(/^\d+px$/),
    );
    expect(root.style.getPropertyValue('--toast-offset-bottom')).not.toBe('24px');

    // 清空購物車 → CartBar 隱藏 → 還原先前的值
    act(() => {
      useCartStore.getState().clear();
    });
    await waitFor(() => expect(root.style.getPropertyValue('--toast-offset-bottom')).toBe('24px'));

    act(() => {
      useCartStore.getState().addLine(porkLine);
    });
    await waitFor(() =>
      expect(root.style.getPropertyValue('--toast-offset-bottom')).not.toBe('24px'),
    );
    unmount();
    expect(root.style.getPropertyValue('--toast-offset-bottom')).toBe('24px');
  });
});
