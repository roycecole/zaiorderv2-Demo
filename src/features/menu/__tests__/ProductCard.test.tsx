// ProductCard 版面結構（03 §6.6、§6.7）：愛心在品名前、底列（價格靠左 + 動作靠右）、各變體結構不退化。
// 實際的幾何對齊（getBoundingClientRect）由 e2e/product-card-layout.spec.ts 驗證；這裡只驗 DOM 順序與結構。
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import type { RememberedChoice } from '@/domain/rememberedChoice';
import { ProductCard } from '../ProductCard';
import type { ProductCardProps } from '../ProductCard';
import { LUROU, product } from './fixtures';
import { resetStores } from './helpers';

const REMEMBERED: RememberedChoice = {
  productId: 'prd_lurou',
  optionIds: ['opt_l', 'opt_egg'],
  labels: ['大碗', '滷蛋'],
  at: 0,
};

// 有圖、有描述、熱銷標籤、必選選項（「＋ 加入」開面板）
const WITH_IMAGE = LUROU;
// 只有品名與價格（精簡）
const BARE = product({ id: 'prd_bare', name: '鮮肉餛飩湯', basePrice: 60, displayPrice: 60 });
// 無圖，但有描述與標籤
const NO_IMAGE = product({
  id: 'prd_noimg',
  name: '超值單人套餐',
  basePrice: 99,
  displayPrice: 99,
  description: '主餐、附湯與飲料一次搞定',
  tags: ['CHEF_PICK'],
});

function props(overrides: Partial<ProductCardProps> = {}): ProductCardProps {
  return {
    product: WITH_IMAGE,
    layout: 'LIST',
    cartQuantity: 0,
    quickQuantity: null,
    quickMax: 20,
    tabStop: true,
    roving: true,
    showHints: false,
    onOpen: vi.fn(),
    onQuickAdd: vi.fn(),
    onQuickChange: vi.fn(),
    onQuickRemove: vi.fn(),
    onRepeat: vi.fn(),
    onToggleFavorite: vi.fn(),
    ...overrides,
  };
}

function renderCard(overrides: Partial<ProductCardProps> = {}) {
  const p = props(overrides);
  const { container } = renderWithProviders(<ProductCard {...p} />);
  const card = container.querySelector('[data-product-card]') as HTMLElement;
  const part = (name: string): HTMLElement | null =>
    card.querySelector<HTMLElement>(`[data-card-part="${name}"]`);
  return { card, part, props: p };
}

/** a 在 b 之前（文件順序） */
function before(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

const FAVORITE = { active: false } as const;

beforeEach(() => {
  resetStores();
});

describe('LIST：兩欄 + 全寬底列', () => {
  it('結構：文字欄（品名列 / 描述）＋ 右側縮圖，其下是同一列的「價格 + 動作」底列', () => {
    const { card, part } = renderCard({ favorite: FAVORITE });
    const title = part('title') as HTMLElement;
    const thumb = part('thumb') as HTMLElement;
    const footer = part('footer') as HTMLElement;
    const price = part('price') as HTMLElement;
    const actions = part('actions') as HTMLElement;

    // 縮圖在文字欄之後（右欄），且與品名列同一個上方列容器；底列在該容器之後（縮圖下方）
    const row = thumb.parentElement as HTMLElement;
    expect(row.contains(title)).toBe(true);
    expect(row.contains(footer)).toBe(false);
    expect(before(title, thumb)).toBe(true);
    expect(before(row, footer)).toBe(true);
    expect(row.className).toContain('items-start');
    expect(thumb.className).toContain('shrink-0');
    expect(card.querySelector('img')).not.toBeNull();
    expect(thumb.contains(card.querySelector('img'))).toBe(true);

    // 價格與動作在同一個底列容器，價格在左（先）、動作在右（後）；底列不在縮圖欄裡
    expect(footer.contains(price)).toBe(true);
    expect(footer.contains(actions)).toBe(true);
    expect(before(price, actions)).toBe(true);
    expect(thumb.contains(footer)).toBe(false);
    expect(footer.className).toContain('justify-between');
    expect(footer.className).toContain('flex-wrap');
    // 動作群組靠右（換行後仍靠右），不被縮圖欄擠窄
    expect(actions.className).toContain('ml-auto');
    expect(actions.className).toContain('justify-end');
  });

  it('品名列：愛心在品名前，標籤在品名之後；愛心與標籤不在縮圖內', () => {
    const { card, part } = renderCard({ favorite: FAVORITE });
    const title = part('title') as HTMLElement;
    const favorite = part('favorite') as HTMLElement;
    const name = part('name') as HTMLElement;
    const hot = within(card).getByText('熱銷');

    expect(before(favorite, name)).toBe(true);
    expect(before(name, hot)).toBe(true);
    // 愛心與品名同一組（不會被標籤隔開換行），標籤是品名組之後的獨立項目
    const group = title.firstElementChild as HTMLElement;
    expect(group.contains(favorite)).toBe(true);
    expect(group.contains(name)).toBe(true);
    expect(group.contains(hot)).toBe(false);
    expect(part('thumb')?.contains(favorite)).toBe(false);
  });

  it('愛心：名稱含品名、aria-pressed 反映狀態、點擊只切換收藏不開啟面板', async () => {
    const user = userEvent.setup();
    const { card, props: p } = renderCard({ favorite: { active: true } });
    const heart = within(card).getByRole('button', { name: /招牌滷肉飯/, pressed: true });
    expect(heart).toHaveAttribute('data-card-part', 'favorite');
    await user.click(heart);
    expect(p.onToggleFavorite).toHaveBeenCalledWith(WITH_IMAGE);
    expect(p.onOpen).not.toHaveBeenCalled();
  });

  it('Tab / 閱讀順序：愛心 → 品名（開面板）→ 動作；品名按鈕仍是整卡的 stretched link', async () => {
    const user = userEvent.setup();
    const { card, props: p } = renderCard({ favorite: FAVORITE });
    const buttons = Array.from(card.querySelectorAll('button'));
    expect(buttons.map((b) => b.getAttribute('data-card-part') ?? b.textContent?.trim())).toEqual([
      'favorite',
      '招牌滷肉飯',
      '加入',
    ]);
    // 品名按鈕以偽元素覆蓋整張卡片
    expect(buttons[1]?.className).toContain('after:inset-0');
    await user.click(buttons[1] as HTMLButtonElement);
    expect(p.onOpen).toHaveBeenCalledTimes(1);
    expect(card).toHaveAttribute('aria-labelledby');
    expect(
      document.getElementById(card.getAttribute('aria-labelledby') as string),
    ).toHaveTextContent('招牌滷肉飯');
  });

  it('愛心熱區只向左與上下擴張，按鈕右側緊接品名、不重疊（點品名最左側是開面板，不是切換收藏）', () => {
    const { part } = renderCard({ favorite: FAVORITE });
    const heart = part('favorite') as HTMLElement;
    // 熱區偽元素與按鈕右緣齊（after:right-0），尺寸為 --hit-size（一般 44、觸控面板 56）
    expect(heart.className).toContain('after:right-0');
    expect(heart.className).toContain('after:w-(--hit-size)');
    expect(heart.className).toContain('after:h-(--hit-size)');
    // 以前的做法：四邊各擴 4px 並以 -mr-0.5 讓按鈕壓進品名，熱區因此蓋住品名最左側約 6px
    expect(heart.className).not.toContain('after:-inset-1');
    expect(heart.className).not.toMatch(/(^|\s)-mr-/);
  });

  it('品名最多 2 行：截行在按鈕內層的 span（block 的按鈕會覆寫 line-clamp 的 display）', () => {
    const { part } = renderCard();
    const button = (part('name') as HTMLElement).querySelector('button') as HTMLButtonElement;
    const span = button.querySelector('span') as HTMLSpanElement;
    expect(span).toHaveClass('line-clamp-2');
    expect(span).toHaveTextContent('招牌滷肉飯');
    // line-clamp 需要 display: -webkit-box；按鈕本身是 block，不能再放 line-clamp（會被覆寫而不截行）
    expect(button).toHaveClass('block');
    expect(button.className).not.toContain('line-clamp');
    // 整張卡片仍由品名按鈕的偽元素覆蓋（stretched link）
    expect(button.className).toContain('after:inset-0');
  });

  it('長品名：完整品名仍是可存取名稱與卡片名稱（截行只是視覺）', () => {
    const longName = '手工現做慢火燉煮招牌香濃紅燒牛肉麵加大加料特製豪華套餐組合附小菜與飲料任選';
    const { card, part } = renderCard({
      product: product({ id: 'prd_long', name: longName, basePrice: 180, displayPrice: 180 }),
      favorite: FAVORITE,
    });
    expect(within(card).getByRole('button', { name: longName })).toBe(
      (part('name') as HTMLElement).querySelector('button'),
    );
    expect(
      document.getElementById(card.getAttribute('aria-labelledby') as string),
    ).toHaveTextContent(longName);
    // 不另加 title（會與名稱重複朗讀）；完整名稱在商品面板與可存取名稱中
    expect((part('name') as HTMLElement).querySelector('[title]')).toBeNull();
  });

  it('沒有收藏功能（訪客 / 觸控面板）時不輸出愛心，品名直接是品名列的第一項', () => {
    const { card, part } = renderCard();
    expect(part('favorite')).toBeNull();
    expect(card.querySelector('[aria-pressed]')).toBeNull();
    const group = (part('title') as HTMLElement).firstElementChild as HTMLElement;
    expect(group.firstElementChild).toBe(part('name'));
  });

  it('缺圖：沒有縮圖欄，文字撐滿整列，底列規則不變', () => {
    const { card, part } = renderCard({ product: NO_IMAGE, favorite: FAVORITE });
    expect(part('thumb')).toBeNull();
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('[data-placeholder]')).toBeNull();
    expect(within(card).getByText('主餐、附湯與飲料一次搞定')).toBeInTheDocument();
    const footer = part('footer') as HTMLElement;
    expect(footer.contains(part('price'))).toBe(true);
    expect(footer.contains(part('actions'))).toBe(true);
  });

  it('精簡卡（無圖、無描述、無標籤）：兩列 — 「♥ 品名」與「價格 … 動作」，價格不在品名列', () => {
    const { card, part } = renderCard({ product: BARE, favorite: FAVORITE });
    expect(part('thumb')).toBeNull();
    expect(card.querySelectorAll('p')).toHaveLength(0);
    const title = part('title') as HTMLElement;
    const footer = part('footer') as HTMLElement;
    const price = part('price') as HTMLElement;
    const actions = part('actions') as HTMLElement;

    expect(title.contains(price)).toBe(false);
    expect(title.contains(actions)).toBe(false);
    expect(before(title, footer)).toBe(true);
    expect(footer.contains(price)).toBe(true);
    expect(footer.contains(actions)).toBe(true);
    expect(before(price, actions)).toBe(true);
    expect(before(part('favorite') as HTMLElement, part('name') as HTMLElement)).toBe(true);
    expect(price).toHaveTextContent('NT$ 60');
    expect(within(actions).getByRole('button', { name: '加入 鮮肉餛飩湯' })).toBeInTheDocument();
  });

  it('價格格與動作按鈕同高、垂直置中（價格不受動作群組的說明列影響）', () => {
    const { part } = renderCard({ product: BARE });
    const price = part('price') as HTMLElement;
    expect(price.className).toContain('min-h-9');
    expect(price.className).toContain('items-center');
    expect(price.className).toContain('kiosk:min-h-(--hit-size)');
    expect((part('footer') as HTMLElement).className).toContain('items-start');
  });
});

describe('LIST：各動作變體都在底列的動作群組內', () => {
  it('「＋ 加入」：有份數徽章（已在購物車）', () => {
    const { part } = renderCard({ product: NO_IMAGE, cartQuantity: 2 });
    const actions = part('actions') as HTMLElement;
    const add = within(actions).getByRole('button', { name: /^加入 超值單人套餐/ });
    expect(add).toHaveAttribute('data-card-add');
    expect(add).toHaveTextContent('2');
    // 徽章是裝飾（aria-hidden，份數已在按鈕名稱內）；版面量測以 data-card-part="badge" 定位
    const badge = add.querySelector('[data-card-part="badge"]') as HTMLElement;
    expect(badge).toHaveTextContent('2');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    // 「加入」文字的右內距比徽章的懸伸多留 2px，徽章與文字之間保有淨空
    expect(add.className).toContain('pr-3.5');
  });

  it('沒有在購物車內時不輸出徽章', () => {
    const { part } = renderCard({ product: NO_IMAGE, cartQuantity: 0 });
    expect((part('actions') as HTMLElement).querySelector('[data-card-part="badge"]')).toBeNull();
  });

  it('「↻ 再點」+「＋」：兩個按鈕在同一個動作群組，「上次」在描述下方', () => {
    const { card, part } = renderCard({ remembered: REMEMBERED, favorite: FAVORITE });
    const actions = part('actions') as HTMLElement;
    const repeat = within(actions).getByRole('button', { name: /^再點 招牌滷肉飯/ });
    const adjust = within(actions).getByRole('button', { name: '調整選項：招牌滷肉飯' });
    expect(before(repeat, adjust)).toBe(true);
    const last = within(card).getByText('上次：大碗・滷蛋');
    expect(part('footer')?.contains(last)).toBe(false);
    expect(before(part('desc') as HTMLElement, last)).toBe(true);
  });

  it('步進器：在動作群組內，達上限時說明列在按鈕下方且與「＋」關聯', () => {
    const stepperProduct = product({
      id: 'prd_step',
      name: '雙人分享餐',
      basePrice: 299,
      displayPrice: 299,
      remainingToday: 2,
    });
    const { card, part } = renderCard({
      product: stepperProduct,
      quickQuantity: 2,
      quickMax: 2,
    });
    const actions = part('actions') as HTMLElement;
    const stepper = card.querySelector('[data-card-stepper]') as HTMLElement;
    expect(actions.contains(stepper)).toBe(true);
    expect(within(stepper).getByRole('spinbutton')).toHaveTextContent('2');
    const reason = within(actions).getByText('今日只剩 2 份，已達上限');
    const plus = within(actions).getByRole('button', { name: '增加一份 雙人分享餐' });
    expect(plus).toHaveAttribute('aria-disabled', 'true');
    expect(plus).toHaveAttribute('aria-describedby', reason.id);
    // 價格不在動作群組內，說明列也不在價格格內
    expect(part('price')?.contains(reason)).toBe(false);
  });

  it('售完：停用的「售完」按鈕、標籤在品名之後，縮圖半透明', () => {
    const { card, part } = renderCard({
      product: { ...WITH_IMAGE, isSoldOut: true },
      favorite: FAVORITE,
    });
    const actions = part('actions') as HTMLElement;
    const sold = within(actions).getByRole('button', { name: /今日售完/ });
    expect(sold).toHaveAttribute('aria-disabled', 'true');
    expect(
      before(part('name') as HTMLElement, within(card).getByText('今日售完', { selector: 'span' })),
    ).toBe(true);
    expect(part('thumb')?.className).toContain('opacity-55');
  });

  it('限量：「剩 n 份」標籤在品名列內', () => {
    const limited = product({
      id: 'prd_limited',
      name: '雙人分享餐',
      basePrice: 299,
      displayPrice: 299,
      remainingToday: 3,
      hasRequiredOptions: true,
    });
    const { card, part } = renderCard({ product: limited, favorite: FAVORITE });
    const badge = within(card).getByText('剩 3 份');
    expect(part('title')?.contains(badge)).toBe(true);
    expect(before(part('name') as HTMLElement, badge)).toBe(true);
  });

  it('列出分類（搜尋結果）：分類行在品名列之下、底列之上', () => {
    const { card, part } = renderCard({ categoryName: '飯類', categoryIcon: '🍚' });
    const category = within(card).getByText(/飯類/, { selector: 'p' });
    expect(before(part('title') as HTMLElement, category)).toBe(true);
    expect(before(category, part('footer') as HTMLElement)).toBe(true);
  });
});

describe('GRID：圖片 → 品名列 → 底列', () => {
  it('愛心在品名前、不浮在圖片上；標籤在圖片內；底列在文字之後', () => {
    const { card, part } = renderCard({ layout: 'GRID', favorite: FAVORITE });
    const media = part('media') as HTMLElement;
    const favorite = part('favorite') as HTMLElement;
    const name = part('name') as HTMLElement;
    expect(media.contains(favorite)).toBe(false);
    expect(before(media, favorite)).toBe(true);
    expect(before(favorite, name)).toBe(true);
    expect(media.contains(within(card).getByText('熱銷'))).toBe(true);

    const footer = part('footer') as HTMLElement;
    expect(before(name, footer)).toBe(true);
    expect(footer.contains(part('price'))).toBe(true);
    expect(footer.contains(part('actions'))).toBe(true);
    expect(before(part('price') as HTMLElement, part('actions') as HTMLElement)).toBe(true);
    expect(footer.className).toContain('justify-between');
    expect(footer.className).toContain('mt-auto');
    expect((part('actions') as HTMLElement).className).toContain('ml-auto');
    // 左右緣與圖片齊：底列與文字區沒有額外的左右內距
    expect(footer.className).not.toMatch(/(^|\s)p[xlr]-/);
  });

  it('缺圖：佔位圖塊維持圖片區，其餘結構不變', () => {
    const { card, part } = renderCard({ layout: 'GRID', product: BARE, favorite: FAVORITE });
    expect(card.querySelector('[data-placeholder]')).not.toBeNull();
    expect(part('media')?.contains(card.querySelector('[data-placeholder]'))).toBe(true);
    expect(before(part('favorite') as HTMLElement, part('name') as HTMLElement)).toBe(true);
  });
});
