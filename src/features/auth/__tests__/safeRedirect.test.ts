// 07 §11：redirect 僅接受站內相對路徑（防開放式轉址）
import { describe, expect, it } from 'vitest';
import { buildLoginUrl, isMemberOnlyPath, safeRedirect } from '../safeRedirect';

describe('safeRedirect', () => {
  it.each([
    ['/', '/'],
    ['/orders/ord_1', '/orders/ord_1'],
    ['/account/profile', '/account/profile'],
    ['/checkout?step=2', '/checkout?step=2'],
    ['/?product=prd_1', '/?product=prd_1'],
    ['/orders#top', '/orders#top'],
  ])('站內路徑 %s 原樣保留', (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });

  it.each([
    ['//evil.example'],
    ['///evil.example'],
    ['/\\evil.example'],
    ['\\\\evil.example'],
    ['https://evil.example'],
    ['http://evil.example/path'],
    ['javascript:alert(1)'],
    ['data:text/html,hi'],
    ['evil.example'],
    ['orders'],
    ['/path\nwith-newline'],
    ['/path\twith-tab'],
    ['   '],
    [''],
  ])('不合格的 %j 一律回到預設', (input) => {
    expect(safeRedirect(input)).toBe('/');
  });

  it('null / undefined 回到預設，並可指定 fallback', () => {
    expect(safeRedirect(null)).toBe('/');
    expect(safeRedirect(undefined, '/menu')).toBe('/menu');
    expect(safeRedirect('//x.y', '/orders')).toBe('/orders');
  });

  it('不導回登入頁自己（避免迴圈）', () => {
    expect(safeRedirect('/login')).toBe('/');
    expect(safeRedirect('/login?redirect=/orders')).toBe('/');
  });

  it('前後空白會被去除', () => {
    expect(safeRedirect('  /orders  ')).toBe('/orders');
  });
});

describe('buildLoginUrl', () => {
  it('附上編碼過的 redirect', () => {
    expect(buildLoginUrl('/account/profile')).toBe('/login?redirect=%2Faccount%2Fprofile');
    expect(buildLoginUrl('/orders?tab=completed')).toBe('/login?redirect=%2Forders%3Ftab%3Dcompleted');
  });

  it('首頁、不合格或空的 redirect 不附參數', () => {
    expect(buildLoginUrl('/')).toBe('/login');
    expect(buildLoginUrl('//evil.example')).toBe('/login');
    expect(buildLoginUrl(undefined)).toBe('/login');
  });
});

describe('isMemberOnlyPath', () => {
  it('會員中心相關路徑', () => {
    expect(isMemberOnlyPath('/account')).toBe(true);
    expect(isMemberOnlyPath('/account/addresses')).toBe(true);
    expect(isMemberOnlyPath('/account/coupons?tab=used')).toBe(true);
    expect(isMemberOnlyPath('/accounting')).toBe(false);
    expect(isMemberOnlyPath('/orders')).toBe(false);
  });
});
