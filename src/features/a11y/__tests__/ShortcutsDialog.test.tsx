import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { HOTKEYS } from '@/domain/hotkeys';
import { useGuestOrdersStore } from '@/features/orders/guestOrdersStore';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { renderWithProviders } from '@/test/renderWithProviders';
import { HotkeyProvider } from '../HotkeyProvider';
import { LiveAnnouncer } from '../LiveAnnouncer';
import { noticeSession } from '../noticeSession';
import { useShortcutsDialog } from '../useShortcutsDialog';
import { resetA11yState } from './helpers';

beforeEach(() => {
  resetA11yState();
});

function Opener({ focus }: { focus?: 'shortcuts' | 'preferences' }) {
  const dialog = useShortcutsDialog();
  return (
    <button type="button" onClick={() => dialog.open(focus ? { focus } : undefined)}>
      開啟偏好
    </button>
  );
}

function setup(focus?: 'shortcuts' | 'preferences') {
  const user = userEvent.setup();
  renderWithProviders(
    <HotkeyProvider>
      <Opener focus={focus} />
      <LiveAnnouncer />
    </HotkeyProvider>,
  );
  return user;
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '開啟偏好' }));
  return screen.findByRole('dialog', { name: '鍵盤快速鍵與偏好' });
}

describe('ShortcutsDialog（PG-19）', () => {
  it('開啟：標示本次載入已開啟過偏好；副標依單鍵開關狀態切換', async () => {
    const user = setup();
    const dialog = await openDialog(user);
    expect(noticeSession.getState().prefsOpenedThisLoad).toBe(true);
    expect(dialog).toHaveAccessibleDescription(
      '開啟下方開關後，按 ? 即可隨時開啟此說明；在輸入框內與輸入法組字時不會觸發',
    );
    expect(within(dialog).getByText(/以下為開啟後的鍵位/)).toBeInTheDocument();

    act(() => usePrefsStore.getState().enableHotkeys());
    expect(dialog).toHaveAccessibleDescription('按 ? 隨時開啟；在輸入框內與輸入法組字時不會觸發');
    expect(within(dialog).queryByText(/以下為開啟後的鍵位/)).not.toBeInTheDocument();
  });

  it('鍵位表由 HOTKEYS 登錄表產生：每個說明都列出，且依範圍分區', async () => {
    const user = setup();
    const dialog = await openDialog(user);
    for (const def of HOTKEYS) {
      expect(within(dialog).getAllByText(def.label, { exact: false }).length).toBeGreaterThan(0);
    }
    for (const heading of ['全域', '菜單頁', '商品面板', '購物車 / 訂單面板', '結帳頁', '訂單頁']) {
      expect(within(dialog).getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    expect(within(dialog).getByText('方向鍵與 Tab')).toBeInTheDocument();
  });

  it('「啟用單鍵快速鍵」預設關閉；切換即寫入偏好，關閉不改變已決定的 outcome', async () => {
    const user = setup();
    const dialog = await openDialog(user);
    const sw = within(dialog).getByRole('switch', { name: '啟用單鍵快速鍵' });
    expect(sw).not.toBeChecked();
    expect(sw).toHaveAccessibleDescription(/使用螢幕閱讀器時/);

    await user.click(sw);
    expect(usePrefsStore.getState().hotkeysEnabled).toBe(true);
    expect(usePrefsStore.getState().kbdNotice.outcome).toBe('ACCEPTED');

    await user.click(sw);
    expect(usePrefsStore.getState().hotkeysEnabled).toBe(false);
    expect(usePrefsStore.getState().kbdNotice.outcome).toBe('ACCEPTED');
  });

  it('偏好立即生效：記住選項、大字、減少動態、菜單版面', async () => {
    const user = setup();
    const dialog = await openDialog(user);

    const remember = within(dialog).getByRole('switch', {
      name: '記住上次點過的選項（僅存於此裝置）',
    });
    expect(remember).toBeChecked();
    await user.click(remember);
    expect(usePrefsStore.getState().rememberChoices).toBe(false);

    await user.click(within(dialog).getByRole('switch', { name: '大字模式（文字放大 12.5%）' }));
    expect(usePrefsStore.getState().largeText).toBe(true);

    await user.click(within(dialog).getByRole('switch', { name: '減少動態' }));
    expect(usePrefsStore.getState().reduceMotion).toBe(true);

    const auto = within(dialog).getByRole('radio', { name: /自動/ });
    expect(auto).toBeChecked();
    await user.click(within(dialog).getByRole('radio', { name: /清單/ }));
    expect(usePrefsStore.getState().menuLayoutOverride).toBe('LIST');
  });

  it('清除我的資料需二次確認（預設焦點在取消）；確認後清除訪客資料、點餐記憶與本機訂單，不清購物車與偏好', async () => {
    usePrefsStore.setState({
      guestProfile: { name: '王小明', phone: '0912345678' },
      lastChoices: { p1: { productId: 'p1' } as never },
      largeText: true,
    });
    useGuestOrdersStore.getState().upsert({
      orderId: 'o1',
      orderNo: 'ZO1',
      trackingToken: 'tok',
      placedAt: '2026-10-14T12:00:00+08:00',
    });
    const user = setup();
    const dialog = await openDialog(user);

    await user.click(within(dialog).getByRole('button', { name: '清除我的資料' }));
    const confirm = await screen.findByRole('alertdialog');
    await waitFor(() =>
      expect(within(confirm).getByRole('button', { name: '取消' })).toHaveFocus(),
    );

    await user.click(within(confirm).getByRole('button', { name: '取消' }));
    expect(usePrefsStore.getState().guestProfile).not.toBeNull();

    await user.click(within(dialog).getByRole('button', { name: '清除我的資料' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: '清除' }),
    );
    await waitFor(() => expect(usePrefsStore.getState().guestProfile).toBeNull());
    expect(usePrefsStore.getState().lastChoices).toEqual({});
    expect(useGuestOrdersStore.getState().orders).toEqual([]);
    expect(usePrefsStore.getState().largeText).toBe(true);
  });

  it('Esc 關閉並把焦點還原給入口', async () => {
    const user = setup();
    const trigger = screen.getByRole('button', { name: '開啟偏好' });
    await openDialog(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('「完成」關閉對話框', async () => {
    const user = setup();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: '完成' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('觸控面板模式不提供', async () => {
    act(() => useInputModeStore.getState().setInputMode('KIOSK'));
    const user = setup();
    await user.click(screen.getByRole('button', { name: '開啟偏好' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('對話框開啟期間為純對話框範圍：背景單鍵失效', async () => {
    usePrefsStore.getState().enableHotkeys();
    const user = setup();
    await openDialog(user);
    // 在對話框內按 c 不應觸發任何背景動作（此處沒有處理器；至少不擲錯、對話框維持開啟）
    await user.keyboard('c');
    expect(screen.getByRole('dialog', { name: '鍵盤快速鍵與偏好' })).toBeInTheDocument();
  });
});
