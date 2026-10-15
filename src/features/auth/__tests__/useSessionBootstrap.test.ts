// 啟動時還原 Session：換發成功寫回權杖；伺服器明確拒絕才清除；暫時性失敗保留；併發共用同一次換發
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthTokens, UserProfile } from '@/domain/types';
import { createFakeApi } from '@/test/fakeApi';
import { useSessionStore } from '../sessionStore';
import { bootstrapSession } from '../useSessionBootstrap';

const user: UserProfile = {
  id: 'usr_1',
  phone: '0912345678',
  name: '王小明',
  marketingOptIn: false,
  createdAt: '2026-10-01T00:00:00+08:00',
};
const oldTokens: AuthTokens = { accessToken: 'old', refreshToken: 'ref-old', expiresIn: 900 };
const newTokens: AuthTokens = { accessToken: 'new', refreshToken: 'ref-new', expiresIn: 900 };
const apiError = (status: number, code: string) => Object.assign(new Error(code), { status, code });

beforeEach(() => {
  useSessionStore.getState().clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('bootstrapSession', () => {
  it('訪客：不呼叫任何 API', async () => {
    const refresh = vi.fn();
    await bootstrapSession(createFakeApi({ auth: { refresh } }));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('換發成功：寫回新權杖並更新個人資料', async () => {
    useSessionStore.getState().setSession(oldTokens, user);
    const refresh = vi.fn().mockResolvedValue({ tokens: newTokens });
    await bootstrapSession(
      createFakeApi({
        auth: { refresh },
        me: { get: async () => ({ ...user, name: '王大明' }) },
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().tokens).toEqual(newTokens);
    expect(useSessionStore.getState().user?.name).toBe('王大明');
  });

  it('Mock 模式以 Mock 記住的 session 換發（不帶 Refresh Token，多分頁不會因重複使用被視為遭竊）', async () => {
    useSessionStore.getState().setSession(oldTokens, user);
    const refresh = vi.fn().mockResolvedValue({ tokens: newTokens });
    await bootstrapSession(createFakeApi({ auth: { refresh }, me: { get: async () => user } }));
    expect(refresh).toHaveBeenCalledWith(undefined);
  });

  it('HTTP 模式帶上持久化的 Refresh Token（Body 模式）', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DATA_SOURCE', 'http');
    const store = await import('../sessionStore');
    const boot = await import('../useSessionBootstrap');
    store.useSessionStore.getState().setSession(oldTokens, user);
    const refresh = vi.fn().mockResolvedValue({ tokens: newTokens });
    await boot.bootstrapSession(createFakeApi({ auth: { refresh }, me: { get: async () => user } }));
    expect(refresh).toHaveBeenCalledWith('ref-old');
    expect(store.useSessionStore.getState().tokens).toEqual(newTokens);
  });

  it('伺服器明確拒絕（401）：清除 Session', async () => {
    useSessionStore.getState().setSession(oldTokens, user);
    await bootstrapSession(
      createFakeApi({
        auth: {
          refresh: async () => {
            throw apiError(401, 'UNAUTHORIZED');
          },
        },
      }),
    );
    expect(useSessionStore.getState().user).toBeNull();
    expect(useSessionStore.getState().tokens).toBeNull();
  });

  it.each([
    ['無回應', 0, 'SERVICE_UNAVAILABLE'],
    ['5xx', 503, 'SERVICE_UNAVAILABLE'],
    ['限流', 429, 'RATE_LIMITED'],
  ])('暫時性失敗（%s）：保留 Session', async (_label, status, code) => {
    useSessionStore.getState().setSession(oldTokens, user);
    await bootstrapSession(
      createFakeApi({
        auth: {
          refresh: async () => {
            throw apiError(status, code);
          },
        },
      }),
    );
    expect(useSessionStore.getState().user?.id).toBe('usr_1');
    expect(useSessionStore.getState().tokens).toEqual(oldTokens);
  });

  it('併發呼叫（StrictMode 重複執行 effect）只換發一次', async () => {
    useSessionStore.getState().setSession(oldTokens, user);
    let release: (v: { tokens: AuthTokens }) => void = () => undefined;
    const refresh = vi.fn(
      () =>
        new Promise<{ tokens: AuthTokens }>((resolve) => {
          release = resolve;
        }),
    );
    const api = createFakeApi({ auth: { refresh }, me: { get: async () => user } });
    const a = bootstrapSession(api);
    const b = bootstrapSession(api);
    expect(a).toBe(b);
    release({ tokens: newTokens });
    await Promise.all([a, b]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
