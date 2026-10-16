// PG-01 菜單首頁：分類、商品卡降級（BR-30 / BR-31、03 §6.7）、快速加入、數量上限與原因、售完、營業狀態、
// 搜尋、點餐記憶（再點 / 常點）、返回鍵關閉商品面板
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClock, systemClock } from '@/services/clock';
import { appSessionStorage, STORAGE_KEYS } from '@/services/storage/appStorage';
import { useCartStore } from '@/features/cart/cartStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { LiveAnnouncer, resetAnnouncer } from '@/features/a11y';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { MenuPage } from '../MenuPage';
import {
  CLOSED_STATUS,
  LUROU,
  LUROU_DETAIL,
  PAUSED_STATUS,
  SIZE_GROUP,
  TOPPING_GROUP,
  detailOf,
  fakeApi,
  menuOf,
  product,
  storeInfo,
} from './fixtures';
import { LocationProbe, loginAsMember, resetStores } from './helpers';

const PORK = product({
  id: 'prd_pork',
  name: '古早味排骨飯',
  basePrice: 110,
  displayPrice: 110,
  description: '酥脆排骨配滷汁',
});
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
const MINIMAL = product({ id: 'prd_min', name: '愛玉檸檬', basePrice: 45, displayPrice: 45 });

const FULL_MENU = menuOf(
  { id: 'cat_rice', name: '飯類', icon: '🍚', products: [LUROU, PORK, KONG] },
  { id: 'cat_drink', name: '飲品', icon: '🥤', products: [TEA] },
);

function renderMenu(
  options: Parameters<typeof fakeApi>[0] = {},
  props: Parameters<typeof MenuPage>[0] = {},
  route = '/',
) {
  const api = fakeApi({
    menu: FULL_MENU,
    details: [LUROU_DETAIL, detailOf(PORK), detailOf(TEA)],
    ...options,
  });
  return renderWithProviders(
    <>
      <LocationProbe />
      <MenuPage {...props} />
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
  vi.restoreAllMocks();
  setClock(systemClock);
});

describe('首次載入：整頁骨架一次換成內容（避免版面位移，NFR-03 CLS）', () => {
  it('店家資訊 / 營業狀態 / Banner / 菜單都回來之前只顯示骨架，不逐塊出現；回來後一起顯示', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = fakeApi({
      menu: FULL_MENU,
      info: storeInfo({ announcement: '本週日公休，歡迎提前預約' }),
    });
    const slowMenu = createFakeApi({
      store: {
        getInfo: (...a: []) => base.store.getInfo(...a),
        getStatus: (...a: []) => base.store.getStatus(...a),
        getBanners: (...a: []) => base.store.getBanners(...a),
        getProduct: (id: string) => base.store.getProduct(id),
        getMenu: async () => {
          await gate;
          return FULL_MENU;
        },
      },
    });
    renderWithProviders(<MenuPage />, { api: slowMenu });

    // 其他三個查詢早就回來了，但菜單還沒：不能先冒出公告、店家資訊列或搜尋框
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole('status', { busy: true })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '店家公告' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '店家資訊' })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();

    release?.();
    expect(await screen.findByRole('region', { name: '店家公告' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '店家資訊' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '招牌滷肉飯' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { busy: true })).not.toBeInTheDocument();
  });

  it('單向切換：內容出現後即使又重新取資料，也不會退回骨架', async () => {
    const { queryClient } = renderMenu();
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    expect(screen.queryByRole('status', { busy: true })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '招牌滷肉飯' })).toBeInTheDocument();
  });

  it('店家公告顯示在首頁，可關閉（當日不再顯示）', async () => {
    const user = userEvent.setup();
    renderMenu({ info: storeInfo({ announcement: '本週日公休，歡迎提前預約' }) });
    const region = await screen.findByRole('region', { name: '店家公告' });
    expect(within(region).getByText('本週日公休，歡迎提前預約')).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: '關閉公告' }));
    expect(screen.queryByRole('region', { name: '店家公告' })).not.toBeInTheDocument();
    expect(usePrefsStore.getState().dismissedAnnouncement).not.toBeNull();
  });
});

describe('版面與資料降級', () => {
  it('以分類顯示商品，膠囊列名稱含數量並標示目前所在分類', async () => {
    renderMenu();
    expect(
      await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' }),
    ).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: '菜單分類' });
    expect(within(nav).getByRole('button', { name: '全部，4 項' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(nav).getByRole('button', { name: '飯類，3 項' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: '熱銷，1 項' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '飯類' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '飲品' })).toBeInTheDocument();
  });

  it('有圖的商品顯示圖片、價格顯示「起」與標籤', async () => {
    const { container } = renderMenu({}, {});
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    const card = container.querySelector('[data-product-card="prd_lurou"]') as HTMLElement;
    expect(within(card).getByRole('img', { name: '招牌滷肉飯' })).toBeInTheDocument();
    expect(within(card).getByText('起')).toBeInTheDocument();
    expect(within(card).getByText('熱銷')).toBeInTheDocument();
    expect(within(card).getByText('古早味滷肉燥，肥瘦比例剛剛好')).toBeInTheDocument();
  });

  it('圖卡版面：沒有圖片的商品以佔位圖塊維持節奏，不輸出 <img>', async () => {
    usePrefsStore.setState({ menuLayoutOverride: 'GRID' });
    const { container } = renderMenu({
      menu: menuOf({ id: 'cat_dessert', name: '甜點', icon: '🍮', products: [MINIMAL] }),
      details: [detailOf(MINIMAL)],
    });
    await screen.findByRole('heading', { level: 3, name: '愛玉檸檬' });
    const card = container.querySelector('[data-product-card="prd_min"]') as HTMLElement;
    expect(card.querySelector('img')).toBeNull();
    const placeholder = card.querySelector('[data-placeholder]');
    expect(placeholder).not.toBeNull();
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    // 分類圖示作為佔位內容
    expect(placeholder).toHaveTextContent('🍮');
    expect(within(card).getByRole('button', { name: '加入 愛玉檸檬' })).toBeInTheDocument();
  });

  it('清單版面：沒有圖片的商品不顯示縮圖，缺描述 / 標籤時不留空白行', async () => {
    usePrefsStore.setState({ menuLayoutOverride: 'LIST' });
    const { container } = renderMenu({
      menu: menuOf({ id: 'cat_dessert', name: '甜點', icon: '🍮', products: [MINIMAL] }),
      details: [detailOf(MINIMAL)],
    });
    await screen.findByRole('heading', { level: 3, name: '愛玉檸檬' });
    const card = container.querySelector('[data-product-card="prd_min"]') as HTMLElement;
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('[data-placeholder]')).toBeNull();
    // 只有品名、價格與「＋ 加入」
    expect(card.querySelectorAll('p')).toHaveLength(0);
    expect(within(card).getByText('NT$ 45')).toBeInTheDocument();
  });

  it('圖片載入失敗時退為佔位圖塊，不顯示破圖', async () => {
    usePrefsStore.setState({ menuLayoutOverride: 'GRID' });
    const { container } = renderMenu();
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    const card = container.querySelector('[data-product-card="prd_lurou"]') as HTMLElement;
    const img = card.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);
    await waitFor(() => expect(card.querySelector('img')).toBeNull());
    expect(card.querySelector('[data-placeholder]')).not.toBeNull();
  });

  it('版面切換：寫入使用者偏好並覆寫店家設定（BR-31）', async () => {
    const user = userEvent.setup();
    renderMenu({ info: storeInfo({ display: { brandColor: null, menuLayout: 'GRID' } }) });
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    expect(screen.getByRole('radio', { name: '圖卡' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: '清單' }));
    expect(usePrefsStore.getState().menuLayoutOverride).toBe('LIST');
    expect(screen.getByRole('radio', { name: '清單' })).toBeChecked();
  });

  it('載入失敗顯示區塊錯誤與重試', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const api = fakeApi({ menu: FULL_MENU });
    const flaky = {
      ...api,
      store: {
        ...api.store,
        getMenu: async () => {
          calls += 1;
          if (calls === 1) throw Object.assign(new Error('x'), { code: 'INTERNAL_ERROR' });
          return FULL_MENU;
        },
      },
    } as typeof api;
    renderWithProviders(<MenuPage />, { api: flaky });
    expect(await screen.findByText('菜單暫時無法載入')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重試' }));
    expect(
      await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' }),
    ).toBeInTheDocument();
  });
});

describe('快速加入與數量上限', () => {
  it('無必選選項的商品：「加入」直接以數量 1、無選項加入，顯示 Toast（含復原）並變為步進器', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(await screen.findByRole('button', { name: '加入 古早味排骨飯' }));

    const [line] = useCartStore.getState().lines;
    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(line).toMatchObject({ productId: 'prd_pork', quantity: 1, optionIds: [] });
    expect(line?.snapshot).toMatchObject({
      name: '古早味排骨飯',
      unitPrice: 110,
      optionLabels: [],
    });
    // 不開啟面板
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);

    expect(await screen.findByText('已加入購物車')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: '古早味排骨飯 數量' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
    // aria-live 播報完整句
    await waitFor(() =>
      expect(document.querySelector('[data-zo-live-announcer]')).toHaveTextContent(
        '已加入購物車：古早味排骨飯，目前 1 項，共 NT$ 110',
      ),
    );
  });

  it('「復原」將本次加入的數量扣回，歸零則移除該行', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(await screen.findByRole('button', { name: '加入 古早味排骨飯' }));
    await user.click(await screen.findByRole('button', { name: '復原' }));
    expect(useCartStore.getState().lines).toHaveLength(0);
    // 回到「＋ 加入」
    expect(await screen.findByRole('button', { name: '加入 古早味排骨飯' })).toBeInTheDocument();
  });

  it('卡片步進器：＋ 增加、− 於 1 份時移除並還原為「＋ 加入」', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(await screen.findByRole('button', { name: '加入 古早味排骨飯' }));
    await user.click(screen.getByRole('button', { name: '增加一份 古早味排骨飯' }));
    expect(useCartStore.getState().lines[0]?.quantity).toBe(2);
    expect(screen.getByRole('spinbutton', { name: '古早味排骨飯 數量' })).toHaveAttribute(
      'aria-valuenow',
      '2',
    );
    await user.click(screen.getByRole('button', { name: '減少一份 古早味排骨飯' }));
    expect(useCartStore.getState().lines[0]?.quantity).toBe(1);
    await user.click(screen.getByRole('button', { name: '移除 古早味排骨飯' }));
    expect(useCartStore.getState().lines).toHaveLength(0);
    expect(await screen.findByRole('button', { name: '加入 古早味排骨飯' })).toBeInTheDocument();
  });

  it('焦點管理：「＋ 加入」變為步進器時焦點留在新出現的「＋」；移除後回到「＋ 加入」', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(await screen.findByRole('button', { name: '加入 古早味排骨飯' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '增加一份 古早味排骨飯' })).toHaveFocus(),
    );
    await user.click(screen.getByRole('button', { name: '移除 古早味排骨飯' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '加入 古早味排骨飯' })).toHaveFocus(),
    );
  });

  it('商品卡以價格與描述作為 aria-describedby，關聯的節點存在', async () => {
    const { container } = renderMenu();
    await screen.findByRole('heading', { level: 3, name: '古早味排骨飯' });
    const card = container.querySelector('[data-product-card="prd_pork"]') as HTMLElement;
    const ids = (card.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(2);
    const texts = ids.map((id) => document.getElementById(id)?.textContent);
    expect(texts[0]).toContain('NT$ 110');
    expect(texts[1]).toBe('酥脆排骨配滷汁');
  });

  it('含必選選項的商品：「加入」開啟商品面板，不直接加入', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(await screen.findByRole('button', { name: '加入 招牌滷肉飯' }));
    expect(await screen.findByRole('dialog', { name: '招牌滷肉飯' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('?product=prd_lurou');
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it('限量：步進器依剩餘份數封頂，達上限停用「＋」並說明「今日只剩 n 份，已達上限」', async () => {
    const user = userEvent.setup();
    const limited = product({
      id: 'prd_share',
      name: '雙人分享餐',
      basePrice: 299,
      displayPrice: 299,
      remainingToday: 2,
    });
    renderMenu({
      menu: menuOf({ id: 'cat_combo', name: '套餐', products: [limited] }),
      details: [detailOf(limited)],
    });
    expect(await screen.findByText('剩 2 份')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '加入 雙人分享餐' }));
    const plus = screen.getByRole('button', { name: '增加一份 雙人分享餐' });
    expect(plus).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(plus);
    expect(useCartStore.getState().lines[0]?.quantity).toBe(2);

    const atMax = screen.getByRole('button', { name: '增加一份 雙人分享餐' });
    expect(atMax).toHaveAttribute('aria-disabled', 'true');
    const reason = screen.getByText('今日只剩 2 份，已達上限');
    expect(atMax).toHaveAttribute('aria-describedby', reason.id);
    await user.click(atMax);
    expect(useCartStore.getState().lines[0]?.quantity).toBe(2);
  });

  it('單行 20 份上限與「剩餘份數上限」使用不同說明', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(await screen.findByRole('button', { name: '加入 古早味排骨飯' }));
    const lineId = useCartStore.getState().lines[0]?.lineId as string;
    useCartStore.getState().setQuantity(lineId, 20);
    const plus = await screen.findByRole('button', { name: '增加一份 古早味排骨飯' });
    await waitFor(() => expect(plus).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByText('此品項已達上限 20 份')).toBeInTheDocument();
  });

  it('品項行數已達 30 行：不加入並說明', async () => {
    const user = userEvent.setup();
    renderMenu();
    for (let i = 0; i < 30; i += 1) {
      useCartStore.getState().addLine({
        productId: `other_${i}`,
        quantity: 1,
        optionIds: [],
        snapshot: { name: `品項${i}`, unitPrice: 10, optionLabels: [] },
      });
    }
    await user.click(await screen.findByRole('button', { name: '加入 古早味排骨飯' }));
    expect(useCartStore.getState().lines).toHaveLength(30);
    expect(await screen.findByText('購物車最多 30 項品項，請移除部分品項')).toBeInTheDocument();
  });
});

describe('售完與營業狀態', () => {
  it('售完商品：顯示「今日售完」，動作鈕以 aria-disabled 停用且不可加入', async () => {
    const user = userEvent.setup();
    const { container } = renderMenu();
    await screen.findByRole('heading', { level: 3, name: '控肉飯' });
    const card = container.querySelector('[data-product-card="prd_kong"]') as HTMLElement;
    expect(within(card).getByText('今日售完')).toBeInTheDocument();
    const sold = within(card).getByRole('button', { name: '控肉飯 今日售完' });
    expect(sold).toHaveAttribute('aria-disabled', 'true');
    await user.click(sold);
    expect(useCartStore.getState().lines).toHaveLength(0);
    // 仍可開啟面板瀏覽（唯讀）
    await user.click(within(card).getByRole('button', { name: '控肉飯' }));
    expect(await screen.findByRole('dialog', { name: '控肉飯' })).toBeInTheDocument();
  });

  it('休息中：營業狀態標籤與店家資訊列的「可預約取餐」提示，仍可瀏覽並加入購物車以預約（03 PG-01）', async () => {
    const user = userEvent.setup();
    setClock({ now: () => new Date('2026-10-14T15:00:00+08:00') });
    renderMenu({ status: CLOSED_STATUS });
    // 不再另外插入一條提示列（會在資料回來時把整頁往下推），改為資訊列內的短提示 + 狀態標籤
    expect(await screen.findByText('可預約取餐')).toBeInTheDocument();
    expect(screen.queryByText('目前休息中，可預約 17:00 後取餐')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '加入 古早味排骨飯' }));
    expect(useCartStore.getState().lines).toHaveLength(1);
  });

  it('blockAddWhen：指定狀態下「加入」停用並說明原因', async () => {
    const user = userEvent.setup();
    renderMenu({ status: PAUSED_STATUS }, { blockAddWhen: ['PAUSED'] });
    const add = await screen.findByRole('button', { name: '加入 古早味排骨飯' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    const description = add.getAttribute('aria-describedby');
    expect(description).not.toBeNull();
    expect(document.getElementById(description as string)).toHaveTextContent(
      '店家目前較忙，暫停接單。可稍後再試或直接來電',
    );
    await user.click(add);
    expect(useCartStore.getState().lines).toHaveLength(0);
  });
});

describe('搜尋（?q=）', () => {
  it('以品名與簡述篩選，扁平清單並標示所屬分類', async () => {
    renderMenu({}, {}, '/?q=酥脆');
    expect(await screen.findByRole('heading', { level: 2, name: '搜尋結果' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '古早味排骨飯' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: '招牌滷肉飯' })).toBeNull();
    // 扁平清單：卡片標示所屬分類
    const card = document.querySelector('[data-product-card="prd_pork"]') as HTMLElement;
    expect(within(card).getByText('飯類')).toBeInTheDocument();
  });

  it('無結果：EmptyState 與「清除搜尋」', async () => {
    const user = userEvent.setup();
    renderMenu({}, {}, '/?q=不存在');
    expect(await screen.findByText('找不到「不存在」')).toBeInTheDocument();
    const empty = screen.getByText('試試其他關鍵字，或清除搜尋').parentElement as HTMLElement;
    await user.click(within(empty).getByRole('button', { name: '清除搜尋' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
    expect(
      await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' }),
    ).toBeInTheDocument();
  });

  it('輸入後 250ms 寫入網址（replace），搜尋框與網址一致', async () => {
    const user = userEvent.setup();
    renderMenu();
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    const box = screen.getByRole('searchbox', { name: '搜尋菜單' });
    await user.type(box, '紅茶');
    await waitFor(() =>
      expect(decodeURIComponent(screen.getByTestId('location').textContent ?? '')).toContain(
        'q=紅茶',
      ),
    );
    expect(
      await screen.findByRole('heading', { level: 3, name: '古早味紅茶' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: '招牌滷肉飯' })).toBeNull();
  });
});

describe('點餐記憶：再點與常點（BR-35、FLOW-20）', () => {
  const remember = (optionIds: string[], labels: string[], note?: string) =>
    usePrefsStore.setState({
      lastChoices: {
        prd_lurou: {
          productId: 'prd_lurou',
          optionIds,
          labels,
          ...(note !== undefined ? { note } : {}),
          at: Date.now(),
        },
      },
    });

  it('有選項記憶的商品卡顯示「上次：…」、「↻ 再點」與調整用的「＋」', async () => {
    remember(['opt_l', 'opt_egg'], ['大碗', '滷蛋']);
    const { container } = renderMenu();
    await screen.findByRole('region', { name: '常點的餐點' });
    const card = container.querySelector('[data-product-card="prd_lurou"]') as HTMLElement;
    expect(within(card).getByText('上次：大碗・滷蛋')).toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: '再點 招牌滷肉飯，上次：大碗・滷蛋' }),
    ).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '調整選項：招牌滷肉飯' })).toBeInTheDocument();
  });

  it('「再點」：記憶全數有效時不開面板，直接以記憶的選項與備註加入 1 份並通報', async () => {
    const user = userEvent.setup();
    remember(['opt_l', 'opt_egg'], ['大碗', '滷蛋'], '不要蔥');
    const { container } = renderMenu();
    await screen.findByRole('region', { name: '常點的餐點' });
    const card = container.querySelector('[data-product-card="prd_lurou"]') as HTMLElement;
    await user.click(
      within(card).getByRole('button', { name: '再點 招牌滷肉飯，上次：大碗・滷蛋' }),
    );
    await waitFor(() => expect(useCartStore.getState().lines).toHaveLength(1));
    const line = useCartStore.getState().lines[0];
    expect(line).toMatchObject({
      productId: 'prd_lurou',
      quantity: 1,
      optionIds: ['opt_l', 'opt_egg'],
      note: '不要蔥',
    });
    expect(line?.snapshot).toMatchObject({ unitPrice: 67, optionLabels: ['大碗', '滷蛋'] });
    expect(screen.queryByRole('dialog')).toBeNull();
    // 同一句話有兩份：提示（Toast）與 aria-live 播報。各自確認；不能用 screen.findByText，
    // 兩份同時在畫面上時它會因「找到多個元素」而失敗（負載高、播報較早出現時）
    const sentence = '已再點：招牌滷肉飯（大碗・滷蛋）NT$ 67，目前 1 項，共 NT$ 67';
    const toastViewport = document.querySelector<HTMLElement>('[data-zo-toast-viewport]');
    expect(toastViewport).not.toBeNull();
    expect(await within(toastViewport as HTMLElement).findByText(sentence)).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelector('[data-zo-live-announcer]')).toHaveTextContent(sentence),
    );
  });

  it('記憶的選項已失效：不一鍵加入，改開面板並提示「部分選項已不提供」', async () => {
    const user = userEvent.setup();
    remember(['opt_l', 'opt_egg'], ['大碗', '滷蛋']);
    const stale = detailOf(LUROU, [
      SIZE_GROUP,
      {
        ...TOPPING_GROUP,
        options: TOPPING_GROUP.options.map((o) =>
          o.id === 'opt_egg' ? { ...o, isAvailable: false } : o,
        ),
      },
    ]);
    const { container } = renderMenu({ details: [stale, detailOf(PORK), detailOf(TEA)] });
    await screen.findByRole('region', { name: '常點的餐點' });
    const card = container.querySelector('[data-product-card="prd_lurou"]') as HTMLElement;
    await user.click(
      within(card).getByRole('button', { name: '再點 招牌滷肉飯，上次：大碗・滷蛋' }),
    );
    expect(await screen.findByRole('dialog', { name: '招牌滷肉飯' })).toBeInTheDocument();
    expect(await screen.findByText('部分選項已不提供，已改用預設')).toBeInTheDocument();
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it('取得商品詳情失敗：不加入，說明「暫時無法再點，請稍後再試」', async () => {
    const user = userEvent.setup();
    remember(['opt_l'], ['大碗']);
    const { container } = renderMenu({ details: [] });
    await screen.findByRole('region', { name: '常點的餐點' });
    const card = container.querySelector('[data-product-card="prd_lurou"]') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: '再點 招牌滷肉飯，上次：大碗' }));
    expect(await screen.findByText('暫時無法再點，請稍後再試')).toBeInTheDocument();
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it('「常點的餐點」：列出菜單內仍存在的記憶商品，含無選項商品；現價為選項加價後的金額', async () => {
    usePrefsStore.setState({
      lastChoices: {
        prd_lurou: {
          productId: 'prd_lurou',
          optionIds: ['opt_l', 'opt_egg'],
          labels: ['大碗', '滷蛋'],
          at: Date.now(),
        },
        prd_tea: { productId: 'prd_tea', optionIds: [], labels: [], at: Date.now() - 1000 },
        prd_gone: { productId: 'prd_gone', optionIds: [], labels: [], at: Date.now() - 2000 },
      },
    });
    renderMenu();
    const section = await screen.findByRole('region', { name: '常點的餐點' });
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByText('大碗・滷蛋')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(items[0] as HTMLElement).getByText('NT$ 67')).toBeInTheDocument(),
    );
    expect(within(items[1] as HTMLElement).getByText('古早味紅茶')).toBeInTheDocument();
  });

  it('關閉點餐記憶（rememberChoices = false）：不顯示「上次」與「常點」', async () => {
    remember(['opt_l'], ['大碗']);
    usePrefsStore.setState({ rememberChoices: false });
    renderMenu();
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    expect(screen.queryByText(/上次：/)).toBeNull();
    expect(screen.queryByText('常點的餐點')).toBeNull();
  });

  it('觸控面板模式：不顯示點餐記憶', async () => {
    remember(['opt_l'], ['大碗']);
    useInputModeStore.setState({ inputMode: 'KIOSK' });
    renderMenu();
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    expect(screen.queryByText(/上次：/)).toBeNull();
    expect(screen.queryByText('常點的餐點')).toBeNull();
  });

  it('會員：伺服器常點與本機記憶在記憶體合併，較新者優先', async () => {
    loginAsMember();
    remember(['opt_s'], ['小碗']); // 本機：小碗（現在）
    renderMenu({
      frequent: [
        {
          productId: 'prd_lurou',
          optionIds: ['opt_l', 'opt_egg'],
          optionLabels: ['大碗', '滷蛋'],
          lastOrderedAt: new Date(Date.now() + 60_000).toISOString(),
          orderCount: 3,
        },
      ],
    });
    expect(await screen.findByText('上次：大碗・滷蛋')).toBeInTheDocument();
    // 不寫回本機偏好
    expect(usePrefsStore.getState().lastChoices.prd_lurou?.labels).toEqual(['小碗']);
  });
});

describe('商品面板與返回鍵（FR-PD-01）', () => {
  it('實體返回鍵優先關閉面板而不離開菜單頁；焦點還給觸發的商品卡', async () => {
    const user = userEvent.setup();
    const { container } = renderMenu();
    await user.click(await screen.findByRole('button', { name: '加入 招牌滷肉飯' }));
    expect(await screen.findByRole('dialog', { name: '招牌滷肉飯' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/?product=prd_lurou');

    // 面板開啟時背景為 aria-hidden 且 pointer-events: none：以 fireEvent 模擬實體返回鍵
    fireEvent.click(screen.getByRole('button', { name: '測試返回鍵', hidden: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    const card = container.querySelector('[data-product-card="prd_lurou"]') as HTMLElement;
    await waitFor(() => expect(card).toHaveFocus());
  });

  it('直接開啟 ?product= 網址：顯示面板；關閉後移除參數', async () => {
    const user = userEvent.setup();
    renderMenu({}, {}, '/?product=prd_lurou');
    expect(await screen.findByRole('dialog', { name: '招牌滷肉飯' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '關閉' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  });
});

describe('浮動購物車列與訂單面板', () => {
  it('購物車為空時不顯示 CartBar；有品項後顯示品項數與小計，連到購物車', async () => {
    const user = userEvent.setup();
    renderMenu();
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    expect(screen.queryByRole('link', { name: /查看購物車/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: '加入 古早味排骨飯' }));
    const bar = await screen.findByRole('link', { name: /查看購物車/ });
    expect(bar).toHaveTextContent('1 項');
    expect(bar).toHaveTextContent('NT$ 110');
    expect(bar).toHaveAttribute('href', '/cart');
  });
});

describe('QR 桌號（?table=，03 PG-01、FR-CK-05）', () => {
  beforeEach(() => appSessionStorage.removeItem(STORAGE_KEYS.table));
  afterEach(() => appSessionStorage.removeItem(STORAGE_KEYS.table));

  it('桌號有效：頂部顯示「內用・桌號 A3」與說明，購物車取餐方式固定為內用（不寫入偏好）', async () => {
    const resolveTable = vi.fn(async () => ({ tableNo: 'A3', seats: 4 }));
    renderMenu({ resolveTable }, {}, '/?table=A3');
    const strip = await screen.findByRole('region', { name: '內用桌號' });
    expect(await within(strip).findByText('內用・桌號 A3')).toBeInTheDocument();
    expect(within(strip).getByText('取餐方式已固定為內用，結帳時不需再輸入桌號')).toBeVisible();
    expect(resolveTable).toHaveBeenCalledWith('A3');
    await waitFor(() => expect(useCartStore.getState().orderType).toBe('DINE_IN'));
    expect(usePrefsStore.getState().lastOrderType).toBeNull();
  });

  it('確認中：先顯示同高度的「正在確認桌號…」，不位移版面', async () => {
    let release: (v: { tableNo: string }) => void = () => undefined;
    const resolveTable = vi.fn(
      () => new Promise<{ tableNo: string }>((resolve) => (release = resolve)),
    );
    renderMenu({ resolveTable }, {}, '/?table=A3');
    const strip = await screen.findByRole('region', { name: '內用桌號' });
    expect(strip).toHaveAttribute('aria-busy', 'true');
    expect(within(strip).getByText('正在確認桌號…')).toBeInTheDocument();
    // 尚未確認前不改動購物車的取餐方式
    expect(useCartStore.getState().orderType).toBe('PICKUP');
    release({ tableNo: 'A3' });
    expect(await within(strip).findByText('內用・桌號 A3')).toBeInTheDocument();
  });

  it('站內導覽不帶 ?table=：沿用本分頁記下的桌位權杖', async () => {
    appSessionStorage.setItem(STORAGE_KEYS.table, 'A5');
    const resolveTable = vi.fn(async () => ({ tableNo: 'A5' }));
    renderMenu({ resolveTable }, {}, '/');
    expect(await screen.findByText('內用・桌號 A5')).toBeInTheDocument();
    expect(resolveTable).toHaveBeenCalledWith('A5');
  });

  it('桌號無法辨識：提示並維持一般取餐方式，不鎖定', async () => {
    const resolveTable = vi.fn(async () => {
      throw Object.assign(new Error('找不到桌號'), { code: 'TABLE_NOT_FOUND' });
    });
    renderMenu({ resolveTable }, {}, '/?table=Z9');
    expect(await screen.findByText(/找不到 QR 帶入的桌號，已改為一般點餐/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '內用桌號' })).toBeNull();
    expect(useCartStore.getState().orderType).toBe('PICKUP');
  });

  it('桌號有效但店家未開放內用：說明已改為一般點餐，不鎖定', async () => {
    const resolveTable = vi.fn(async () => ({ tableNo: 'A3' }));
    renderMenu(
      {
        resolveTable,
        info: storeInfo({ services: { pickup: true, delivery: true, dineIn: false } }),
      },
      {},
      '/?table=A3',
    );
    expect(await screen.findByText('店家目前未開放內用，已改為一般點餐')).toBeInTheDocument();
    expect(screen.queryByText('內用・桌號 A3')).toBeNull();
    expect(useCartStore.getState().orderType).toBe('PICKUP');
  });

  it('沒有掃 QR：不顯示桌號區塊，也不查詢桌號', async () => {
    const resolveTable = vi.fn(async () => ({ tableNo: 'A3' }));
    renderMenu({ resolveTable });
    await screen.findByRole('heading', { level: 3, name: '招牌滷肉飯' });
    expect(screen.queryByRole('region', { name: '內用桌號' })).toBeNull();
    expect(resolveTable).not.toHaveBeenCalled();
  });
});
