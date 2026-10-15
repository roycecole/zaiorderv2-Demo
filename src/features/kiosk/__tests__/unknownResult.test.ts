import { afterEach, describe, expect, it } from 'vitest';
import { appSessionStorage, STORAGE_KEYS } from '@/services/storage/appStorage';
import { hasUnknownOrderResult } from '../unknownResult';

afterEach(() => {
  appSessionStorage.removeItem(STORAGE_KEYS.checkoutDraft);
});

const put = (value: unknown): void =>
  appSessionStorage.setItem(
    STORAGE_KEYS.checkoutDraft,
    typeof value === 'string' ? value : JSON.stringify(value),
  );

describe('hasUnknownOrderResult', () => {
  it('沒有草稿 → false', () => {
    expect(hasUnknownOrderResult()).toBe(false);
  });

  it('unknownBodies 非空 → true；空陣列 → false', () => {
    put({ idempotencyKey: 'k', unknownBodies: [{ orderType: 'DINE_IN' }] });
    expect(hasUnknownOrderResult()).toBe(true);
    put({ idempotencyKey: 'k', unknownBodies: [] });
    expect(hasUnknownOrderResult()).toBe(false);
  });

  it('巢狀結構（例：keyState.unknownBodies）也能辨識', () => {
    put({ draft: { name: 'x' }, keyState: { idempotencyKey: 'k', unknownBodies: [{}] } });
    expect(hasUnknownOrderResult()).toBe(true);
  });

  it('JSON 損毀或不是物件 → false，不丟錯', () => {
    put('{not json');
    expect(hasUnknownOrderResult()).toBe(false);
    put('"unknownBodies"');
    expect(hasUnknownOrderResult()).toBe(false);
    put('null');
    expect(hasUnknownOrderResult()).toBe(false);
  });
});
