// Demo 入口（頂部列）：外觀與可存取名稱、面板旗標、預備項數的小圓點，以及「主 bundle 只能依賴輕量模組」的約束
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import type { DemoState } from '@/services/api/mock/demoControl';
import { renderWithProviders } from '@/test/renderWithProviders';
import { DemoTrigger } from '../DemoTrigger';
import { createDemoApi, createFakeDemo } from './demoTestUtils';
import type { FakeDemo } from './demoTestUtils';

vi.mock('@/config/env', async (importOriginal) => ({
  env: { ...(await importOriginal<{ env: object }>()).env, demoMode: true },
}));

let demo: FakeDemo;

function mount(initial: Parameters<typeof createFakeDemo>[0] = {}) {
  demo = createFakeDemo(initial);
  return renderWithProviders(<DemoTrigger />, { api: createDemoApi(demo) });
}

beforeEach(() => {
  useInputModeStore.setState({
    inputMode: 'AUTO',
    themeOverride: null,
    demoPanelOpen: false,
    demoStateSeq: 0,
    keyboardNoticeReplaySeq: 0,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DemoTrigger：外觀與可存取名稱', () => {
  it('按鈕名稱為「Demo 工具」（E2E 與測試以 /^Demo 工具/ 找它）；圖示與「Demo」文字對輔助科技隱藏', () => {
    mount();
    const trigger = screen.getByRole('button', { name: 'Demo 工具' });
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('data-demo-trigger');
    // 可見文字「Demo」只在 ≥ 1024 顯示（CSS），且 aria-hidden：名稱只來自 aria-label，不會變成「Demo Demo 工具」
    const label = trigger.querySelector('span[aria-hidden="true"]');
    expect(label).toHaveTextContent('Demo');
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByTestId('demo-fab-dot')).toBeNull();
  });

  it('深色底（不使用品牌色）；< 1024 為圓形圖示鈕、≥ 1024 為膠囊（class 契約）', () => {
    mount();
    const cls = screen.getByRole('button', { name: 'Demo 工具' }).className;
    expect(cls).toContain('bg-text');
    expect(cls).toContain('text-bg');
    expect(cls).not.toMatch(/bg-brand/);
    // 44px（觸控面板 56px，由 --hit-size 決定）的圓形；膠囊高 40，觸控面板維持 --hit-size
    expect(cls).toContain('size-(--hit-size)');
    expect(cls).toContain('rounded-pill');
    expect(cls).toContain('lg:h-10');
    expect(cls).toContain('kiosk:lg:h-(--hit-size)');
    // 不浮動：沒有任何定位為 fixed / absolute 的 class（小圓點除外，它在子元素上）
    expect(cls).not.toMatch(/(^|\s)(fixed|absolute|sticky)(\s|$)/);
  });
});

describe('DemoTrigger：面板旗標（useInputModeStore.demoPanelOpen 是單一事實來源）', () => {
  it('點擊切換旗標；aria-expanded 與 aria-controls 同步', async () => {
    const user = userEvent.setup();
    mount();
    const trigger = screen.getByRole('button', { name: 'Demo 工具' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('aria-controls');

    await user.click(trigger);
    expect(useInputModeStore.getState().demoPanelOpen).toBe(true);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', 'zaiorder-demo-panel');

    await user.click(trigger);
    expect(useInputModeStore.getState().demoPanelOpen).toBe(false);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('可由鍵盤操作：Tab 到達、Enter 與 Space 各切換一次', async () => {
    const user = userEvent.setup();
    mount();
    await user.tab();
    const trigger = screen.getByRole('button', { name: 'Demo 工具' });
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(useInputModeStore.getState().demoPanelOpen).toBe(true);
    await user.keyboard(' ');
    expect(useInputModeStore.getState().demoPanelOpen).toBe(false);
  });

  it('旗標由別處設定（橫幅、面板關閉鈕、其他程式）時，入口跟著反映', () => {
    mount();
    act(() => useInputModeStore.getState().setDemoPanelOpen(true));
    expect(screen.getByRole('button', { name: 'Demo 工具' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});

describe('DemoTrigger：「下一次送出」預備情境的小圓點', () => {
  const armed: Partial<DemoState> = {
    raceOnNextCreate: {
      soldOutProductIds: ['prd_combo_share'],
      buy: [{ productId: 'prd_combo_share', quantity: 5 }],
    },
    failNext: { target: 'orders.create', remaining: 1 },
  };

  it('第一次繪製就帶圓點與 aria-label（網址參數預備的情境不必等輪詢）', () => {
    mount(armed);
    expect(
      screen.getByRole('button', { name: 'Demo 工具，已預備 3 項下次送出的模擬' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('demo-fab-dot')).toHaveAttribute('aria-hidden', 'true');
  });

  it('針對其他端點的失敗注入不算預備項目', () => {
    mount({ failNext: { target: 'orders.pay', remaining: 2 } });
    expect(screen.queryByTestId('demo-fab-dot')).toBeNull();
    expect(screen.getByRole('button', { name: 'Demo 工具' })).toBeInTheDocument();
  });

  it('面板寫入後（notifyDemoStateChanged）立即更新，不必等下一次輪詢', () => {
    mount();
    expect(screen.queryByTestId('demo-fab-dot')).toBeNull();
    demo.current = { ...demo.current, ...armed };
    act(() => useInputModeStore.getState().notifyDemoStateChanged());
    expect(screen.getByTestId('demo-fab-dot')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Demo 工具，已預備 3 項下次送出的模擬' }),
    ).toBeInTheDocument();
  });

  it('每秒輪詢外部變更：預備情境在送出時被消耗後，圓點消失、名稱回到「Demo 工具」', async () => {
    vi.useFakeTimers();
    mount(armed);
    expect(screen.getByTestId('demo-fab-dot')).toBeInTheDocument();
    demo.current = { ...demo.current, raceOnNextCreate: null, failNext: null };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(screen.queryByTestId('demo-fab-dot')).toBeNull();
    expect(screen.getByRole('button', { name: 'Demo 工具' })).toBeInTheDocument();
  });

  it('卸載後停止輪詢（不再讀取 DemoControl）', async () => {
    vi.useFakeTimers();
    const { unmount } = mount();
    unmount();
    demo.getState.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(demo.getState).not.toHaveBeenCalled();
  });
});

describe('DemoTrigger 不渲染的情況', () => {
  it('HTTP 模式（沒有 DemoControl）', () => {
    renderWithProviders(<DemoTrigger />, { api: createDemoApi(null) });
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('[data-demo-trigger]')).toBeNull();
  });
});

describe('主 bundle 的輕量約束（頂部列靜態匯入 DemoTrigger）', () => {
  /** 讀 `src/` 底下的原始碼 */
  const read = (file: string): string => readFileSync(resolve(process.cwd(), 'src', file), 'utf8');
  /** 只列出 import / export … from 的模組路徑（含 `import type`） */
  const importsOf = (file: string): string[] =>
    [...read(file).matchAll(/^(?:import|export)\s[^;]*?from\s+'([^']+)'/gms)].map((m) => m[1]!);

  it('DemoTrigger 只依賴輕量模組：不匯入面板、DemoRoot、Radix、整份 demo 文案或 scenario', async () => {
    const allowed = [
      'clsx',
      'lucide-react',
      'react',
      '@/config/env',
      '@/features/prefs/inputModeStore',
      '@/hooks/useDemoControl',
      '@/i18n/strings/demoTrigger',
      '@/services/api/mock/demoControl', // 只有型別（import type）
      './armed',
      './constants',
    ];
    expect(importsOf('features/demo/DemoTrigger.tsx').filter((m) => !allowed.includes(m))).toEqual(
      [],
    );
    expect(read('features/demo/DemoTrigger.tsx')).toMatch(
      /import type \{ DemoControl \} from '@\/services\/api\/mock\/demoControl'/,
    );
  });

  it('armed.ts 只有型別相依；demoTrigger.ts 與 constants.ts 沒有任何相依', () => {
    expect(importsOf('features/demo/armed.ts')).toEqual(['@/services/api/mock/demoControl']);
    expect(read('features/demo/armed.ts')).toMatch(/import type \{ DemoState \}/);
    expect(importsOf('i18n/strings/demoTrigger.ts')).toEqual([]);
    expect(importsOf('features/demo/constants.ts')).toEqual([]);
  });
});
