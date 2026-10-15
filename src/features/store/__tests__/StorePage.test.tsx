import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pageTitleStore } from '@/app/layouts/pageTitle';
import type { DeliveryZone } from '@/domain/types';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { setClock, systemClock } from '@/services/clock';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { AnnouncementBanner, announcementId } from '../AnnouncementBanner';
import { StorePage } from '../StorePage';
import { NOON_MS, makeStatus, makeStoreInfo } from './fixtures';

const zones: DeliveryZone[] = [
  {
    zipCode: '106',
    city: '臺北市',
    district: '大安區',
    deliveryFee: 30,
    minOrderAmount: 200,
    freeDeliveryThreshold: 500,
    estimatedMinutes: 35,
  },
  {
    zipCode: '104',
    city: '臺北市',
    district: '中山區',
    deliveryFee: 0,
    minOrderAmount: 0,
    freeDeliveryThreshold: null,
    estimatedMinutes: 0,
  },
];

beforeEach(() => {
  // 2026-10-14（週三）12:00
  setClock({ now: () => new Date(NOON_MS) });
  pageTitleStore.setState({ title: null, storeName: null });
  window.localStorage.clear();
  usePrefsStore.getState().reset();
});
afterEach(() => setClock(systemClock));

describe('StorePage（PG-15）', () => {
  it('資訊、聯絡、營業時間（今日強調）、特殊營業日、取餐方式、外送範圍、付款方式與餐具政策', async () => {
    const api = createFakeApi({
      store: {
        getInfo: async () =>
          makeStoreInfo({
            specialDays: [
              {
                date: '2026-10-14',
                type: 'SPECIAL_HOURS',
                open: '11:00',
                close: '15:00',
                note: '活動場次',
              },
              { date: '2026-10-20', type: 'CLOSED', note: '員工旅遊' },
            ],
          }),
        getStatus: async () => makeStatus(),
        getDeliveryZones: async () => ({ items: zones }),
      },
    });
    renderWithProviders(<StorePage />, { api });

    expect(
      await screen.findByRole('heading', { level: 1, name: '巷仔內小吃部' }),
    ).toBeInTheDocument();
    expect(pageTitleStore.getState().title).toBe('店家資訊');
    expect(screen.getByText('古早味・現點現做')).toBeInTheDocument();
    expect(await screen.findByText('營業中・今日 11:00–14:00、17:00–21:00')).toBeInTheDocument();

    // 聯絡
    expect(screen.getByRole('link', { name: '撥打電話 02-0000-0000' })).toHaveAttribute(
      'href',
      'tel:02-0000-0000',
    );
    const map = screen.getByRole('link', { name: /在地圖開啟：臺北市大安區示範路 100 號/ });
    expect(map.getAttribute('href')).toContain('google.com/maps');
    expect(map).not.toHaveAttribute('target');

    // 營業時間表：今日（週三）強調，週一公休
    const hours = screen.getByRole('table', { name: '每週營業時間' });
    const rows = within(hours).getAllByRole('row').slice(1); // 第一列為視覺隱藏的表頭
    expect(rows).toHaveLength(7);
    const today = rows.filter((r) => r.getAttribute('aria-current') === 'date');
    expect(today).toHaveLength(1);
    expect(today[0]).toHaveTextContent('週三');
    expect(today[0]).toHaveTextContent('今日');
    expect(rows[0]).toHaveTextContent('週一');
    expect(rows[0]).toHaveTextContent('公休');
    expect(rows[1]).toHaveTextContent('11:00–14:00、17:00–21:00');
    expect(screen.getByText(/今日例外：特殊營業 11:00–15:00（活動場次）/)).toBeInTheDocument();

    // 特殊營業日
    expect(screen.getByText('10/20（二）')).toBeInTheDocument();
    expect(screen.getByText(/公休・員工旅遊/)).toBeInTheDocument();

    // 取餐方式
    const services = screen.getByRole('region', { name: '取餐方式' });
    expect(within(services).getAllByText('開放')).toHaveLength(3);

    // 外送範圍
    const table = await screen.findByRole('table', { name: '外送行政區、運費與條件' });
    expect(within(table).getByText('臺北市大安區')).toBeInTheDocument();
    expect(within(table).getByText('NT$ 30')).toBeInTheDocument();
    expect(within(table).getByText('免運')).toBeInTheDocument();
    expect(within(table).getByText('約 35 分鐘')).toBeInTheDocument();

    // 付款與餐具
    expect(screen.getByText('現金')).toBeInTheDocument();
    expect(screen.getByText('LINE Pay')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '餐具政策' })).toBeInTheDocument();
  });

  it('未開放外送：不顯示外送範圍，也不查詢外送區域', async () => {
    const api = createFakeApi({
      store: {
        getInfo: async () =>
          makeStoreInfo({ services: { pickup: true, delivery: false, dineIn: true } }),
        getStatus: async () => makeStatus(),
      },
    });
    renderWithProviders(<StorePage />, { api });
    await screen.findByRole('heading', { level: 1, name: '巷仔內小吃部' });
    expect(screen.queryByRole('heading', { name: '外送範圍' })).not.toBeInTheDocument();
    expect(screen.getAllByText('未開放').length).toBeGreaterThan(0);
  });

  it('欄位缺漏時降級：沒有簡介、電子郵件、特殊營業日、付款方式', async () => {
    const api = createFakeApi({
      store: {
        getInfo: async () =>
          makeStoreInfo({
            tagline: undefined,
            description: undefined,
            email: undefined,
            paymentMethods: [],
            services: { pickup: true, delivery: false, dineIn: false },
          }),
        getStatus: async () => makeStatus(),
      },
    });
    renderWithProviders(<StorePage />, { api });
    await screen.findByRole('heading', { level: 1, name: '巷仔內小吃部' });
    expect(screen.queryByText('電子郵件：')).not.toBeInTheDocument();
    expect(screen.getByText('近 30 天沒有特殊營業日安排。')).toBeInTheDocument();
    expect(screen.getByText('付款方式請洽店家。')).toBeInTheDocument();
  });

  it('載入失敗：顯示可重試的錯誤，並保留回菜單連結', async () => {
    let attempt = 0;
    const user = userEvent.setup();
    const api = createFakeApi({
      store: {
        getInfo: async () => {
          attempt += 1;
          if (attempt === 1) throw new Error('boom');
          return makeStoreInfo();
        },
        getStatus: async () => makeStatus(),
      },
    });
    renderWithProviders(<StorePage />, { api });
    expect(
      await screen.findByRole('heading', { name: '暫時無法取得店家資訊' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回菜單' })).toHaveAttribute('href', '/');
    await user.click(screen.getByRole('button', { name: '重試' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: '巷仔內小吃部' }),
    ).toBeInTheDocument();
  });
});

describe('AnnouncementBanner', () => {
  it('公告更新（文字不同）後會再次顯示', async () => {
    const user = userEvent.setup();
    let text = '本週五提早打烊';
    const api = createFakeApi({
      store: { getInfo: async () => makeStoreInfo({ announcement: text }) },
    });
    const { queryClient } = renderWithProviders(<AnnouncementBanner />, { api });
    await user.click(await screen.findByRole('button', { name: '關閉公告' }));
    expect(screen.queryByRole('region', { name: '店家公告' })).not.toBeInTheDocument();
    expect(usePrefsStore.getState().dismissedAnnouncement).toBe(announcementId('本週五提早打烊'));

    text = '週日全天公休';
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    expect(await screen.findByText('週日全天公休')).toBeInTheDocument();
  });

  it('沒有公告時不渲染', async () => {
    const api = createFakeApi({
      store: { getInfo: async () => makeStoreInfo({ announcement: undefined }) },
    });
    renderWithProviders(<AnnouncementBanner />, { api });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('region', { name: '店家公告' })).not.toBeInTheDocument();
  });
});
