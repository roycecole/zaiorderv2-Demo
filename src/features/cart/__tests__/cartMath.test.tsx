// 購物車衍生值、useCartCount selector 與取餐方式切換
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CartLine } from '@/domain/cart';
import { fakeApi, storeInfo } from '@/features/menu/__tests__/fixtures';
import { resetStores } from '@/features/menu/__tests__/helpers';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { renderWithProviders } from '@/test/renderWithProviders';
import {
  cartQuantity,
  cartSubtotal,
  lineMetaParts,
  quantityOfProduct,
  quickAddLine,
} from '../cartMath';
import { useCartStore } from '../cartStore';
import { OrderTypeSwitch } from '../OrderTypeSwitch';
import { useCartCount } from '../useCartCount';

const line = (overrides: Partial<CartLine> = {}): CartLine => ({
  lineId: 'l1',
  productId: 'p1',
  quantity: 2,
  optionIds: [],
  snapshot: { name: '品名', unitPrice: 35, optionLabels: [] },
  ...overrides,
});

beforeEach(() => {
  resetStores();
});

describe('cartMath', () => {
  it('小計、份數與同商品份數', () => {
    const lines = [line(), line({ lineId: 'l2', productId: 'p2', quantity: 1 })];
    expect(cartSubtotal(lines)).toBe(105);
    expect(cartQuantity(lines)).toBe(3);
    expect(quantityOfProduct(lines, 'p1')).toBe(2);
    expect(quantityOfProduct(lines, 'none')).toBe(0);
  });

  it('快速加入行：沒有選項也沒有備註者', () => {
    const lines = [
      line({ lineId: 'a', optionIds: ['x'] }),
      line({ lineId: 'b', note: '少飯' }),
      line({ lineId: 'c' }),
    ];
    expect(quickAddLine(lines, 'p1')?.lineId).toBe('c');
    expect(quickAddLine(lines, 'p2')).toBeUndefined();
  });

  it('行說明：選項摘要與備註；皆無時為空（不輸出空白行）', () => {
    expect(lineMetaParts(line(), '備註：')).toEqual([]);
    expect(
      lineMetaParts(
        line({
          note: ' 不要蔥 ',
          snapshot: { name: 'x', unitPrice: 1, optionLabels: ['大碗', '滷蛋'] },
        }),
        '備註：',
      ),
    ).toEqual(['大碗・滷蛋', '備註：不要蔥']);
  });
});

describe('useCartCount', () => {
  it('品項行數、份數與小計隨購物車更新', () => {
    const { result } = renderHook(() => useCartCount());
    expect(result.current).toMatchObject({ lineCount: 0, quantity: 0, subtotal: 0, isEmpty: true });
    act(() => {
      useCartStore.getState().addLine({
        productId: 'p1',
        quantity: 2,
        optionIds: [],
        snapshot: { name: '品名', unitPrice: 35, optionLabels: [] },
      });
    });
    expect(result.current).toMatchObject({
      lineCount: 1,
      quantity: 2,
      subtotal: 70,
      isEmpty: false,
    });
  });
});

describe('OrderTypeSwitch', () => {
  it('依店家設定隱藏不可用的取餐方式；切換寫入購物車與偏好', async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      info: storeInfo({ services: { pickup: true, delivery: false, dineIn: true } }),
    });
    renderWithProviders(<OrderTypeSwitch />, { api });
    // 店家資訊載入後才隱藏不可用的取餐方式
    await waitFor(() => expect(screen.queryByRole('radio', { name: '外送' })).toBeNull());
    expect(screen.getByRole('radio', { name: '內用' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '自取' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: '內用' }));
    expect(useCartStore.getState().orderType).toBe('DINE_IN');
    expect(usePrefsStore.getState().lastOrderType).toBe('DINE_IN');
  });

  it('觸控面板：「外帶」與「內用」，不提供外送', async () => {
    useInputModeStore.setState({ inputMode: 'KIOSK' });
    renderWithProviders(<OrderTypeSwitch />, { api: fakeApi() });
    expect(await screen.findByRole('radio', { name: '外帶' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '內用' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '外送' })).toBeNull();
  });
});
