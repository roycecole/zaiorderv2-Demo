// QR 桌號的分頁內保存（FR-CK-05、UAT-10）：站內導覽不帶 `?table=`，結帳頁仍要取得桌位權杖
import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appSessionStorage, STORAGE_KEYS } from '@/services/storage/appStorage';
import { clearDraft } from '../checkoutDraft';
import {
  forgetQrTable,
  qrTokenFromSearch,
  recalledQrTable,
  rememberQrTable,
  useRememberQrTable,
} from '../qrTable';

beforeEach(() => {
  appSessionStorage.removeItem(STORAGE_KEYS.table);
});
afterEach(() => {
  appSessionStorage.removeItem(STORAGE_KEYS.table);
});

describe('qrTokenFromSearch', () => {
  it('取出 table 參數並去除空白；沒有或空白為 null', () => {
    expect(qrTokenFromSearch('?table=A3')).toBe('A3');
    expect(qrTokenFromSearch('?demo_clock=x&table=%20A3%20')).toBe('A3');
    expect(qrTokenFromSearch('?table=')).toBeNull();
    expect(qrTokenFromSearch('?table=%20')).toBeNull();
    expect(qrTokenFromSearch('')).toBeNull();
  });
});

describe('remember / recall / forget', () => {
  it('記下後可取回，forget 後為 null', () => {
    expect(recalledQrTable()).toBeNull();
    rememberQrTable('A3');
    expect(recalledQrTable()).toBe('A3');
    forgetQrTable();
    expect(recalledQrTable()).toBeNull();
  });

  it('訂單成立或草稿丟棄（clearDraft）時一併清除桌位權杖', () => {
    rememberQrTable('A3');
    clearDraft();
    expect(recalledQrTable()).toBeNull();
  });
});

describe('useRememberQrTable', () => {
  const wrapperAt =
    (url: string) =>
    ({ children }: { children: ReactNode }) =>
      createElement(MemoryRouter, { initialEntries: [url] }, children);

  it('網址帶 ?table= 時記下權杖', () => {
    renderHook(() => useRememberQrTable(), { wrapper: wrapperAt('/?table=A3') });
    expect(recalledQrTable()).toBe('A3');
  });

  it('網址沒有 table 時不覆寫已記下的權杖', () => {
    rememberQrTable('A5');
    renderHook(() => useRememberQrTable(), { wrapper: wrapperAt('/cart') });
    expect(recalledQrTable()).toBe('A5');
  });
});
