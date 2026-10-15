// 菜單 / 購物車測試的共用輔助：Store 重置、網址觀測與返回鍵
import { useLocation, useNavigate } from 'react-router';
import { useCartStore } from '@/features/cart/cartStore';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { useSessionStore } from '@/features/auth/sessionStore';
import { getClock } from '@/services/clock';
import type { AuthTokens, UserProfile } from '@/domain/types';

/** 還原各 Store 為初始狀態（購物車空、偏好預設、未登入、非觸控面板） */
export function resetStores(): void {
  useCartStore.setState({ lines: [], orderType: 'PICKUP', updatedAt: getClock().now().getTime() });
  usePrefsStore.getState().reset();
  useSessionStore.getState().clear();
  useInputModeStore.setState({ inputMode: 'AUTO' });
}

export function loginAsMember(): void {
  const tokens: AuthTokens = { accessToken: 'token', expiresIn: 3600 };
  const user: UserProfile = {
    id: 'user_1',
    phone: '0912345678',
    marketingOptIn: false,
    createdAt: '2026-01-01T00:00:00+08:00',
  };
  useSessionStore.getState().setSession(tokens, user);
}

/** 顯示目前網址（pathname + search），並提供「返回」按鈕（模擬實體返回鍵） */
export function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      <button type="button" onClick={() => void navigate(-1)}>
        測試返回鍵
      </button>
    </div>
  );
}
