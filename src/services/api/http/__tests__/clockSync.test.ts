// StoreStatus.serverTime 時鐘偏差校正（07 §6.4 末段）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClock, setClock, systemClock } from '@/services/clock';
import type { Clock } from '@/services/clock';
import { CLOCK_SKEW_TOLERANCE_MS, createClockSync } from '../clockSync';
import { createHttpApiClient } from '../createHttpClient';
import { BASE_URL, jsonResponse, STORE_SLUG, stubFetch } from './helpers';

/** 本機（假）真實時間：2026-10-14T04:00:00Z = 12:00 +08:00 */
const LOCAL_NOW = new Date('2026-10-14T04:00:00.000Z');

const status = (serverTime: string) => ({
  status: 'OPEN',
  todayHours: [{ open: '11:00', close: '14:00' }],
  serverTime,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(LOCAL_NOW);
  setClock(systemClock);
});

afterEach(() => {
  setClock(systemClock);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createClockSync', () => {
  it('偏差達 2 秒以上：以 serverTime 為準校正，之後隨本機時間繼續走', () => {
    const sync = createClockSync();
    // 伺服器比本機快 5 分鐘
    sync.sync('2026-10-14T12:05:00+08:00');

    expect(getClock()).not.toBe(systemClock);
    expect(getClock().now().toISOString()).toBe('2026-10-14T04:05:00.000Z');

    vi.advanceTimersByTime(30_000);
    expect(getClock().now().toISOString()).toBe('2026-10-14T04:05:30.000Z');
  });

  it('裝置時間比伺服器快（負偏差）同樣校正', () => {
    createClockSync().sync('2026-10-14T11:50:00+08:00');
    expect(getClock().now().toISOString()).toBe('2026-10-14T03:50:00.000Z');
  });

  it('偏差小於 2 秒不調整', () => {
    const sync = createClockSync();
    sync.sync('2026-10-14T12:00:01+08:00'); // +1s
    expect(getClock()).toBe(systemClock);

    sync.sync(new Date(LOCAL_NOW.getTime() - (CLOCK_SKEW_TOLERANCE_MS - 1)).toISOString());
    expect(getClock()).toBe(systemClock);
  });

  it('偏差恰為 2 秒即調整（門檻為「小於 2 秒不調整」）', () => {
    createClockSync().sync('2026-10-14T12:00:02+08:00');
    expect(getClock()).not.toBe(systemClock);
    expect(getClock().now().toISOString()).toBe('2026-10-14T04:00:02.000Z');
  });

  it('已校正且仍準確時，不重設時鐘（避免每次輪詢時間抖動）', () => {
    const sync = createClockSync();
    sync.sync('2026-10-14T12:05:00+08:00');
    const installed = getClock();

    vi.advanceTimersByTime(60_000);
    // 伺服器此時是 12:06:00.500，與校正後時鐘僅差 0.5 秒
    sync.sync('2026-10-14T12:06:00.500+08:00');
    expect(getClock()).toBe(installed);
  });

  it('伺服器時間與已校正時鐘又差 2 秒以上：重設', () => {
    const sync = createClockSync();
    sync.sync('2026-10-14T12:05:00+08:00');
    const first = getClock();

    sync.sync('2026-10-14T12:10:00+08:00'); // 本機仍是 12:00:00
    expect(getClock()).not.toBe(first);
    expect(getClock().now().toISOString()).toBe('2026-10-14T04:10:00.000Z');
  });

  it('使用者修正了裝置時間（偏差回到 2 秒內）：撤掉校正，回到系統時鐘', () => {
    const sync = createClockSync();
    sync.sync('2026-10-14T12:05:00+08:00');
    expect(getClock()).not.toBe(systemClock);

    sync.sync('2026-10-14T12:00:00+08:00');
    expect(getClock()).toBe(systemClock);
  });

  it('時鐘已被他人覆寫（測試 / Demo 時間穿梭）時不介入', () => {
    const fixed: Clock = { now: () => new Date('2020-01-01T00:00:00.000Z') };
    setClock(fixed);

    createClockSync().sync('2026-10-14T12:05:00+08:00');
    expect(getClock()).toBe(fixed);
  });

  it('serverTime 缺漏或格式錯誤時忽略', () => {
    const sync = createClockSync();
    sync.sync(undefined);
    sync.sync('不是時間');
    expect(getClock()).toBe(systemClock);
  });
});

describe('getStatus() 取得後校正', () => {
  it('以回應的 serverTime 校正，並原樣回傳 StoreStatus', async () => {
    const body = status('2026-10-14T12:30:00+08:00');
    stubFetch(() => jsonResponse(200, body));
    const api = createHttpApiClient({ baseUrl: BASE_URL, storeSlug: STORE_SLUG });

    const result = await api.store.getStatus();

    expect(result).toEqual(body);
    expect(getClock().now().toISOString()).toBe('2026-10-14T04:30:00.000Z');
  });

  it('getStatus 失敗時不動時鐘', async () => {
    stubFetch(() => jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'x' } }));
    const api = createHttpApiClient({ baseUrl: BASE_URL, storeSlug: STORE_SLUG });

    await expect(api.store.getStatus()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(getClock()).toBe(systemClock);
  });

  it('其他端點（getInfo、getMenu）不校正', async () => {
    stubFetch(() => jsonResponse(200, { status: status('2026-10-14T12:30:00+08:00') }));
    const api = createHttpApiClient({ baseUrl: BASE_URL, storeSlug: STORE_SLUG });

    await api.store.getInfo();
    await api.store.getMenu();
    expect(getClock()).toBe(systemClock);
  });
});
