// src/features/auth/sessionStore.ts —— 會員 Session（07 §7.1：Zustand persist，Demo 存 localStorage）
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AuthTokens, UserProfile } from '@/domain/types';
import { appLocalStorage, STORAGE_KEYS } from '@/services/storage/appStorage';

interface SessionData {
  tokens: AuthTokens | null;
  user: UserProfile | null;
}

interface SessionActions {
  setSession(tokens: AuthTokens, user: UserProfile): void;
  setTokens(tokens: AuthTokens): void;
  setUser(user: UserProfile): void;
  clear(): void;
}

export const useSessionStore = create<SessionData & SessionActions>()(
  persist(
    (set) => ({
      tokens: null,
      user: null,
      setSession: (tokens, user) => set({ tokens, user }),
      setTokens: (tokens) => set({ tokens }),
      setUser: (user) => set({ user }),
      clear: () => set({ tokens: null, user: null }),
    }),
    {
      name: STORAGE_KEYS.session,
      version: 1,
      storage: createJSONStorage(() => appLocalStorage),
      partialize: (s) => ({ tokens: s.tokens, user: s.user }),
    },
  ),
);

/** 是否已登入（以 user 為準；token 過期由 refresh 處理） */
export const selectIsLoggedIn = (s: SessionData): boolean => s.user !== null;

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEYS.session) void useSessionStore.persist.rehydrate();
  });
}
