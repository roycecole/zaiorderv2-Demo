// Dialog 的實作延後載入（NFR-03）：在「全新的模組登錄」下驗證第一次開啟——載入完成前不輸出內容、
// 完成後顯示並移焦點，Esc 關閉後焦點回到觸發者。
// 其他測試的 setup 會先載入浮層實作（維持同步渲染），因此這裡以 vi.resetModules() 取得尚未載入的 Dialog。
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
});

describe('Dialog 第一次開啟才載入實作', () => {
  it('開啟 → 載入 → 顯示並聚焦標題；Esc 關閉後焦點還原給觸發者', async () => {
    vi.resetModules();
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { Dialog } = await import('../Dialog');
    const { preloadAllOverlays } = await import('../lazyOverlay');
    const h = React.createElement;
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;

    function Harness() {
      const [open, setOpen] = React.useState(false);
      return h(
        React.Fragment,
        null,
        h('button', { type: 'button', onClick: () => setOpen(true) }, '開啟'),
        h(Dialog, { open, onOpenChange: setOpen, title: '延後載入的對話框' }, '內容'),
      );
    }

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(h(Harness));
    });

    // 從未開啟：沒有任何對話框內容
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    const trigger = container.querySelector('button') as HTMLButtonElement;
    trigger.focus();
    await React.act(async () => {
      trigger.click();
    });
    // 開啟後等實作載入完成（preloadAllOverlays 與元件共用同一個進行中的載入）
    await React.act(async () => {
      await preloadAllOverlays();
    });

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('延後載入的對話框');
    expect(dialog?.contains(document.activeElement)).toBe(true);

    await React.act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));

    await React.act(async () => root.unmount());
  });
});
