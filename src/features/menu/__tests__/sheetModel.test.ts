// 商品面板純函式：預設值優先序（編輯 ＞ 記憶 ＞ 預設）、單價、群組驗證、恢復預設
import { describe, expect, it } from 'vitest';
import {
  buildInitialForm,
  firstGroupError,
  flattenSelected,
  groupErrors,
  noteLength,
  restoreDefaults,
  selectedLabels,
  selectedUnitPrice,
  toSelected,
} from '../sheetModel';
import { LUROU_DETAIL, SIZE_GROUP, TOPPING_GROUP, detailOf, LUROU } from './fixtures';

const remembered = (optionIds: string[], labels: string[], note?: string) => ({
  productId: 'prd_lurou',
  optionIds,
  labels,
  ...(note !== undefined ? { note } : {}),
  at: 1,
});

describe('buildInitialForm', () => {
  it('無記憶：商品預設選項、數量 1、不顯示提示', () => {
    const form = buildInitialForm({ detail: LUROU_DETAIL, maxQuantity: 20 });
    expect(flattenSelected(LUROU_DETAIL, form.selected)).toEqual(['opt_s']);
    expect(form).toMatchObject({ note: '', quantity: 1, tip: { kind: 'NONE' }, attempted: false });
  });

  it('記憶全數有效：套用選項與備註並提示（數量固定 1）', () => {
    const form = buildInitialForm({
      detail: LUROU_DETAIL,
      remembered: remembered(['opt_l', 'opt_egg'], ['大碗', '滷蛋'], '不要蔥'),
      maxQuantity: 20,
    });
    expect(flattenSelected(LUROU_DETAIL, form.selected)).toEqual(['opt_l', 'opt_egg']);
    expect(form.note).toBe('不要蔥');
    expect(form.quantity).toBe(1);
    expect(form.tip).toEqual({ kind: 'APPLIED', text: '大碗・滷蛋' });
  });

  it('記憶部分失效：失效者丟棄、必選群組以預設補足並提示 PARTIAL', () => {
    const detail = detailOf(LUROU, [
      SIZE_GROUP,
      {
        ...TOPPING_GROUP,
        options: TOPPING_GROUP.options.map((o) =>
          o.id === 'opt_egg' ? { ...o, isAvailable: false } : o,
        ),
      },
    ]);
    const form = buildInitialForm({
      detail,
      remembered: remembered(['opt_l', 'opt_egg'], ['大碗', '滷蛋']),
      maxQuantity: 20,
    });
    expect(flattenSelected(detail, form.selected)).toEqual(['opt_l']);
    expect(form.tip).toEqual({ kind: 'PARTIAL' });
  });

  it('記憶沒有選項也沒有備註：不顯示「已套用上次的選擇」', () => {
    const detail = detailOf(LUROU, []);
    const form = buildInitialForm({ detail, remembered: remembered([], []), maxQuantity: 5 });
    expect(form.tip).toEqual({ kind: 'NONE' });
  });

  it('編輯購物車行：以該行內容為準（不套用記憶），數量夾在可加入上限內', () => {
    const form = buildInitialForm({
      detail: LUROU_DETAIL,
      editing: { optionIds: ['opt_l'], note: '少飯', quantity: 6 },
      remembered: remembered(['opt_s'], ['小碗']),
      maxQuantity: 4,
    });
    expect(flattenSelected(LUROU_DETAIL, form.selected)).toEqual(['opt_l']);
    expect(form).toMatchObject({ note: '少飯', quantity: 4, tip: { kind: 'NONE' } });
  });

  it('可加入量為 0 時數量仍為 1（加入鈕停用由畫面處理）', () => {
    const form = buildInitialForm({ detail: LUROU_DETAIL, maxQuantity: 0 });
    expect(form.quantity).toBe(1);
  });
});

describe('金額與驗證', () => {
  it('單價 = 基本價 + Σ 選項加價；標籤依群組順序', () => {
    expect(selectedUnitPrice(LUROU_DETAIL, ['opt_l', 'opt_egg'])).toBe(67);
    expect(selectedLabels(LUROU_DETAIL, ['opt_egg', 'opt_l'])).toEqual(['大碗', '滷蛋']);
  });

  it('單價不得小於 0', () => {
    const detail = detailOf({ ...LUROU, basePrice: 10 }, [
      {
        ...TOPPING_GROUP,
        options: [{ id: 'x', name: '折', priceDelta: -50, isDefault: false, isAvailable: true }],
      },
    ]);
    expect(selectedUnitPrice(detail, ['x'])).toBe(0);
  });

  it('群組驗證：必選未選與複選上限；第一個錯誤群組', () => {
    const empty = toSelected(LUROU_DETAIL, []);
    expect(firstGroupError(LUROU_DETAIL, empty)?.group.id).toBe('og_size');
    expect(firstGroupError(LUROU_DETAIL, empty)?.message).toBe('請選擇份量');
    expect(groupErrors(LUROU_DETAIL, toSelected(LUROU_DETAIL, ['opt_s'])).size).toBe(0);
    const tooMany = toSelected(LUROU_DETAIL, ['opt_s', 'opt_egg', 'opt_tofu', 'opt_meat']);
    expect(groupErrors(LUROU_DETAIL, tooMany).get('og_topping')).toBe('加料最多選 2 項');
  });

  it('備註以字數計（非 UTF-16 單位）', () => {
    expect(noteLength('不要蔥')).toBe(3);
    expect(noteLength('😀😀')).toBe(2);
  });
});

describe('restoreDefaults', () => {
  const applied = buildInitialForm({
    detail: LUROU_DETAIL,
    remembered: remembered(['opt_l', 'opt_egg'], ['大碗', '滷蛋'], '不要蔥'),
    maxQuantity: 20,
  });

  it('選項回到預設並清除記憶預填的備註', () => {
    const form = restoreDefaults(LUROU_DETAIL, applied, { clearNote: true });
    expect(flattenSelected(LUROU_DETAIL, form.selected)).toEqual(['opt_s']);
    expect(form.note).toBe('');
    expect(form.tip).toEqual({ kind: 'RESTORED' });
  });

  it('編輯購物車行時備註屬於該行，不清除', () => {
    const form = restoreDefaults(LUROU_DETAIL, { ...applied, note: '少飯' }, { clearNote: false });
    expect(form.note).toBe('少飯');
  });
});
