// FR-DM-01～13 / PG-18：Demo 面板的操作會呼叫 DemoControl、同步 runtime store 並 invalidate 查詢
import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { stubViewportWidth } from '@/features/a11y/__tests__/helpers';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useCartStore } from '@/features/cart/cartStore';
import { useGuestOrdersStore } from '@/features/orders/guestOrdersStore';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { createTestQueryClient, renderWithProviders } from '@/test/renderWithProviders';
import DemoRoot from '../DemoRoot';
import { DemoTrigger } from '../DemoTrigger';
import { DemoHarness, createDemoApi, createFakeDemo, order } from './demoTestUtils';
import type { FakeDemo } from './demoTestUtils';

// 頂部列的入口只在 Demo 建置出現
vi.mock('@/config/env', async (importOriginal) => ({
  env: { ...(await importOriginal<{ env: object }>()).env, demoMode: true },
}));

let demo: FakeDemo;
let queryClient: QueryClient;
let invalidate: MockInstance<QueryClient['invalidateQueries']>;

/** 已 invalidate 的 queryKey（JSON 字串） */
const invalidatedKeys = (): string[] =>
  invalidate.mock.calls.map((call) => JSON.stringify((call[0] as { queryKey: unknown }).queryKey));

function mount(
  initial: Parameters<typeof createFakeDemo>[0] = {},
  options: Parameters<typeof createDemoApi>[1] = {},
  route = '/',
) {
  demo = createFakeDemo(initial);
  const api = createDemoApi(demo, options);
  queryClient = createTestQueryClient();
  invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const view = renderWithProviders(<DemoHarness />, { api, queryClient, route });
  return { api, ...view };
}

/** 頂部列的入口按鈕（面板開啟時背景為 aria-hidden，以屬性選取而不是 ARIA 角色） */
const triggerEl = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[data-demo-trigger]');
  if (el === null) throw new Error('找不到 Demo 入口');
  return el;
};

async function openPanel(user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: /^Demo 工具/ }));
  return { user, panel: await screen.findByRole('dialog', { name: 'Demo 工具' }) };
}

/** 展開區塊（預設收合）；回傳區塊的 fieldset */
async function expand(user: ReturnType<typeof userEvent.setup>, title: string) {
  const toggle = screen.getByRole('button', { name: title });
  if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle);
  return screen.getByRole('group', { name: title });
}

beforeEach(() => {
  useInputModeStore.setState({
    inputMode: 'AUTO',
    themeOverride: null,
    demoPanelOpen: false,
    keyboardNoticeReplaySeq: 0,
  });
  usePrefsStore.getState().reset();
  useCartStore.getState().clear();
  useSessionStore.getState().clear();
  useGuestOrdersStore.getState().clear();
  document.documentElement.removeAttribute('style');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('進入條件與入口', () => {
  it('沒有 DemoControl（HTTP 模式）時入口與 DemoRoot 都不渲染', () => {
    const api = createDemoApi(null);
    const { container } = renderWithProviders(<DemoHarness />, { api });
    expect(container.querySelector('button')).toBeNull();
    expect(screen.queryByRole('button', { name: /Demo/ })).toBeNull();
  });

  it('掛載時以 DemoState 初始化 useInputModeStore（inputMode、themeOverride）', () => {
    mount({ inputMode: 'KEYBOARD_HINTS', themeOverride: '#2E7D4F' });
    expect(useInputModeStore.getState().inputMode).toBe('KEYBOARD_HINTS');
    expect(useInputModeStore.getState().themeOverride).toBe('#2E7D4F');
  });

  it('頂部列入口可由鍵盤操作；展開時 aria-expanded 與面板的 demoPanelOpen 旗標同步', async () => {
    mount();
    const trigger = screen.getByRole('button', { name: 'Demo 工具' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const { user } = await openPanel();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(useInputModeStore.getState().demoPanelOpen).toBe(true);
    await user.click(screen.getByRole('button', { name: '關閉' }));
    expect(useInputModeStore.getState().demoPanelOpen).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Demo 工具' })).toBeNull();
  });

  it('預設顯示 Demo 橫幅；關閉後寫入 prefs.demoBannerDismissed 並不再顯示', async () => {
    mount();
    const user = userEvent.setup();
    const banner = screen.getByRole('region', { name: '示範站台提示' });
    expect(banner).toHaveTextContent('金流與簡訊皆為模擬');
    await user.click(within(banner).getByRole('button', { name: '關閉提示' }));
    expect(usePrefsStore.getState().demoBannerDismissed).toBe(true);
    expect(screen.queryByRole('region', { name: '示範站台提示' })).toBeNull();
  });

  it('橫幅的「開啟 Demo 工具」直接展開面板', async () => {
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '開啟 Demo 工具' }));
    expect(await screen.findByRole('dialog', { name: 'Demo 工具' })).toBeInTheDocument();
  });

  it('「已預備」項目與「下一次送出」失敗注入使入口顯示小圓點並同步 aria-label', () => {
    mount({
      raceOnNextCreate: {
        soldOutProductIds: ['prd_combo_share'],
        buy: [{ productId: 'prd_combo_share', quantity: 5 }],
      },
      failNext: { target: 'orders.create', remaining: 1, phase: 'AFTER_COMMIT' },
    });
    expect(
      screen.getByRole('button', { name: 'Demo 工具，已預備 3 項下次送出的模擬' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('demo-fab-dot')).toBeInTheDocument();
  });

  it('外部變更（預備情境在送出時生效並清除）會於輪詢後反映在入口', async () => {
    mount({ failNext: { target: 'orders.create', remaining: 1 } });
    expect(screen.getByTestId('demo-fab-dot')).toBeInTheDocument();
    demo.current = { ...demo.current, failNext: null };
    await waitFor(() => expect(screen.queryByTestId('demo-fab-dot')).toBeNull(), { timeout: 3000 });
    expect(screen.getByRole('button', { name: 'Demo 工具' })).toBeInTheDocument();
  });
});

describe('面板開關的單一事實來源（useInputModeStore.demoPanelOpen）與焦點還原', () => {
  let restoreViewport: (() => void) | undefined;
  afterEach(() => {
    restoreViewport?.();
    restoreViewport = undefined;
  });

  it('入口在 DemoRoot（延後載入）就緒前被點了，DemoRoot 就緒後面板仍會開啟', async () => {
    const api = createDemoApi(createFakeDemo());
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<DemoTrigger />, { api });
    await user.click(screen.getByRole('button', { name: 'Demo 工具' }));
    expect(useInputModeStore.getState().demoPanelOpen).toBe(true);
    expect(screen.queryByRole('dialog', { name: 'Demo 工具' })).toBeNull();

    rerender(<DemoHarness />);
    expect(await screen.findByRole('dialog', { name: 'Demo 工具' })).toBeInTheDocument();
    expect(triggerEl()).toHaveAttribute('aria-expanded', 'true');
  });

  it('面板的開關完全由 store 推導：外部設定旗標即可開關，再點入口切換', async () => {
    mount();
    act(() => useInputModeStore.getState().setDemoPanelOpen(true));
    expect(await screen.findByRole('dialog', { name: 'Demo 工具' })).toBeInTheDocument();
    expect(triggerEl()).toHaveAttribute('aria-controls', 'zaiorder-demo-panel');

    act(() => useInputModeStore.getState().setDemoPanelOpen(false));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Demo 工具' })).toBeNull());
    expect(triggerEl()).not.toHaveAttribute('aria-controls');

    act(() => useInputModeStore.getState().toggleDemoPanel());
    expect(await screen.findByRole('dialog', { name: 'Demo 工具' })).toBeInTheDocument();
    act(() => useInputModeStore.getState().toggleDemoPanel());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Demo 工具' })).toBeNull());
  });

  it('面板的關閉鈕與橫幅的「開啟 Demo 工具」都操作同一個旗標', async () => {
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '開啟 Demo 工具' }));
    expect(useInputModeStore.getState().demoPanelOpen).toBe(true);
    // 面板展開期間橫幅收起
    expect(screen.queryByRole('region', { name: '示範站台提示' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: '關閉' }));
    expect(useInputModeStore.getState().demoPanelOpen).toBe(false);
  });

  it('手機（底部 Sheet）：Esc 關閉後焦點回到頂部列的入口', async () => {
    mount();
    const user = userEvent.setup();
    triggerEl().focus();
    await user.keyboard('{Enter}');
    const panel = await screen.findByRole('dialog', { name: 'Demo 工具' });
    expect(panel).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Demo 工具' })).toBeNull());
    expect(triggerEl()).toHaveFocus();
  });

  it('桌機（左下浮動面板）：鍵盤開啟、焦點移到面板標題，Esc 與關閉鈕收合後焦點回到入口', async () => {
    restoreViewport = stubViewportWidth(1280);
    mount();
    const user = userEvent.setup();
    triggerEl().focus();
    await user.keyboard('{Enter}');
    const panel = await screen.findByRole('dialog', { name: 'Demo 工具' });
    expect(panel).toHaveAttribute('aria-modal', 'false');
    expect(within(panel).getByRole('heading', { name: 'Demo 工具' })).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Demo 工具' })).toBeNull());
    expect(triggerEl()).toHaveFocus();

    await user.click(triggerEl());
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Demo 工具' })).getByRole('button', {
        name: '收合 Demo 工具',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Demo 工具' })).toBeNull());
    expect(triggerEl()).toHaveFocus();
  });

  it('桌機：由橫幅開啟（橫幅按鈕隨之卸載）後關閉，焦點同樣回到入口', async () => {
    restoreViewport = stubViewportWidth(1280);
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '開啟 Demo 工具' }));
    await screen.findByRole('dialog', { name: 'Demo 工具' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Demo 工具' })).toBeNull());
    expect(triggerEl()).toHaveFocus();
  });

  it('桌機：再點一次入口收合（非 modal 面板，背景可操作）', async () => {
    restoreViewport = stubViewportWidth(1280);
    mount();
    const user = userEvent.setup();
    await user.click(triggerEl());
    await screen.findByRole('dialog', { name: 'Demo 工具' });
    await user.click(triggerEl());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Demo 工具' })).toBeNull());
    expect(useInputModeStore.getState().demoPanelOpen).toBe(false);
    expect(triggerEl()).toHaveAttribute('aria-expanded', 'false');
  });

  it('入口隨頂部列重新掛載（版面切換）後，關閉面板仍把焦點還給「目前」的入口', async () => {
    restoreViewport = stubViewportWidth(1280);
    const api = createDemoApi(createFakeDemo());
    const user = userEvent.setup();
    function Tree({ variant }: { variant: 'app' | 'task' }) {
      // 兩種版面的頂部列各自渲染一個入口；切換時舊的卸載、新的掛載
      return variant === 'app' ? (
        <header key="app">
          <DemoTrigger />
        </header>
      ) : (
        <div key="task">
          <DemoTrigger />
        </div>
      );
    }
    const { rerender } = renderWithProviders(
      <>
        <Tree variant="app" />
        <DemoRoot />
      </>,
      { api },
    );
    await user.click(triggerEl());
    await screen.findByRole('dialog', { name: 'Demo 工具' });
    const before = triggerEl();

    rerender(
      <>
        <Tree variant="task" />
        <DemoRoot />
      </>,
    );
    expect(triggerEl()).not.toBe(before);
    // 版面切換期間面板維持開啟（旗標在 store，不隨外殼卸載而歸零）
    expect(screen.getByRole('dialog', { name: 'Demo 工具' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Demo 工具' })).toBeNull());
    expect(triggerEl()).toHaveFocus();
  });
});

describe('Demo 橫幅的顯示位置（FR-DM-07）：只在一般頁面，不蓋住任務型頁面的主要操作', () => {
  it.each(['/', '/cart', '/store', '/orders', '/orders/lookup', '/login'])(
    '一般頁面 %s 顯示橫幅',
    (route) => {
      mount({}, {}, route);
      expect(screen.getByRole('region', { name: '示範站台提示' })).toBeInTheDocument();
    },
  );

  it.each(['/checkout', '/checkout/', '/payment/ord_1', '/orders/ord_1', '/Orders/ord_1/'])(
    '任務型頁面 %s（頁底有送出列 / 主要操作）不顯示橫幅，入口仍在頂部列',
    (route) => {
      mount({}, {}, route);
      expect(screen.queryByRole('region', { name: '示範站台提示' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Demo 工具' })).toBeInTheDocument();
    },
  );

  it('觸控面板模式不顯示橫幅，入口仍在（可用面板切回「自動」）', () => {
    useInputModeStore.setState({ inputMode: 'KIOSK' });
    mount({ inputMode: 'KIOSK' });
    expect(screen.queryByRole('region', { name: '示範站台提示' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Demo 工具' })).toBeInTheDocument();
  });
});

describe('寫入類操作：DemoControl.setState、同步 store、invalidate', () => {
  it('自動模擬與速度', async () => {
    mount();
    const { user } = await openPanel();
    await user.click(screen.getByRole('switch', { name: /自動模擬訂單/ }));
    expect(demo.setState).toHaveBeenLastCalledWith({ autoSimulate: false });
    await user.click(screen.getByRole('radio', { name: '5×' }));
    expect(demo.setState).toHaveBeenLastCalledWith({ speed: 5 });
    expect(invalidate).toHaveBeenCalled();
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining(['["store"]', '["quote"]', '["orders"]']),
    );
  });

  it('店家狀態覆寫', async () => {
    mount();
    const { user } = await openPanel();
    await expand(user, '店家與時間');
    await user.click(screen.getByRole('radio', { name: '暫停接單' }));
    expect(demo.setState).toHaveBeenLastCalledWith({ storeOverride: 'PAUSED' });
  });

  it('時間穿梭：預設時間、快轉 +24 小時與回到實際時間；快轉後清除已過期的購物車', async () => {
    mount();
    const purge = vi.spyOn(useCartStore.getState(), 'purgeIfExpired');
    const { user } = await openPanel();
    await expand(user, '店家與時間');

    await user.click(screen.getByRole('button', { name: '午餐營業 12:00' }));
    const lunch = demo.setState.mock.lastCall?.[0].clockOverride;
    expect(lunch).toMatch(/T12:00:00\+08:00$/);

    const before = Date.now();
    await user.click(screen.getByRole('button', { name: '快轉 +24 小時' }));
    const forwarded = Date.parse(demo.setState.mock.lastCall?.[0].clockOverride ?? '');
    expect(Math.abs(forwarded - (before + 24 * 3_600_000))).toBeLessThan(10_000);
    expect(purge).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '快轉 +15 分鐘' }));
    const plus15 = Date.parse(demo.setState.mock.lastCall?.[0].clockOverride ?? '');
    expect(plus15).toBeGreaterThan(Date.now() - 10_000);

    await user.click(screen.getByRole('button', { name: '實際時間' }));
    expect(demo.setState).toHaveBeenLastCalledWith({ clockOverride: null });
  });

  it('自訂日期時間（台北時間）；格式無效時顯示錯誤且不寫入', async () => {
    mount();
    const { user } = await openPanel();
    await expand(user, '店家與時間');
    const input = screen.getByLabelText(/自訂日期時間/);
    fireEvent.change(input, { target: { value: '2026-10-20T20:40' } });
    await user.click(screen.getByRole('button', { name: '套用' }));
    expect(demo.setState).toHaveBeenLastCalledWith({ clockOverride: '2026-10-20T20:40:00+08:00' });

    demo.setState.mockClear();
    fireEvent.change(input, { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: '套用' }));
    expect(screen.getByText('請輸入有效的日期與時間')).toBeInTheDocument();
    expect(demo.setState).not.toHaveBeenCalled();
  });

  it('付款結果與網路延遲', async () => {
    mount();
    const { user } = await openPanel();
    await expand(user, '付款與網路');
    await user.click(screen.getByRole('radio', { name: '失敗' }));
    expect(demo.setState).toHaveBeenLastCalledWith({ nextPaymentResult: 'FAILED' });
    await user.click(screen.getByRole('radio', { name: '1500 ms' }));
    expect(demo.setState).toHaveBeenLastCalledWith({ latencyMs: 1500 });
  });

  it('指定端點的下一次請求失敗：端點 + 次數 + 持續失敗 + 取消預備', async () => {
    mount();
    const { user } = await openPanel();
    await expand(user, '付款與網路');
    await user.selectOptions(screen.getByLabelText('端點'), 'orders.pay');
    await user.click(screen.getByRole('radio', { name: '2 次' }));
    await user.click(screen.getByRole('button', { name: '預備失敗' }));
    expect(demo.setState).toHaveBeenLastCalledWith({
      failNext: { target: 'orders.pay', remaining: 2 },
    });
    expect(await screen.findByText(/已預備：付款將失敗 2 次/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '持續失敗' }));
    await user.click(screen.getByRole('button', { name: '預備失敗' }));
    expect(demo.setState).toHaveBeenLastCalledWith({
      failNext: { target: 'orders.pay', remaining: Number.MAX_SAFE_INTEGER },
    });

    await user.click(screen.getByRole('button', { name: '取消預備' }));
    expect(demo.setState).toHaveBeenLastCalledWith({ failNext: null });
  });

  it('載入菜單失敗預設 3 次（GET 內建重試 2 次）', async () => {
    mount();
    const { user } = await openPanel();
    await expand(user, '付款與網路');
    await user.selectOptions(screen.getByLabelText('端點'), 'store.getMenu');
    expect(screen.getByRole('radio', { name: '3 次' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: '預備失敗' }));
    expect(demo.setState).toHaveBeenLastCalledWith({
      failNext: { target: 'store.getMenu', remaining: 3 },
    });
  });

  it('菜單資料完整度', async () => {
    mount();
    const { user } = await openPanel();
    await expand(user, '菜單與外觀');
    await user.click(screen.getByRole('radio', { name: '無圖片' }));
    expect(demo.setState).toHaveBeenLastCalledWith({ menuProfile: 'NO_IMAGES' });
  });

  it('主題色：預設 7 組、店家設定、自訂色碼與對比提示；同步 store 並套用到 :root', async () => {
    mount();
    const { user } = await openPanel();
    await expand(user, '菜單與外觀');

    await user.click(screen.getByRole('radio', { name: '抹茶綠' }));
    expect(demo.setState).toHaveBeenLastCalledWith({ themeOverride: '#2E7D4F' });
    expect(useInputModeStore.getState().themeOverride).toBe('#2E7D4F');
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--color-brand')).toBe('#2E7D4F'),
    );

    // 檸檬黃：主色上的文字改用深色
    await user.click(screen.getByRole('radio', { name: '檸檬黃' }));
    expect(await screen.findByText(/按鈕文字自動使用深色（對比 11\.\d+:1）/)).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue('--color-on-brand')).toBe('#18181B');

    // 自訂色碼（簡寫與小寫會正規化為 #RRGGBB）
    await user.type(screen.getByLabelText(/自訂色碼/), '#c00');
    await user.click(screen.getByRole('button', { name: '套用' }));
    expect(demo.setState).toHaveBeenLastCalledWith({ themeOverride: '#CC0000' });

    // 無效色碼
    await user.clear(screen.getByLabelText(/自訂色碼/));
    await user.type(screen.getByLabelText(/自訂色碼/), 'red');
    await user.click(screen.getByRole('button', { name: '套用' }));
    expect(screen.getByText('請輸入正確的色碼，例如 #2E7D4F')).toBeInTheDocument();

    // 回到店家設定：還原店家品牌色
    await user.click(screen.getByRole('radio', { name: '店家設定' }));
    expect(demo.setState).toHaveBeenLastCalledWith({ themeOverride: null });
    expect(useInputModeStore.getState().themeOverride).toBeNull();
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--color-brand')).toBe('#D93A22'),
    );
  });

  it('輸入模式同時寫入 DemoState 與 useInputModeStore', async () => {
    mount();
    const { user } = await openPanel();
    await expand(user, '菜單與外觀');
    await user.click(screen.getByRole('radio', { name: '觸控面板' }));
    expect(demo.setState).toHaveBeenLastCalledWith({ inputMode: 'KIOSK' });
    expect(useInputModeStore.getState().inputMode).toBe('KIOSK');
    await user.click(screen.getByRole('radio', { name: '強制啟用快速鍵並顯示徽章' }));
    expect(useInputModeStore.getState().inputMode).toBe('KEYBOARD_HINTS');
  });

  it('重播鍵盤提醒：重設提醒旗標與單鍵快速鍵並發出重播請求', async () => {
    usePrefsStore.getState().enableHotkeys();
    usePrefsStore.getState().declineNotice();
    mount();
    const { user } = await openPanel();
    await expand(user, '菜單與外觀');
    await user.click(screen.getByRole('button', { name: '重播鍵盤提醒' }));
    const prefs = usePrefsStore.getState();
    expect(prefs.hotkeysEnabled).toBe(false);
    expect(prefs.kbdNotice.outcome).toBe('NONE');
    expect(useInputModeStore.getState().keyboardNoticeReplaySeq).toBe(1);
  });

  it('點餐記憶：載入範例（4 筆）與清除', async () => {
    mount();
    const { user } = await openPanel();
    await expand(user, '菜單與外觀');
    await user.click(screen.getByRole('button', { name: '載入範例' }));
    const map = usePrefsStore.getState().lastChoices;
    expect(Object.keys(map).sort()).toEqual(
      ['prd_beef_noodle', 'prd_black_tea', 'prd_lurou', 'prd_salt_chicken'].sort(),
    );
    expect(map['prd_lurou']?.note).toBe('不要蔥');
    expect(map['prd_salt_chicken']?.optionIds).toContain('opt_spice_xl');
    await user.click(screen.getByRole('button', { name: '清除' }));
    expect(usePrefsStore.getState().lastChoices).toEqual({});
  });
});

describe('對我的訂單執行店家動作', () => {
  it('只顯示合法轉換；按下後呼叫 demo.act 並 invalidate orders', async () => {
    useGuestOrdersStore.getState().upsert({
      orderId: 'ord_1',
      orderNo: 'ZO1',
      trackingToken: 'trk_1',
      placedAt: '2026-10-14T12:00:00+08:00',
    });
    mount({}, { orders: [order({ id: 'ord_1', status: 'PENDING', orderType: 'PICKUP' })] });
    const { user } = await openPanel();
    const accept = await screen.findByRole('button', { name: '接單' });
    expect(screen.getByRole('button', { name: '拒單' })).toBeInTheDocument();
    // 待接單時不會有「出餐 / 出發 / 完成」
    expect(screen.queryByRole('button', { name: '出餐' })).toBeNull();
    expect(screen.queryByRole('button', { name: '出發' })).toBeNull();
    expect(screen.queryByRole('button', { name: '完成' })).toBeNull();
    await user.click(accept);
    expect(demo.act).toHaveBeenCalledWith('ord_1', 'ACCEPT');
  });

  it('外送單可出餐後出發；自取單可直接完成', async () => {
    useGuestOrdersStore.getState().upsert({
      orderId: 'ord_2',
      orderNo: 'ZO2',
      trackingToken: 'trk_2',
      placedAt: '2026-10-14T12:00:00+08:00',
    });
    mount({}, { orders: [order({ id: 'ord_2', status: 'READY', orderType: 'DELIVERY' })] });
    await openPanel();
    expect(await screen.findByRole('button', { name: '出發' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '完成' })).toBeNull();
  });

  it('沒有進行中訂單、或待付款（無店家動作）時顯示說明', async () => {
    mount();
    await openPanel();
    expect(await screen.findByText(/目前沒有進行中的訂單/)).toBeInTheDocument();
  });

  it('已登入會員：納入 orders.list(active) 的訂單', async () => {
    useSessionStore
      .getState()
      .setSession(
        { accessToken: 'a', refreshToken: 'r', expiresIn: 900 },
        {
          id: 'usr_1',
          phone: '0900000000',
          marketingOptIn: false,
          createdAt: '2026-10-01T00:00:00+08:00',
        },
      );
    mount(
      {},
      {
        summaries: [
          {
            id: 'ord_m',
            orderNo: 'ZOM',
            orderType: 'DINE_IN',
            status: 'ACCEPTED',
            paymentStatus: 'UNPAID',
            pickupNo: 'A009',
            total: 100,
            itemCount: 1,
            itemsPreview: 'x',
            placedAt: '2026-10-14T12:00:00+08:00',
            scheduledAt: null,
          } as never,
        ],
      },
    );
    await openPanel();
    expect(await screen.findByRole('button', { name: '出餐' })).toBeInTheDocument();
    expect(screen.getByText(/A009・製作中（內用）/)).toBeInTheDocument();
  });
});

describe('庫存與時段情境（FR-DM-12）', () => {
  it('讀數、剩 n 份、恢復預設、自訂限量', async () => {
    mount({ limitOverrides: { prd_combo_share: 2 } });
    const { user } = await openPanel();
    await expand(user, '庫存與時段情境');
    expect(
      await screen.findByText('每日限量 5・今日已售 1・待付款保留 0・剩 4 份'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('商品')).toHaveValue('prd_combo_share');

    await user.click(screen.getByRole('button', { name: '剩 2 份' }));
    expect(demo.setRemaining).toHaveBeenLastCalledWith('prd_combo_share', 2);
    await user.click(screen.getByRole('button', { name: '用盡（剩 0 份）' }));
    expect(demo.setRemaining).toHaveBeenLastCalledWith('prd_combo_share', 0);

    await user.click(screen.getByRole('button', { name: '恢復預設' }));
    expect(demo.setState).toHaveBeenLastCalledWith({ limitOverrides: {} });

    const limit = screen.getByLabelText(/每日限量/);
    await user.clear(limit);
    await user.type(limit, '8');
    await user.click(screen.getByRole('button', { name: '套用限量' }));
    expect(demo.setLimit).toHaveBeenLastCalledWith('prd_combo_share', 8);

    await user.clear(limit);
    await user.click(screen.getByRole('button', { name: '套用限量' }));
    expect(demo.setLimit).toHaveBeenLastCalledWith('prd_combo_share', null);

    await user.type(limit, 'abc');
    await user.click(screen.getByRole('button', { name: '套用限量' }));
    expect(screen.getByText('請輸入 0 以上的整數')).toBeInTheDocument();
  });

  it('手動售完與調價（既有的售完旗標保留）', async () => {
    mount({ soldOutProductIds: ['prd_kong_rou'] });
    const { user } = await openPanel();
    await expand(user, '庫存與時段情境');
    await user.click(screen.getByRole('switch', { name: /手動售完/ }));
    expect(demo.setState).toHaveBeenLastCalledWith({
      soldOutProductIds: ['prd_kong_rou', 'prd_combo_share'],
    });
    await user.type(screen.getByLabelText(/暫時基本價/), '350');
    await user.click(screen.getByRole('button', { name: '套用價格' }));
    expect(demo.setState).toHaveBeenLastCalledWith({ priceOverrides: { prd_combo_share: 350 } });
  });

  it('模擬他人下單：份數 1–20、狀態；夾到剩餘時說明', async () => {
    mount();
    const { user } = await openPanel();
    await expand(user, '庫存與時段情境');
    const qty = screen.getByLabelText('份數');
    await user.clear(qty);
    await user.type(qty, '3');
    await user.click(screen.getByRole('radio', { name: '待付款（15 分鐘後釋放）' }));
    await user.click(screen.getByRole('button', { name: '他人現在下單' }));
    expect(demo.injectOtherOrder).toHaveBeenLastCalledWith({
      productId: 'prd_combo_share',
      quantity: 3,
      status: 'PENDING_PAYMENT',
    });

    demo.injectOtherOrder.mockResolvedValueOnce({ added: 1 });
    await user.click(screen.getByRole('button', { name: '他人現在下單' }));
    expect(
      await screen.findByText('只剩 1 份可注入（要求 3 份），已夾到剩餘份數'),
    ).toBeInTheDocument();

    await user.clear(qty);
    await user.type(qty, '21');
    await user.click(screen.getByRole('button', { name: '他人現在下單' }));
    expect(screen.getByText('請輸入 1–20 的整數')).toBeInTheDocument();
  });

  it('下一次送出前才發生：預備、顯示、取消預備', async () => {
    mount();
    const { user } = await openPanel();
    await expand(user, '庫存與時段情境');
    await user.click(screen.getByRole('radio', { name: '他人買走' }));
    const qty = screen.getByLabelText('買走份數');
    await user.clear(qty);
    await user.type(qty, '5');
    await user.click(screen.getByRole('button', { name: '預備' }));
    expect(demo.armRace).toHaveBeenLastCalledWith({
      soldOutProductIds: [],
      buy: [{ productId: 'prd_combo_share', quantity: 5 }],
      fillSlots: [],
    });
    expect(await screen.findByText('他人會先買走 雙人分享餐 ×5')).toBeInTheDocument();
    // 入口提示已預備（Sheet 開啟時背景為 aria-hidden，故由圓點取得按鈕）
    expect(screen.getByTestId('demo-fab-dot').parentElement).toHaveAttribute(
      'aria-label',
      'Demo 工具，已預備 1 項下次送出的模擬',
    );

    await user.click(screen.getByRole('radio', { name: '商品變售完' }));
    await user.click(screen.getByRole('button', { name: '預備' }));
    expect(demo.armRace).toHaveBeenLastCalledWith({
      soldOutProductIds: ['prd_combo_share'],
      buy: [{ productId: 'prd_combo_share', quantity: 5 }],
      fillSlots: [],
    });

    await user.click(screen.getByRole('radio', { name: '時段額滿' }));
    await user.click(screen.getByRole('button', { name: '預備' }));
    expect(demo.armRace.mock.lastCall?.[0].fillSlots).toEqual([
      { startAt: '2026-10-14T12:30:00+08:00', leave: 0 },
    ]);

    await user.click(screen.getByRole('button', { name: '取消預備' }));
    expect(demo.disarmRace).toHaveBeenCalled();
    expect(await screen.findByText('目前沒有預備項目。')).toBeInTheDocument();
  });

  it('預約時段：讓此時段額滿 / 只剩 1 個名額；清除他人訂單', async () => {
    mount();
    const { user } = await openPanel();
    await expand(user, '庫存與時段情境');
    await user.click(await screen.findByRole('button', { name: '讓此時段額滿' }));
    expect(demo.fillSlot).toHaveBeenLastCalledWith('2026-10-14T12:30:00+08:00', 0);
    await user.click(screen.getByRole('button', { name: '只剩 1 個名額' }));
    expect(demo.fillSlot).toHaveBeenLastCalledWith('2026-10-14T12:30:00+08:00', 1);
    await user.click(screen.getByRole('button', { name: '清除他人訂單' }));
    expect(demo.clearOtherOrders).toHaveBeenCalled();
    expect(await screen.findByText('已清除 2 筆他人訂單')).toBeInTheDocument();
    // 寫入後 invalidate pickup-slots（['store']）
    expect(invalidate).toHaveBeenCalled();
  });
});

describe('送出結果（FR-DM-13）', () => {
  it('下一次送出：正常 / 失敗，未建立訂單 / 回應遺失，訂單已建立', async () => {
    mount();
    const { user } = await openPanel();
    await expand(user, '送出結果');
    expect(screen.getByRole('radio', { name: '正常' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: '回應遺失，訂單已建立' }));
    expect(demo.setState).toHaveBeenLastCalledWith({
      failNext: { target: 'orders.create', remaining: 1, phase: 'AFTER_COMMIT' },
    });
    await user.click(screen.getByRole('radio', { name: '失敗，未建立訂單' }));
    expect(demo.setState).toHaveBeenLastCalledWith({
      failNext: { target: 'orders.create', remaining: 1, phase: 'BEFORE' },
    });
    await user.click(screen.getByRole('radio', { name: '正常' }));
    expect(demo.setState).toHaveBeenLastCalledWith({ failNext: null });
  });

  it('選「正常」不會清掉其他端點的失敗注入', async () => {
    mount({ failNext: { target: 'orders.pay', remaining: 2 } });
    const { user } = await openPanel();
    await expand(user, '送出結果');
    demo.setState.mockClear();
    await user.click(screen.getByRole('radio', { name: '正常' }));
    expect(demo.setState).not.toHaveBeenCalled();
  });

  it('最近 5 筆送出紀錄：結果、取回原訂單、Key 片段與時間', async () => {
    mount();
    demo.getCreateLog.mockReturnValue([
      {
        at: '2026-10-14T12:03:15+08:00',
        idempotencyKey: 'aaaaaaaa-1111-2222-3333-bbbbbbbbcccc',
        outcome: 'REPLAYED',
        orderNo: 'ZO261014K7M3QX',
      },
      {
        at: '2026-10-14T12:03:11+08:00',
        idempotencyKey: 'aaaaaaaa-1111-2222-3333-bbbbbbbbcccc',
        outcome: 'RESPONSE_LOST',
        orderNo: 'ZO261014K7M3QX',
      },
      {
        at: '2026-10-14T12:02:40+08:00',
        idempotencyKey: 'dddddddd-1111-2222-3333-eeeeeeeeffff',
        outcome: 'REJECTED',
        code: 'ITEM_SOLD_OUT',
        summary: '雙人分享餐今日售完',
      },
    ]);
    const { user } = await openPanel();
    await expand(user, '送出結果');
    expect(demo.getCreateLog).toHaveBeenCalledWith(5);
    const list = await screen.findByRole('list');
    expect(list).toHaveTextContent('12:03:15');
    expect(list).toHaveTextContent('重送 → 取回原訂單 ZO261014K7M3QX（未重複建立）');
    expect(list).toHaveTextContent('回應遺失（訂單已建立 ZO261014K7M3QX）');
    expect(list).toHaveTextContent('被拒：雙人分享餐今日售完');
    expect(list).toHaveTextContent('Key …bbbbcccc');
  });
});

describe('帳號與資料', () => {
  it('快速登入：loginAsDemoUser → refresh（tokens）→ me.get（user）→ 寫入 sessionStore 並 invalidate me / orders', async () => {
    const { api } = mount();
    const { user } = await openPanel();
    await expand(user, '帳號與資料');
    await user.click(screen.getByRole('button', { name: '快速登入示範會員' }));
    await waitFor(() => expect(useSessionStore.getState().user?.name).toBe('示範會員'));
    expect(demo.loginAsDemoUser).toHaveBeenCalled();
    expect(api.auth.refresh).toHaveBeenCalledWith();
    expect(api.auth.verifyOtp).not.toHaveBeenCalled();
    expect(useSessionStore.getState().tokens?.refreshToken).toBe('ref');
    await waitFor(() => expect(invalidatedKeys()).toContain('["me"]'));
  });

  it('refresh 失敗時改走 Demo 驗證碼（0900000000 / 123456）', async () => {
    const { api } = mount();
    api.auth.refresh.mockRejectedValueOnce(new Error('no cookie'));
    const { user } = await openPanel();
    await expand(user, '帳號與資料');
    await user.click(screen.getByRole('button', { name: '快速登入示範會員' }));
    await waitFor(() => expect(useSessionStore.getState().user).not.toBeNull());
    expect(api.auth.verifyOtp).toHaveBeenCalledWith('0900000000', '123456');
    expect(useSessionStore.getState().tokens?.refreshToken).toBe('ref2');
  });

  it('重置 Demo 資料：需確認；確認後記憶體 store 歸零並呼叫 resetAll', async () => {
    useCartStore.getState().addLine({
      productId: 'p',
      quantity: 1,
      optionIds: [],
      snapshot: { name: 'x', unitPrice: 1, optionLabels: [] },
    });
    usePrefsStore.getState().patch({ guestProfile: { name: '王小明' } });
    mount();
    const { user } = await openPanel();
    await expand(user, '帳號與資料');
    await user.click(screen.getByRole('button', { name: '重置 Demo 資料' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(demo.resetAll).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: '重置' }));
    await waitFor(() => expect(demo.resetAll).toHaveBeenCalledTimes(1));
    expect(useCartStore.getState().lines).toEqual([]);
    expect(usePrefsStore.getState().guestProfile).toBeNull();
  });
});

describe('觸控面板模式', () => {
  it('頂部列的入口仍在（可改回「自動」），但不顯示橫幅、「庫存與時段情境」與「送出結果」', async () => {
    useInputModeStore.setState({ inputMode: 'KIOSK' });
    mount({ inputMode: 'KIOSK' });
    expect(screen.queryByRole('region', { name: '示範站台提示' })).toBeNull();
    const { user } = await openPanel();
    expect(screen.getByRole('button', { name: '訂單模擬' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '庫存與時段情境' })).toBeNull();
    expect(screen.queryByRole('button', { name: '送出結果' })).toBeNull();
    await expand(user, '菜單與外觀');
    await user.click(screen.getByRole('radio', { name: '自動' }));
    expect(useInputModeStore.getState().inputMode).toBe('AUTO');
    expect(await screen.findByRole('button', { name: '庫存與時段情境' })).toBeInTheDocument();
  });
});

describe('目前情境與模擬時間', () => {
  it('顯示目前模擬時間與非預設的情境（含網址參數預備者）', async () => {
    mount({
      clockOverride: '2026-10-14T20:40:00+08:00',
      storeOverride: 'CLOSED',
      latencyMs: 1500,
      limitOverrides: { prd_combo_share: 2 },
    });
    await openPanel();
    expect(screen.getByText('目前模擬時間')).toBeInTheDocument();
    expect(screen.getByText('時間穿梭中')).toBeInTheDocument();
    expect(screen.getByText('店家狀態：強制休息')).toBeInTheDocument();
    expect(screen.getByText('延遲 1500 ms')).toBeInTheDocument();
    expect(screen.getByText('1 項每日限量覆寫')).toBeInTheDocument();
  });

  it('全部為預設值時顯示說明', async () => {
    mount();
    await openPanel();
    expect(screen.getByText('全部為預設值')).toBeInTheDocument();
    expect(demo.getState).toHaveBeenCalled();
  });
});

describe('≥ 768 的浮動面板（非 modal）', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: /min-width:\s*(768|1024)px/.test(query),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('role=dialog、aria-modal=false；Esc 收合並把焦點還給頂部列的入口；背景不 inert', async () => {
    mount();
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Demo 工具' });
    await user.click(trigger);
    const panel = await screen.findByRole('dialog', { name: 'Demo 工具' });
    expect(panel).toHaveAttribute('aria-modal', 'false');
    // 非 modal 的浮動面板：固定定位、不遮罩背景
    expect(panel.className).toContain('fixed');
    expect(trigger).not.toHaveAttribute('aria-hidden');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Demo 工具' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Demo 工具' })).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
