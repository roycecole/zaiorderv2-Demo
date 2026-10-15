// PG-09 登入：手機 → OTP → 導向 redirect；OTP 錯誤、鎖定、限流；新會員補姓名；Demo 提示
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OtpVerifyResponse, UserProfile } from '@/domain/types';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { LoginPage } from '../LoginPage';
import { useSessionStore } from '../sessionStore';

const demoState = vi.hoisted(() => ({ control: null as null | { loginAsDemoUser: () => Promise<void> } }));
vi.mock('@/hooks/useDemoControl', () => ({ useDemoControl: () => demoState.control }));

const user: UserProfile = {
  id: 'usr_1',
  phone: '0912345678',
  name: '王小明',
  marketingOptIn: false,
  createdAt: '2026-10-01T00:00:00+08:00',
};
const verified = (isNewUser = false): OtpVerifyResponse => ({
  tokens: { accessToken: 'acc', refreshToken: 'ref', expiresIn: 900 },
  user: isNewUser ? { ...user, name: undefined } : user,
  isNewUser,
});
const apiError = (status: number, code: string, body: Record<string, unknown> = {}) =>
  Object.assign(new Error(code), { status, code, body: { code, ...body } });

function Probe() {
  const loc = useLocation();
  return <p data-testid="location">{`${loc.pathname}${loc.search}`}</p>;
}

function renderLogin(api = createFakeApi(), route = '/login') {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<Probe />} />
    </Routes>,
    { api, route },
  );
}

async function sendOtp(u: ReturnType<typeof userEvent.setup>, phone = '0912-345-678') {
  await u.type(screen.getByLabelText(/手機號碼/), phone);
  await u.click(screen.getByRole('button', { name: '發送驗證碼' }));
  await screen.findByRole('group', { name: '驗證碼' });
}

beforeEach(() => {
  demoState.control = null;
  useSessionStore.getState().clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('LoginPage', () => {
  it('標示登入為選用，並提供「以訪客身分繼續」回到來源頁', async () => {
    renderLogin(createFakeApi(), '/login?redirect=%2Forders%2Flookup');
    expect(screen.getByText(/登入為選用，可直接以訪客點餐/)).toBeInTheDocument();
    const guest = screen.getByRole('link', { name: '以訪客身分繼續' });
    expect(guest).toHaveAttribute('href', '/orders/lookup');
  });

  it('來源是會員專屬頁時，訪客繼續回到首頁', () => {
    renderLogin(createFakeApi(), '/login?redirect=%2Faccount%2Fprofile');
    expect(screen.getByRole('link', { name: '以訪客身分繼續' })).toHaveAttribute('href', '/');
  });

  it('手機格式錯誤：顯示欄位錯誤，不呼叫 API', async () => {
    const u = userEvent.setup();
    const sendOtpFn = vi.fn();
    renderLogin(createFakeApi({ auth: { sendOtp: sendOtpFn } }));
    await u.type(screen.getByLabelText(/手機號碼/), '123');
    await u.click(screen.getByRole('button', { name: '發送驗證碼' }));
    expect(await screen.findByText('請輸入正確的手機號碼（09 開頭，共 10 碼）')).toBeInTheDocument();
    expect(screen.getByLabelText(/手機號碼/)).toHaveAttribute('aria-invalid', 'true');
    expect(sendOtpFn).not.toHaveBeenCalled();
  });

  it('輸入時自動插入連字號，送出時以純數字呼叫 sendOtp', async () => {
    const u = userEvent.setup();
    const sendOtpFn = vi.fn().mockResolvedValue({ resendAfterSeconds: 60 });
    renderLogin(createFakeApi({ auth: { sendOtp: sendOtpFn } }));
    const input = screen.getByLabelText(/手機號碼/);
    await u.type(input, '0912345678');
    expect(input).toHaveValue('0912-345-678');
    await u.click(screen.getByRole('button', { name: '發送驗證碼' }));
    await screen.findByRole('group', { name: '驗證碼' });
    expect(sendOtpFn).toHaveBeenCalledWith('0912345678');
    expect(screen.getByText('60 秒後可重新發送')).toBeInTheDocument();
  });

  it('輸入滿 6 碼自動驗證，成功後寫入 Session 並導向 redirect', async () => {
    const u = userEvent.setup();
    const verify = vi.fn().mockResolvedValue(verified());
    renderLogin(
      createFakeApi({
        auth: { sendOtp: async () => ({ resendAfterSeconds: 60 }), verifyOtp: verify },
      }),
      '/login?redirect=%2Forders%3Ftab%3Dcompleted',
    );
    await sendOtp(u);
    await u.keyboard('123456');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/orders?tab=completed'));
    expect(verify).toHaveBeenCalledWith('0912345678', '123456');
    expect(useSessionStore.getState().user?.id).toBe('usr_1');
    expect(useSessionStore.getState().tokens?.accessToken).toBe('acc');
  });

  it('redirect 為站外網址時一律回到首頁（防 open redirect）', async () => {
    const u = userEvent.setup();
    renderLogin(
      createFakeApi({
        auth: {
          sendOtp: async () => ({ resendAfterSeconds: 60 }),
          verifyOtp: async () => verified(),
        },
      }),
      '/login?redirect=%2F%2Fevil.example%2Fphish',
    );
    await sendOtp(u);
    await u.keyboard('123456');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
  });

  it('OTP_INVALID：顯示剩餘次數、清空驗證碼並把焦點放回第一格', async () => {
    const u = userEvent.setup();
    renderLogin(
      createFakeApi({
        auth: {
          sendOtp: async () => ({ resendAfterSeconds: 60 }),
          verifyOtp: async () => {
            throw apiError(400, 'OTP_INVALID', { remainingAttempts: 3 });
          },
        },
      }),
    );
    await sendOtp(u);
    await u.keyboard('111111');
    const message = await screen.findByText('驗證碼不正確，還可以再試 3 次');
    expect(message.closest('[role="alert"]')).not.toBeNull();
    const cells = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(cells.every((c) => c.value === '')).toBe(true);
    expect(cells[0]).toHaveFocus();
    expect(cells[0]).toHaveAttribute('aria-invalid', 'true');
    expect(useSessionStore.getState().user).toBeNull();
  });

  it('OTP_LOCKED：停用輸入並顯示等待時間', async () => {
    const u = userEvent.setup();
    renderLogin(
      createFakeApi({
        auth: {
          sendOtp: async () => ({ resendAfterSeconds: 60 }),
          verifyOtp: async () => {
            throw apiError(423, 'OTP_LOCKED', { retryAfterSeconds: 600 });
          },
        },
      }),
    );
    await sendOtp(u);
    await u.keyboard('111111');
    expect(await screen.findByText('驗證錯誤次數過多，請稍後再試')).toBeInTheDocument();
    expect(screen.getByText(/請等 (10 分鐘|10 分 \d 秒|9 分 \d+ 秒)後再試/)).toBeInTheDocument();
    for (const c of screen.getAllByRole('textbox')) expect(c).toBeDisabled();
  });

  it('發送被限流（OTP_RATE_LIMITED）：顯示說明，並可直接輸入已收到的驗證碼', async () => {
    const u = userEvent.setup();
    renderLogin(
      createFakeApi({
        auth: {
          sendOtp: async () => {
            throw apiError(429, 'OTP_RATE_LIMITED', { retryAfterSeconds: 42 });
          },
        },
      }),
    );
    await u.type(screen.getByLabelText(/手機號碼/), '0912345678');
    await u.click(screen.getByRole('button', { name: '發送驗證碼' }));
    expect(await screen.findByText('驗證碼發送太頻繁，請稍後再試')).toBeInTheDocument();
    expect(screen.getByText('請等 42 秒後再試')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: '我已收到驗證碼' }));
    expect(screen.getByRole('group', { name: '驗證碼' })).toBeInTheDocument();
  });

  it('倒數結束後出現「重新發送驗證碼」，再次呼叫 sendOtp', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const sendOtpFn = vi.fn().mockResolvedValue({ resendAfterSeconds: 3 });
    renderLogin(createFakeApi({ auth: { sendOtp: sendOtpFn } }));
    await sendOtp(u);
    expect(screen.queryByRole('button', { name: '重新發送驗證碼' })).not.toBeInTheDocument();
    expect(screen.getByText('3 秒後可重新發送')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    const resend = await screen.findByRole('button', { name: '重新發送驗證碼' });
    await u.click(resend);
    expect(sendOtpFn).toHaveBeenCalledTimes(2);
  });

  it('新會員：登入後進入補姓名步驟（選填），儲存姓名後導向 redirect', async () => {
    const u = userEvent.setup();
    const update = vi.fn().mockResolvedValue({ ...user, name: '小明' });
    renderLogin(
      createFakeApi({
        auth: {
          sendOtp: async () => ({ resendAfterSeconds: 60 }),
          verifyOtp: async () => verified(true),
        },
        me: { update },
      }),
      '/login?redirect=%2Fcart',
    );
    await sendOtp(u);
    await u.keyboard('123456');
    const name = await screen.findByLabelText(/姓名/);
    expect(screen.getByRole('heading', { name: '歡迎加入' })).toBeInTheDocument();
    expect(useSessionStore.getState().user).not.toBeNull();
    await u.type(name, '小明');
    await u.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/cart'));
    expect(update).toHaveBeenCalledWith({ name: '小明' });
    expect(useSessionStore.getState().user?.name).toBe('小明');
  });

  it('新會員可略過補姓名', async () => {
    const u = userEvent.setup();
    const update = vi.fn();
    renderLogin(
      createFakeApi({
        auth: {
          sendOtp: async () => ({ resendAfterSeconds: 60 }),
          verifyOtp: async () => verified(true),
        },
        me: { update },
      }),
    );
    await sendOtp(u);
    await u.keyboard('123456');
    await u.click(await screen.findByRole('button', { name: '略過' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
    expect(update).not.toHaveBeenCalled();
  });

  it('Demo 模式：提示驗證碼 123456，快速登入示範會員', async () => {
    const u = userEvent.setup();
    const loginAsDemoUser = vi.fn().mockResolvedValue(undefined);
    demoState.control = { loginAsDemoUser };
    const refresh = vi
      .fn()
      .mockResolvedValue({ tokens: { accessToken: 'demo-acc', refreshToken: 'demo-ref', expiresIn: 900 } });
    renderLogin(
      createFakeApi({
        auth: { refresh },
        me: { get: async () => ({ ...user, id: 'usr_demo', phone: '0900000000' }) },
      }),
      '/login?redirect=%2Forders',
    );
    expect(screen.getByText('Demo 驗證碼：123456')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: '快速登入示範會員' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/orders'));
    expect(loginAsDemoUser).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith();
    expect(useSessionStore.getState().user?.id).toBe('usr_demo');
  });

  it('非 Demo 模式不顯示 Demo 提示', () => {
    renderLogin();
    expect(screen.queryByText(/Demo 驗證碼/)).not.toBeInTheDocument();
  });

  it('已登入者進入登入頁直接導向 redirect', async () => {
    useSessionStore.getState().setSession(verified().tokens, user);
    renderLogin(createFakeApi(), '/login?redirect=%2Faccount');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/account'));
  });
});
