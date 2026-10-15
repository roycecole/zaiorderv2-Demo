// 鍵盤操作：商品網格的方向鍵導覽與 roving tabindex（原生導覽，不需開啟單鍵快速鍵）、
// 單鍵快速鍵（a 加入 / r 再點 / f 收藏 / 1–9 0 跳分類 / v 版面 / c 購物車；商品面板 + - a d）
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HotkeyProvider } from '@/features/a11y';
import { useCartStore } from '@/features/cart/cartStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { renderWithProviders } from '@/test/renderWithProviders';
import { MenuPage } from '../MenuPage';
import { LUROU, LUROU_DETAIL, detailOf, fakeApi, menuOf, product } from './fixtures';
import { LocationProbe, loginAsMember, resetStores } from './helpers';

const PORK = product({ id: 'prd_pork', name: '古早味排骨飯', basePrice: 110, displayPrice: 110 });
const KONG = product({
  id: 'prd_kong',
  name: '控肉飯',
  basePrice: 85,
  displayPrice: 85,
  isSoldOut: true,
});
const TEA = product({
  id: 'prd_tea',
  name: '古早味紅茶',
  categoryId: 'cat_drink',
  basePrice: 25,
  displayPrice: 25,
});

function renderMenu(extra: Parameters<typeof fakeApi>[0] = {}, route = '/') {
  const api = fakeApi({
    menu: menuOf(
      { id: 'cat_rice', name: '飯類', products: [LUROU, PORK, KONG] },
      { id: 'cat_drink', name: '飲品', products: [TEA] },
    ),
    details: [LUROU_DETAIL, detailOf(PORK), detailOf(TEA)],
    ...extra,
  });
  return renderWithProviders(
    <HotkeyProvider pathname="/">
      <LocationProbe />
      <MenuPage showSearch={false} />
    </HotkeyProvider>,
    { api, route },
  );
}

const card = (container: HTMLElement, id: string): HTMLElement =>
  container.querySelector(`[data-product-card="${id}"]`) as HTMLElement;

beforeEach(() => {
  resetStores();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('方向鍵導覽（不需開啟單鍵快速鍵）', () => {
  it('roving tabindex：整個網格只有一個 Tab 停點，卡片內的按鈕隨之', async () => {
    const { container } = renderMenu();
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-product-card]'));
    expect(cards.map((c) => c.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
    const firstAdd = within(cards[0] as HTMLElement).getByRole('button', {
      name: '加入 招牌滷肉飯',
    });
    const secondAdd = within(cards[1] as HTMLElement).getByRole('button', {
      name: '加入 古早味排骨飯',
    });
    expect(firstAdd).not.toHaveAttribute('tabindex', '-1');
    expect(secondAdd).toHaveAttribute('tabindex', '-1');
  });

  it('← → ↑ ↓ Home End 在商品卡間移動焦點；Enter 開啟面板', async () => {
    const user = userEvent.setup();
    const { container } = renderMenu();
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    act(() => card(container, 'prd_lurou').focus());
    await user.keyboard('{ArrowRight}');
    expect(card(container, 'prd_pork')).toHaveFocus();
    await user.keyboard('{End}');
    expect(card(container, 'prd_tea')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(card(container, 'prd_kong')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(card(container, 'prd_lurou')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(card(container, 'prd_pork')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(card(container, 'prd_lurou')).toHaveFocus();
    // 取得焦點的卡片成為 Tab 停點
    await user.keyboard('{ArrowRight}');
    expect(card(container, 'prd_pork')).toHaveAttribute('tabindex', '0');
    expect(card(container, 'prd_lurou')).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: '古早味排骨飯' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('product=prd_pork');
  });

  it('單鍵快速鍵預設關閉：按 a 不會加入（Esc 與方向鍵不受影響）', async () => {
    const user = userEvent.setup();
    const { container } = renderMenu();
    await screen.findByRole('heading', { level: 3, name: '古早味排骨飯' });
    act(() => card(container, 'prd_pork').focus());
    await user.keyboard('a');
    expect(useCartStore.getState().lines).toHaveLength(0);
  });
});

describe('單鍵快速鍵（已啟用）', () => {
  beforeEach(() => {
    usePrefsStore.setState({ hotkeysEnabled: true });
  });

  it('a：加入焦點商品（無必選選項直接加入；含必選選項開啟面板；售完時通報）', async () => {
    const user = userEvent.setup();
    const { container } = renderMenu();
    await screen.findByRole('heading', { level: 3, name: '古早味排骨飯' });

    act(() => card(container, 'prd_pork').focus());
    await user.keyboard('a');
    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(useCartStore.getState().lines[0]?.productId).toBe('prd_pork');

    act(() => card(container, 'prd_kong').focus());
    await user.keyboard('a');
    expect(useCartStore.getState().lines).toHaveLength(1);

    act(() => card(container, 'prd_lurou').focus());
    await user.keyboard('a');
    expect(await screen.findByRole('dialog', { name: '招牌滷肉飯' })).toBeInTheDocument();
  });

  it('r：再點焦點商品上次的選擇；f：會員收藏 / 取消收藏', async () => {
    const user = userEvent.setup();
    loginAsMember();
    usePrefsStore.setState({
      lastChoices: {
        prd_lurou: {
          productId: 'prd_lurou',
          optionIds: ['opt_l'],
          labels: ['大碗'],
          at: Date.now(),
        },
      },
    });
    const { container } = renderMenu();
    await screen.findByRole('region', { name: '常點的餐點' });

    act(() => card(container, 'prd_lurou').focus());
    await user.keyboard('r');
    await waitFor(() => expect(useCartStore.getState().lines).toHaveLength(1));
    expect(useCartStore.getState().lines[0]?.optionIds).toEqual(['opt_l']);

    act(() => card(container, 'prd_pork').focus());
    await user.keyboard('f');
    await waitFor(() =>
      expect(
        within(card(container, 'prd_pork')).getByRole('button', { name: '取消收藏 古早味排骨飯' }),
      ).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  it('數字鍵跳分類：1 = 第一個分類（含熱銷），0 = 全部', async () => {
    const user = userEvent.setup();
    renderMenu();
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    const nav = screen.getByRole('navigation', { name: '菜單分類' });
    await user.keyboard('1'); // 熱銷（只有 HOT 標籤的商品）
    expect(within(nav).getByRole('button', { name: '熱銷，1 項' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.queryByRole('heading', { level: 3, name: '古早味紅茶' })).toBeNull();
    await user.keyboard('0');
    expect(within(nav).getByRole('button', { name: '全部，4 項' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('heading', { level: 3, name: '古早味紅茶' })).toBeInTheDocument();
    await user.keyboard('3'); // 飲品
    expect(within(nav).getByRole('button', { name: '飲品，1 項' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('v：切換圖卡 / 清單並記住；c：前往購物車（< 1024）', async () => {
    const user = userEvent.setup();
    renderMenu();
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    const before = usePrefsStore.getState().menuLayoutOverride;
    await user.keyboard('v');
    expect(usePrefsStore.getState().menuLayoutOverride).not.toBe(before);
    await user.keyboard('c');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/cart$/);
  });

  it('商品面板：+ / - 調整數量、a 加入、d 恢復預設；面板開啟時背景範圍失效', async () => {
    const user = userEvent.setup();
    usePrefsStore.setState({
      lastChoices: {
        prd_lurou: {
          productId: 'prd_lurou',
          optionIds: ['opt_l', 'opt_egg'],
          labels: ['大碗', '滷蛋'],
          at: Date.now(),
        },
      },
    });
    const { container } = renderMenu({}, '/?product=prd_lurou');
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    await within(dialog).findByText('已套用上次的選擇：大碗・滷蛋');

    await user.keyboard('+');
    expect(within(dialog).getByRole('spinbutton', { name: '數量' })).toHaveAttribute(
      'aria-valuenow',
      '2',
    );
    await user.keyboard('-');
    expect(within(dialog).getByRole('spinbutton', { name: '數量' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );

    // 背景頁面的 a（加入焦點商品）不會觸發：焦點在面板內時 a 為「加入購物車」
    await user.keyboard('d');
    expect(within(dialog).getByRole('radio', { name: /小碗/ })).toBeChecked();
    expect(within(dialog).getByText('已恢復預設選項')).toBeInTheDocument();

    await user.keyboard('a');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(useCartStore.getState().lines[0]).toMatchObject({
      productId: 'prd_lurou',
      optionIds: ['opt_s'],
    });
    expect(container.querySelector('[data-product-card]')).not.toBeNull();
  });

  it('在輸入框內不觸發單鍵快速鍵（備註輸入 a、+）', async () => {
    const user = userEvent.setup();
    renderMenu({}, '/?product=prd_lurou');
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    const note = await within(dialog).findByRole('textbox', { name: /備註/ });
    await user.click(note);
    await user.keyboard('a+d');
    expect(note).toHaveValue('a+d');
    expect(useCartStore.getState().lines).toHaveLength(0);
    expect(within(dialog).getByRole('spinbutton', { name: '數量' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
  });
});
