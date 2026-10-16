import { describe, expect, it } from 'vitest';
import { launchParam, launchSearch } from '../launchParams';

const loc = (search: string, hash: string) => ({ search, hash });

describe('launchParam：browser 與 hash 路由都讀得到', () => {
  it('browser 路由：只有 location.search', () => {
    expect(launchParam('mode', loc('?mode=kiosk', ''))).toBe('kiosk');
  });

  it('hash 路由：查詢字串在 #/ 之後', () => {
    expect(launchParam('mode', loc('', '#/?mode=kiosk'))).toBe('kiosk');
    expect(launchParam('mode', loc('', '#/orders/lookup?mode=kiosk&x=1'))).toBe('kiosk');
  });

  it('hash 路由：查詢字串寫在 # 之前也有效', () => {
    expect(launchParam('mode', loc('?mode=kiosk', '#/'))).toBe('kiosk');
  });

  it('兩處都有時 location.search 優先', () => {
    expect(launchParam('mode', loc('?mode=normal', '#/?mode=kiosk'))).toBe('normal');
  });

  it('找不到、沒有查詢字串或 hash 內沒有 ? 時回傳 null', () => {
    expect(launchParam('mode', loc('', ''))).toBeNull();
    expect(launchParam('mode', loc('', '#/orders'))).toBeNull();
    expect(launchParam('mode', loc('?x=1', '#/?y=2'))).toBeNull();
  });

  it('參數名稱相同但屬於其他鍵的前綴不會誤判', () => {
    expect(launchParam('mode', loc('?model=1', '#/?submode=2'))).toBeNull();
  });
});

describe('launchSearch：合併後的原始查詢字串', () => {
  it('沒有任何參數 → 空字串', () => {
    expect(launchSearch(loc('', ''))).toBe('');
    expect(launchSearch(loc('', '#/'))).toBe('');
  });

  it('只有 search / 只有 hash / 兩者並存（hash 在前、search 在後）', () => {
    expect(launchSearch(loc('?a=1', ''))).toBe('?a=1');
    expect(launchSearch(loc('', '#/?b=2'))).toBe('?b=2');
    expect(launchSearch(loc('?a=1', '#/?b=2'))).toBe('?b=2&a=1');
  });

  it('保留原始字元：demo_clock 的 +08:00 不被轉成空白', () => {
    const merged = launchSearch(loc('', '#/?demo_clock=2026-10-14T12:00:00+08:00&mode=kiosk'));
    expect(merged).toBe('?demo_clock=2026-10-14T12:00:00+08:00&mode=kiosk');
  });

  it('search 不帶開頭的 ? 時也能處理', () => {
    expect(launchSearch(loc('a=1', ''))).toBe('?a=1');
  });
});
