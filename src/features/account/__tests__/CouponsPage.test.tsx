// PG-14 我的優惠券：可用 / 已使用 / 已過期、折扣內容、條件與效期
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserCouponStatus } from '@/domain/types';
import { useSessionStore } from '@/features/auth/sessionStore';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CouponsPage } from '../CouponsPage';
import { coupon, profile, tokens, userCoupon } from './fixtures';

beforeEach(() => {
  useSessionStore.getState().setSession(tokens, profile);
});

function renderCoupons(api: ReturnType<typeof createFakeApi>, route = '/account/coupons') {
  return renderWithProviders(
    <Routes>
      <Route path="/account/coupons" element={<CouponsPage />} />
    </Routes>,
    { api, route },
  );
}

describe('CouponsPage', () => {
  it('可用分頁：折扣內容、使用條件與效期', async () => {
    const list = vi.fn(async (status?: UserCouponStatus) => ({
      items:
        status === 'AVAILABLE'
          ? [
              userCoupon(),
              userCoupon({
                id: 'uc_2',
                coupon: coupon({
                  id: 'cpn_2',
                  code: 'WELCOME50',
                  name: '新朋友折 $50',
                  description: undefined,
                  discountType: 'FIXED_AMOUNT',
                  discountValue: 50,
                  maxDiscountAmount: undefined,
                  minOrderAmount: 250,
                  applicableOrderTypes: ['DELIVERY'],
                  memberOnly: true,
                }),
              }),
              userCoupon({
                id: 'uc_3',
                coupon: coupon({
                  id: 'cpn_3',
                  code: 'FREESHIP',
                  name: '外送免運',
                  discountType: 'FREE_DELIVERY',
                  discountValue: 0,
                  maxDiscountAmount: undefined,
                  minOrderAmount: 0,
                  applicableOrderTypes: ['DELIVERY'],
                }),
              }),
            ]
          : [],
    }));
    renderCoupons(createFakeApi({ me: { coupons: { list } } }));
    const cards = await screen.findAllByRole('article');
    expect(list).toHaveBeenCalledWith('AVAILABLE');
    expect(cards).toHaveLength(3);

    const lunch = cards[0] as HTMLElement;
    expect(within(lunch).getByText('9 折')).toBeInTheDocument();
    expect(within(lunch).getByText('午餐 9 折')).toBeInTheDocument();
    expect(within(lunch).getByText('小計滿 NT$ 150 可用')).toBeInTheDocument();
    expect(within(lunch).getByText('最高折 NT$ 40')).toBeInTheDocument();
    expect(within(lunch).getByText(/效期至 10\/31（六）/)).toBeInTheDocument();
    expect(within(lunch).getByText('折扣碼 LUNCH10')).toBeInTheDocument();

    const welcome = cards[1] as HTMLElement;
    expect(within(welcome).getByText('折 NT$ 50')).toBeInTheDocument();
    expect(within(welcome).getByText('會員專屬')).toBeInTheDocument();
    expect(within(welcome).getByText('適用：外送')).toBeInTheDocument();

    const ship = cards[2] as HTMLElement;
    expect(within(ship).getByText('免運')).toBeInTheDocument();
    expect(within(ship).getByText('不限最低消費')).toBeInTheDocument();
  });

  it('已使用 / 已過期分頁：依狀態查詢，卡片以狀態標籤與灰階呈現', async () => {
    const u = userEvent.setup();
    const list = vi.fn(async (status?: UserCouponStatus) => {
      if (status === 'USED') {
        return {
          items: [
            userCoupon({ id: 'uc_u', status: 'USED', usedAt: '2026-10-10T12:30:00+08:00' }),
          ],
        };
      }
      if (status === 'EXPIRED') {
        return {
          items: [
            userCoupon({
              id: 'uc_e',
              status: 'EXPIRED',
              coupon: coupon({ id: 'cpn_old', code: 'OLD2025', name: '2025 年末優惠', endsAt: '2025-12-31T23:59:59+08:00' }),
            }),
          ],
        };
      }
      return { items: [] };
    });
    renderCoupons(createFakeApi({ me: { coupons: { list } } }));
    expect(await screen.findByText('目前沒有可用的優惠券')).toBeInTheDocument();

    await u.click(screen.getByRole('tab', { name: '已使用' }));
    const used = await screen.findByRole('article');
    expect(list).toHaveBeenCalledWith('USED');
    expect(used).toHaveAttribute('data-status', 'USED');
    expect(within(used).getByText('已使用')).toBeInTheDocument();
    expect(within(used).getByText(/使用於 10\/10（六） 12:30/)).toBeInTheDocument();

    await u.click(screen.getByRole('tab', { name: '已過期' }));
    const expired = await screen.findByRole('article');
    expect(list).toHaveBeenCalledWith('EXPIRED');
    expect(expired).toHaveAttribute('data-status', 'EXPIRED');
    expect(within(expired).getByText('已過期')).toBeInTheDocument();
    expect(within(expired).getByText(/已於 12\/31（三）到期/)).toBeInTheDocument();
  });

  it('?tab=used 直接進入已使用分頁；空分頁顯示說明', async () => {
    const list = vi.fn(async () => ({ items: [] }));
    renderCoupons(createFakeApi({ me: { coupons: { list } } }), '/account/coupons?tab=used');
    expect(await screen.findByText('還沒有使用過的優惠券')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith('USED');
    expect(screen.getByRole('tab', { name: '已使用' })).toHaveAttribute('aria-selected', 'true');
  });
});
