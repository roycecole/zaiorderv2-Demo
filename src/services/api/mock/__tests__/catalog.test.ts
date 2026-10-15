// 菜單、商品、店家資訊、營業狀態、時段與外送範圍（06 §5.2b～§5.7；08 §2、§3）
import { afterEach, describe, expect, it } from 'vitest';
import { rejection, setup } from './harness';
import type { Harness } from './harness';

let h: Harness;
afterEach(() => h.cleanup());

describe('store.getInfo / getStatus', () => {
  it('店家基本資料、服務、付款方式與限制（08 §2.1）', async () => {
    h = setup();
    const info = await h.client.store.getInfo();
    expect(info.slug).toBe('demo-snack');
    expect(info.name).toBe('巷仔內小吃部');
    expect(info.timezone).toBe('Asia/Taipei');
    expect(info.services).toEqual({ pickup: true, delivery: true, dineIn: true });
    expect(info.paymentMethods).toEqual(['CASH', 'CREDIT_CARD', 'LINE_PAY', 'JKOPAY']);
    expect(info.display).toEqual({ brandColor: '#D93A22', menuLayout: 'AUTO' });
    expect(info.limits).toEqual({
      minOrderAmount: 0,
      maxQuantityPerItem: 20,
      maxLines: 30,
      maxAdvanceDays: 1,
      slotIntervalMinutes: 15,
      pickupLeadMinutes: 15,
      deliveryLeadMinutes: 40,
    });
    expect(info.businessHours).toHaveLength(12); // 週一至週六各兩段
    expect(info.status.status).toBe('OPEN');
  });

  it('特殊公休日為播種當下的今日 + 3 日（備註「店休日」）', async () => {
    h = setup();
    const info = await h.client.store.getInfo();
    expect(info.specialDays).toEqual([{ date: '2026-10-17', type: 'CLOSED', note: '店休日' }]);
  });

  it('serverTime 帶 +08:00 並隨模擬時鐘', async () => {
    h = setup();
    const s = await h.client.store.getStatus();
    expect(s.serverTime).toBe('2026-10-14T12:00:00+08:00');
    expect(s.status).toBe('OPEN');
  });

  it('14:30 午休：CLOSED · OUT_OF_HOURS，下次 17:00', async () => {
    h = setup({ now: Date.parse('2026-10-14T14:30:00+08:00') });
    const s = await h.client.store.getStatus();
    expect(s.status).toBe('CLOSED');
    expect(s.closedReason).toBe('OUT_OF_HOURS');
    expect(s.nextOpenAt).toBe('2026-10-14T17:00:00+08:00');
  });

  it('週日公休、特殊公休日皆為 HOLIDAY', async () => {
    h = setup();
    h.setNow(Date.parse('2026-10-18T12:00:00+08:00')); // 週日
    expect((await h.client.store.getStatus()).closedReason).toBe('HOLIDAY');
    h.setNow(Date.parse('2026-10-17T12:00:00+08:00')); // 特殊公休日（今日 + 3 日，週六）
    const s = await h.client.store.getStatus();
    expect(s.status).toBe('CLOSED');
    expect(s.closedReason).toBe('HOLIDAY');
  });

  it('storeOverride：強制營業 / 休息 / 暫停', async () => {
    h = setup({ now: Date.parse('2026-10-14T14:30:00+08:00') });
    h.client.demo.setState({ storeOverride: 'OPEN' });
    expect((await h.client.store.getStatus()).status).toBe('OPEN');
    h.client.demo.setState({ storeOverride: 'PAUSED' });
    expect((await h.client.store.getStatus()).status).toBe('PAUSED');
    h.client.demo.setState({ storeOverride: 'CLOSED' });
    const s = await h.client.store.getStatus();
    expect(s.status).toBe('CLOSED');
    expect(s.nextOpenAt).toBe('2026-10-14T17:00:00+08:00');
  });
});

describe('store.getMenu', () => {
  it('8 個分類、34 項商品，依序排列', async () => {
    h = setup();
    const menu = await h.client.store.getMenu();
    expect(menu.categories.map((c) => c.id)).toEqual([
      'cat_rice', 'cat_noodle', 'cat_snack', 'cat_soup', 'cat_side', 'cat_drink', 'cat_dessert', 'cat_combo',
    ]);
    expect(menu.categories.every((c) => c.icon !== undefined)).toBe(true);
    expect(menu.categories.flatMap((c) => c.products)).toHaveLength(34);
    expect(menu.generatedAt).toBe('2026-10-14T12:00:00+08:00');
  });

  it('商品旗標：價格「起」、必選選項、售完與剩餘份數', async () => {
    h = setup();
    const all = (await h.client.store.getMenu()).categories.flatMap((c) => c.products);
    const by = (id: string) => all.find((p) => p.id === id);

    const lurou = by('prd_lurou');
    expect(lurou).toMatchObject({
      basePrice: 35, displayPrice: 35, isPriceFrom: true, hasRequiredOptions: true,
      isSoldOut: false, remainingToday: null, tags: ['HOT'], allergens: ['SOY'],
    });
    expect(lurou?.imageUrl).toBe('/images/products/lurou.svg');

    // 控肉飯：手動售完（不限量）、只有選填群組 → 「＋」直接加入
    expect(by('prd_kong_rou')).toMatchObject({
      isSoldOut: true, remainingToday: null, hasRequiredOptions: false, isPriceFrom: false,
    });
    expect(by('prd_kong_rou')?.imageUrl).toBeUndefined();

    // 雙人分享餐：每日限量 5、剩 5 份
    expect(by('prd_combo_share')).toMatchObject({
      isSoldOut: false, remainingToday: 5, isPriceFrom: true, hasRequiredOptions: true, tags: ['LIMITED'],
    });

    // 無選項商品
    expect(by('prd_danzai')).toMatchObject({ hasRequiredOptions: false, isPriceFrom: false, displayPrice: 60 });
    expect(by('prd_danzai')?.description).toBeUndefined();
    // 必選群組價格皆相同 → 不顯示「起」
    expect(by('prd_beef_noodle')).toMatchObject({ isPriceFrom: false, hasRequiredOptions: true });
  });

  it('12 項有圖、其餘無圖；有與無描述皆存在', async () => {
    h = setup();
    const all = (await h.client.store.getMenu()).categories.flatMap((c) => c.products);
    expect(all.filter((p) => p.imageUrl !== undefined)).toHaveLength(12);
    expect(all.filter((p) => p.description === undefined).length).toBeGreaterThan(10);
    expect(all.filter((p) => p.description !== undefined).length).toBeGreaterThan(10);
  });

  it('限量用盡：isSoldOut = true 且 remainingToday = 0（與手動售完不同）', async () => {
    h = setup();
    h.client.demo.setRemaining('prd_combo_share', 0);
    const menu = await h.client.store.getMenu();
    const combo = menu.categories.flatMap((c) => c.products).find((p) => p.id === 'prd_combo_share');
    expect(combo).toMatchObject({ isSoldOut: true, remainingToday: 0 });
  });

  it('menuProfile：NO_IMAGES / MINIMAL / MIXED 轉換（FR-DM-09）', async () => {
    h = setup();
    const flat = async () => (await h.client.store.getMenu()).categories.flatMap((c) => c.products);

    h.client.demo.setState({ menuProfile: 'NO_IMAGES' });
    expect((await flat()).every((p) => p.imageUrl === undefined)).toBe(true);
    expect((await flat()).some((p) => p.description !== undefined)).toBe(true);

    h.client.demo.setState({ menuProfile: 'MIXED' });
    const mixed = await flat();
    const withImage = mixed.filter((p) => p.imageUrl !== undefined).length;
    expect(withImage).toBeLessThan(12);

    h.client.demo.setState({ menuProfile: 'MINIMAL' });
    const minimal = await flat();
    expect(minimal.every((p) => p.imageUrl === undefined && p.description === undefined)).toBe(true);
    expect(minimal.every((p) => p.tags.length === 0 && p.allergens.length === 0)).toBe(true);
    expect(minimal.every((p) => !p.hasRequiredOptions && !p.isPriceFrom)).toBe(true);
    expect(minimal.find((p) => p.id === 'prd_combo_share')?.remainingToday).toBeUndefined();
    // 精簡菜單仍顯示「今日售完」：限量用盡折進 isSoldOut
    h.client.demo.setRemaining('prd_combo_share', 0);
    expect((await flat()).find((p) => p.id === 'prd_combo_share')?.isSoldOut).toBe(true);
  });

  it('priceOverrides 調價同時反映在菜單與商品詳情', async () => {
    h = setup();
    h.client.demo.setState({ priceOverrides: { prd_lurou: 40 } });
    const lurou = (await h.client.store.getMenu()).categories
      .flatMap((c) => c.products)
      .find((p) => p.id === 'prd_lurou');
    expect(lurou?.basePrice).toBe(40);
    expect((await h.client.store.getProduct('prd_lurou')).basePrice).toBe(40);
  });
});

describe('store.getProduct', () => {
  it('選項群組：份量（必選單選）與加料（選填多選，0–3）', async () => {
    h = setup();
    const p = await h.client.store.getProduct('prd_lurou');
    expect(p.optionGroups).toHaveLength(2);
    expect(p.optionGroups[0]).toMatchObject({
      id: 'og_size_bowl', name: '份量', selectionType: 'SINGLE', required: true, minSelect: 1, maxSelect: 1,
    });
    expect(p.optionGroups[0]?.options.map((o) => [o.id, o.priceDelta, o.isDefault])).toEqual([
      ['opt_bowl_s', 0, true],
      ['opt_bowl_l', 20, false],
    ]);
    expect(p.optionGroups[1]).toMatchObject({
      selectionType: 'MULTIPLE', required: false, minSelect: 0, maxSelect: 3,
    });
  });

  it('無選項商品 optionGroups 為空陣列；雙人分享餐主餐（選 2）為 2–2 多選', async () => {
    h = setup();
    expect((await h.client.store.getProduct('prd_danzai')).optionGroups).toEqual([]);
    const combo = await h.client.store.getProduct('prd_combo_share');
    expect(combo.optionGroups[0]).toMatchObject({ selectionType: 'MULTIPLE', minSelect: 2, maxSelect: 2 });
  });

  it('MINIMAL：選項群組為空', async () => {
    h = setup({ demo: { menuProfile: 'MINIMAL' } });
    expect((await h.client.store.getProduct('prd_lurou')).optionGroups).toEqual([]);
  });

  it('不存在 → 404 NOT_FOUND', async () => {
    h = setup();
    const err = await rejection(h.client.store.getProduct('prd_nope'));
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });
});

describe('banners、外送範圍與桌號', () => {
  it('3 個 Banner 與連結', async () => {
    h = setup();
    const { items } = await h.client.store.getBanners();
    expect(items.map((b) => [b.linkType, b.linkValue])).toEqual([
      ['PRODUCT', 'prd_aiyu'],
      ['PRODUCT', 'prd_combo_share'],
      ['NONE', undefined],
    ]);
  });

  it('外送範圍三區與 checkDelivery', async () => {
    h = setup();
    const { items } = await h.client.store.getDeliveryZones();
    expect(items.map((z) => z.zipCode)).toEqual(['106', '100', '110']);
    expect(await h.client.store.checkDelivery('106')).toEqual({
      deliverable: true,
      zone: {
        zipCode: '106', city: '臺北市', district: '大安區', deliveryFee: 30, minOrderAmount: 150,
        freeDeliveryThreshold: 400, estimatedMinutes: 35,
      },
    });
    expect(await h.client.store.checkDelivery('220')).toEqual({
      deliverable: false,
      reason: 'OUT_OF_DELIVERY_AREA',
    });
    const bad = await rejection(h.client.store.checkDelivery('22'));
    expect(bad.code).toBe('VALIDATION_FAILED');
  });

  it('resolveTable：A1～A6；無效回 422 TABLE_NOT_FOUND', async () => {
    h = setup();
    expect(await h.client.store.resolveTable('A3')).toMatchObject({ tableNo: 'A3' });
    expect(await h.client.store.resolveTable('a6')).toMatchObject({ tableNo: 'A6' });
    const err = await rejection(h.client.store.resolveTable('Z9'));
    expect(err.status).toBe(422);
    expect(err.code).toBe('TABLE_NOT_FOUND');
  });
});

describe('store.getPickupSlots（FLOW-05）', () => {
  it('12:00 營業中：即時單可用（15–20 分鐘），今日第一個時段為 12:15', async () => {
    h = setup();
    const r = await h.client.store.getPickupSlots({ orderType: 'PICKUP' });
    expect(r.asap).toEqual({ available: true, etaMinutes: { min: 15, max: 20 } });
    expect(r.days.map((d) => d.label)).toEqual(['今天', '明天']);
    expect(r.days[0]?.slots[0]).toEqual({ startAt: '2026-10-14T12:15:00+08:00', status: 'AVAILABLE' });
    expect(r.days[0]?.slots.at(-1)?.startAt).toBe('2026-10-14T20:45:00+08:00');
  });

  it('14:30 午休：即時單 STORE_CLOSED，預設可選今日 17:00（UAT-03）', async () => {
    h = setup({ now: Date.parse('2026-10-14T14:30:00+08:00') });
    const r = await h.client.store.getPickupSlots({ orderType: 'PICKUP' });
    expect(r.asap).toEqual({ available: false, unavailableReason: 'STORE_CLOSED' });
    expect(r.days[0]?.slots[0]?.startAt).toBe('2026-10-14T17:00:00+08:00');
  });

  it('暫停接單：asap 回 STORE_PAUSED', async () => {
    h = setup({ demo: { storeOverride: 'PAUSED' } });
    const r = await h.client.store.getPickupSlots({ orderType: 'PICKUP' });
    expect(r.asap).toMatchObject({ available: false, unavailableReason: 'STORE_PAUSED' });
  });

  it('外送使用配送區預估分鐘：大安區 35 分、預估 35–40；13:30 來不及打烊 → SLOT_UNAVAILABLE', async () => {
    h = setup({ now: Date.parse('2026-10-14T13:30:00+08:00') });
    const r = await h.client.store.getPickupSlots({ orderType: 'DELIVERY', zipCode: '106' });
    expect(r.asap).toEqual({ available: false, unavailableReason: 'SLOT_UNAVAILABLE' });
    // 預約：earliest 14:05 → 午市已無時段，從 17:00 起
    expect(r.days[0]?.slots[0]?.startAt).toBe('2026-10-14T17:00:00+08:00');
    h.setNow(Date.parse('2026-10-14T11:00:00+08:00'));
    const early = await h.client.store.getPickupSlots({ orderType: 'DELIVERY', zipCode: '106' });
    expect(early.asap).toEqual({ available: true, etaMinutes: { min: 35, max: 40 } });
    expect(early.days[0]?.slots[0]?.startAt).toBe('2026-10-14T11:45:00+08:00');
  });

  it('內用不需時段；無效取餐方式回 400', async () => {
    h = setup();
    expect((await h.client.store.getPickupSlots({ orderType: 'DINE_IN' })).days).toEqual([]);
    const err = await rejection(
      h.client.store.getPickupSlots({ orderType: 'NOPE' as unknown as 'PICKUP' }),
    );
    expect(err.status).toBe(400);
  });

  it('時段額滿標記（單時段上限 8 單）與只剩 1 個名額', async () => {
    h = setup();
    const startAt = '2026-10-14T12:30:00+08:00';
    expect(await h.client.demo.fillSlot(startAt, 1)).toEqual({ added: 7 });
    let r = await h.client.store.getPickupSlots({ orderType: 'PICKUP' });
    expect(r.days[0]?.slots.find((s) => s.startAt === startAt)?.status).toBe('AVAILABLE');
    expect(await h.client.demo.fillSlot(startAt, 0)).toEqual({ added: 1 });
    r = await h.client.store.getPickupSlots({ orderType: 'PICKUP' });
    expect(r.days[0]?.slots.find((s) => s.startAt === startAt)?.status).toBe('FULL');
  });

  it('唯讀：連續查詢不改變 db 內容（庫存-1）', async () => {
    h = setup();
    const before = h.storage.getItem('zaiorder:v1:db');
    for (let i = 0; i < 5; i++) {
      await h.client.store.getMenu();
      await h.client.store.getPickupSlots({ orderType: 'PICKUP' });
      await h.client.store.getInfo();
    }
    expect(h.storage.getItem('zaiorder:v1:db')).toBe(before);
  });
});
