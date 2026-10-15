// 菜單頁的互動細節：搜尋框鍵盤、分類膠囊（roving、scroll-spy、跳轉）、Banner、收藏
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { MenuPage } from '../MenuPage';
import { LUROU, LUROU_DETAIL, detailOf, fakeApi, menuOf, product } from './fixtures';
import { LocationProbe, loginAsMember, resetStores } from './helpers';

const PORK = product({ id: 'prd_pork', name: '古早味排骨飯', basePrice: 110, displayPrice: 110 });
const TEA = product({
  id: 'prd_tea',
  name: '古早味紅茶',
  categoryId: 'cat_drink',
  basePrice: 25,
  displayPrice: 25,
});
const SOUP = product({
  id: 'prd_soup',
  name: '貢丸湯',
  categoryId: 'cat_soup',
  basePrice: 30,
  displayPrice: 30,
});

const MENU = menuOf(
  { id: 'cat_rice', name: '飯類', products: [LUROU, PORK] },
  { id: 'cat_drink', name: '飲品', products: [TEA] },
  { id: 'cat_soup', name: '湯品', products: [SOUP] },
);

function renderMenu(options: Parameters<typeof fakeApi>[0] = {}, route = '/') {
  const api = fakeApi({
    menu: MENU,
    details: [LUROU_DETAIL, detailOf(PORK), detailOf(TEA), detailOf(SOUP)],
    ...options,
  });
  return renderWithProviders(
    <>
      <LocationProbe />
      <MenuPage />
    </>,
    { api, route },
  );
}

beforeEach(() => {
  resetStores();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('搜尋框鍵盤', () => {
  it('↓ 或 Enter 把焦點移到第一個結果商品卡；Esc 清除文字並失焦', async () => {
    const user = userEvent.setup();
    const { container } = renderMenu();
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    const box = screen.getByRole('searchbox', { name: '搜尋菜單' });
    await user.type(box, '紅茶');
    // ↓：立即套用輸入並聚焦第一張卡
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(container.querySelector('[data-product-card]')).toHaveFocus());
    expect(container.querySelector('[data-product-card]')).toHaveAttribute(
      'data-product-card',
      'prd_tea',
    );

    await user.click(box);
    await user.keyboard('{Escape}');
    expect(box).toHaveValue('');
    expect(box).not.toHaveFocus();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
  });

  it('輸入穩定 250ms 後才寫入網址（不是每個字元）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderMenu();
      await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
      const box = screen.getByRole('searchbox', { name: '搜尋菜單' });
      fireEvent.change(box, { target: { value: '湯' } });
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(260);
      });
      expect(decodeURIComponent(screen.getByTestId('location').textContent ?? '')).toContain(
        'q=湯',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('分類膠囊列', () => {
  it('方向鍵 / Home / End 移動焦點（roving tabindex，整列一個 Tab 停點）', async () => {
    const user = userEvent.setup();
    renderMenu();
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    const nav = screen.getByRole('navigation', { name: '菜單分類' });
    const chips = within(nav).getAllByRole('button');
    expect(chips.filter((c) => c.getAttribute('tabindex') === '0')).toHaveLength(1);

    act(() => chips[0]?.focus());
    await user.keyboard('{ArrowRight}');
    expect(chips[1]).toHaveFocus();
    expect(chips[1]).toHaveAttribute('tabindex', '0');
    await user.keyboard('{End}');
    expect(chips[chips.length - 1]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(chips[0]).toHaveFocus();
  });

  it('點選分類：平滑捲動到該區並同步強調；點「全部」回到頁首', async () => {
    const user = userEvent.setup();
    renderMenu();
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    const nav = screen.getByRole('navigation', { name: '菜單分類' });
    await user.click(within(nav).getByRole('button', { name: '湯品，1 項' }));
    expect(within(nav).getByRole('button', { name: '湯品，1 項' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'start' }),
    );
    await user.click(within(nav).getByRole('button', { name: '全部，4 項' }));
    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
  });

  it('捲動時 scroll-spy 依可見區塊同步強調', async () => {
    type Entry = { target: Element; isIntersecting: boolean };
    let callback: ((entries: Entry[]) => void) | null = null;
    class FakeObserver {
      constructor(cb: (entries: Entry[]) => void) {
        callback = cb;
      }
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 600 });
    const { container } = renderMenu();
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    const drink = container.querySelector('[data-section-id="cat_drink"]') as Element;
    act(() => {
      callback?.([{ target: drink, isIntersecting: true }]);
    });
    const nav = screen.getByRole('navigation', { name: '菜單分類' });
    await waitFor(() =>
      expect(within(nav).getByRole('button', { name: '飲品，1 項' })).toHaveAttribute(
        'aria-current',
        'true',
      ),
    );
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });
});

describe('Banner', () => {
  it('連結商品：點擊開啟商品面板；有多則時可手動切換（不自動輪播）', async () => {
    const user = userEvent.setup();
    renderMenu({
      banners: [
        {
          id: 'b1',
          title: '招牌滷肉飯限時優惠',
          imageUrl: '/b1.svg',
          linkType: 'PRODUCT',
          linkValue: 'prd_lurou',
        },
        { id: 'b2', title: '週日公休', imageUrl: '/b2.svg', linkType: 'NONE' },
      ],
    });
    const region = await screen.findByRole('region', { name: '最新消息' });
    expect(within(region).getByText('1 / 2')).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: '下一則' }));
    expect(within(region).getByText('2 / 2')).toBeInTheDocument();
    expect(within(region).getByRole('img', { name: '週日公休' })).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: '上一則' }));
    await user.click(within(region).getByRole('button', { name: /招牌滷肉飯限時優惠/ }));
    expect(await screen.findByRole('dialog', { name: '招牌滷肉飯' })).toBeInTheDocument();
  });

  it('圖片載入失敗：退為純文字卡，不出現破圖', async () => {
    renderMenu({
      banners: [{ id: 'b1', title: '新品上市', imageUrl: '/missing.svg', linkType: 'NONE' }],
    });
    const region = await screen.findByRole('region', { name: '最新消息' });
    fireEvent.error(within(region).getByRole('img', { name: '新品上市' }));
    await waitFor(() => expect(within(region).queryByRole('img')).toBeNull());
    expect(within(region).getByText('新品上市')).toBeInTheDocument();
  });
});

describe('收藏（僅會員）', () => {
  it('會員：商品卡有收藏心形，點擊樂觀更新並呼叫 API；失敗時回復並說明', async () => {
    const user = userEvent.setup();
    loginAsMember();
    const add = vi.fn(async (id: string) => {
      void id;
    });
    const api = fakeApi({
      menu: MENU,
      details: [LUROU_DETAIL, detailOf(PORK), detailOf(TEA), detailOf(SOUP)],
      favoriteAdd: add,
    });
    renderWithProviders(<MenuPage />, { api });
    const heart = await screen.findByRole('button', { name: '收藏 古早味排骨飯' });
    expect(heart).toHaveAttribute('aria-pressed', 'false');
    await user.click(heart);
    await waitFor(() => expect(add).toHaveBeenCalledWith('prd_pork'));
    expect(await screen.findByRole('button', { name: '取消收藏 古早味排骨飯' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    add.mockRejectedValueOnce(new Error('x'));
    await user.click(screen.getByRole('button', { name: '收藏 古早味紅茶' }));
    expect(await screen.findByText('收藏失敗，請稍後再試')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '收藏 古早味紅茶' })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );
  });

  it('訪客：商品卡沒有收藏心形（不阻擋任何點餐動作，BR-33）', async () => {
    renderMenu();
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    expect(screen.queryByRole('button', { name: /^收藏 / })).toBeNull();
  });
});
