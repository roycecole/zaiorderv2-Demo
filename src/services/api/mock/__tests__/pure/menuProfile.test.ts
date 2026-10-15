// FR-DM-09 / 07 §6.7：Demo 菜單完整度（FULL / MIXED / NO_IMAGES / MINIMAL）、O-05（精簡菜單與庫存）
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { resolveMenuLayout } from '@/domain/menuLayout';
import type { Menu, ProductDetail, ProductSummary } from '@/domain/types';
import { applyDetailProfile, applyMenuProfile, toCatalogView } from '../../menuProfile';
import type { MenuProfile } from '../../menuProfile';

/** 08 §3.2 的 34 項種子商品 ID（依分類順序） */
const SEED_IDS = [
  'prd_lurou',
  'prd_chicken_rice',
  'prd_kong_rou',
  'prd_pork_chop',
  'prd_chicken_leg',
  'prd_beef_noodle',
  'prd_danzai',
  'prd_oyster_vermicelli',
  'prd_dry_noodle',
  'prd_wonton_soup',
  'prd_oyster_omelet',
  'prd_stinky_tofu',
  'prd_salt_chicken',
  'prd_meatball',
  'prd_rice_cake',
  'prd_fried_vermicelli',
  'prd_meatball_soup',
  'prd_clam_soup',
  'prd_sishen_soup',
  'prd_rib_soup',
  'prd_greens',
  'prd_braised_egg',
  'prd_tofu_dry',
  'prd_century_tofu',
  'prd_cucumber',
  'prd_black_tea',
  'prd_winter_melon',
  'prd_bubble_tea',
  'prd_soy_milk',
  'prd_tofu_pudding',
  'prd_herb_jelly',
  'prd_aiyu',
  'prd_combo_single',
  'prd_combo_share',
];

const summary = (o: Partial<ProductSummary> & { id: string }): ProductSummary => ({
  categoryId: 'c',
  name: o.id,
  description: 'd',
  imageUrl: '/i.jpg',
  basePrice: 35,
  displayPrice: 40,
  isPriceFrom: true,
  tags: ['HOT'],
  allergens: ['SOY'],
  isSoldOut: false,
  remainingToday: 3,
  hasRequiredOptions: true,
  ...o,
});
const detail = (o: Partial<ProductDetail> & { id: string }): ProductDetail => ({
  ...summary(o),
  optionGroups: [
    {
      id: 'g',
      name: 'n',
      selectionType: 'SINGLE',
      required: true,
      minSelect: 1,
      maxSelect: 1,
      options: [{ id: 'o', name: 'o', priceDelta: 5, isDefault: true, isAvailable: true }],
    },
  ],
  ...o,
});
const menuOf = (products: ProductSummary[]): Menu => ({
  generatedAt: '2026-10-14T12:00:00+08:00',
  categories: [{ id: 'c', name: 'c', products }],
});
const flat = (m: Menu): ProductSummary[] => m.categories.flatMap((c) => c.products);

describe('applyMenuProfile', () => {
  const full = menuOf(SEED_IDS.map((id) => summary({ id })));

  it('FULL 原樣回傳（同一個物件）', () => {
    expect(applyMenuProfile(full, 'FULL')).toBe(full);
  });

  it('MIXED：34 項種子 ID 恰一半（17）保留圖片，AUTO 版面判為 GRID（50% 門檻）', () => {
    const products = flat(applyMenuProfile(full, 'MIXED'));
    expect(products).toHaveLength(34);
    expect(products.filter((p) => p.imageUrl).length).toBe(17);
    expect(resolveMenuLayout('AUTO', products)).toBe('GRID');
  });

  it('MIXED：以商品 ID 決定，清單與詳情一致；多次呼叫結果穩定', () => {
    const list = flat(applyMenuProfile(full, 'MIXED'));
    for (const p of list) {
      const d = applyDetailProfile(detail({ id: p.id }), 'MIXED');
      expect(Boolean(d.imageUrl), p.id).toBe(Boolean(p.imageUrl));
    }
    expect(flat(applyMenuProfile(full, 'MIXED')).map((p) => Boolean(p.imageUrl))).toEqual(
      list.map((p) => Boolean(p.imageUrl)),
    );
  });

  it('NO_IMAGES：全無圖（AUTO 判為 LIST），其他欄位保留', () => {
    const products = flat(applyMenuProfile(full, 'NO_IMAGES'));
    expect(products.every((p) => p.imageUrl === undefined)).toBe(true);
    expect('imageUrl' in (products[0] as ProductSummary)).toBe(false);
    expect(products[0]).toMatchObject({
      description: 'd',
      tags: ['HOT'],
      allergens: ['SOY'],
      remainingToday: 3,
      hasRequiredOptions: true,
    });
    expect(resolveMenuLayout('AUTO', products)).toBe('LIST');
  });

  it('MINIMAL：只剩品名與價格（無描述、圖片、標籤、過敏原、剩餘、必選旗標、「起」）', () => {
    const p = flat(
      applyMenuProfile(menuOf([summary({ id: 'a' })]), 'MINIMAL'),
    )[0] as ProductSummary;
    expect(p).toMatchObject({
      id: 'a',
      categoryId: 'c',
      name: 'a',
      basePrice: 35,
      displayPrice: 35,
      isPriceFrom: false,
      tags: [],
      allergens: [],
      isSoldOut: false,
      hasRequiredOptions: false,
    });
    expect('imageUrl' in p).toBe(false);
    expect('description' in p).toBe(false);
    expect('remainingToday' in p).toBe(false);
  });

  it('不改動輸入菜單，保留其他分類屬性與 generatedAt', () => {
    const snapshot = JSON.stringify(full);
    const out = applyMenuProfile(full, 'MINIMAL');
    expect(JSON.stringify(full)).toBe(snapshot);
    expect(out.generatedAt).toBe(full.generatedAt);
    expect(out.categories[0]?.id).toBe('c');
  });

  it('各 profile 都不改變商品數量與順序', () => {
    for (const profile of ['FULL', 'MIXED', 'NO_IMAGES', 'MINIMAL'] as MenuProfile[]) {
      expect(
        flat(applyMenuProfile(full, profile)).map((p) => p.id),
        profile,
      ).toEqual(SEED_IDS);
    }
  });
});

describe('O-05：精簡菜單與庫存', () => {
  it('MINIMAL 先把「可購買量為 0」折進 isSoldOut 再刪除 remainingToday（顧客端仍顯示今日售完）', () => {
    const sold = applyDetailProfile(detail({ id: 'p', remainingToday: 0 }), 'MINIMAL');
    expect(sold.isSoldOut).toBe(true);
    expect('remainingToday' in sold).toBe(false);
    const some = applyDetailProfile(detail({ id: 'p', remainingToday: 2 }), 'MINIMAL');
    expect(some.isSoldOut).toBe(false);
    expect('remainingToday' in some).toBe(false);
    const menu = menuOf([summary({ id: 'p', remainingToday: 0 })]);
    expect(flat(applyMenuProfile(menu, 'MINIMAL'))[0]?.isSoldOut).toBe(true);
  });

  it('MINIMAL 保留手動售完旗標（remainingToday 省略 / null 時不改變）', () => {
    expect(
      applyDetailProfile(detail({ id: 'p', isSoldOut: true, remainingToday: null }), 'MINIMAL')
        .isSoldOut,
    ).toBe(true);
    const noRemaining = summary({ id: 'p' });
    delete noRemaining.remainingToday;
    expect(
      applyMenuProfile(menuOf([noRemaining]), 'MINIMAL').categories[0]?.products[0]?.isSoldOut,
    ).toBe(false);
  });

  it('applyDetailProfile：僅 MINIMAL 清空選項群組', () => {
    const d = detail({ id: 'p' });
    expect(applyDetailProfile(d, 'MINIMAL').optionGroups).toEqual([]);
    for (const p of ['FULL', 'MIXED', 'NO_IMAGES'] as MenuProfile[]) {
      expect(applyDetailProfile(d, p).optionGroups, p).toHaveLength(1);
    }
  });

  it('MINIMAL 詳情的鍵集合只剩必要欄位（含 optionGroups）', () => {
    const d = applyDetailProfile(detail({ id: 'a' }), 'MINIMAL');
    expect(Object.keys(d).sort()).toEqual([
      'allergens',
      'basePrice',
      'categoryId',
      'displayPrice',
      'hasRequiredOptions',
      'id',
      'isPriceFrom',
      'isSoldOut',
      'name',
      'optionGroups',
      'tags',
    ]);
    expect(d.optionGroups).toHaveLength(0);
  });

  it('toCatalogView：保留原始庫存事實（isSoldOut、remainingToday），選項清空、單價為 basePrice', () => {
    const d = detail({ id: 'p', remainingToday: 2 });
    const v = toCatalogView(d, 'MINIMAL');
    expect(v.remainingToday).toBe(2);
    expect(v.isSoldOut).toBe(false);
    expect(v.optionGroups).toEqual([]);
    expect(v.displayPrice).toBe(d.basePrice);
  });

  it('toCatalogView：remainingToday 為 0 時 isSoldOut 不被折疊（保留原始值）；省略與 null 原樣', () => {
    const zero = toCatalogView(detail({ id: 'p', remainingToday: 0, isSoldOut: false }), 'MINIMAL');
    expect(zero.remainingToday).toBe(0);
    expect(zero.isSoldOut).toBe(false);
    const omitted = detail({ id: 'p' });
    delete omitted.remainingToday;
    expect(toCatalogView(omitted, 'MINIMAL').remainingToday).toBeUndefined();
    expect('remainingToday' in toCatalogView(omitted, 'MINIMAL')).toBe(false);
    expect(
      toCatalogView(detail({ id: 'p', remainingToday: null }), 'MINIMAL').remainingToday,
    ).toBeNull();
  });

  it('toCatalogView：其他 profile 不改動庫存；不改動原物件', () => {
    const d = detail({ id: 'p', remainingToday: 2 });
    for (const p of ['FULL', 'MIXED', 'NO_IMAGES'] as MenuProfile[]) {
      expect(toCatalogView(d, p).remainingToday, p).toBe(2);
    }
    toCatalogView(d, 'MINIMAL');
    expect(d.remainingToday).toBe(2);
    expect(d.optionGroups).toHaveLength(1);
  });

  it('性質：不論 profile，toCatalogView 的庫存事實（isSoldOut、remainingToday）恆等於原始值', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<MenuProfile>('FULL', 'MIXED', 'NO_IMAGES', 'MINIMAL'),
        fc.boolean(),
        fc.option(fc.integer({ min: 0, max: 20 }), { nil: null }),
        (profile, isSoldOut, remainingToday) => {
          const d = detail({ id: 'prd_x', isSoldOut, remainingToday });
          const v = toCatalogView(d, profile);
          expect(v.isSoldOut).toBe(isSoldOut);
          expect(v.remainingToday).toBe(remainingToday);
        },
      ),
    );
  });
});
