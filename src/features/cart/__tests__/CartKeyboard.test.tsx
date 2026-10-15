// 購物車範圍的單鍵快速鍵：e 編輯、d 移除（需確認）、+ / - 數量、p 前往結帳；作用於焦點品項
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CartLine } from '@/domain/cart';
import { HotkeyProvider } from '@/features/a11y';
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
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CartPage } from '../CartPage';
import { useCartStore } from '../cartStore';

const PORK = product({ id: 'prd_pork', name: '古早味排骨飯', basePrice: 110, displayPrice: 110 });
const porkLine = (overrides: Partial<Omit<CartLine, 'lineId'>> = {}): Omit<CartLine, 'lineId'> => ({
  productId: 'prd_pork',
  quantity: 2,
  optionIds: [],
  snapshot: { name: '古早味排骨飯', unitPrice: 110, optionLabels: [] },
  ...overrides,
});

function renderCart() {
  const api = fakeApi({
    menu: menuOf({ id: 'cat', name: '飯類', products: [LUROU, PORK] }),
    details: [LUROU_DETAIL, detailOf(PORK)],
    quote: (req) => quoteFor(req, (id) => (id === 'prd_pork' ? 110 : 67)),
  });
  return renderWithProviders(
    <HotkeyProvider pathname="/cart">
      <LocationProbe />
      <CartPage />
    </HotkeyProvider>,
    { api, route: '/cart' },
  );
}

const row = (container: HTMLElement): HTMLElement =>
  container.querySelector('li[data-line-id]') as HTMLElement;

beforeEach(() => {
  resetStores();
  usePrefsStore.setState({ hotkeysEnabled: true });
  useCartStore.getState().addLine(porkLine());
});

describe('購物車快速鍵', () => {
  it('+ / -：調整焦點品項的數量；- 於 1 份時詢問是否移除', async () => {
    const user = userEvent.setup();
    const { container } = renderCart();
    act(() => row(container).focus());
    await user.keyboard('+');
    expect(useCartStore.getState().lines[0]?.quantity).toBe(3);
    await user.keyboard('-');
    await user.keyboard('-');
    expect(useCartStore.getState().lines[0]?.quantity).toBe(1);
    await user.keyboard('-');
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('要移除這個品項嗎？')).toBeInTheDocument();
    expect(useCartStore.getState().lines).toHaveLength(1);
  });

  it('d：移除焦點品項（需確認）；確認後焦點移到「回菜單」', async () => {
    const user = userEvent.setup();
    const { container } = renderCart();
    act(() => row(container).focus());
    await user.keyboard('d');
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: '移除' }));
    expect(useCartStore.getState().lines).toHaveLength(0);
    await waitFor(() => expect(screen.getByRole('link', { name: '回菜單' })).toHaveFocus());
  });

  it('e：編輯焦點品項（開啟 ?edit=）；p：前往結帳', async () => {
    const user = userEvent.setup();
    const { container } = renderCart();
    const lineId = useCartStore.getState().lines[0]?.lineId as string;
    act(() => row(container).focus());
    await user.keyboard('e');
    expect(screen.getByTestId('location')).toHaveTextContent(`?edit=${lineId}`);
    expect(await screen.findByRole('dialog', { name: '古早味排骨飯' })).toBeInTheDocument();
  });

  it('p：前往結帳', async () => {
    const user = userEvent.setup();
    const { container } = renderCart();
    act(() => row(container).focus());
    await user.keyboard('p');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/checkout$/);
  });

  it('單鍵快速鍵關閉時不觸發', async () => {
    const user = userEvent.setup();
    usePrefsStore.setState({ hotkeysEnabled: false });
    const { container } = renderCart();
    act(() => row(container).focus());
    await user.keyboard('+');
    await user.keyboard('p');
    expect(useCartStore.getState().lines[0]?.quantity).toBe(2);
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/cart$/);
  });
});
