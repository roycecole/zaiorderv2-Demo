// PG-11 個人資料：姓名（VR-02）、Email、行銷同意；手機唯讀；只送出有變更的欄位
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/auth/sessionStore';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { ProfilePage } from '../ProfilePage';
import { profile, tokens } from './fixtures';

beforeEach(() => {
  useSessionStore.getState().setSession(tokens, profile);
});

const renderProfile = (api: ReturnType<typeof createFakeApi>) => renderWithProviders(<ProfilePage />, { api });

describe('ProfilePage', () => {
  it('手機為唯讀並說明需客服變更；其他欄位帶入目前資料', async () => {
    renderProfile(createFakeApi({ me: { get: async () => profile } }));
    const phone = screen.getByLabelText(/手機號碼/);
    expect(phone).toHaveAttribute('readonly');
    expect(phone).toHaveValue('0912 345 678');
    expect(screen.getByText('手機號碼是登入帳號，需要變更請聯絡店家')).toBeInTheDocument();
    expect(screen.getByLabelText(/姓名/)).toHaveValue('王小明');
    expect(screen.getByLabelText(/Email/)).toHaveValue('ming@example.com');
  });

  it('只送出有變更的欄位，成功後更新 Session 並 Toast', async () => {
    const u = userEvent.setup();
    const update = vi.fn(async (patch: object) => ({ ...profile, ...patch }));
    renderProfile(createFakeApi({ me: { get: async () => profile, update } }));
    const name = screen.getByLabelText(/姓名/);
    await u.clear(name);
    await u.type(name, '王大明');
    await u.click(screen.getByRole('checkbox', { name: '我願意收到店家的優惠與活動訊息' }));
    await u.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ name: '王大明', marketingOptIn: true }));
    expect(await screen.findByText('已儲存')).toBeInTheDocument();
    expect(useSessionStore.getState().user?.name).toBe('王大明');
    expect(useSessionStore.getState().user?.marketingOptIn).toBe(true);
  });

  it('Email 格式錯誤：欄位錯誤，不呼叫 API', async () => {
    const u = userEvent.setup();
    const update = vi.fn();
    renderProfile(createFakeApi({ me: { get: async () => profile, update } }));
    const email = screen.getByLabelText(/Email/);
    await u.clear(email);
    await u.type(email, 'not-an-email');
    await u.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByText('請輸入正確的 Email')).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(update).not.toHaveBeenCalled();
  });

  it('已有姓名時不可清空（VR-02）；姓名超過 20 字也會被擋下', async () => {
    const u = userEvent.setup();
    const update = vi.fn();
    renderProfile(createFakeApi({ me: { get: async () => profile, update } }));
    const name = screen.getByLabelText(/姓名/);
    await u.clear(name);
    await u.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByText('請輸入姓名（最多 20 字）')).toBeInTheDocument();
    await u.type(name, '一二三四五六七八九十一二三四五六七八九十甲');
    await u.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByText('請輸入姓名（最多 20 字）')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it('清空 Email 會以空字串送出（清除）', async () => {
    const u = userEvent.setup();
    const update = vi.fn(async () => ({ ...profile, email: undefined }));
    renderProfile(createFakeApi({ me: { get: async () => profile, update } }));
    await u.clear(screen.getByLabelText(/Email/));
    await u.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ email: '' }));
  });

  it('伺服器欄位錯誤（VALIDATION_FAILED details）對應到欄位', async () => {
    const u = userEvent.setup();
    const update = vi.fn(async () => {
      throw Object.assign(new Error('v'), {
        status: 400,
        code: 'VALIDATION_FAILED',
        body: { code: 'VALIDATION_FAILED', details: [{ field: 'email', message: '這個 Email 已被使用' }] },
      });
    });
    renderProfile(createFakeApi({ me: { get: async () => profile, update } }));
    const email = screen.getByLabelText(/Email/);
    await u.clear(email);
    await u.type(email, 'other@example.com');
    await u.click(screen.getByRole('button', { name: '儲存' }));
    expect(await screen.findByText('這個 Email 已被使用')).toBeInTheDocument();
  });
});
