// BR-35 點餐記憶、FLOW-20、03 §6.8；O-05（再點與庫存）
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MAX_REMEMBERED,
  REMEMBER_TTL_MS,
  applyRemembered,
  canRepeatDirectly,
  defaultOptionIds,
  frequentItems,
  mergeRemembered,
  pruneRemembered,
  rememberFromOrder,
  satisfiesGroups,
} from '../rememberedChoice';
import type { AppliedChoice, RememberedChoice, RememberedMap } from '../rememberedChoice';
import type { FrequentItem, OptionGroup, ProductDetail } from '../types';

const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const detail = (over: Partial<ProductDetail> = {}): ProductDetail => ({
  id: 'prd_lurou',
  categoryId: 'c',
  name: '招牌滷肉飯',
  basePrice: 35,
  displayPrice: 35,
  isPriceFrom: true,
  tags: [],
  allergens: [],
  isSoldOut: false,
  hasRequiredOptions: true,
  optionGroups: [
    {
      id: 'og_size',
      name: '份量',
      selectionType: 'SINGLE',
      required: true,
      minSelect: 1,
      maxSelect: 1,
      options: [
        { id: 'opt_s', name: '小碗', priceDelta: 0, isDefault: true, isAvailable: true },
        { id: 'opt_l', name: '大碗', priceDelta: 20, isDefault: false, isAvailable: true },
      ],
    },
    {
      id: 'og_top',
      name: '加料',
      selectionType: 'MULTIPLE',
      required: false,
      minSelect: 0,
      maxSelect: 2,
      options: [
        { id: 'opt_egg', name: '滷蛋', priceDelta: 12, isDefault: false, isAvailable: true },
        { id: 'opt_tofu', name: '滷豆干', priceDelta: 10, isDefault: false, isAvailable: true },
        { id: 'opt_fried', name: '荷包蛋', priceDelta: 15, isDefault: false, isAvailable: true },
      ],
    },
  ],
  ...over,
});
/** 修改後的商品：回傳深拷貝，避免互相污染 */
const mutate = (fn: (d: ProductDetail) => void): ProductDetail => {
  const d = structuredClone(detail());
  fn(d);
  return d;
};
const group = (d: ProductDetail, i: number): OptionGroup => d.optionGroups[i] as OptionGroup;

const rec = (o: Partial<RememberedChoice> = {}): RememberedChoice => ({
  productId: 'prd_lurou',
  optionIds: ['opt_l', 'opt_egg'],
  labels: ['大碗', '滷蛋'],
  note: '不要蔥',
  at: NOW,
  ...o,
});

describe('常數（BR-35）', () => {
  it('保留 180 天、最多 100 項', () => {
    expect(REMEMBER_TTL_MS).toBe(180 * DAY);
    expect(MAX_REMEMBERED).toBe(100);
  });
});

describe('applyRemembered：以商品「目前」的選項驗證記憶', () => {
  it('全數有效 → FULL，套用選項與備註，可直接再點', () => {
    const a = applyRemembered(detail(), rec());
    expect(a.status).toBe('FULL');
    expect(a.optionIds).toEqual(['opt_l', 'opt_egg']);
    expect(a.labels).toEqual(['大碗', '滷蛋']);
    expect(a.note).toBe('不要蔥');
    expect(a.dropped).toEqual([]);
    expect(canRepeatDirectly(detail(), a)).toBe(true);
  });

  it('無記憶或記憶不屬於此商品 → NONE（呼叫端使用 defaultOptionIds）', () => {
    expect(applyRemembered(detail(), undefined)).toEqual({
      status: 'NONE',
      optionIds: [],
      labels: [],
      dropped: [],
    });
    expect(applyRemembered(detail(), rec({ productId: 'other' })).status).toBe('NONE');
    expect(defaultOptionIds(detail())).toEqual(['opt_s']);
  });

  it('選項已不提供 → PARTIAL，丟棄失效者且不可直接再點', () => {
    const d = mutate((x) => {
      (group(x, 1).options[0] as { isAvailable: boolean }).isAvailable = false;
    }); // 滷蛋停售
    const a = applyRemembered(d, rec());
    expect(a.status).toBe('PARTIAL');
    expect(a.dropped).toEqual(['opt_egg']);
    expect(a.optionIds).toEqual(['opt_l']);
    expect(canRepeatDirectly(d, a)).toBe(false);
  });

  it('選項已從商品移除（ID 不存在）→ 同樣丟棄', () => {
    const a = applyRemembered(
      detail(),
      rec({ optionIds: ['opt_l', 'opt_gone'], labels: ['大碗', '舊'] }),
    );
    expect(a.status).toBe('PARTIAL');
    expect(a.dropped).toEqual(['opt_gone']);
    expect(a.optionIds).toEqual(['opt_l']);
  });

  it('必選群組的記憶選項失效 → 改用該群組預設並標示 PARTIAL', () => {
    const d = mutate((x) => {
      (group(x, 0).options[1] as { isAvailable: boolean }).isAvailable = false;
    }); // 大碗停售
    const a = applyRemembered(d, rec());
    expect(a.status).toBe('PARTIAL');
    expect(a.optionIds).toEqual(['opt_s', 'opt_egg']);
    expect(a.labels).toEqual(['小碗', '滷蛋']);
  });

  it('商品新增必選群組（記憶中沒有）→ 用預設並標示 PARTIAL', () => {
    const d = mutate((x) => {
      x.optionGroups.push({
        id: 'og_new',
        name: '辣度',
        selectionType: 'SINGLE',
        required: true,
        minSelect: 1,
        maxSelect: 1,
        options: [
          { id: 'opt_none', name: '不辣', priceDelta: 0, isDefault: true, isAvailable: true },
        ],
      });
    });
    const a = applyRemembered(d, rec());
    expect(a.status).toBe('PARTIAL');
    expect(a.optionIds).toContain('opt_none');
    expect(a.labels).toContain('不辣');
  });

  it('複選超過上限視同失效（PARTIAL，不靜默截斷）：保留前 maxSelect 個、其餘列入 dropped', () => {
    const a = applyRemembered(
      detail(),
      rec({ optionIds: ['opt_l', 'opt_egg', 'opt_tofu', 'opt_fried'] }),
    );
    expect(a.status).toBe('PARTIAL');
    expect(a.optionIds).toEqual(['opt_l', 'opt_egg', 'opt_tofu']);
    expect(a.dropped).toEqual(['opt_fried']);
    expect(canRepeatDirectly(detail(), a)).toBe(false);
  });

  it('群組由複選改單選（上限降為 1）→ PARTIAL 並列出被丟棄者', () => {
    const d = mutate((x) => {
      group(x, 1).selectionType = 'SINGLE';
      group(x, 1).maxSelect = 1;
    });
    const a = applyRemembered(d, rec({ optionIds: ['opt_l', 'opt_egg', 'opt_tofu'] }));
    expect(a.status).toBe('PARTIAL');
    expect(a.optionIds).toEqual(['opt_l', 'opt_egg']);
    expect(a.dropped).toEqual(['opt_tofu']);
    expect(canRepeatDirectly(d, a)).toBe(false);
  });

  it('最少 2 選的群組：保留仍有效者，並以預設補足（不整組覆蓋）', () => {
    const d = detail({
      optionGroups: [
        {
          id: 'og_share',
          name: '主餐（選 2）',
          selectionType: 'MULTIPLE',
          required: true,
          minSelect: 2,
          maxSelect: 2,
          options: [
            { id: 'o1', name: '滷肉飯', priceDelta: 0, isDefault: false, isAvailable: true },
            { id: 'o2', name: '雞肉飯', priceDelta: 0, isDefault: false, isAvailable: false },
            { id: 'o3', name: '排骨飯', priceDelta: 30, isDefault: true, isAvailable: true },
          ],
        },
      ],
    });
    const a = applyRemembered(d, rec({ optionIds: ['o1', 'o2'] }));
    expect(a.status).toBe('PARTIAL');
    expect(a.optionIds).toEqual(['o1', 'o3']);
    expect(a.dropped).toEqual(['o2']);
    expect(canRepeatDirectly(d, a)).toBe(false); // 已是 PARTIAL，必須開面板確認

    // 沒有預設可補時：保留有效者，不滿足群組限制（由面板要求使用者補選）
    const none = detail({
      optionGroups: [
        { ...group(d, 0), options: group(d, 0).options.map((o) => ({ ...o, isDefault: false })) },
      ],
    });
    const b = applyRemembered(none, rec({ optionIds: ['o1', 'o2'] }));
    expect(b.optionIds).toEqual(['o1']);
    expect(satisfiesGroups(none, b.optionIds)).toBe(false);
  });

  it('備註只有空白不套用；備註前後空白去除；重複 ID 去重', () => {
    expect(applyRemembered(detail(), rec({ note: '   ' })).note).toBeUndefined();
    expect(applyRemembered(detail(), rec({ note: ' 少冰 ' })).note).toBe('少冰');
    expect(
      applyRemembered(detail(), rec({ optionIds: ['opt_l', 'opt_l', 'opt_egg'] })).optionIds,
    ).toEqual(['opt_l', 'opt_egg']);
  });

  it('性質：結果選項皆為目前可用選項、每群組不超過上限；FULL 必滿足群組限制且無丟棄；labels 與 optionIds 等長', () => {
    const allIds = ['opt_s', 'opt_l', 'opt_egg', 'opt_tofu', 'opt_fried', 'opt_gone'];
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...allIds), { maxLength: 6 }),
        fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
        (wanted, availability) => {
          const d = mutate((x) => {
            const flat = x.optionGroups.flatMap((g) => g.options);
            flat.forEach((o, i) => {
              o.isAvailable = availability[i] ?? true;
            });
          });
          const a = applyRemembered(d, rec({ optionIds: wanted }));
          const availableIds = new Set(
            d.optionGroups
              .flatMap((g) => g.options)
              .filter((o) => o.isAvailable)
              .map((o) => o.id),
          );
          expect(a.optionIds.every((id) => availableIds.has(id))).toBe(true);
          expect(new Set(a.optionIds).size).toBe(a.optionIds.length);
          expect(a.labels).toHaveLength(a.optionIds.length);
          for (const g of d.optionGroups) {
            const n = g.options.filter((o) => a.optionIds.includes(o.id)).length;
            expect(n).toBeLessThanOrEqual(g.selectionType === 'SINGLE' ? 1 : g.maxSelect);
          }
          if (a.status === 'FULL') {
            expect(a.dropped).toEqual([]);
            expect(satisfiesGroups(d, a.optionIds)).toBe(true);
          }
        },
      ),
    );
  });
});

describe('defaultOptionIds / satisfiesGroups', () => {
  it('每群組取 isDefault 且可用者；單選最多 1 個、複選至多 maxSelect 個', () => {
    const d = detail({
      optionGroups: [
        {
          id: 'g1',
          name: 's',
          selectionType: 'SINGLE',
          required: true,
          minSelect: 1,
          maxSelect: 1,
          options: [
            { id: 'a', name: 'a', priceDelta: 0, isDefault: true, isAvailable: true },
            { id: 'b', name: 'b', priceDelta: 0, isDefault: true, isAvailable: true },
          ],
        },
        {
          id: 'g2',
          name: 'm',
          selectionType: 'MULTIPLE',
          required: false,
          minSelect: 0,
          maxSelect: 2,
          options: [
            { id: 'c', name: 'c', priceDelta: 0, isDefault: true, isAvailable: true },
            { id: 'd', name: 'd', priceDelta: 0, isDefault: true, isAvailable: false },
            { id: 'e', name: 'e', priceDelta: 0, isDefault: true, isAvailable: true },
            { id: 'f', name: 'f', priceDelta: 0, isDefault: true, isAvailable: true },
          ],
        },
      ],
    });
    expect(defaultOptionIds(d)).toEqual(['a', 'c', 'e']);
  });

  it('沒有任何選項群組：預設為空，且恆滿足限制', () => {
    const d = detail({ optionGroups: [] });
    expect(defaultOptionIds(d)).toEqual([]);
    expect(satisfiesGroups(d, [])).toBe(true);
  });

  it('satisfiesGroups：必選群組不足或超過上限皆不滿足', () => {
    expect(satisfiesGroups(detail(), ['opt_s'])).toBe(true);
    expect(satisfiesGroups(detail(), [])).toBe(false);
    expect(satisfiesGroups(detail(), ['opt_s', 'opt_l'])).toBe(false);
    expect(satisfiesGroups(detail(), ['opt_s', 'opt_egg', 'opt_tofu', 'opt_fried'])).toBe(false);
  });
});

describe('canRepeatDirectly（O-05：再點與庫存）', () => {
  const full: AppliedChoice = { status: 'FULL', optionIds: [], labels: [], dropped: [] };
  const prod = (o: Partial<ProductDetail> = {}): ProductDetail =>
    detail({ optionGroups: [], hasRequiredOptions: false, ...o });

  it('納入購物車內已有份數：剩 3、購物車已有 3 → 不可；已有 2 → 可', () => {
    const d = prod({ remainingToday: 3 });
    expect(canRepeatDirectly(d, full, 0)).toBe(true);
    expect(canRepeatDirectly(d, full, 2)).toBe(true);
    expect(canRepeatDirectly(d, full, 3)).toBe(false);
    expect(canRepeatDirectly(d, full, 5)).toBe(false);
    expect(canRepeatDirectly(d, full)).toBe(true); // 預設 inCartQuantity = 0
  });

  it('remainingToday 省略視為未提供（不限制）；null 為不限量；0 與手動售完不可；非 FULL 不可', () => {
    expect(canRepeatDirectly(prod(), full, 9)).toBe(true);
    expect(canRepeatDirectly(prod({ remainingToday: null }), full, 9)).toBe(true);
    expect(canRepeatDirectly(prod({ remainingToday: 0 }), full, 0)).toBe(false);
    expect(canRepeatDirectly(prod({ isSoldOut: true }), full, 0)).toBe(false);
    expect(canRepeatDirectly(prod({ remainingToday: 5 }), { ...full, status: 'PARTIAL' }, 0)).toBe(
      false,
    );
    expect(canRepeatDirectly(prod({ remainingToday: 5 }), { ...full, status: 'NONE' }, 0)).toBe(
      false,
    );
  });

  it('FULL 但不滿足群組限制（例如必選群組沒有記憶）不可直接再點', () => {
    expect(canRepeatDirectly(detail(), full)).toBe(false);
  });

  it('今日剩餘 0：即使記憶全數有效也不可直接再點', () => {
    const d = detail({ remainingToday: 0 });
    expect(canRepeatDirectly(d, applyRemembered(d, rec()))).toBe(false);
  });
});

describe('rememberFromOrder', () => {
  const line = (
    productId: string,
    o: { optionIds?: string[]; labels?: string[]; note?: string } = {},
  ) => ({
    productId,
    optionIds: o.optionIds ?? [],
    labels: o.labels ?? [],
    ...(o.note !== undefined ? { note: o.note } : {}),
  });

  it('同商品覆蓋為最新；備註空白不寫入；不改動原物件', () => {
    const base: RememberedMap = { prd_lurou: rec({ at: NOW - 5000 }) };
    const next = rememberFromOrder(
      base,
      [line('prd_lurou', { optionIds: ['opt_s'], labels: ['小碗'], note: '  ' })],
      NOW,
    );
    expect(next.prd_lurou?.optionIds).toEqual(['opt_s']);
    expect(next.prd_lurou?.note).toBeUndefined();
    expect(next.prd_lurou?.at).toBe(NOW);
    expect(base.prd_lurou?.at).toBe(NOW - 5000);
    expect(base.prd_lurou?.optionIds).toEqual(['opt_l', 'opt_egg']);
  });

  it('備註去除前後空白；選項與名稱為複本（不與輸入共用陣列）', () => {
    const input = line('p', { optionIds: ['a'], labels: ['A'], note: ' 少冰 ' });
    const next = rememberFromOrder({}, [input], NOW);
    expect(next.p?.note).toBe('少冰');
    expect(next.p?.optionIds).not.toBe(input.optionIds);
    expect(next.p?.labels).not.toBe(input.labels);
  });

  it('價格不隨記憶保存：記錄只含商品、選項 ID、名稱快照、備註與時間', () => {
    const next = rememberFromOrder(
      {},
      [line('a', { optionIds: ['x'], labels: ['大碗'], note: '少飯' })],
      NOW,
    );
    expect(Object.keys(next.a as RememberedChoice).sort()).toEqual([
      'at',
      'labels',
      'note',
      'optionIds',
      'productId',
    ]);
    const bare = rememberFromOrder({}, [line('b')], NOW);
    expect(Object.keys(bare.b as RememberedChoice).sort()).toEqual([
      'at',
      'labels',
      'optionIds',
      'productId',
    ]);
  });

  it('同一筆訂單的「常點」排序穩定：依行序，第 1 行最新', () => {
    const lines = ['10', '2', '1', 'b', 'a'].map((id) => line(id));
    const next = rememberFromOrder({}, lines, NOW);
    expect(frequentItems(next, 5, NOW).map((x) => x.productId)).toEqual(['10', '2', '1', 'b', 'a']);
  });

  it('寫入時一併清除過期與超出上限的舊項目', () => {
    const old: RememberedMap = {
      stale: rec({ productId: 'stale', at: NOW - REMEMBER_TTL_MS - 1 }),
    };
    const next = rememberFromOrder(old, [line('fresh')], NOW);
    expect(Object.keys(next)).toEqual(['fresh']);
  });
});

describe('pruneRemembered', () => {
  it('超過 180 天者清除（恰 180 天保留）', () => {
    const m: RememberedMap = {
      a: rec({ productId: 'a', at: NOW - REMEMBER_TTL_MS - 1 }),
      b: rec({ productId: 'b', at: NOW - REMEMBER_TTL_MS }),
    };
    expect(Object.keys(pruneRemembered(m, NOW))).toEqual(['b']);
  });

  it('超過 100 筆淘汰最舊者', () => {
    const many: RememberedMap = {};
    for (let i = 0; i < 120; i++) many[`p${i}`] = rec({ productId: `p${i}`, at: NOW - i });
    const out = pruneRemembered(many, NOW);
    expect(Object.keys(out)).toHaveLength(100);
    expect(out.p0).toBeDefined();
    expect(out.p99).toBeDefined();
    expect(out.p100).toBeUndefined();
    expect(out.p119).toBeUndefined();
  });

  it('同商品多筆只留最新，不佔 100 名額', () => {
    const m: RememberedMap = {
      k1: rec({ productId: 'p', at: 200 }),
      k2: rec({ productId: 'p', at: 100 }),
    };
    const out = pruneRemembered(m, 300);
    expect(Object.keys(out)).toHaveLength(1);
    expect(out.p?.at).toBe(200);
  });

  it('時鐘異常（NaN）時不得清空使用者的記憶；at 非有限值的項目被丟棄', () => {
    const m: RememberedMap = {
      a: rec({ productId: 'a', at: NOW - REMEMBER_TTL_MS - 1 }),
      b: rec({ productId: 'b', at: NOW }),
    };
    expect(Object.keys(pruneRemembered(m, Number.NaN)).sort()).toEqual(['a', 'b']);
    expect(
      Object.keys(pruneRemembered({ x: rec({ productId: 'x', at: Number.NaN }) }, NOW)),
    ).toEqual([]);
  });

  it('不改動輸入、結果為新物件', () => {
    const m: RememberedMap = { a: rec({ productId: 'a' }) };
    const out = pruneRemembered(m, NOW);
    expect(out).not.toBe(m);
    expect(Object.keys(m)).toEqual(['a']);
  });

  it('性質：冪等、不超過上限、每商品至多一筆、結果皆未過期', () => {
    const entryArb = fc.record({
      productId: fc.constantFrom('a', 'b', 'c', 'd', 'e'),
      age: fc.integer({ min: 0, max: 2 * REMEMBER_TTL_MS }),
    });
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 30 }), (entries) => {
        const map: RememberedMap = {};
        entries.forEach((e, i) => {
          map[`k${i}`] = rec({ productId: e.productId, at: NOW - e.age });
        });
        const once = pruneRemembered(map, NOW);
        expect(pruneRemembered(once, NOW)).toEqual(once);
        expect(Object.keys(once).length).toBeLessThanOrEqual(MAX_REMEMBERED);
        for (const [k, v] of Object.entries(once)) {
          expect(k).toBe(v.productId);
          expect(NOW - v.at).toBeLessThanOrEqual(REMEMBER_TTL_MS);
          // 該商品的最新未過期記錄
          const best = Math.max(
            ...entries
              .filter((e) => e.productId === v.productId && e.age <= REMEMBER_TTL_MS)
              .map((e) => NOW - e.age),
          );
          expect(v.at).toBe(best);
        }
      }),
    );
  });
});

describe('frequentItems（常點）', () => {
  it('依時間新到舊取前 N 項', () => {
    const m: RememberedMap = {
      a: rec({ productId: 'a', at: 1 }),
      b: rec({ productId: 'b', at: 3 }),
      c: rec({ productId: 'c', at: 2 }),
    };
    expect(frequentItems(m, 2, 10).map((x) => x.productId)).toEqual(['b', 'c']);
    expect(frequentItems(m, 10, 10).map((x) => x.productId)).toEqual(['b', 'c', 'a']);
  });

  it('「常點」區塊最多 6 項（呼叫端傳入 limit = 6）', () => {
    const m: RememberedMap = {};
    for (let i = 0; i < 10; i++) m[`p${i}`] = rec({ productId: `p${i}`, at: NOW - i });
    expect(frequentItems(m, 6, NOW).map((x) => x.productId)).toEqual([
      'p0',
      'p1',
      'p2',
      'p3',
      'p4',
      'p5',
    ]);
  });

  it('讀取也遵守 180 天：過期者不在「常點」', () => {
    const m: RememberedMap = {
      a: rec({ productId: 'a', at: NOW - REMEMBER_TTL_MS - 1 }),
      b: rec({ productId: 'b', at: NOW }),
    };
    expect(frequentItems(m, 6, NOW).map((x) => x.productId)).toEqual(['b']);
  });

  it('負數、NaN、小數 limit 的處理', () => {
    const m: RememberedMap = {
      a: rec({ productId: 'a' }),
      b: rec({ productId: 'b', at: NOW - 1 }),
    };
    expect(frequentItems(m, -1, NOW)).toEqual([]);
    expect(frequentItems(m, Number.NaN, NOW)).toEqual([]);
    expect(frequentItems(m, 1.9, NOW)).toHaveLength(1);
    expect(frequentItems(m, 0, NOW)).toEqual([]);
  });
});

describe('mergeRemembered（會員：伺服器常點 + 本機記憶，BR-35、FLOW-20）', () => {
  const iso = (ms: number): string => new Date(ms).toISOString();
  const server = (o: Partial<FrequentItem> & { productId: string }): FrequentItem => ({
    optionIds: ['S'],
    optionLabels: ['伺服器'],
    lastOrderedAt: iso(NOW - 500),
    orderCount: 2,
    ...o,
  });

  it('伺服器較新者勝、本機較新者保留、僅伺服器有者加入、日期無效者略過', () => {
    const local: RememberedMap = {
      a: rec({ productId: 'a', optionIds: ['L'], labels: ['本機'], at: NOW - 1000 }),
      b: rec({ productId: 'b', optionIds: ['L'], labels: ['本機'], at: NOW }),
    };
    const m = mergeRemembered(
      local,
      [
        server({ productId: 'a' }),
        server({ productId: 'b' }),
        server({ productId: 'c', note: ' 少冰 ', lastOrderedAt: iso(NOW - 2000), orderCount: 1 }),
        server({
          productId: 'd',
          optionIds: [],
          optionLabels: [],
          lastOrderedAt: 'not-a-date',
          orderCount: 1,
        }),
      ],
      NOW,
    );
    expect(m.a?.optionIds).toEqual(['S']); // 伺服器較新
    expect(m.b?.optionIds).toEqual(['L']); // 本機較新
    expect(m.c?.note).toBe('少冰');
    expect(m.d).toBeUndefined();
  });

  it('同時（at 相同）保留本機', () => {
    const local: RememberedMap = { a: rec({ productId: 'a', optionIds: ['L'], at: NOW - 500 }) };
    const m = mergeRemembered(local, [server({ productId: 'a' })], NOW);
    expect(m.a?.optionIds).toEqual(['L']);
  });

  it('合併後同樣遵守 180 天與上限；不改動本機輸入', () => {
    const local: RememberedMap = { a: rec({ productId: 'a', at: NOW }) };
    const m = mergeRemembered(
      local,
      [server({ productId: 'old', lastOrderedAt: iso(NOW - REMEMBER_TTL_MS - 1000) })],
      NOW,
    );
    expect(m.old).toBeUndefined();
    expect(Object.keys(local)).toEqual(['a']);
  });
});
