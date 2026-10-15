// 07 §7.1 會員 Session：Zustand persist（Demo 存 localStorage）、登入判斷、多分頁同步
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthTokens, UserProfile } from '@/domain/types';
import { MemoryStorage, stubWebStorage } from '@/test/memoryStorage';
import type { StubbedStorages } from '@/test/memoryStorage';
import type * as SessionNs from '../sessionStore';

const KEY = 'zaiorder:v1:session';
type SessionModule = typeof SessionNs;
let storages: StubbedStorages;

async function load(preload?: unknown): Promise<SessionModule> {
  vi.resetModules();
  const local = new MemoryStorage();
  if (preload !== undefined)
    local.setItem(KEY, typeof preload === 'string' ? preload : JSON.stringify(preload));
  storages = stubWebStorage(local);
  return import('../sessionStore');
}
const persisted = (): { state: Record<string, unknown>; version: number } =>
  JSON.parse(storages.local.getItem(KEY) as string) as {
    state: Record<string, unknown>;
    version: number;
  };

const tokens = (o: Partial<AuthTokens> = {}): AuthTokens => ({
  accessToken: 'acc',
  refreshToken: 'ref',
  expiresIn: 900,
  ...o,
});
const user = (o: Partial<UserProfile> = {}): UserProfile => ({
  id: 'usr_1',
  phone: '0912345678',
  name: '王小明',
  marketingOptIn: false,
  createdAt: '2026-10-01T00:00:00+08:00',
  ...o,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sessionStore', () => {
  it('初始為未登入（tokens、user 皆為 null）', async () => {
    const { useSessionStore, selectIsLoggedIn } = await load();
    const s = useSessionStore.getState();
    expect(s.tokens).toBeNull();
    expect(s.user).toBeNull();
    expect(selectIsLoggedIn(s)).toBe(false);
  });

  it('setSession 同時寫入 tokens 與 user；selectIsLoggedIn 以 user 為準', async () => {
    const { useSessionStore, selectIsLoggedIn } = await load();
    useSessionStore.getState().setSession(tokens(), user());
    const s = useSessionStore.getState();
    expect(s.tokens?.accessToken).toBe('acc');
    expect(s.user?.id).toBe('usr_1');
    expect(selectIsLoggedIn(s)).toBe(true);
  });

  it('setTokens（refresh）只更新權杖；setUser 只更新使用者', async () => {
    const { useSessionStore } = await load();
    const s = useSessionStore.getState();
    s.setSession(tokens(), user());
    s.setTokens(tokens({ accessToken: 'acc2' }));
    expect(useSessionStore.getState().tokens?.accessToken).toBe('acc2');
    expect(useSessionStore.getState().user?.id).toBe('usr_1');
    s.setUser(user({ name: '新名字' }));
    expect(useSessionStore.getState().user?.name).toBe('新名字');
    expect(useSessionStore.getState().tokens?.accessToken).toBe('acc2');
  });

  it('clear（登出）回到未登入', async () => {
    const { useSessionStore, selectIsLoggedIn } = await load();
    useSessionStore.getState().setSession(tokens(), user());
    useSessionStore.getState().clear();
    expect(useSessionStore.getState().tokens).toBeNull();
    expect(useSessionStore.getState().user).toBeNull();
    expect(selectIsLoggedIn(useSessionStore.getState())).toBe(false);
  });

  it('selectIsLoggedIn 只看 user：有 tokens 但沒有 user 視為未登入（token 過期由 refresh 處理）', async () => {
    const { selectIsLoggedIn } = await load();
    expect(selectIsLoggedIn({ tokens: tokens(), user: null })).toBe(false);
    expect(selectIsLoggedIn({ tokens: null, user: user() })).toBe(true);
  });

  it('持久化：zaiorder:v1:session、version 1，只保存 { tokens, user }', async () => {
    const { useSessionStore } = await load();
    useSessionStore.getState().setSession(tokens(), user());
    const p = persisted();
    expect(p.version).toBe(1);
    expect(Object.keys(p.state).sort()).toEqual(['tokens', 'user']);
    expect((p.state.user as UserProfile).id).toBe('usr_1');
  });

  it('登出後儲存內為 null（不殘留舊權杖）', async () => {
    const { useSessionStore } = await load();
    useSessionStore.getState().setSession(tokens(), user());
    useSessionStore.getState().clear();
    expect(persisted().state).toEqual({ tokens: null, user: null });
  });

  it('載入時還原已登入的 session', async () => {
    const { useSessionStore, selectIsLoggedIn } = await load({
      state: { tokens: tokens(), user: user() },
      version: 1,
    });
    expect(selectIsLoggedIn(useSessionStore.getState())).toBe(true);
    expect(useSessionStore.getState().user?.phone).toBe('0912345678');
  });

  it('載入時資料損毀 → 未登入，不丟錯', async () => {
    const { useSessionStore } = await load('not-json');
    expect(useSessionStore.getState().user).toBeNull();
  });

  it('多分頁：其他分頁登入或登出時重新水合；其他鍵不觸發', async () => {
    const { useSessionStore } = await load();
    storages.local.setItem(
      KEY,
      JSON.stringify({ state: { tokens: tokens(), user: user({ id: 'usr_other' }) }, version: 1 }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'zaiorder:v1:cart' }));
    await Promise.resolve();
    expect(useSessionStore.getState().user).toBeNull();
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    await vi.waitFor(() => {
      expect(useSessionStore.getState().user?.id).toBe('usr_other');
    });
    // 其他分頁登出
    storages.local.setItem(
      KEY,
      JSON.stringify({ state: { tokens: null, user: null }, version: 1 }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    await vi.waitFor(() => {
      expect(useSessionStore.getState().user).toBeNull();
    });
  });
});
