import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { qk } from '@/services/api/queryKeys';
import { createFakeApi } from '@/test/fakeApi';
import { isHomeLocation, preloadImage, prefetchStartupQueries } from '../startup';

const loc = (pathname: string, hash = '') => ({ pathname, hash });

describe('isHomeLocation', () => {
  it('browser 路由：根路徑與子路徑部署的根', () => {
    expect(isHomeLocation(loc('/'))).toBe(true);
    expect(isHomeLocation(loc(''))).toBe(true);
    expect(isHomeLocation(loc('/cart'))).toBe(false);
    expect(isHomeLocation(loc('/orders/abc'))).toBe(false);
  });
});

describe('preloadImage', () => {
  const created: Array<{ src: string; fetchPriority: string; decoding: string }> = [];
  beforeEach(() => {
    created.length = 0;
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        fetchPriority = '';
        decoding = '';
        constructor() {
          created.push(this);
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('建立 Image 並設定來源與優先序', () => {
    preloadImage('/images/banners/a.svg', 'high');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ src: '/images/banners/a.svg', fetchPriority: 'high', decoding: 'async' });
  });

  it('沒有網址（undefined 或空字串）時不做事', () => {
    preloadImage(undefined);
    preloadImage('');
    expect(created).toHaveLength(0);
  });
});

describe('prefetchStartupQueries（首頁）', () => {
  const created: Array<{ src: string }> = [];
  beforeEach(() => {
    created.length = 0;
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        fetchPriority = '';
        decoding = '';
        constructor() {
          created.push(this);
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('預取店家資訊、營業狀態、菜單與 Banner，並預先下載 Logo 與第一張 Banner 圖片', async () => {
    const calls: string[] = [];
    const api = createFakeApi({
      store: {
        getInfo: async () => {
          calls.push('info');
          return { logoUrl: '/images/store/logo.svg' } as never;
        },
        getStatus: async () => {
          calls.push('status');
          return {} as never;
        },
        getMenu: async () => {
          calls.push('menu');
          return { categories: [], generatedAt: '' };
        },
        getBanners: async () => {
          calls.push('banners');
          return { items: [{ id: 'b1', title: 't', imageUrl: '/images/banners/a.svg', linkType: 'NONE' }] };
        },
      },
    });
    const queryClient = new QueryClient();
    prefetchStartupQueries(queryClient, api);
    await vi.waitFor(() => expect(created.map((i) => i.src)).toEqual(expect.arrayContaining(['/images/store/logo.svg', '/images/banners/a.svg'])));
    expect(calls.sort()).toEqual(['banners', 'info', 'menu', 'status']);
    // 結果存在查詢快取：頁面上的 hook 以同一組鍵直接沿用，不會重複請求
    expect(queryClient.getQueryData(qk.store.menu())).toBeDefined();
    expect(queryClient.getQueryData(qk.store.banners())).toBeDefined();
  });

  it('預取失敗不丟錯（查詢留在錯誤狀態，由頁面自己的重試與錯誤畫面處理）', async () => {
    const api = createFakeApi({});
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    expect(() => prefetchStartupQueries(queryClient, api)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queryClient.getQueryState(qk.store.info())?.status).toBe('error');
  });
});
