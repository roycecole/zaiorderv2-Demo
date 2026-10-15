// PG-02 商品面板：選項規則、即時金額、數量上限與原因、點餐記憶套用 / 失效降級（BR-35）、編輯購物車行、資料缺漏降級
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CartLine } from '@/domain/cart';
import type { ProductDetail } from '@/domain/types';
import { useCartStore } from '@/features/cart/cartStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { renderWithProviders } from '@/test/renderWithProviders';
import { ProductSheet } from '../ProductSheet';
import { useProductSheetNav } from '../productSheetNav';
import {
  LUROU,
  LUROU_DETAIL,
  SIZE_GROUP,
  TOPPING_GROUP,
  detailOf,
  fakeApi,
  menuOf,
  product,
} from './fixtures';
import { LocationProbe, resetStores } from './helpers';

function OpenButton({ id = 'prd_lurou' }: { id?: string }) {
  const nav = useProductSheetNav();
  return (
    <button type="button" onClick={() => nav.openProduct(id)}>
      開啟面板
    </button>
  );
}

function renderSheet(
  detail: ProductDetail | ProductDetail[] = LUROU_DETAIL,
  route = '/?product=prd_lurou',
) {
  const details = Array.isArray(detail) ? detail : [detail];
  const api = fakeApi({
    menu: menuOf({ id: 'cat_rice', name: '飯類', products: details }),
    details,
  });
  return renderWithProviders(
    <>
      <LocationProbe />
      <OpenButton />
      <ProductSheet />
    </>,
    { api, route },
  );
}

const lineOf = (overrides: Partial<CartLine> = {}): Omit<CartLine, 'lineId'> => ({
  productId: 'prd_lurou',
  quantity: 1,
  optionIds: ['opt_l', 'opt_egg'],
  snapshot: { name: '招牌滷肉飯', unitPrice: 67, optionLabels: ['大碗', '滷蛋'] },
  ...overrides,
});

beforeEach(() => {
  resetStores();
});

describe('完整資料', () => {
  it('顯示品名、描述、標籤、過敏原、選項群組規則與預設選項', async () => {
    renderSheet();
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    expect(within(dialog).getByText('古早味滷肉燥，肥瘦比例剛剛好')).toBeInTheDocument();
    expect(within(dialog).getByText('熱銷')).toBeInTheDocument();
    expect(within(dialog).getByText(/過敏原：大豆/)).toBeInTheDocument();

    const size = within(dialog).getByRole('radiogroup', { name: /份量/ });
    expect(within(size).getByText('必選・單選')).toBeInTheDocument();
    expect(within(size).getByRole('radio', { name: /小碗/ })).toBeChecked();
    const topping = within(dialog).getByRole('group', { name: /加料/ });
    expect(within(topping).getByText('選填・最多 2 項')).toBeInTheDocument();

    expect(within(dialog).getByRole('button', { name: '加入購物車 · NT$ 35' })).toBeInTheDocument();
    // 開啟時焦點在面板標題
    expect(screen.getByRole('heading', { name: '招牌滷肉飯' })).toHaveFocus();
  });

  it('金額即時計算：(基本價 + 選項加價) × 數量（FR-PD-03）', async () => {
    const user = userEvent.setup();
    renderSheet();
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    await user.click(within(dialog).getByRole('radio', { name: /大碗/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /滷蛋/ }));
    expect(within(dialog).getByRole('button', { name: '加入購物車 · NT$ 67' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '增加數量' }));
    expect(
      within(dialog).getByRole('button', { name: '加入購物車 · NT$ 134' }),
    ).toBeInTheDocument();
  });

  it('加入購物車：寫入選項、備註與快照，關閉面板並顯示 Toast', async () => {
    const user = userEvent.setup();
    renderSheet();
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    await user.click(within(dialog).getByRole('radio', { name: /大碗/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /滷蛋/ }));
    await user.type(within(dialog).getByRole('textbox', { name: /備註/ }), '不要蔥');
    await user.click(within(dialog).getByRole('button', { name: '加入購物車 · NT$ 67' }));

    const { lines } = useCartStore.getState();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      productId: 'prd_lurou',
      quantity: 1,
      optionIds: ['opt_l', 'opt_egg'],
      note: '不要蔥',
    });
    expect(lines[0]?.snapshot).toMatchObject({ unitPrice: 67, optionLabels: ['大碗', '滷蛋'] });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    expect(await screen.findByText('已加入購物車')).toBeInTheDocument();
  });

  it('相同商品 + 相同選項 + 相同備註合併為同一行（BR-13）', async () => {
    const user = userEvent.setup();
    renderSheet();
    let dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    await user.click(within(dialog).getByRole('button', { name: /^加入購物車/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: '開啟面板' }));
    dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    await user.click(within(dialog).getByRole('button', { name: /^加入購物車/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const { lines } = useCartStore.getState();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(2);
  });

  it('不同備註為不同行', async () => {
    const user = userEvent.setup();
    renderSheet();
    let dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    await user.click(within(dialog).getByRole('button', { name: /^加入購物車/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: '開啟面板' }));
    dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    await user.type(within(dialog).getByRole('textbox', { name: /備註/ }), '少飯');
    await user.click(within(dialog).getByRole('button', { name: /^加入購物車/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(useCartStore.getState().lines).toHaveLength(2);
  });
});

describe('選項規則', () => {
  const noDefault = detailOf(LUROU, [
    { ...SIZE_GROUP, options: SIZE_GROUP.options.map((o) => ({ ...o, isDefault: false })) },
    TOPPING_GROUP,
  ]);

  it('必選未選：按鈕停用並說明，點擊後群組標示錯誤、焦點移到該群組，不加入', async () => {
    const user = userEvent.setup();
    renderSheet(noDefault);
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    const add = within(dialog).getByRole('button', { name: '請選擇份量' });
    expect(add).toHaveAttribute('aria-disabled', 'true');

    // 剛開啟時不標紅
    expect(within(dialog).queryAllByText('請選擇份量')).toHaveLength(1);
    await user.click(add);
    expect(useCartStore.getState().lines).toHaveLength(0);
    // 群組標頭下方出現錯誤文字
    expect(within(dialog).getAllByText('請選擇份量').length).toBeGreaterThan(1);
    expect(within(dialog).getByRole('radiogroup', { name: /份量/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(within(dialog).getAllByRole('radio')[0]).toHaveFocus();

    await user.click(within(dialog).getByRole('radio', { name: /小碗/ }));
    expect(within(dialog).getByRole('button', { name: /^加入購物車/ })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('複選達上限：其餘未選項停用並顯示「已達上限」', async () => {
    const user = userEvent.setup();
    renderSheet();
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    await user.click(within(dialog).getByRole('checkbox', { name: /滷蛋/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /滷豆干/ }));
    const meat = within(dialog).getByRole('checkbox', { name: /加肉燥/ });
    expect(meat).toBeDisabled();
    expect(within(dialog).getByText('已達上限')).toBeInTheDocument();
  });

  it('暫無供應的選項不可選並說明原因', async () => {
    const detail = detailOf(LUROU, [
      SIZE_GROUP,
      {
        ...TOPPING_GROUP,
        options: TOPPING_GROUP.options.map((o) =>
          o.id === 'opt_egg' ? { ...o, isAvailable: false } : o,
        ),
      },
    ]);
    renderSheet(detail);
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    expect(within(dialog).getByRole('checkbox', { name: /滷蛋/ })).toBeDisabled();
    expect(within(dialog).getByText('暫無供應')).toBeInTheDocument();
  });

  it('選填的單選群組可選「不選擇」', async () => {
    const user = userEvent.setup();
    const detail = detailOf(LUROU, [
      {
        id: 'og_spice',
        name: '辣度',
        selectionType: 'SINGLE',
        required: false,
        minSelect: 0,
        maxSelect: 1,
        options: [
          { id: 'opt_mild', name: '小辣', priceDelta: 0, isDefault: false, isAvailable: true },
        ],
      },
    ]);
    renderSheet(detail);
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    const none = within(dialog).getByRole('radio', { name: /不選擇/ });
    expect(none).toBeChecked();
    await user.click(within(dialog).getByRole('radio', { name: /小辣/ }));
    expect(none).not.toBeChecked();
    await user.click(none);
    await user.click(within(dialog).getByRole('button', { name: /^加入購物車/ }));
    expect(useCartStore.getState().lines[0]?.optionIds).toEqual([]);
  });
});

describe('備註與數量', () => {
  it('備註超過 50 字：顯示字數與錯誤並停用加入', async () => {
    const user = userEvent.setup();
    renderSheet();
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    const note = within(dialog).getByRole('textbox', { name: /備註/ });
    fireEvent.change(note, { target: { value: '我'.repeat(51) } });
    expect(within(dialog).getByText('51/50')).toBeInTheDocument();
    expect(within(dialog).getAllByText('備註最多 50 字').length).toBeGreaterThan(0);
    const add = within(dialog).getByRole('button', { name: '備註最多 50 字' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    await user.click(add);
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it('限量：上限 = 剩餘份數 − 購物車內同商品其他行；達上限說明「今日只剩 n 份，已達上限」', async () => {
    const user = userEvent.setup();
    const limited = detailOf({ ...LUROU, remainingToday: 3 }, [SIZE_GROUP]);
    // 購物車內同商品其他行已有 1 份（不同選項）
    useCartStore.getState().addLine(
      lineOf({
        optionIds: ['opt_l'],
        snapshot: { name: '招牌滷肉飯', unitPrice: 55, optionLabels: ['大碗'] },
      }),
    );
    renderSheet(limited);
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    expect(within(dialog).getByText('剩 3 份')).toBeInTheDocument();
    const plus = within(dialog).getByRole('button', { name: '增加數量' });
    await user.click(plus); // 1 → 2（上限 2）
    expect(within(dialog).getByRole('spinbutton', { name: '數量' })).toHaveAttribute(
      'aria-valuenow',
      '2',
    );
    expect(plus).toHaveAttribute('aria-disabled', 'true');
    expect(within(dialog).getByText('今日只剩 3 份，已達上限')).toBeInTheDocument();
    await user.click(plus);
    expect(within(dialog).getByRole('spinbutton', { name: '數量' })).toHaveAttribute(
      'aria-valuenow',
      '2',
    );
  });

  it('同商品已占滿剩餘份數：加入鈕停用並說明', async () => {
    const limited = detailOf({ ...LUROU, remainingToday: 1 }, [SIZE_GROUP]);
    useCartStore.getState().addLine(lineOf({ optionIds: ['opt_l'] }));
    renderSheet(limited);
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    expect(within(dialog).getByRole('button', { name: '已達上限' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('達 20 份單行上限：說明「此品項已達上限 20 份」', async () => {
    const user = userEvent.setup();
    renderSheet(detailOf(LUROU, []));
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    const plus = within(dialog).getByRole('button', { name: '增加數量' });
    for (let i = 0; i < 19; i += 1) await user.click(plus);
    expect(within(dialog).getByRole('spinbutton', { name: '數量' })).toHaveAttribute(
      'aria-valuenow',
      '20',
    );
    expect(plus).toHaveAttribute('aria-disabled', 'true');
    expect(within(dialog).getByText('此品項已達上限 20 份')).toBeInTheDocument();
  });

  it('今日售完：內容唯讀，按鈕顯示「今日售完」且停用', async () => {
    const user = userEvent.setup();
    const sold = detailOf({ ...LUROU, isSoldOut: true }, [SIZE_GROUP, TOPPING_GROUP]);
    renderSheet(sold);
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    const add = within(dialog).getByRole('button', { name: '今日售完' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(within(dialog).getByRole('radio', { name: /大碗/ })).toBeDisabled();
    await user.click(add);
    expect(useCartStore.getState().lines).toHaveLength(0);
  });
});

describe('點餐記憶（FR-PD-09、BR-35）', () => {
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

  it('預設套用上次的選項與備註（數量 1），並可「恢復預設」', async () => {
    const user = userEvent.setup();
    remember(['opt_l', 'opt_egg'], ['大碗', '滷蛋'], '不要蔥');
    renderSheet();
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    expect(within(dialog).getByText('已套用上次的選擇：大碗・滷蛋')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /大碗/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /滷蛋/ })).toBeChecked();
    expect(within(dialog).getByRole('textbox', { name: /備註/ })).toHaveValue('不要蔥');
    expect(within(dialog).getByRole('spinbutton', { name: '數量' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );

    await user.click(within(dialog).getByRole('button', { name: '恢復預設' }));
    expect(within(dialog).getByRole('radio', { name: /小碗/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /滷蛋/ })).not.toBeChecked();
    expect(within(dialog).getByRole('textbox', { name: /備註/ })).toHaveValue('');
    expect(within(dialog).getByText('已恢復預設選項')).toBeInTheDocument();
  });

  it('部分選項已不提供：失效者不被選取、必選群組改用預設並提示', async () => {
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
    renderSheet(stale);
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    expect(within(dialog).getByText('部分選項已不提供，已改用預設')).toBeInTheDocument();
    expect(within(dialog).queryByText(/已套用上次的選擇/)).toBeNull();
    expect(within(dialog).getByRole('checkbox', { name: /滷蛋/ })).not.toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /大碗/ })).toBeChecked();
  });

  it('必選群組改版後記憶的選項不在群組內：以預設補足', async () => {
    remember(['opt_gone'], ['舊選項']);
    renderSheet();
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    expect(within(dialog).getByText('部分選項已不提供，已改用預設')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /小碗/ })).toBeChecked();
  });

  it('關閉點餐記憶時不套用', async () => {
    remember(['opt_l'], ['大碗']);
    usePrefsStore.setState({ rememberChoices: false });
    renderSheet();
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    expect(within(dialog).queryByText(/已套用上次的選擇/)).toBeNull();
    expect(within(dialog).getByRole('radio', { name: /小碗/ })).toBeChecked();
  });
});

describe('編輯購物車品項（?edit=）', () => {
  it('帶入該行的選項、數量與備註（不套用記憶）；更新會取代原品項而非新增', async () => {
    const user = userEvent.setup();
    usePrefsStore.setState({
      lastChoices: {
        prd_lurou: {
          productId: 'prd_lurou',
          optionIds: ['opt_s'],
          labels: ['小碗'],
          at: Date.now(),
        },
      },
    });
    useCartStore.getState().addLine(lineOf({ quantity: 2, note: '不要蔥' }));
    const lineId = useCartStore.getState().lines[0]?.lineId as string;
    renderSheet(LUROU_DETAIL, `/cart?edit=${lineId}`);

    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    // 編輯時標題先取自購物車快照，選項資料到齊後才有群組
    expect(await within(dialog).findByRole('radio', { name: /大碗/ })).toBeChecked();
    expect(within(dialog).queryByText(/已套用上次的選擇/)).toBeNull();
    expect(within(dialog).getByRole('checkbox', { name: /滷蛋/ })).toBeChecked();
    expect(within(dialog).getByRole('textbox', { name: /備註/ })).toHaveValue('不要蔥');
    expect(within(dialog).getByRole('spinbutton', { name: '數量' })).toHaveAttribute(
      'aria-valuenow',
      '2',
    );
    expect(
      within(dialog).getByRole('button', { name: '更新購物車 · NT$ 134' }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('radio', { name: /小碗/ }));
    await user.click(within(dialog).getByRole('button', { name: '更新購物車 · NT$ 94' }));

    const { lines } = useCartStore.getState();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      lineId,
      quantity: 2,
      optionIds: ['opt_s', 'opt_egg'],
      note: '不要蔥',
    });
    expect(lines[0]?.snapshot.unitPrice).toBe(47);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('已更新購物車')).toBeInTheDocument();
  });

  it('編輯後的合併鍵與其他行相同時合併為一行', async () => {
    const user = userEvent.setup();
    useCartStore.getState().addLine(
      lineOf({
        optionIds: ['opt_s'],
        snapshot: { name: '招牌滷肉飯', unitPrice: 35, optionLabels: ['小碗'] },
      }),
    );
    useCartStore.getState().addLine(lineOf());
    const [, second] = useCartStore.getState().lines;
    renderSheet(LUROU_DETAIL, `/cart?edit=${second?.lineId}`);
    const dialog = await screen.findByRole('dialog', { name: '招牌滷肉飯' });
    await user.click(await within(dialog).findByRole('radio', { name: /小碗/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /滷蛋/ }));
    await user.click(within(dialog).getByRole('button', { name: /^更新購物車/ }));
    const { lines } = useCartStore.getState();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(2);
  });

  it('找不到該品項（已被移除）：不顯示面板', async () => {
    renderSheet(LUROU_DETAIL, '/cart?edit=unknown');
    await waitFor(() => expect(screen.getByTestId('location')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('資料缺漏降級（FR-PD-08、§6.7）', () => {
  it('無圖、無描述、無選項：只有品名、價格、數量與備註，不出現圖片區或空標題', async () => {
    const user = userEvent.setup();
    const bare = detailOf(
      product({ id: 'prd_lurou', name: '愛玉檸檬', basePrice: 45, displayPrice: 45 }),
    );
    const { baseElement } = renderSheet(bare);
    const dialog = await screen.findByRole('dialog', { name: '愛玉檸檬' });
    expect(baseElement.querySelector('img')).toBeNull();
    expect(within(dialog).queryByText(/過敏原/)).toBeNull();
    expect(within(dialog).queryByRole('radiogroup')).toBeNull();
    expect(within(dialog).queryByRole('group', { name: /加料/ })).toBeNull();
    expect(within(dialog).getByText('NT$ 45')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /備註/ })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '加入購物車 · NT$ 45' }));
    expect(useCartStore.getState().lines[0]).toMatchObject({
      productId: 'prd_lurou',
      optionIds: [],
    });
  });

  it('載入失敗：區塊錯誤與重試', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const base = fakeApi({ menu: menuOf({ id: 'c', name: '飯類', products: [LUROU] }) });
    const api = {
      ...base,
      store: {
        ...base.store,
        getProduct: async () => {
          calls += 1;
          if (calls === 1) throw Object.assign(new Error('x'), { code: 'INTERNAL_ERROR' });
          return LUROU_DETAIL;
        },
      },
    } as typeof base;
    renderWithProviders(<ProductSheet />, { api, route: '/?product=prd_lurou' });
    expect(await screen.findByText('暫時無法載入這項餐點')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByRole('radiogroup', { name: /份量/ })).toBeInTheDocument();
  });
});
