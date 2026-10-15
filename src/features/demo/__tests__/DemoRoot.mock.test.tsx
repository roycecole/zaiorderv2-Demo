// 與真正的 Mock Adapter 整合：面板的操作經 DemoControl 作用在 Mock 上，前台查詢可見其結果
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CreateOrderRequest } from '@/domain/types';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useGuestOrdersStore } from '@/features/orders/guestOrdersStore';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { createMockClient } from '@/services/api/mock/createMockClient';
import type { MockClient } from '@/services/api/mock/createMockClient';
import { getClock, setClock, systemClock } from '@/services/clock';
import { renderWithProviders } from '@/test/renderWithProviders';
import DemoRoot from '../DemoRoot';

const T0 = Date.parse('2026-10-14T12:00:00+08:00');

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

let client: MockClient;

beforeEach(() => {
  setClock({ now: () => new Date(T0) });
  client = createMockClient({
    storeSlug: 'demo-snack',
    storage: memoryStorage(),
    locks: null,
    demoMode: false,
    syncTabs: false,
    reloadPage: () => undefined,
    sleep: async () => undefined,
  });
  client.demo.setState({ latencyMs: 0, autoSimulate: false });
  useInputModeStore.setState({ inputMode: 'AUTO', themeOverride: null, demoPanelOpen: false });
  usePrefsStore.getState().reset();
  useSessionStore.getState().clear();
  useGuestOrdersStore.getState().clear();
});

afterEach(() => {
  client.dispose();
  setClock(systemClock);
});

async function openPanelAndSection(title: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Demo 工具' }));
  await screen.findByRole('dialog', { name: 'Demo 工具' });
  const toggle = screen.getByRole('button', { name: title });
  if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle);
  return user;
}

const cashOrder = (): CreateOrderRequest => ({
  orderType: 'PICKUP',
  items: [{ productId: 'prd_lurou', quantity: 1, optionIds: ['opt_bowl_l', 'opt_egg'] }],
  scheduledAt: null,
  contact: { name: '王小明', phone: '0912345678' },
  paymentMethod: 'CASH',
  invoice: { type: 'PAPER' },
  needUtensils: false,
  expectedTotal: 67,
});

describe('DemoRoot + Mock Adapter', () => {
  it('「剩 2 份」寫入每日限量覆寫，菜單的 remainingToday 隨之改變', async () => {
    renderWithProviders(<DemoRoot />, { api: client });
    const user = await openPanelAndSection('庫存與時段情境');
    expect(
      await screen.findByText(/每日限量 5・今日已售 0・待付款保留 0・剩 5 份/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '剩 2 份' }));
    await waitFor(async () => {
      const menu = await client.store.getMenu();
      const combo = menu.categories
        .flatMap((c) => c.products)
        .find((p) => p.id === 'prd_combo_share');
      expect(combo?.remainingToday).toBe(2);
    });
    expect(
      await screen.findByText('每日限量 2・今日已售 0・待付款保留 0・剩 2 份', undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument();
  });

  it('他人現在下單 3 份 → 讀數的已售增加，菜單剩餘減少；清除他人訂單後恢復', async () => {
    renderWithProviders(<DemoRoot />, { api: client });
    const user = await openPanelAndSection('庫存與時段情境');
    const qty = await screen.findByLabelText('份數');
    await user.clear(qty);
    await user.type(qty, '3');
    await user.click(screen.getByRole('button', { name: '他人現在下單' }));
    expect(
      await screen.findByText(/今日已售 3・待付款保留 0・剩 2 份/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '清除他人訂單' }));
    expect(
      await screen.findByText(/今日已售 0・待付款保留 0・剩 5 份/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it('手動店家動作：自己的待接單訂單 → 接單 → 狀態變為 ACCEPTED', async () => {
    const created = await client.orders.create(cashOrder(), '00000000-0000-4000-8000-000000000001');
    expect(created.order.status).toBe('PENDING');
    useGuestOrdersStore.getState().upsert({
      orderId: created.order.id,
      orderNo: created.order.orderNo,
      trackingToken: created.trackingToken ?? '',
      placedAt: created.order.placedAt,
    });
    renderWithProviders(<DemoRoot />, { api: client });
    const user = await openPanelAndSection('訂單模擬');
    await user.click(await screen.findByRole('button', { name: '接單' }));
    await waitFor(async () => {
      const o = await client.orders.get(created.order.id, {
        trackingToken: created.trackingToken ?? '',
      });
      expect(o.status).toBe('ACCEPTED');
    });
    // 接單後可出餐
    expect(
      await screen.findByRole('button', { name: '出餐' }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('快速登入示範會員：sessionStore 取得 tokens 與 user，Mock 的 me.get 可用', async () => {
    renderWithProviders(<DemoRoot />, { api: client });
    const user = await openPanelAndSection('帳號與資料');
    await user.click(screen.getByRole('button', { name: '快速登入示範會員' }));
    await waitFor(() => expect(useSessionStore.getState().user).not.toBeNull());
    expect(useSessionStore.getState().tokens?.refreshToken).toBeTruthy();
    expect(useSessionStore.getState().user?.phone).toBe('0900000000');
    expect((await client.me.get()).phone).toBe('0900000000');
  });

  it('時間穿梭：快轉 +24 小時後 getClock() 前進，並清除已過期的購物車', async () => {
    renderWithProviders(<DemoRoot />, { api: client });
    const user = await openPanelAndSection('店家與時間');
    await user.click(screen.getByRole('button', { name: '快轉 +24 小時' }));
    await waitFor(() => {
      expect(client.demo.getState().clockOverride).not.toBeNull();
    });
    // Mock 以 createOffsetClock 套用覆寫；起點為點擊當下的「現在」+ 24 小時
    expect(getClock().now().getTime() - T0).toBeGreaterThanOrEqual(24 * 3_600_000 - 5000);
  });

  it('主題色與輸入模式寫入 DemoState（持久化）與 runtime store', async () => {
    renderWithProviders(<DemoRoot />, { api: client });
    const user = await openPanelAndSection('菜單與外觀');
    await user.click(screen.getByRole('radio', { name: '海洋藍' }));
    await user.click(screen.getByRole('radio', { name: '觸控面板' }));
    expect(client.demo.getState().themeOverride).toBe('#1F5FBF');
    expect(client.demo.getState().inputMode).toBe('KIOSK');
    expect(useInputModeStore.getState().inputMode).toBe('KIOSK');
    expect(useInputModeStore.getState().themeOverride).toBe('#1F5FBF');
  });
});
