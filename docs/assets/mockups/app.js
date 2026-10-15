/* ==========================================================================
   ZaiOrder 消費者端點餐 — 設計參考原型 app.js
   原生 JS；資料內嵌；emoji 作為商品「圖片」。不使用框架、CDN、外部字型或圖片。
   依 URL 參數渲染單一畫面：
     screen=menu|sheet|checkout|tracking|themes|shortcuts|idle|done   device=desktop|mobile
     brand=red|green|coffee|orange|blue|black|yellow
     data=full|mixed|noimg|minimal   layout=grid|list|auto
     login=guest|member   sheet=lurou|aiyu   cart=0|1
     hints=auto|1|0   reminder=0|1   issues=0|bg|1|done
     memory=0|1   mode=normal|kiosk   focus=<商品 id>
   單鍵快速鍵預設關閉（hints=auto）；偵測到實體鍵盤後以不位移版面的浮動卡提醒可開啟（reminder=1 可直接顯示）。
   結帳以 issues 展示「送出時最終確認庫存與時段」的狀態列與異動清單。
   結帳與訂單追蹤（任務型頁面）同樣保留 ⌨（≥ 768）、頁尾「鍵盤快速鍵」與跳過連結「鍵盤快速鍵與偏好」。
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ 1. 參數 */
  const qs = new URLSearchParams(location.search);
  const pick = (key, allowed, fallback) => (allowed.includes(qs.get(key)) ? qs.get(key) : fallback);
  const BRAND_KEYS = ['red', 'green', 'coffee', 'orange', 'blue', 'black', 'yellow'];
  const P = {
    screen: pick('screen', ['menu', 'sheet', 'checkout', 'tracking', 'themes', 'shortcuts', 'idle', 'done'], 'menu'),
    device: pick('device', ['desktop', 'mobile'], null),
    brand: pick('brand', BRAND_KEYS, 'red'),
    data: pick('data', ['full', 'mixed', 'noimg', 'minimal'], 'full'),
    layout: pick('layout', ['grid', 'list', 'auto'], 'auto'),
    login: pick('login', ['guest', 'member'], 'guest'),
    sheet: pick('sheet', ['lurou', 'aiyu'], 'lurou'),
    cart: pick('cart', ['0', '1'], '1'),
    hints: pick('hints', ['auto', '1', '0'], 'auto'),
    reminder: pick('reminder', ['0', '1'], '0'),
    issues: pick('issues', ['0', 'bg', '1', 'done'], '0'),
    memory: pick('memory', ['0', '1'], '0'),
    mode: pick('mode', ['normal', 'kiosk'], 'normal'),
    focus: qs.get('focus') || null,
  };
  if (P.screen === 'idle' || P.screen === 'done') P.mode = 'kiosk'; /* 閒置警示與完成畫面僅屬觸控面板 */
  const KIOSK = P.mode === 'kiosk';
  if (KIOSK) {
    P.device = 'desktop';
    if (P.screen === 'shortcuts') P.screen = 'menu'; /* 觸控面板不提供快速鍵說明 */
  }
  const root = document.getElementById('app');
  const html = document.documentElement;
  if (!P.device) P.device = window.innerWidth >= 768 ? 'desktop' : 'mobile';
  html.dataset.brand = P.brand;
  html.dataset.device = P.device;
  html.dataset.screen = P.screen;
  html.dataset.mode = P.mode;
  document.title = 'ZaiOrder 設計參考原型 · ' + P.screen + (KIOSK ? ' · kiosk' : '');

  /* device=mobile 但視窗很寬時：以 iframe 呈現 390 視口（無手機外框），讓 CSS media query 以 390 計算 */
  let inFrame = false;
  try { inFrame = window.self !== window.top; } catch (e) { inFrame = true; }
  if (P.device === 'mobile' && !inFrame && window.innerWidth >= 768) {
    const file = location.pathname.split('/').pop() || 'app.html';
    root.innerHTML =
      '<div class="devicestage">' +
      '<p class="devicestage__note">device=mobile · 以 390 × 844 視口預覽（無手機外框）</p>' +
      '<iframe class="deviceframe" title="手機視口預覽" src="' + file + location.search + '"></iframe>' +
      '</div>';
    return;
  }

  /* ------------------------------------------------------------------ 2. 資料 */
  const STORE = {
    name: '巷仔內小吃部',
    initial: '巷',
    hours: '今日 11:00–14:00、17:00–21:00',
    address: '臺北市大安區示範路 100 號',
    phone: '02-0000-0000',
    eta: '預估 15–20 分鐘',
  };
  const FULFIL = KIOSK
    ? [{ id: 'dinein', name: '內用' }, { id: 'pickup', name: '外帶' }]
    : [{ id: 'pickup', name: '自取' }, { id: 'delivery', name: '外送' }, { id: 'dinein', name: '內用' }];
  const DELIVERY_FEE = 30;

  const CATEGORIES = [
    { id: 'hot', name: '熱銷', icon: '🔥', virtual: true },
    { id: 'rice', name: '飯類', icon: '🍚' },
    { id: 'noodle', name: '麵食', icon: '🍜' },
    { id: 'snack', name: '小吃', icon: '🍢' },
    { id: 'drink', name: '飲品', icon: '🧋' },
    { id: 'dessert', name: '甜點', icon: '🍮' },
  ];

  const TAGS = {
    hot: { label: '熱銷', cls: 'tag--hot' },
    rec: { label: '店長推薦', cls: 'tag--rec' },
    new: { label: '新品', cls: 'tag--new' },
    limited: { label: '限量・剩 5 份', cls: 'tag--limited' },
    veg: { label: '素食', cls: 'tag--veg' },
    sold: { label: '今日售完', cls: 'tag--sold' },
  };

  const grp = (id, name, required, multi, choices, max) => ({ id, name, required, multi, max: max || 0, choices });
  const ch = (id, name, delta, def) => ({ id, name, delta: delta || 0, def: !!def });
  const sizeGroup = () => grp('size', '份量', true, false, [ch('s', '小碗', 0, true), ch('l', '大碗', 20)]);
  const drinkGroups = () => [
    grp('cup', '杯型', true, false, [ch('m', '中杯', 0, true), ch('l', '大杯', 10)]),
    grp('sugar', '甜度', true, false, [ch('full', '全糖'), ch('less', '少糖'), ch('half', '半糖', 0, true), ch('light', '微糖'), ch('none', '無糖')]),
    grp('ice', '冰量', true, false, [ch('normal', '正常冰'), ch('less', '少冰'), ch('light', '微冰', 0, true), ch('none', '去冰'), ch('hot', '熱飲')]),
  ];

  /* 共用菜單資料（完整版）；順序即簡報 §4.1 的列表順序 */
  const FULL = [
    { id: 'lurou', cat: 'rice', name: '招牌滷肉飯', desc: '古早味滷肉燥，肥瘦比例剛剛好', price: 35, emoji: '🍚', tags: ['hot'],
      groups: [sizeGroup(), grp('topping', '加料', false, true, [ch('egg', '滷蛋', 12), ch('tofu', '滷豆干', 10), ch('fried', '荷包蛋', 15)], 3)] },
    { id: 'chicken_rice', cat: 'rice', name: '嘉義雞肉飯', desc: '火雞肉絲拌雞油，清爽不膩', price: 45, emoji: '🍗', tags: ['rec'], groups: [sizeGroup()] },
    { id: 'kong_rou', cat: 'rice', name: '控肉飯', desc: '入口即化的古早味控肉', price: 85, emoji: '🍖', tags: [], groups: [], soldOut: true },
    { id: 'pork_chop', cat: 'rice', name: '古早味排骨飯', desc: '現炸排骨配三樣小菜', price: 110, emoji: '🍱', tags: [], groups: [] },
    { id: 'beef_noodle', cat: 'noodle', name: '紅燒牛肉麵', desc: '慢燉牛腱與牛筋，湯頭濃郁', price: 180, emoji: '🍜', tags: ['hot'],
      groups: [grp('noodle', '麵條', true, false, [ch('thin', '細麵', 0, true), ch('wide', '寬麵')]),
               grp('spicy', '辣度', true, false, [ch('none', '不辣', 0, true), ch('mild', '小辣'), ch('med', '中辣')])] },
    { id: 'danzai', cat: 'noodle', name: '擔仔麵', desc: '肉燥與蝦頭高湯的台南老味道', price: 60, emoji: '🥢', tags: [], groups: [] },
    { id: 'oyster_vermicelli', cat: 'noodle', name: '蚵仔麵線', desc: '大腸與蚵仔，柴魚高湯', price: 65, emoji: '🥣', tags: ['hot'],
      groups: [grp('size', '份量', true, false, [ch('s', '小碗', 0, true), ch('l', '大碗', 20)])] },
    { id: 'oyster_omelet', cat: 'snack', name: '蚵仔煎', desc: '新鮮蚵仔、地瓜粉漿與甜辣醬', price: 75, emoji: '🍳', tags: ['hot'],
      groups: [grp('spicy', '辣度', true, false, [ch('none', '不辣', 0, true), ch('mild', '小辣')])] },
    { id: 'salt_chicken', cat: 'snack', name: '鹽酥雞', desc: '九層塔香氣十足', price: 70, emoji: '🍗', tags: [], groups: [] },
    { id: 'black_tea', cat: 'drink', name: '古早味紅茶', desc: '每日現煮', price: 25, emoji: '🧋', tags: [], groups: drinkGroups() },
    { id: 'bubble_tea', cat: 'drink', name: '珍珠奶茶', desc: '手工珍珠，奶香濃郁', price: 55, emoji: '🧋', tags: ['hot'],
      groups: drinkGroups().concat([grp('topping', '加料', false, true, [ch('pearl', '珍珠', 10)], 1)]) },
    { id: 'tofu_pudding', cat: 'dessert', name: '手工豆花', desc: '嫩滑豆花，可加配料', price: 45, emoji: '🍮', tags: ['veg'], groups: [] },
    { id: 'aiyu', cat: 'dessert', name: '愛玉檸檬', desc: '清爽解膩', price: 45, emoji: '🍋', tags: ['new', 'veg'], groups: [] },
    { id: 'combo_share', cat: 'rice', name: '雙人分享餐', desc: '兩主餐、一小吃、一小菜', price: 299, emoji: '🍱', tags: ['limited'],
      groups: [
        grp('main1', '主餐一', true, false, [ch('lurou', '招牌滷肉飯', 0, true), ch('chicken', '嘉義雞肉飯'), ch('pork', '古早味排骨飯', 15)]),
        grp('main2', '主餐二', true, false, [ch('beef', '紅燒牛肉麵', 0, true), ch('danzai', '擔仔麵')]),
        grp('snack', '小吃', true, false, [ch('omelet', '蚵仔煎', 0, true), ch('salt', '鹽酥雞')]),
        grp('side', '小菜', true, false, [ch('veg', '燙青菜', 0, true), ch('cucumber', '涼拌小黃瓜')]),
      ] },
  ];

  /* mixed：奇數項（依上表序）無圖 → 7/14 = 50%；另有部分無描述／標籤／選項 */
  const MIXED = {
    noDesc: ['chicken_rice', 'beef_noodle', 'oyster_omelet', 'bubble_tea', 'combo_share'],
    noTags: ['tofu_pudding', 'oyster_vermicelli'],
    noOpts: ['chicken_rice', 'oyster_omelet', 'combo_share'],
  };

  function buildMenu(variant) {
    return FULL.map((src, i) => {
      const p = Object.assign({}, src, { tags: src.tags.slice(), groups: src.groups.map((g) => Object.assign({}, g)) });
      const idx = i + 1;
      if (variant === 'noimg' || variant === 'minimal') p.emoji = null;
      if (variant === 'minimal') { p.desc = ''; p.tags = []; p.groups = []; }
      if (variant === 'mixed') {
        if (idx % 2 === 1) p.emoji = null;
        if (MIXED.noDesc.includes(p.id)) p.desc = '';
        if (MIXED.noTags.includes(p.id)) p.tags = [];
        if (MIXED.noOpts.includes(p.id)) p.groups = [];
      }
      return p;
    });
  }

  const MENU = buildMenu(P.data);
  const byId = (id) => MENU.find((p) => p.id === id) || FULL.find((p) => p.id === id);
  const isBare = (p) => !p.emoji && !p.desc && !p.tags.length && !p.groups.length;
  const DATASET_MINIMAL = MENU.every((p) => !p.emoji && !p.desc && !p.tags.length && !p.groups.length);
  const HAS_HOT = MENU.some((p) => p.tags.includes('hot'));
  if (P.focus && !MENU.some((p) => p.id === P.focus)) P.focus = null;

  /* layout=auto：有圖商品比例 >= 50% → grid，否則 list */
  const LAYOUT = (() => {
    if (P.layout === 'grid' || P.layout === 'list') return P.layout;
    const ratio = MENU.filter((p) => p.emoji).length / MENU.length;
    return ratio >= 0.5 ? 'grid' : 'list';
  })();

  /* 購物車預設內容（以快照存放，使各資料完整度下金額一致：小計 $297） */
  const DEFAULT_CART = [
    { id: 'l1', pid: 'lurou', qty: 1, unit: 67, opt: '大碗・滷蛋', note: '', sel: { size: ['l'], topping: ['egg'] } },
    { id: 'l2', pid: 'beef_noodle', qty: 1, unit: 180, opt: '細麵・不辣', note: '', sel: { noodle: ['thin'], spicy: ['none'] } },
    { id: 'l3', pid: 'black_tea', qty: 2, unit: 25, opt: '中杯・半糖・微冰', note: '少冰', sel: { cup: ['m'], sugar: ['half'], ice: ['light'] } },
  ];

  /* 結帳「送出時最終確認」示範（?issues=bg|1|done）：購物車含 3 個會被退回的情境。
     was = 加入購物車時的單價；unit = 目前最新單價（價格已更新 $67 → $72，不計入阻擋數） */
  const CK_ON = P.screen === 'checkout' && P.issues !== '0';
  const ISSUE_CART = [
    { id: 'i1', pid: 'lurou', qty: 1, unit: 72, was: 67, opt: '大碗・滷蛋', note: '', sel: { size: ['l'], topping: ['egg'] } },
    { id: 'i2', pid: 'black_tea', qty: 1, unit: 25, opt: '中杯・半糖・微冰', note: '', sel: { cup: ['m'], sugar: ['half'], ice: ['light'] } },
    { id: 'i3', pid: 'combo_share', qty: 3, unit: 299, opt: '招牌滷肉飯・紅燒牛肉麵・蚵仔煎・燙青菜', note: '',
      sel: { main1: ['lurou'], main2: ['beef'], snack: ['omelet'], side: ['veg'] } },
  ];
  const SOLD_OUT_TODAY = ['black_tea'];
  const STOCK_LEFT = { combo_share: 2 };
  const SLOTS = ['17:00', '17:15', '17:30', '17:45', '18:00'];
  const SLOT_FULL = ['17:00'];
  const SLOT_SUGGEST = '17:15';

  /* 點餐記憶（原型內固定；?memory=1 才啟用；kiosk 不保存）。labels 為訂單成立當下的選項名稱快照。
     window.__PROTO_MEMORY__ 僅供測試覆寫（例如驗證「部分選項已不提供」） */
  const MEMORY_DEFAULT = {
    lurou: { sel: { size: ['l'], topping: ['egg'] }, labels: ['大碗', '滷蛋'], note: '不要蔥' },
    danzai: { sel: {}, labels: [], note: '' }, /* 無選項群組的商品：只出現在「常點」，卡片不顯示「上次」 */
    black_tea: { sel: { cup: ['m'], sugar: ['half'], ice: ['light'] }, labels: ['中杯', '半糖', '微冰'], note: '少冰' },
    beef_noodle: { sel: { noodle: ['thin'], spicy: ['none'] }, labels: ['細麵', '不辣'], note: '' },
    bubble_tea: { sel: { cup: ['l'], sugar: ['light'], ice: ['none'], topping: ['pearl'] }, labels: ['大杯', '微糖', '去冰', '珍珠'], note: '' },
    chicken_rice: { sel: { size: ['l'] }, labels: ['大碗'], note: '' },
  };
  const MEMORY = window.__PROTO_MEMORY__ && typeof window.__PROTO_MEMORY__ === 'object' ? window.__PROTO_MEMORY__ : MEMORY_DEFAULT;
  const MEMORY_ORDER = ['lurou', 'danzai', 'black_tea', 'beef_noodle', 'bubble_tea', 'chicken_rice'];

  /* ------------------------------------------------------------------ 3. 狀態 */
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const FINE_POINTER = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  const state = {
    cat: 'all',
    layout: null, /* 版面切換（僅記憶體）：null = 依 ?layout= / auto */
    q: '',
    searchOpen: false,
    fulfil: KIOSK ? 'dinein' : 'pickup',
    cart: P.cart === '1' ? clone(CK_ON ? ISSUE_CART : DEFAULT_CART) : [],
    ver: 0, /* 購物車版本：復原只在期間內沒有其他變更時有效 */
    sheet: null,
    cartOpen: false,
    dialog: null, /* { type: 'shortcuts'|'store'|'login'|'confirm'|'idle', ... } */
    seq: 100,
    cx: { when: CK_ON ? 'later' : 'asap', slot: CK_ON ? '17:00' : null, pay: 'cash', remember: false, utensils: false, hint: true },
    /* 「啟用單鍵快速鍵」開關（僅記憶體）：預設關閉；hints=1 視為使用者已開啟；hints=0 關閉且不提醒 */
    shortcutsOn: P.hints === '1' && !KIOSK,
    /* 結帳異動：expanded = 清單已展開；rejected = 送出被退回；log = 已調整項目；base = 第一次調整前的快照 */
    ck: { phase: P.issues === '1' || P.issues === 'done' ? 'ready' : 'checking', expanded: P.issues === '1', rejected: P.issues === '1', log: [], base: null, ver: 0 },
    memoryPref: true, /* 「記住上次點過的選項」 */
    textLarge: false, /* 「大字模式」（文字 ×1.125） */
    motion: 'system', /* 「減少動態」：system | on | off */
    fav: [],
    activeCard: null, /* roving tabindex：目前的商品卡 */
    returnKeys: [], /* 浮層關閉後還原焦點用 */
    large: false, /* kiosk 大字 */
  };
  const currentLayout = () => state.layout || LAYOUT;

  /* ------------------------------------------------------------------ 4. 工具 */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + Number(n).toLocaleString('en-US');
  const initial = (s) => Array.from(String(s))[0] || '';
  const fulfilName = (id) => (FULFIL.find((x) => x.id === id) || FULFIL[0]).name;

  const PATHS = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.9-3.9"/>',
    cart: '<path d="M3 4h2.3l2.1 10.1a1.2 1.2 0 0 0 1.2.9h8.7a1.2 1.2 0 0 0 1.2-.9L20 8.2H6"/><circle cx="9.5" cy="19.3" r="1.4"/><circle cx="17" cy="19.3" r="1.4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    chevR: '<path d="m9 6 6 6-6 6"/>',
    chevL: '<path d="m15 6-6 6 6 6"/>',
    chevD: '<path d="m6 9 6 6 6-6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-10.6A6.5 6.5 0 0 1 12 4a6.5 6.5 0 0 1 6.5 6.4C18.5 15.400 12 21 12 21z"/><circle cx="12" cy="10.2" r="2.3"/>',
    phone: '<path d="M6.8 4h2.7l1.5 3.800-1.900 1.300a10.500 10.500 0 0 0 5.300 5.300l1.300-1.900 3.800 1.500v2.700a2 2 0 0 1-2.100 2A15.500 15.500 0 0 1 4.800 6.100 2 2 0 0 1 6.800 4z"/>',
    clock: '<circle cx="12" cy="12" r="8.500"/><path d="M12 7.500V12l3 2"/>',
    pencil: '<path d="M4.500 19.500h3.800L19 8.800a2.100 2.100 0 0 0-3-3L5.300 16.500l-.8 3z"/><path d="m13.500 7.500 3 3"/>',
    user: '<circle cx="12" cy="8.200" r="3.800"/><path d="M4.800 20c.7-3.500 3.500-5.300 7.200-5.300s6.500 1.800 7.200 5.300"/>',
    receipt: '<path d="M6.500 3.500h11v17l-2.750-1.800L12 20.500l-2.750-1.800L6.500 20.500v-17z"/><path d="M9.500 8.500h5M9.500 12h5"/>',
    bowl: '<path d="M3.500 11.500h17a8.500 8.500 0 0 1-17 0z"/><path d="M9 8c0-1.500 1-1.500 1-3M14 8c0-1.500 1-1.500 1-3"/>',
    info: '<circle cx="12" cy="12" r="8.500"/><path d="M12 11v5.200M12 7.800v.2"/>',
    alert: '<path d="M12 4.500 21 19.500H3L12 4.500z"/><path d="M12 10v4.500M12 17v.2"/>',
    trash: '<path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l.9 12a1.500 1.500 0 0 0 1.500 1.400h6.200a1.500 1.500 0 0 0 1.500-1.400l.9-12M10 11v6M14 11v6"/>',
    grid: '<rect x="4" y="4" width="6.500" height="6.500" rx="1.500"/><rect x="13.500" y="4" width="6.500" height="6.500" rx="1.500"/><rect x="4" y="13.500" width="6.500" height="6.500" rx="1.500"/><rect x="13.500" y="13.500" width="6.500" height="6.500" rx="1.500"/>',
    list: '<path d="M9.500 7H20M9.500 12H20M9.500 17H20"/><path d="M4.500 7h.01M4.500 12h.01M4.500 17h.01"/>',
    repeat: '<path d="M4 12a8 8 0 0 1 13.700-5.600L20 8.500"/><path d="M20 4v4.500h-4.500"/><path d="M20 12a8 8 0 0 1-13.700 5.600L4 15.500"/><path d="M4 20v-4.500h4.500"/>',
    keyboard: '<rect x="3" y="6.500" width="18" height="11" rx="2"/><path d="M7 10h.01M10.500 10h.01M14 10h.01M17.500 10h.01M7.500 14h9"/>',
    heart: '<path d="M12 20s-7-4.600-7-10a4.200 4.200 0 0 1 7-3 4.200 4.200 0 0 1 7 3c0 5.400-7 10-7 10z"/>',
    textsize: '<path d="M3.500 18 8.500 5.500 13.500 18M5.300 13.500h6.400"/><path d="M16.500 11h4M18.500 9v4"/>',
  };
  const ICON = (name, size, cls) =>
    '<svg class="icon' + (cls ? ' ' + cls : '') + '" width="' + (size || 20) + '" height="' + (size || 20) +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    PATHS[name] + '</svg>';

  const hrefTo = (screen, extra) => {
    const u = new URLSearchParams(location.search);
    u.set('screen', screen);
    Object.keys(extra || {}).forEach((k) => (extra[k] == null ? u.delete(k) : u.set(k, extra[k])));
    return (location.pathname.split('/').pop() || 'app.html') + '?' + u.toString();
  };
  const navigate = (screen, extra, hash) => { location.href = hrefTo(screen, extra) + (hash || ''); };

  /* ------------------------------------------------------------------ 5. 快速鍵登錄表（單一事實來源）
     說明對話框、KeyHint、aria-keyshortcuts 與鍵盤處理皆由此產生（對應 07 §7.5 的 HOTKEYS）。 */
  const HOTKEYS = [
    { action: 'help', scope: 'global', keys: ['?'], label: '顯示 / 關閉快速鍵說明' },
    { action: 'search', scope: 'global', keys: ['s', '/'], label: '搜尋菜單' },
    { action: 'goMenu', scope: 'global', keys: ['m'], label: '回到菜單' },
    { action: 'openCart', scope: 'global', keys: ['c'], label: '開啟購物車（桌機：移到訂單面板）' },
    { action: 'goOrders', scope: 'global', keys: ['o'], label: '訂單（會員：歷史訂單；訪客：查詢訂單）' },
    { action: 'goStore', scope: 'global', keys: ['i'], label: '店家資訊' },
    { action: 'goLogin', scope: 'global', keys: ['l'], label: '登入 / 會員中心' },
    /* Esc 的順序（closeTop，對應 07 的 closeTarget）：關閉最上層浮層 → 收起鍵盤提醒（可見且焦點在其中）→ 搜尋框有字則清除並失焦 */
    { action: 'close', scope: 'global', keys: ['Escape'], label: '關閉浮層、清除搜尋', alwaysOn: true },
    { action: 'jumpCategory', scope: 'menu', keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], label: '跳到第 N 個分類（0 = 全部）' },
    { action: 'toggleLayout', scope: 'menu', keys: ['v'], label: '切換圖卡 / 清單' },
    { action: 'addFocused', scope: 'menu', keys: ['a'], label: '加入焦點商品（含必選選項者開啟面板）' },
    { action: 'repeatFocused', scope: 'menu', keys: ['r'], label: '再點上次的選擇' },
    { action: 'toggleFavorite', scope: 'menu', keys: ['f'], label: '收藏 / 取消收藏' },
    { action: 'qtyUp', scope: 'sheet', keys: ['+', '='], label: '數量 +1' },
    { action: 'qtyDown', scope: 'sheet', keys: ['-'], label: '數量 −1' },
    { action: 'confirmAdd', scope: 'sheet', keys: ['a'], label: '加入購物車' },
    { action: 'restoreDefault', scope: 'sheet', keys: ['d'], label: '恢復預設選項' },
    { action: 'editLine', scope: 'cart', keys: ['e'], label: '編輯焦點品項' },
    { action: 'removeLine', scope: 'cart', keys: ['d'], label: '移除焦點品項（需確認）' },
    { action: 'qtyUp', scope: 'cart', keys: ['+', '='], label: '數量 +1' },
    { action: 'qtyDown', scope: 'cart', keys: ['-'], label: '數量 −1' },
    { action: 'checkout', scope: 'cart', keys: ['p'], label: '前往結帳' },
    { action: 'back', scope: 'checkout', keys: ['b'], label: '返回購物車' },
    { action: 'submitOrder', scope: 'checkout', keys: ['Ctrl+Enter'], label: '送出訂單（macOS 為 ⌘ + Enter）', alwaysOn: true },
    { action: 'again', scope: 'order', keys: ['a'], label: '再來一單' },
    { action: 'refresh', scope: 'order', keys: ['u'], label: '立即更新狀態' },
  ];
  const SCOPE_TITLE = { global: '全域', menu: '菜單頁', sheet: '商品面板', cart: '購物車 / 訂單面板', checkout: '結帳頁', order: '訂單頁' };

  /* 單鍵快速鍵是否啟用（單一開關）：使用者已開啟 且 不在觸控面板模式。
     預設關閉；徽章（KeyHint）、aria-keyshortcuts、商品卡提示列一律跟隨此開關；Esc 與 Ctrl/⌘ + Enter 不受影響 */
  const hotkeysEnabled = () => !KIOSK && state.shortcutsOn;
  const syncHints = () => { html.dataset.hints = hotkeysEnabled() ? '1' : '0'; html.dataset.hotkeys = hotkeysEnabled() ? '1' : '0'; };

  /* KeyHint：永遠 aria-hidden；觸控面板 / 停用快速鍵時不輸出 */
  const KH = (key, onBrand) => (hotkeysEnabled() ? '<kbd class="keyhint' + (onBrand ? ' keyhint--on-brand' : '') + '" aria-hidden="true">' + esc(key) + '</kbd>' : '');
  /* aria-keyshortcuts：與 KeyHint 同步，停用 / 觸控面板時不輸出 */
  const AKS = (keys) => (hotkeysEnabled() ? ' aria-keyshortcuts="' + esc(keys) + '"' : '');

  /* 依登錄表解析一次按鍵（與 07 §7.5 的 normalizeKey / resolveHotkey 同規則） */
  function normalizeKey(e) {
    const key = typeof e.key === 'string' ? e.key : '';
    const code = typeof e.code === 'string' ? e.code : '';
    if (key === 'Escape') return 'Escape';
    if (key === 'Enter') return 'Enter';
    const k = key.length === 1 ? key.toLowerCase() : '';
    if (/^[a-z0-9]$/.test(k) || ['?', '/', '+', '=', '-'].includes(k)) return k;
    /* 只有輸入法佔位值（Process、Unidentified）或非拉丁字元（注音符號、西里爾字母…，> U+024F）才改用實體按鍵 event.code；
       'Dead'、ß、é、à 等屬目前配置下確實輸入的字元，不可當成別的鍵（AZERTY 數字列不加 Shift 輸出 é、à…） */
    const viaCode = key === 'Process' || key === 'Unidentified' || (key.length === 1 && key.charCodeAt(0) > 0x024f);
    if (!viaCode) return null;
    let m = code.match(/^Key([A-Z])$/);
    if (m) return m[1].toLowerCase();
    m = code.match(/^Digit([0-9])$/);
    if (m) return m[1];
    if (code === 'Slash') return e.shiftKey ? '?' : '/';
    if (code === 'Equal') return e.shiftKey ? '+' : '=';
    if (code === 'Minus') return e.shiftKey ? null : '-'; /* Shift + - 輸入的是 '_' */
    return null;
  }

  const TEXT_INPUT_TYPES = ['text', 'search', 'email', 'tel', 'url', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week'];
  const isEditableTarget = (el) => {
    if (!el || !el.tagName) return false;
    if (el.isContentEditable === true) return true;
    const tag = el.tagName.toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return TEXT_INPUT_TYPES.includes((el.getAttribute('type') || 'text').toLowerCase());
    const role = el.getAttribute('role');
    return role === 'textbox' || role === 'searchbox' || role === 'combobox';
  };

  function resolveHotkey(e, ctx) {
    if (e.isComposing || e.repeat) return null; /* 輸入法組字中、長按不重複觸發 */
    if (e.keyCode === 229 && ctx.editable) return null; /* 輸入元件內的 229 視為組字；非輸入元件仍以 code 比對 */
    const key = normalizeKey(e);
    if (!key) return null;
    const mod = e.ctrlKey || e.metaKey;
    let token;
    if (e.altKey) return null;
    if (mod) {
      if (key !== 'Enter') return null; /* 其他 Ctrl / ⌘ 組合留給瀏覽器與輔助科技 */
      token = 'Ctrl+Enter';
    } else {
      if (e.shiftKey && /^[a-z0-9]$/.test(key)) return null; /* Shift 僅用於符號（? +） */
      token = key;
    }
    const always = HOTKEYS.some((h) => h.alwaysOn && h.keys.includes(token));
    if (ctx.editable && !always) return null;
    if (!ctx.enabled && !always) return null;
    for (const scope of ctx.scopes) {
      if (ctx.modalOpen && scope !== 'global' && scope !== ctx.modalScope) continue;
      const def = HOTKEYS.find((h) => h.scope === scope && h.keys.includes(token));
      if (!def) continue;
      if (ctx.modalOpen && scope === 'global' && def.action !== 'help' && def.action !== 'close') continue;
      return { action: def.action, scope: scope, arg: token };
    }
    return null;
  }

  /* 價格與選項 */
  const hasSurcharge = (p) => p.groups.some((g) => g.required && g.choices.some((c) => c.delta > 0));
  const defaultSel = (p) => {
    const sel = {};
    p.groups.forEach((g) => {
      if (g.required) sel[g.id] = [(g.choices.find((c) => c.def) || g.choices[0]).id];
      else sel[g.id] = [];
    });
    return sel;
  };
  const unitPrice = (p, sel) => {
    let t = p.price;
    p.groups.forEach((g) => (sel[g.id] || []).forEach((cid) => {
      const c = g.choices.find((x) => x.id === cid);
      if (c) t += c.delta;
    }));
    return t;
  };
  const optText = (p, sel) => {
    const out = [];
    p.groups.forEach((g) => (sel[g.id] || []).forEach((cid) => {
      const c = g.choices.find((x) => x.id === cid);
      if (c) out.push(c.name);
    }));
    return out.join('・');
  };
  const needsSheet = (p) => p.groups.some((g) => g.required);

  /* 點餐記憶（§6.8）：
       null                          無記憶 / 記憶已關閉 / 觸控面板 / 記憶的選項為空
       { kind:'plain' }              無選項群組的商品：只出現在「常點」，卡片不顯示「上次」
       { kind:'options', partial }   有選項群組：partial = 部分選項已不提供 → 「再點」改為開啟面板並提示 */
  const memoryOn = () => P.memory === '1' && !KIOSK && state.memoryPref;
  function memoryFor(p) {
    if (!memoryOn() || !p || !MEMORY[p.id]) return null;
    const m = MEMORY[p.id];
    const labels = m.labels || [];
    const remembered = Object.keys(m.sel || {}).filter((gid) => (m.sel[gid] || []).length);
    if (!p.groups.length) {
      if (remembered.length) return null; /* 記憶指向已不存在的選項群組 */
      return { kind: 'plain', partial: false, sel: {}, note: m.note || '', text: '', unit: p.price };
    }
    if (!remembered.length) return null; /* 記憶的選項為空 */
    const sel = defaultSel(p);
    let partial = false;
    remembered.forEach((gid) => {
      const g = p.groups.find((x) => x.id === gid);
      if (!g) { partial = true; return; }
      const ids = m.sel[gid].filter((cid) => g.choices.some((c) => c.id === cid));
      if (ids.length !== m.sel[gid].length) partial = true;
      if (g.max && ids.length > g.max) partial = true;
      if (g.required && !ids.length) { partial = true; return; }
      sel[gid] = ids;
    });
    p.groups.forEach((g) => { if (g.required && !(m.sel && (m.sel[g.id] || []).length)) partial = true; });
    if (partial) {
      const d = defaultSel(p);
      return { kind: 'options', partial: true, sel: d, note: '', text: labels.join('・'), unit: unitPrice(p, d) };
    }
    return { kind: 'options', partial: false, sel: sel, note: m.note || '', text: optText(p, sel), unit: unitPrice(p, sel) };
  }
  const commonItems = () => (memoryOn() ? MEMORY_ORDER.map(byId).filter((p) => p && memoryFor(p)).slice(0, 6) : []);

  /* 購物車計算 */
  const qtyOf = (pid) => state.cart.filter((l) => l.pid === pid).reduce((s, l) => s + l.qty, 0);
  const subtotal = () => state.cart.reduce((s, l) => s + l.unit * l.qty, 0);
  const feeAmount = () => (state.fulfil === 'delivery' && state.cart.length ? DELIVERY_FEE : 0);
  const total = () => subtotal() + feeAmount();
  const lastLine = (pid) => state.cart.filter((l) => l.pid === pid).pop();
  const cartSummary = () => '目前 ' + state.cart.length + ' 項，共 ' + money(total());

  const reduceMotion = () => state.motion === 'on' || (state.motion === 'system' && !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches));
  const syncPrefs = () => {
    html.dataset.textscale = state.textLarge ? '1' : '0';
    html.dataset.motion = state.motion;
  };

  /* ------------------------------------------------------------------ 6. 元件 */
  const tagsHTML = (keys) => keys.map((k) => '<span class="tag ' + TAGS[k].cls + '">' + TAGS[k].label + '</span>').join('');
  const priceHTML = (p, id) => '<span class="price tnum"' + (id ? ' id="' + id + '"' : '') + '>' + money(p.price) + (hasSurcharge(p) ? '<small>起</small>' : '') + '</span>';
  /* roving tabindex：觸控面板不使用（以原生 Tab 順序操作） */
  const tabAttr = (tab) => (KIOSK ? '' : ' data-rov tabindex="' + tab + '"');

  function stepperHTML(p, q, tab) {
    return '<div class="stepper" role="group" aria-label="' + esc(p.name) + ' 數量">' +
      '<button type="button" class="stepper__btn stepper__btn--minus" data-action="dec" data-id="' + p.id + '" data-key="dec:' + p.id + '"' + tabAttr(tab) + ' aria-label="減少一份 ' + esc(p.name) + '">' + ICON('minus', KIOSK ? 28 : 16) + '</button>' +
      '<output class="stepper__count">' + q + '</output>' +
      '<button type="button" class="stepper__btn stepper__btn--plus" data-action="inc" data-id="' + p.id + '" data-key="inc:' + p.id + '"' + tabAttr(tab) + ' aria-label="增加一份 ' + esc(p.name) + '">' + ICON('plus', KIOSK ? 28 : 16) + '</button>' +
      '</div>';
  }

  /* FR-MN-11：無必選群組（quick-add）已在購物車 → `− n ＋`；含必選群組者維持「＋ 加入」並以右上角徽章顯示已加入份數。
     有選項群組且記憶不為空：`↻ 再點` + 圓形 `＋`（開啟面板調整），徽章掛在 `＋` 上 */
  function actionHTML(p, tab, mem) {
    const q = qtyOf(p.id);
    const memOpt = !!(mem && mem.kind === 'options');
    let inner;
    if (p.soldOut) {
      inner = '<button type="button" class="btn-sold" aria-disabled="true" aria-label="' + esc(p.name) + ' 今日售完">售完</button>';
    } else if (!needsSheet(p) && q > 0) {
      inner = stepperHTML(p, q, tab);
    } else if (memOpt) {
      const badge = q > 0 ? '<span class="btn-add__badge tnum" aria-hidden="true">' + q + '</span>' : '';
      inner = '<button type="button" class="btn-again" data-action="again" data-id="' + p.id + '" data-key="again:' + p.id + '"' + tabAttr(tab) +
          ' aria-label="再點 ' + esc(p.name) + '，上次：' + esc(mem.text) + '">' + ICON('repeat', KIOSK ? 24 : 16) + '<span>再點</span></button>' +
        '<button type="button" class="btn-add btn-add--icon" data-action="add" data-id="' + p.id + '" data-key="add:' + p.id + '"' + tabAttr(tab) +
          ' aria-label="調整選項：' + esc(p.name) + '">' + ICON('plus', KIOSK ? 28 : 18) + badge + '</button>';
    } else {
      const icon = DATASET_MINIMAL;
      const badge = q > 0 ? '<span class="btn-add__badge tnum" aria-hidden="true">' + q + '</span>' : '';
      const label = '加入 ' + esc(p.name) + (q > 0 ? '（購物車已有 ' + q + ' 份）' : '');
      inner = '<button type="button" class="btn-add' + (icon ? ' btn-add--icon' : '') + '" data-action="add" data-id="' + p.id + '" data-key="add:' + p.id + '"' + tabAttr(tab) +
        AKS('a') + ' aria-label="' + label + '">' + ICON('plus', icon ? (KIOSK ? 28 : 18) : (KIOSK ? 24 : 16)) + (icon ? '' : '<span>加入</span>') + badge + '</button>';
    }
    return '<div class="act' + (memOpt && !p.soldOut ? ' act--mem' : '') + '" data-action="noop">' + inner + '</div>';
  }

  /* 商品卡取得焦點時，卡片底部出現的提示列（浮在卡片下緣，不佔版面） */
  function cardHintHTML(p, mem) {
    if (!hotkeysEnabled()) return '';
    const parts = [];
    if (!p.soldOut) {
      parts.push(KH('a') + '<span>加入</span>');
      if (mem && mem.kind === 'options') parts.push(KH('r') + '<span>再點</span>');
    }
    parts.push(KH('f') + '<span>收藏</span>');
    if (!p.soldOut) parts.push(KH('Enter') + '<span>詳情</span>');
    return '<div class="pcard__hint" aria-hidden="true">' + parts.join('<i class="sep">·</i>') + '</div>';
  }

  function cardHTML(p, layout) {
    const compact = isBare(p) && (layout === 'list' || DATASET_MINIMAL);
    const soldCls = p.soldOut ? ' is-soldout' : '';
    const active = state.activeCard === p.id;
    const tab = active ? 0 : -1;
    const fav = state.fav.includes(p.id);
    const mem = p.soldOut ? null : memoryFor(p);
    const memOpt = !!(mem && mem.kind === 'options');
    const openAttr = p.soldOut ? '' : ' data-action="open" data-id="' + p.id + '"';
    const desc = p.desc ? ' ds-' + p.id : '';
    const base = (KIOSK ? '' : ' tabindex="' + tab + '"') + ' data-pid="' + p.id + '" data-key="card:' + p.id + '"' + AKS('a r f') +
      ' aria-labelledby="n-' + p.id + '" aria-describedby="pr-' + p.id + desc + '"' + openAttr;
    const nameBtn = (p.soldOut || KIOSK)
      ? esc(p.name)
      : '<button type="button" class="pcard__open" data-action="open" data-id="' + p.id + '" data-key="open:' + p.id + '"' + tabAttr(tab) + '>' + esc(p.name) + '</button>';
    const nameEl = '<h3 class="pcard__name" id="n-' + p.id + '">' + nameBtn + '</h3>';
    const price = priceHTML(p, 'pr-' + p.id);
    const act = actionHTML(p, tab, mem);
    const favIcon = fav ? '<span class="favmark" aria-label="已收藏">' + ICON('heart', 16, 'is-filled') + '</span>' : '';
    const hint = cardHintHTML(p, mem);
    const descEl = p.desc ? '<p class="pcard__desc" id="ds-' + p.id + '">' + esc(p.desc) + '</p>' : '';

    if (compact) {
      return '<article class="pcard pcard--' + layout + ' pcard--bare' + soldCls + '"' + base + '>' +
        '<div class="pcard__barein">' + nameEl.replace('</h3>', favIcon + '</h3>') +
        '<div class="pcard__row">' + price + act + '</div></div>' + hint + '</article>';
    }

    const tags = p.soldOut ? ['sold'] : p.tags;
    const hasImg = !!p.emoji;
    const lastEl = memOpt ? '<p class="pcard__last">上次：' + esc(mem.text) + '</p>' : '';

    if (layout === 'grid') {
      const media = hasImg
        ? '<div class="pmedia pmedia--photo" aria-hidden="true"><span class="pmedia__glyph">' + p.emoji + '</span></div>'
        : '<div class="pmedia pmedia--ph" aria-hidden="true"><span class="pmedia__glyph">' + esc(initial(p.name)) + '</span></div>';
      const overlay = hasImg && tags.length ? '<div class="pcard__overlay">' + tagsHTML(tags) + '</div>' : '';
      const inline = !hasImg && tags.length ? tagsHTML(tags) : '';
      return '<article class="pcard pcard--grid' + soldCls + '"' + base + '>' +
        '<div class="pcard__media">' + media + overlay + (fav ? '<span class="pcard__fav" aria-label="已收藏">' + ICON('heart', 16, 'is-filled') + '</span>' : '') + '</div>' +
        '<div class="pcard__body">' +
          '<div class="pcard__titlerow">' + nameEl + inline + '</div>' + descEl + lastEl +
        '</div>' +
        '<div class="pcard__foot' + (memOpt ? ' pcard__foot--mem' : '') + '">' + price + act + '</div>' + hint + '</article>';
    }

    /* list */
    const thumb = hasImg
      ? '<div class="pmedia pmedia--photo pcard__thumb" aria-hidden="true"><span class="pmedia__glyph">' + p.emoji + '</span></div>'
      : '';
    return '<article class="pcard pcard--list' + soldCls + '"' + base + '>' +
      '<div class="pcard__main">' +
        '<div class="pcard__titlerow">' + nameEl.replace('</h3>', favIcon + '</h3>') + (tags.length ? tagsHTML(tags) : '') + '</div>' +
        descEl + lastEl +
        '<div class="pcard__row">' + price + act + '</div>' +
      '</div>' + thumb + hint + '</article>';
  }

  /* 「常點」：依上次點餐的選項一鍵再點（無選項群組者只顯示品名與價格） */
  function commonHTML() {
    const items = commonItems();
    if (!items.length) return '';
    return '<section class="common" id="common" tabindex="-1" aria-labelledby="common-title">' +
      '<div class="common__head"><h2 class="common__title" id="common-title">常點的餐點</h2><p class="common__sub">依你上次點餐的選項</p></div>' +
      '<ul class="common__list">' + items.map((p) => {
        const m = memoryFor(p);
        const label = '再點 ' + esc(p.name) + (m.text ? '，上次：' + esc(m.text) : '');
        return '<li class="ccard' + (p.soldOut ? ' is-soldout' : '') + '">' +
          '<div class="ccard__main"><h3 class="ccard__name">' + esc(p.name) + '</h3>' + (m.text ? '<p class="ccard__opt">' + esc(m.text) + '</p>' : '') + '</div>' +
          '<div class="ccard__foot"><span class="price tnum">' + money(m.unit) + '</span>' +
          (p.soldOut
            ? '<span class="tag tag--sold">今日售完</span><button type="button" class="btn-again" aria-disabled="true">' + ICON('repeat', 16) + '<span>再點</span></button>'
            : '<button type="button" class="btn-again" data-action="again" data-id="' + p.id + '" data-key="again-c:' + p.id + '" aria-label="' + label + '">' + ICON('repeat', 16) + '<span>再點</span></button>') +
          '</div></li>';
      }).join('') + '</ul></section>';
  }

  const catChips = () => CATEGORIES.filter((c) => !(c.virtual && !HAS_HOT));
  const catCount = (id) => (id === 'all' ? MENU.length : id === 'hot' ? MENU.filter((p) => p.tags.includes('hot')).length : MENU.filter((p) => p.cat === id).length);

  function sectionsHTML() {
    const q = state.q.trim().toLowerCase();
    let sections;
    if (q) {
      const hit = MENU.filter((p) => p.name.toLowerCase().includes(q) || (p.desc || '').toLowerCase().includes(q));
      sections = [{ title: '搜尋結果', items: hit }];
    } else if (state.cat === 'hot') {
      sections = [{ title: '🔥 熱銷', items: MENU.filter((p) => p.tags.includes('hot')) }];
    } else if (state.cat !== 'all') {
      const c = CATEGORIES.find((x) => x.id === state.cat);
      sections = [{ title: c.name, items: MENU.filter((p) => p.cat === c.id) }];
    } else {
      sections = CATEGORIES.filter((c) => !c.virtual)
        .map((c) => ({ title: c.name, items: MENU.filter((p) => p.cat === c.id) }))
        .filter((s) => s.items.length);
    }
    if (!sections.some((s) => s.items.length)) {
      return '<div class="empty menu-empty"><div class="empty__icon">' + ICON('search', 28) + '</div>' +
        '<p class="empty__title">找不到「' + esc(state.q) + '」</p><p class="empty__text">換個關鍵字，或清除搜尋看看全部菜單。</p></div>';
    }
    /* roving tabindex：確保有一張可進入的卡片 */
    const visible = [].concat.apply([], sections.map((s) => s.items));
    if (!visible.some((p) => p.id === state.activeCard)) {
      state.activeCard = (visible.find((p) => !p.soldOut) || visible[0]).id;
    }
    const layout = currentLayout();
    const gridCls = layout === 'grid' ? 'pgrid' : 'plist';
    const common = state.cat === 'all' && !q ? commonHTML() : '';
    return common + sections.map((s, i) =>
      '<section class="msec"><div class="msec__head"><div class="msec__titlewrap"><h2 class="msec__title">' + esc(s.title) + '</h2>' +
      '<span class="msec__count">' + s.items.length + ' 項</span></div>' + (i === 0 && !KIOSK ? layoutToggleHTML('icon') : '') + '</div>' +
      '<div class="' + gridCls + '" role="group" aria-label="' + esc(s.title) + '">' + s.items.map((p) => cardHTML(p, layout)).join('') + '</div></section>'
    ).join('');
  }

  /* 版面切換「圖卡｜清單」：桌機（text）置於分類膠囊列最右；手機（icon）置於第一個分類標題列右側 */
  function layoutToggleHTML(kind) {
    const cur = currentLayout();
    const seg = '<div class="segmented layouttoggle layouttoggle--' + kind + '" role="radiogroup" aria-label="商品版面"' + AKS('v') + '>' +
      [['grid', '圖卡'], ['list', '清單']].map((o) =>
        '<button type="button" class="segmented__btn' + (kind === 'icon' ? ' segmented__btn--icon' : '') + '" role="radio" aria-checked="' + (cur === o[0]) + '"' +
        ' tabindex="' + (cur === o[0] ? 0 : -1) + '" data-action="layout" data-id="' + o[0] + '" data-key="layout:' + kind + ':' + o[0] + '"' + (kind === 'icon' ? ' aria-label="' + o[1] + '"' : '') + '>' +
        ICON(o[0], 16) + (kind === 'text' ? '<span>' + o[1] + '</span>' : '') + '</button>'
      ).join('') + '</div>';
    return '<div class="layouttoggle-wrap layouttoggle-wrap--' + kind + '">' + seg + KH('v') + '</div>';
  }

  function segmentedHTML(extra) {
    return '<div class="segmented ' + (extra || '') + '" role="radiogroup" aria-label="取餐方式">' +
      FULFIL.map((f) =>
        '<button type="button" class="segmented__btn" role="radio" aria-checked="' + (state.fulfil === f.id) + '" tabindex="' + (state.fulfil === f.id ? 0 : -1) + '" data-action="fulfil" data-id="' + f.id + '" data-key="fulfil:' + f.id + (extra ? ':x' : '') + '">' + f.name + '</button>'
      ).join('') + '</div>';
  }

  /* 跳過連結：菜單頁為「跳到主要內容」「跳到我的訂單」「鍵盤快速鍵與偏好」；任務型頁面（結帳、訂單追蹤）沒有訂單面板可跳，
     保留「跳到主要內容」與「鍵盤快速鍵與偏好」（入口位置一致，WCAG 3.2.6；不依賴單鍵）。觸控面板不提供鍵盤入口。
     鍵盤提醒緊接在跳過連結之後（DOM 順序），Tab 可立即到達 */
  function skipLinksHTML(kind) {
    const prefs = '<a class="skip skip--prefs" href="#prefs" data-action="help" data-key="skip-prefs">鍵盤快速鍵與偏好</a>';
    return '<a class="skip" href="#menu" data-action="skip" data-target="menu">跳到主要內容</a>' +
      (kind === 'menu' ? '<a class="skip skip--panel" href="#orderpanel" data-action="skip" data-target="orderpanel">跳到我的訂單</a>' + prefs : '') +
      (kind === 'task' && !KIOSK ? prefs : '');
  }
  /* 任務型頁面（結帳、訂單追蹤）頂欄右側的 ⌨「鍵盤快速鍵與偏好」：≥ 768 顯示（< 768 由頁尾與跳過連結進入），不依賴徽章開關 */
  const taskHelpHTML = () => (KIOSK ? '' :
    '<button type="button" class="iconbtn appbar__help" data-action="help" data-key="help"' + AKS('?') + ' aria-label="鍵盤快速鍵與偏好' + (KN.dot ? '，有新提示' : '') + '" title="鍵盤快速鍵與偏好">' +
    ICON('keyboard', 22) + (KN.dot ? '<span class="kbdot" aria-hidden="true"></span>' : '') + '</button>');

  function topbarHTML() {
    const member = P.login === 'member';
    const n = state.cart.length;
    return '<header class="topbar">' +
      '<button type="button" class="topbar__brand" data-action="store" data-key="store-i"' + AKS('i') + ' aria-label="店家資訊：' + STORE.name + '">' +
        '<span class="brandmark" aria-hidden="true">' + STORE.initial + '</span><span class="brand-name">' + STORE.name + '</span>' + KH('i') + '</button>' +
      '<div class="searchbox">' + ICON('search', 20) +
        '<input type="search" id="search-d" data-search data-key="search-d" placeholder="搜尋菜單…" aria-label="搜尋菜單"' + AKS('s /') + ' value="' + esc(state.q) + '">' + KH('s') + '</div>' +
      '<div class="topbar__actions">' +
        '<button type="button" class="iconbtn topbar__cart" data-action="open-cart" aria-label="購物車，' + n + ' 項">' + ICON('cart', 22) + (n ? '<span class="countbadge">' + n + '</span>' : '') + '</button>' +
        '<button type="button" class="btn btn--ghost" data-action="orders" data-key="orders"' + AKS('o') + '>查詢訂單' + KH('o') + '</button>' +
        (member
          ? '<button type="button" class="btn btn--ghost" data-action="login" data-key="login"' + AKS('l') + '><span class="avatar" aria-hidden="true">示</span>我的' + KH('l') + '</button>'
          : '<button type="button" class="btn btn--ghost" data-action="login" data-key="login"' + AKS('l') + '>登入' + KH('l') + '</button>') +
        '<button type="button" class="iconbtn topbar__help" data-action="help" data-key="help"' + AKS('?') + ' aria-label="鍵盤快速鍵與偏好' + (KN.dot ? '，有新提示' : '') + '" title="鍵盤快速鍵與偏好">' +
          ICON('keyboard', 22) + (KN.dot ? '<span class="kbdot" aria-hidden="true"></span>' : '') + '</button>' +
      '</div></header>';
  }

  function kioskTopbarHTML() {
    return '<header class="topbar topbar--kiosk">' +
      '<div class="topbar__brand"><span class="brandmark" aria-hidden="true">' + STORE.initial + '</span><span class="brand-name">' + STORE.name + '</span></div>' +
      '<div class="segmented segmented--kiosk" role="radiogroup" aria-label="用餐方式">' +
        FULFIL.map((f) => '<button type="button" class="segmented__btn" role="radio" aria-checked="' + (state.fulfil === f.id) + '" data-action="fulfil" data-id="' + f.id + '" data-key="fulfil:' + f.id + '">' + f.name + '</button>').join('') +
      '</div>' +
      '<span class="eta">' + ICON('clock', 28) + STORE.eta + '</span>' +
      '<div class="topbar__actions"><button type="button" class="kiosk-large" data-action="kiosk-large" data-key="kiosk-large" aria-pressed="' + state.large + '">' + ICON('textsize', 28) + '<span>大字</span></button></div>' +
      '</header>';
  }

  function appbarHTML() {
    const member = P.login === 'member';
    const n = state.cart.length;
    return '<header class="appbar appbar--menu">' +
      '<button type="button" class="appbar__brand" data-action="store" data-key="store-m" aria-label="店家資訊：' + STORE.name + '"><span class="brandmark" aria-hidden="true">' + STORE.initial + '</span><span class="brand-name">' + STORE.name + '</span></button>' +
      '<div class="appbar__actions">' +
        '<button type="button" class="iconbtn" data-action="toggle-search" data-key="toggle-search" aria-label="搜尋菜單"' + AKS('s /') + ' aria-expanded="' + state.searchOpen + '">' + ICON('search', 22) + '</button>' +
        '<button type="button" class="iconbtn" data-action="open-cart" data-key="open-cart-m" aria-label="購物車，' + n + ' 項"' + AKS('c') + '>' + ICON('cart', 22) + (n ? '<span class="countbadge">' + n + '</span>' : '') + '</button>' +
        (member ? '<span class="avatar" aria-label="我的">示</span>' : '') +
      '</div>' +
      (state.searchOpen
        ? '<div class="appbar__search"><div class="searchbox">' + ICON('search', 20) +
          '<input type="search" id="search-m" data-search data-key="search-m" placeholder="搜尋菜單…" aria-label="搜尋菜單" value="' + esc(state.q) + '">' + KH('s') + '</div></div>'
        : '') +
      '</header>';
  }

  /* 店家資訊列：整列為「店家資訊」入口（外觀與靜態資訊列相同），鍵盤提示 i 附於末端 */
  function storeHTML() {
    return '<section class="store" aria-label="店家資訊">' +
      '<div class="store__info">' +
        '<span class="store__item store__item--open"><span class="store__status"><span class="dot"></span>營業中</span>・' + STORE.hours + '</span>' +
        '<span class="store__item store__item--addr">' + ICON('pin', 16) + STORE.address + '</span>' +
        '<span class="store__item store__item--tel">' + ICON('phone', 16) + STORE.phone + '</span>' +
      '</div>' +
      '<div class="store__ctl">' + segmentedHTML('') + '<span class="eta">' + ICON('clock', 16) + STORE.eta + '</span></div>' +
      '</section>';
  }

  function chipsHTML() {
    const items = [{ id: 'all', label: '全部', name: '全部', num: 0 }];
    catChips().forEach((c, i) => items.push({ id: c.id, label: (c.virtual ? c.icon + ' ' : '') + c.name, name: c.name, num: i + 1 }));
    const current = items.find((c) => state.cat === c.id && !state.q);
    const rov = current || items[0];
    const chips = items.map((c) => {
      const isCur = c === current;
      const showNum = typeof c.num === 'number' && c.num <= 9 && !KIOSK;
      return '<button type="button" class="chip" aria-current="' + isCur + '" tabindex="' + (c === rov ? 0 : -1) + '"' +
        ' aria-label="' + esc(c.name) + '，' + catCount(c.id) + ' 項"' +
        ' data-action="cat" data-id="' + c.id + '" data-key="cat:' + c.id + '"' + (showNum ? AKS(String(c.num)) : '') + '>' +
        (showNum && hotkeysEnabled() ? '<span class="chip__num" aria-hidden="true">' + c.num + '</span>' : '') + c.label + '</button>';
    }).join('');
    if (KIOSK) {
      return '<nav class="chipsbar chipsbar--kiosk" aria-label="菜單分類">' +
        '<button type="button" class="chips__nav" data-action="chips-prev" data-key="chips-prev" aria-label="上一頁">' + ICON('chevL', 28) + '</button>' +
        '<div class="chips__scroller">' + chips + '</div>' +
        '<button type="button" class="chips__nav" data-action="chips-next" data-key="chips-next" aria-label="下一頁">' + ICON('chevR', 28) + '</button>' +
        '</nav>';
    }
    return '<nav class="chipsbar" aria-label="菜單分類"><div class="chips__scroller">' + chips + '</div>' + layoutToggleHTML('text') + '</nav>';
  }

  /* 訂單面板 / 購物車內容 */
  /* 縮圖：有任一品項有圖時，無圖品項以淺灰首字塊補位（對齊文字左緣）；全部無圖則不留縮圖欄 */
  const anyThumb = () => state.cart.some((l) => { const p = byId(l.pid); return p && p.emoji; });
  function cartLineHTML(l) {
    const p = byId(l.pid);
    const name = p ? p.name : l.pid;
    const thumb = p && p.emoji
      ? '<div class="cartline__thumb" aria-hidden="true">' + p.emoji + '</div>'
      : anyThumb() ? '<div class="cartline__thumb cartline__thumb--ph" aria-hidden="true">' + esc(initial(name)) + '</div>' : '';
    const main = '<div class="cartline__main">' +
      '<div class="cartline__title"><span class="cartline__qty tnum">' + l.qty + '×</span>' + esc(name) + '</div>' +
      (l.opt ? '<div class="cartline__meta">' + esc(l.opt) + '</div>' : '') +
      (l.note ? '<div class="cartline__meta">備註：' + esc(l.note) + '</div>' : '') + '</div>';
    if (KIOSK) {
      return '<li class="cartline cartline--kiosk" data-line="' + l.id + '">' + thumb + main +
        '<span class="price tnum cartline__price">' + money(l.unit * l.qty) + '</span>' +
        '<div class="cartline__acts">' +
          '<button type="button" class="cartline__btn" data-action="edit" data-line="' + l.id + '" data-key="edit:' + l.id + '" aria-label="編輯 ' + esc(name) + '">' + ICON('pencil', 28) + '</button>' +
          '<button type="button" class="cartline__btn" data-action="remove-line" data-line="' + l.id + '" data-key="rm:' + l.id + '" aria-label="移除 ' + esc(name) + '">' + ICON('trash', 28) + '</button>' +
        '</div></li>';
    }
    /* 「編輯」「移除」一律可見（不與徽章開關耦合）；啟用單鍵快速鍵後才在按鈕旁加上 e / d 徽章（局部重排可接受） */
    return '<li class="cartline" tabindex="0" data-line="' + l.id + '" data-key="line:' + l.id + '"' + AKS('e d + -') + '>' + thumb + main +
      '<div class="cartline__side">' +
        '<div class="cartline__acts">' +
          '<button type="button" class="cartline__edit" data-action="edit" data-line="' + l.id + '" data-key="edit:' + l.id + '"' + AKS('e') + ' aria-label="編輯 ' + esc(name) + '">' + ICON('pencil', 14) + '編輯' + KH('e') + '</button>' +
          '<button type="button" class="cartline__edit cartline__edit--rm" data-action="remove-line" data-line="' + l.id + '" data-key="rm:' + l.id + '"' + AKS('d') + ' aria-label="移除 ' + esc(name) + '">' + ICON('trash', 14) + '移除' + KH('d') + '</button>' +
        '</div>' +
        '<span class="price tnum">' + money(l.unit * l.qty) + '</span>' +
      '</div></li>';
  }

  function totalsHTML() {
    const fee = feeAmount();
    return '<dl class="totals">' +
      '<div><dt>小計</dt><dd>' + money(subtotal()) + '</dd></div>' +
      '<div class="' + (fee ? '' : 'is-none') + '"><dt>運費</dt><dd>' + (fee ? money(fee) : '—') + '</dd></div>' +
      '<div class="is-none"><dt>折扣</dt><dd>—</dd></div>' +
      '<div class="totals__total"><dt>總計</dt><dd>' + money(total()) + '</dd></div></dl>';
  }

  const emptyCartHTML = () =>
    '<div class="empty"><div class="empty__icon">' + ICON('cart', 28) + '</div>' +
    '<p class="empty__title">購物車還是空的，來點好吃的吧！</p>' +
    '<p class="empty__text">點選商品右下角的「＋」即可加入。</p></div>';

  function orderPanelHTML() {
    const n = state.cart.length;
    const f = fulfilName(state.fulfil);
    const cta = KIOSK ? hrefTo('done', { mode: 'kiosk' }) : hrefTo('checkout', { device: 'mobile' });
    return '<aside class="orderpanel" id="orderpanel" tabindex="-1" aria-label="我的訂單"' + AKS('c') + '>' +
      '<div class="orderpanel__head"><h2 class="orderpanel__title">我的訂單' + KH('c') + '</h2><span class="chip chip--static is-selected">' + f + '</span></div>' +
      '<div class="orderpanel__list">' + (n ? '<ul>' + state.cart.map(cartLineHTML).join('') + '</ul>' : emptyCartHTML()) + '</div>' +
      '<div class="orderpanel__foot">' + totalsHTML() +
        '<a class="btn btn--primary btn--lg btn--block"' + (n ? ' href="' + cta + '"' : ' aria-disabled="true"') + ' data-key="go-checkout"' + AKS('p') + '>' +
          (n ? '前往結帳 · ' + money(total()) : '前往結帳') + (n ? KH('p', true) : '') + '</a>' +
        (KIOSK ? '' : '<p class="orderpanel__note">不需登入即可結帳</p>') +
      '</div></aside>';
  }

  function cartbarHTML() {
    const n = state.cart.length;
    if (!n) {
      return '<div class="cartbar-wrap"><button type="button" class="cartbar cartbar--empty" data-action="open-cart" data-key="cartbar">' +
        ICON('cart', 20) + '<span>購物車還是空的，來點好吃的吧！</span></button></div>';
    }
    return '<div class="cartbar-wrap"><button type="button" class="cartbar" data-action="open-cart" data-key="cartbar"' + AKS('c') + '>' +
      '<span class="cartbar__count">' + ICON('cart', 22) + n + ' 項</span>' +
      '<span class="cartbar__total">' + money(total()) + '</span>' +
      '<span class="cartbar__go">查看購物車' + ICON('chevR', 18) + '</span></button></div>';
  }

  function bottomTabHTML() {
    return '<nav class="bottomtab" aria-label="主要導覽">' +
      '<a class="bottomtab__item" aria-current="page" href="' + hrefTo('menu', { sheet: null }) + '">' + ICON('bowl', 22) + '菜單</a>' +
      '<a class="bottomtab__item" href="' + hrefTo('tracking') + '">' + ICON('receipt', 22) + '訂單</a>' +
      '<button type="button" class="bottomtab__item" data-action="login" data-key="login-m">' + ICON('user', 22) + '我的</button>' +
      '</nav>';
  }

  function footerHTML(kind) {
    return '<footer class="sitefooter' + (kind === 'task' ? ' sitefooter--task' + (CK_ON ? ' sitefooter--ck' : '') : '') + '">' +
      '<div class="sitefooter__row">' +
        '<span>' + STORE.name + '・設計參考原型</span>' +
        '<button type="button" class="sitefooter__link" data-action="store" data-key="store-f"' + AKS('i') + '>店家資訊' + KH('i') + '</button>' +
        '<button type="button" class="sitefooter__link" data-action="help" data-key="help-f"' + AKS('?') + '>鍵盤快速鍵' + KH('?') + '</button>' +
        '<button type="button" class="sitefooter__link" data-action="prefs" data-key="prefs-f">偏好設定</button>' +
      '</div>' +
      (memoryOn() ? '<p class="sitefooter__note">點餐記憶僅存於此裝置，可在「清除我的資料」移除。</p>' : '') +
      '</footer>';
  }

  /* 商品面板 */
  function groupHTML(p, g, S) {
    const sel = S.sel[g.id] || [];
    const type = g.multi ? 'checkbox' : 'radio';
    const rule = g.required ? (g.multi ? '必選・可複選' : '必選・單選') : g.max ? '選填・最多 ' + g.max + ' 項' : '選填';
    const full = g.multi && g.max && sel.length >= g.max;
    return '<div class="optgroup" role="' + (g.multi ? 'group' : 'radiogroup') + '" aria-labelledby="g-' + g.id + '">' +
      '<div class="optgroup__head"><span class="optgroup__title" id="g-' + g.id + '">' + esc(g.name) + '</span>' +
      '<span class="optgroup__rule' + (g.required ? ' is-required' : '') + '">' + rule + '</span></div>' +
      '<div class="opts">' +
      g.choices.map((c) => {
        const on = sel.includes(c.id);
        const dis = full && !on;
        return '<label class="opt' + (on ? ' is-checked' : '') + (dis ? ' is-disabled' : '') + '">' +
          '<input type="' + type + '" name="' + g.id + '" value="' + c.id + '" data-action="opt" data-group="' + g.id + '" data-key="opt:' + g.id + ':' + c.id + '"' + (on ? ' checked' : '') + (dis ? ' disabled' : '') + '>' +
          '<span class="opt__mark opt__mark--' + type + '">' + (g.multi ? ICON('check', 14) : '') + '</span>' +
          '<span class="opt__text"><span class="opt__label">' + esc(c.name) + '</span>' +
          (c.delta ? '<span class="opt__delta tnum">+$' + c.delta + '</span>' : '') + '</span></label>';
      }).join('') + '</div></div>';
  }

  function sheetHTML() {
    const S = state.sheet;
    const p = byId(S.pid);
    const hasImg = !!p.emoji;
    const editing = !!S.lineId;
    const unit = p.groups.length ? unitPrice(p, S.sel) : editing ? (state.cart.find((l) => l.id === S.lineId) || {}).unit || p.price : p.price;
    const sum = unit * S.qty;
    const bare = !hasImg;
    const closeBtn = '<button type="button" class="sheet__close' + (bare ? ' sheet__close--inline' : '') + '" data-action="close-sheet" data-key="close-sheet" aria-label="關閉">' + ICON('close', KIOSK ? 28 : 22) + '</button>';
    const tip = S.mem && S.mem.applied
      ? '<div class="tip" role="status"><span class="tip__text">已套用上次的選擇：' + esc(S.mem.text) + '</span>' +
        '<button type="button" class="tip__btn" data-action="restore-default" data-key="restore-default"' + AKS('d') + '>恢復預設' + KH('d') + '</button></div>'
      : S.mem && S.mem.partial
        ? '<div class="tip tip--warning" role="status"><span class="tip__text">部分選項已不提供，已改用預設</span></div>'
        : '';
    return '<div class="scrim" data-action="close-sheet"></div>' +
      '<section class="sheet' + (bare ? ' sheet--bare' : '') + '" role="dialog" aria-modal="true" aria-labelledby="sheet-title" data-overlay="sheet">' +
        '<div class="sheet__handle" aria-hidden="true"></div>' +
        '<div class="sheet__scroll">' +
          closeBtn +
          (hasImg ? '<div class="sheet__media pmedia pmedia--photo" aria-hidden="true"><span class="pmedia__glyph">' + p.emoji + '</span></div>' : '') +
          '<div class="sheet__head"><h2 class="sheet__title" id="sheet-title" tabindex="-1">' + esc(p.name) + '</h2>' + priceHTML(p) + '</div>' +
          tip +
          (p.desc ? '<p class="sheet__desc">' + esc(p.desc) + '</p>' : '') +
          (p.tags.length ? '<div class="sheet__tags">' + tagsHTML(p.tags) + '</div>' : '') +
          p.groups.map((g) => groupHTML(p, g, S)).join('') +
          '<label class="field"><span class="field__label">備註 <small>（選填）</small></span>' +
            '<textarea class="textarea" data-note data-key="note" rows="2" placeholder="例如：不要香菜、醬料分開">' + esc(S.note) + '</textarea></label>' +
          (editing ? '<button type="button" class="btn btn--ghost" style="margin-top:12px;color:var(--color-danger)" data-action="sheet-remove" data-key="sheet-remove">' + ICON('trash', 18) + '從購物車移除</button>' : '') +
        '</div>' +
        '<footer class="sheet__foot">' +
          '<div class="stepper stepper--lg" role="group" aria-label="數量">' +
            '<button type="button" class="stepper__btn stepper__btn--minus" data-action="sheet-dec" data-key="sheet-dec"' + AKS('-') + ' aria-label="減少數量"' + (S.qty <= 1 ? ' disabled' : '') + '>' + ICON('minus', 18) + '</button>' +
            '<output class="stepper__count">' + S.qty + '</output>' +
            '<button type="button" class="stepper__btn stepper__btn--plus" data-action="sheet-inc" data-key="sheet-inc"' + AKS('+ =') + ' aria-label="增加數量">' + ICON('plus', 18) + '</button>' +
          '</div>' + (hotkeysEnabled() ? '<span class="keyhints">' + KH('-') + KH('+') + '</span>' : '') +
          '<button type="button" class="btn btn--primary btn--lg" data-action="sheet-commit" data-key="sheet-commit"' + AKS('a') + '>' +
            (editing ? '更新購物車' : '加入購物車') + ' · ' + money(sum) + KH('a', true) + '</button>' +
        '</footer>' +
      '</section>';
  }

  function cartSheetHTML() {
    const n = state.cart.length;
    const f = fulfilName(state.fulfil);
    return '<div class="scrim" data-action="close-cart"></div>' +
      '<section class="sheet cartsheet" role="dialog" aria-modal="true" aria-labelledby="cart-title" data-overlay="cart">' +
        '<div class="sheet__handle" aria-hidden="true"></div>' +
        '<div class="cartsheet__head"><h2 class="orderpanel__title" id="cart-title" tabindex="-1">我的訂單</h2>' +
          '<span class="chip chip--static is-selected">' + f + '</span>' +
          '<button type="button" class="iconbtn" data-action="close-cart" data-key="close-cart" aria-label="關閉" style="margin-left:auto">' + ICON('close', 22) + '</button></div>' +
        '<div class="sheet__scroll cartsheet__body">' + (n ? '<ul>' + state.cart.map(cartLineHTML).join('') + '</ul>' : emptyCartHTML()) + '</div>' +
        '<div class="cartsheet__foot">' + totalsHTML() +
          '<a class="btn btn--primary btn--lg btn--block"' + (n ? ' href="' + hrefTo('checkout', { device: 'mobile' }) + '"' : ' aria-disabled="true"') + ' data-key="cart-checkout"' + AKS('p') + '>' +
            (n ? '前往結帳 · ' + money(total()) : '前往結帳') + (n ? KH('p', true) : '') + '</a>' +
          '<p class="orderpanel__note">不需登入即可結帳</p></div>' +
      '</section>';
  }

  /* 快速鍵說明對話框的內容由 HOTKEYS 產生；另列方向鍵與 Tab（§10.2） */
  const keyDocTokens = (def) => {
    if (def.action === 'jumpCategory') return ['1', '~–', '9', '~、', '0'];
    if (def.keys.length === 1 && def.keys[0] === 'Ctrl+Enter') return ['Ctrl/⌘', '~ + ', 'Enter'];
    return def.keys.map((k, i) => (i ? ['~ ', k === 'Escape' ? 'Esc' : k] : [k === 'Escape' ? 'Esc' : k])).reduce((a, b) => a.concat(b), []);
  };
  const keysHTML = (tokens) => tokens.map((k) => (k.charAt(0) === '~' ? '<span class="keyrow__sep">' + esc(k.slice(1)) + '</span>' : '<kbd class="keyhint keyhint--doc">' + esc(k) + '</kbd>')).join('');
  function keygroupHTML(scope) {
    const rows = HOTKEYS.filter((h) => h.scope === scope);
    return '<section class="keygroup" data-scope="' + scope + '"><h3 class="keygroup__title">' + SCOPE_TITLE[scope] + '</h3>' +
      rows.map((h) => '<div class="keyrow"><span class="keyrow__keys">' + keysHTML(keyDocTokens(h)) + '</span><span class="keyrow__text">' + esc(h.label) + '</span></div>').join('') +
      '</section>';
  }
  const navKeysHTML = () =>
    '<section class="keygroup" data-scope="nav"><h3 class="keygroup__title">方向鍵與 Tab</h3>' +
    '<div class="keyrow"><span class="keyrow__keys">' + keysHTML(['←', '→', '↑', '↓']) + '</span><span class="keyrow__text">在商品、分類、取餐方式間移動</span></div>' +
    '<div class="keyrow"><span class="keyrow__keys">' + keysHTML(['Enter']) + '</span><span class="keyrow__text">開啟商品面板 / 確認</span></div>' +
    '<div class="keyrow"><span class="keyrow__keys">' + keysHTML(['Tab']) + '</span><span class="keyrow__text">下一個控制項（Shift + Tab 回上一個）</span></div>' +
    '</section>';

  function dialogHTML() {
    const d = state.dialog;
    if (!d) return '';
    if (d.type === 'shortcuts') {
      const cols = '<div class="keygroups__col">' + keygroupHTML('global') + keygroupHTML('menu') + keygroupHTML('order') + '</div>' +
        '<div class="keygroups__col">' + keygroupHTML('sheet') + keygroupHTML('cart') + keygroupHTML('checkout') + navKeysHTML() + '</div>';
      const sw = (on, action, key, labelId, helpId, extra) =>
        '<button type="button" class="switch" role="switch" aria-checked="' + on + '" aria-labelledby="' + labelId + '" aria-describedby="' + helpId + '" data-action="' + action + '" data-key="' + key + '"' + (extra || '') + '></button>';
      const motionOpts = [['system', '跟隨系統'], ['on', '開'], ['off', '關']].map((o) =>
        '<button type="button" class="segmented__btn" role="radio" aria-checked="' + (state.motion === o[0]) + '" tabindex="' + (state.motion === o[0] ? 0 : -1) + '" data-action="motion" data-id="' + o[0] + '" data-key="motion:' + o[0] + '">' + o[1] + '</button>').join('');
      const prefs = '<section class="prefs" id="prefs" aria-labelledby="prefs-title"><h3 class="prefs__title" id="prefs-title">顯示與輸入偏好</h3>' +
        '<div class="prefrow"><div class="prefrow__text"><b id="pf-mem">記住上次點過的選項</b><small id="pf-mem-h">於此裝置顯示「上次：…」「↻ 再點」與「常點」</small></div>' + sw(state.memoryPref, 'toggle-memory', 'dlg-memory', 'pf-mem', 'pf-mem-h') + '</div>' +
        '<div class="prefrow"><div class="prefrow__text"><b id="pf-large">大字模式</b><small id="pf-large-h">文字放大 12.5%，版面自動重排</small></div>' + sw(state.textLarge, 'toggle-text', 'dlg-large', 'pf-large', 'pf-large-h') + '</div>' +
        '<div class="prefrow"><div class="prefrow__text"><b id="pf-motion">減少動態</b><small id="pf-motion-h">停用轉場與捲動動畫；「跟隨系統」依作業系統設定</small></div>' +
          '<div class="segmented" role="radiogroup" aria-labelledby="pf-motion" aria-describedby="pf-motion-h">' + motionOpts + '</div></div>' +
        '<div class="prefrow"><div class="prefrow__text"><small id="pf-clear-h">清除此裝置記住的姓名、手機、地址、點餐記憶與本機訂單記錄</small></div>' +
          '<button type="button" class="btn btn--ghost" data-action="clear-data" data-key="dlg-clear" aria-describedby="pf-clear-h">清除我的資料</button></div>' +
        '</section>';
      return '<div class="scrim scrim--top" data-action="close-dialog"></div>' +
        '<section class="dialog dialog--shortcuts" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-overlay="dialog">' +
          '<header class="dialog__head"><h2 class="dialog__title" id="dlg-title" tabindex="-1">鍵盤快速鍵與偏好</h2>' +
            '<p class="dialog__sub">' + (state.shortcutsOn
              ? '按 <kbd class="keyhint keyhint--doc">?</kbd> 隨時開啟；在輸入框內與輸入法組字時不會觸發'
              : '開啟下方開關後，按 <kbd class="keyhint keyhint--doc">?</kbd> 即可隨時開啟此說明；在輸入框內與輸入法組字時不會觸發') + '</p>' +
            '<button type="button" class="iconbtn dialog__x" data-action="close-dialog" data-key="dlg-x" aria-label="關閉">' + ICON('close', 22) + '</button></header>' +
          '<div class="dialog__body">' +
            '<div class="switchrow"><div class="switchrow__text"><b id="sw-label">啟用單鍵快速鍵</b><small id="sw-help">' + (state.shortcutsOn ? '關閉後僅保留 Esc 與 Ctrl/⌘ + Enter' : '開啟後可用單鍵操作，例如 c 開購物車；關閉時僅保留 Esc 與 Ctrl/⌘ + Enter') + '</small></div>' +
              sw(state.shortcutsOn, 'toggle-shortcuts', 'dlg-switch', 'sw-label', 'sw-help') + '</div>' +
            '<p class="dialog__note dialog__note--sr">使用螢幕閱讀器時，單鍵快速鍵可能與瀏覽模式的按鍵衝突，建議保持關閉。</p>' +
            '<div class="keygroups">' + cols + '</div>' +
            prefs +
          '</div>' +
          '<footer class="dialog__foot"><p class="dialog__note">快速鍵以鍵帽上的字元為準；注音等輸入法下改以實體按鍵比對。</p>' +
            '<button type="button" class="btn btn--primary" data-action="close-dialog" data-key="dlg-close">關閉</button></footer>' +
        '</section>';
    }
    if (d.type === 'store') {
      return '<div class="scrim scrim--top" data-action="close-dialog"></div>' +
        '<section class="dialog dialog--small" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-overlay="dialog">' +
          '<header class="dialog__head"><h2 class="dialog__title" id="dlg-title" tabindex="-1">店家資訊</h2>' +
            '<button type="button" class="iconbtn dialog__x" data-action="close-dialog" data-key="dlg-x" aria-label="關閉">' + ICON('close', 22) + '</button></header>' +
          '<div class="dialog__body"><div class="infolist infolist--lg">' +
            '<div class="infolist__row">' + ICON('receipt', 18) + '<span><b>' + STORE.name + '</b>・<span class="store__status"><span class="dot"></span>營業中</span></span></div>' +
            '<div class="infolist__row">' + ICON('clock', 18) + '<span>' + STORE.hours + '</span></div>' +
            '<div class="infolist__row">' + ICON('pin', 18) + '<span>' + STORE.address + '</span></div>' +
            '<div class="infolist__row">' + ICON('phone', 18) + '<span>' + STORE.phone + '</span></div>' +
            '<div class="infolist__row">' + ICON('info', 18) + '<span>' + STORE.eta + '・可自取、外送、內用</span></div>' +
          '</div></div>' +
          '<footer class="dialog__foot"><span></span><button type="button" class="btn btn--primary" data-action="close-dialog" data-key="dlg-close">關閉</button></footer>' +
        '</section>';
    }
    if (d.type === 'login') {
      const member = P.login === 'member';
      return '<div class="scrim scrim--top" data-action="close-dialog"></div>' +
        '<section class="dialog dialog--small" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-overlay="dialog">' +
          '<header class="dialog__head"><h2 class="dialog__title" id="dlg-title" tabindex="-1">' + (member ? '會員中心' : '登入（可略過）') + '</h2>' +
            '<button type="button" class="iconbtn dialog__x" data-action="close-dialog" data-key="dlg-x" aria-label="關閉">' + ICON('close', 22) + '</button></header>' +
          '<div class="dialog__body">' + (member
            ? '<p class="dialog__text">示範會員。可查看我的資料、歷史訂單與我的最愛。</p>' +
              (memoryOn() ? '<button type="button" class="btn btn--neutral" data-action="clear-memory" data-key="clear-memory">清除點餐記憶</button>' : '')
            : '<p class="dialog__text">登入後可帶入聯絡資料、收藏商品並查看歷史訂單。<b>不登入也能完整點餐與結帳。</b></p>') + '</div>' +
          '<footer class="dialog__foot"><span></span><div class="btnrow">' +
            (member ? '' : '<button type="button" class="btn btn--primary" data-action="close-dialog" data-key="dlg-login">以手機登入</button>') +
            '<button type="button" class="btn ' + (member ? 'btn--primary' : 'btn--ghost') + '" data-action="close-dialog" data-key="dlg-close">' + (member ? '關閉' : '稍後再說') + '</button></div></footer>' +
        '</section>';
    }
    if (d.type === 'confirm') {
      const l = state.cart.find((x) => x.id === d.lineId);
      const p = l ? byId(l.pid) : null;
      const name = p ? p.name : '此品項';
      return '<div class="scrim scrim--top" data-action="close-dialog"></div>' +
        '<section class="dialog dialog--small" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-desc" data-overlay="dialog">' +
          '<header class="dialog__head"><h2 class="dialog__title" id="dlg-title">移除這個品項？</h2></header>' +
          '<div class="dialog__body"><p class="dialog__text" id="dlg-desc">「' + esc(name) + (l && l.opt ? '・' + esc(l.opt) : '') + '」將從購物車移除。</p></div>' +
          '<footer class="dialog__foot"><span></span><div class="btnrow">' +
            '<button type="button" class="btn btn--neutral" data-action="close-dialog" data-key="dlg-cancel" data-autofocus>取消</button>' +
            '<button type="button" class="btn btn--danger" data-action="confirm-remove" data-key="dlg-ok">' + ICON('trash', 18) + '移除</button></div></footer>' +
        '</section>';
    }
    if (d.type === 'idle') {
      return '<div class="scrim scrim--top"></div>' +
        '<section class="dialog dialog--idle" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-desc" data-overlay="dialog">' +
          '<h2 class="dialog__title dialog__title--xl" id="dlg-title">還在嗎？</h2>' +
          '<p class="idle__msg" id="dlg-desc"><span class="idle__count tnum" id="idle-count">' + d.left + '</span><span> 秒後將重新開始，購物車會清空</span></p>' +
          '<div class="idle__btns">' +
            '<button type="button" class="btn btn--primary btn--xl" data-action="idle-continue" data-key="idle-continue" data-autofocus>繼續點餐</button>' +
            '<button type="button" class="btn btn--neutral btn--xl" data-action="idle-restart" data-key="idle-restart">重新開始</button>' +
          '</div>' +
        '</section>';
    }
    return '';
  }

  /* ------------------------------------------------------------------ 7. 畫面 */
  function menuScreen() {
    return '<div class="app" data-screen="menu"' + (state.searchOpen ? ' style="--appbar-offset:116px"' : '') + '>' +
      (KIOSK ? '' : skipLinksHTML('menu') + kbnHTML()) +
      (KIOSK ? kioskTopbarHTML() : topbarHTML() + appbarHTML()) +
      '<div class="page">' +
        '<div class="page__main">' + (KIOSK ? '' : storeHTML()) + chipsHTML() +
          '<main class="menu" id="menu" tabindex="-1"><h1 class="sr-only">' + STORE.name + '・菜單</h1>' + sectionsHTML() + '</main>' +
          (KIOSK ? '' : footerHTML()) + '</div>' +
        orderPanelHTML() +
      '</div>' +
      (KIOSK ? '' : cartbarHTML() + bottomTabHTML()) +
      (state.sheet ? sheetHTML() : '') + (state.cartOpen ? cartSheetHTML() : '') + dialogHTML() +
      '</div>';
  }

  /* ---- 結帳：送出時最終確認庫存與時段（FR-CK-15、FR-CK-16；CMP-40 AvailabilityIssueList） ----
     issues=0 無異動；bg = 背景偵測（只更新狀態列、明細行與送出鈕，清單不展開）；
     1 = 送出被退回（清單展開）；done = 已處理完成（摘要含復原、價格差異仍列）。
     原型沒有後端：異動內容為固定示範資料，按鈕可操作並更新狀態。 */
  const pname = (l) => { const p = byId(l.pid); return p ? p.name : l.pid; };
  function ckModel() {
    const items = [];
    const diffs = [];
    if (CK_ON) {
      state.cart.forEach((l) => { if (SOLD_OUT_TODAY.includes(l.pid)) items.push({ type: 'soldout', line: l }); });
      Object.keys(STOCK_LEFT).forEach((pid) => {
        const ls = state.cart.filter((l) => l.pid === pid);
        const have = ls.reduce((a, l) => a + l.qty, 0);
        if (have > STOCK_LEFT[pid]) items.push({ type: 'limited', line: ls[ls.length - 1], have: have, left: STOCK_LEFT[pid] });
      });
      if (state.cx.when === 'later') {
        if (!state.cx.slot) items.push({ type: 'slotempty' });
        else if (SLOT_FULL.includes(state.cx.slot)) items.push({ type: 'slot', slot: state.cx.slot });
      }
      state.cart.forEach((l) => { if (l.was != null && l.was !== l.unit) diffs.push({ line: l }); });
    }
    return { items: items, diffs: diffs, blocking: items.length };
  }
  /* 摘要依類別排序：移除 → 改為 n 份 → 時段 */
  const ckLogText = () => {
    const cat = (t) => (/^移除/.test(t) ? 1 : /^時段改為/.test(t) ? 3 : 2);
    return state.ck.log.map((t, i) => ({ t: t, c: cat(t), i: i })).sort((a, b) => a.c - b.c || a.i - b.i).map((x) => x.t).join('、');
  };
  const ckAck = () => state.ck.expanded || state.ck.log.length > 0; /* 價格差異是否已展示給使用者 */
  /* 顧客原本在畫面上看到的總額（價格更新前）；僅總額增加時需要兩步確認，降價或不變可一鍵送出（BR-25） */
  const ckOldTotal = () => state.cart.reduce((s, l) => s + (l.was != null ? l.was : l.unit) * l.qty, 0) + feeAmount();
  const ckPriceUp = () => CK_ON && ckModel().diffs.length > 0 && total() > ckOldTotal();
  const ckSnap = () => ({ cart: clone(state.cart), when: state.cx.when, slot: state.cx.slot, log: state.ck.log.slice() });
  function ckRestore(s) {
    state.cart = clone(s.cart);
    state.cx.when = s.when;
    state.cx.slot = s.slot;
    state.ck.log = s.log.slice();
  }
  function ckSuggestText(m) {
    const rm = m.items.filter((i) => i.type === 'soldout').length;
    const ql = m.items.filter((i) => i.type === 'limited');
    const parts = [];
    if (rm) parts.push('移除 ' + rm + ' 項');
    if (ql.length) parts.push(ql.length + ' 項改為 ' + (ql.length === 1 ? ql[0].left + ' 份' : '可購買份數'));
    if (m.items.some((i) => i.type === 'slot' || i.type === 'slotempty')) parts.push('時段改為 ' + SLOT_SUGGEST);
    return parts.join('、');
  }

  /* 每項異動的圖示、原因與就地動作（名稱含品名，目標 ≥ 44） */
  function ckItemView(it) {
    if (it.type === 'soldout') {
      const nm = pname(it.line);
      return { tone: 'danger', icon: 'close', name: nm, sub: it.line.opt, why: '今日售完',
        acts: [{ a: 'ck-rm', id: it.line.id, key: 'ck-rm:' + it.line.id, text: '移除', label: '移除' + nm, icon: 'trash', danger: true }] };
    }
    if (it.type === 'limited') {
      const nm = pname(it.line);
      return { tone: 'warning', icon: 'alert', name: nm, sub: '', why: '今日只剩 ' + it.left + ' 份（已選 ' + it.have + ' 份）',
        acts: [
          { a: 'ck-qty', id: it.line.id, key: 'ck-qty:' + it.line.id, text: '改為 ' + it.left + ' 份', label: '將' + nm + '改為 ' + it.left + ' 份' },
          { a: 'ck-rm', id: it.line.id, key: 'ck-rm:' + it.line.id, text: '移除', label: '移除' + nm, icon: 'trash', danger: true },
        ] };
    }
    if (it.type === 'slot') {
      return { tone: 'warning', icon: 'clock', name: '取餐時段 ' + it.slot, sub: '', why: '這個時段已額滿',
        acts: [
          { a: 'ck-slot', id: SLOT_SUGGEST, key: 'ck-slot', text: '改選 ' + SLOT_SUGGEST, label: '取餐時段改選 ' + SLOT_SUGGEST },
          { a: 'ck-slot-other', id: '', key: 'ck-slot-other', text: '選其他時段', label: '選其他時段（取餐時間）' },
        ] };
    }
    return { tone: 'warning', icon: 'clock', name: '取餐時段', sub: '', why: '請重新選擇時段',
      acts: [{ a: 'ck-slot', id: SLOT_SUGGEST, key: 'ck-slot', text: '改選 ' + SLOT_SUGGEST, label: '取餐時段改選 ' + SLOT_SUGGEST }] };
  }
  const ckBtn = (b, cls) => '<button type="button" class="btn btn--neutral issue__btn' + (b.danger ? ' issue__btn--danger' : '') + (cls || '') + '" data-action="' + b.a + '"' +
    (b.id ? ' data-id="' + b.id + '"' : '') + ' data-key="' + b.key + '" aria-label="' + esc(b.label) + '">' + (b.icon ? ICON(b.icon, 16) : '') + esc(b.text) + '</button>';

  function ckStatusHTML(m) {
    let cls;
    let icon;
    let text;
    let btn = '';
    if (state.ck.phase === 'checking') { cls = 'is-checking'; icon = '<span class="spin" aria-hidden="true"></span>'; text = '正在確認餐點與時段…'; }
    else if (m.blocking > 0) {
      cls = 'is-issue'; icon = ICON('alert', 18); text = '有 ' + m.blocking + ' 項需要調整';
      btn = '<button type="button" class="cxstatus__btn" data-action="ck-view" data-key="ck-view">查看</button>';
    } else if (CK_ON && m.diffs.length > 0) {
      /* 僅價格更新（n = 0）：「有 {k} 項價格更新」，k = 價格更新項數（m.diffs，與清單 / 摘要內的價格列數一致），不計入 n，不顯示「有 0 項」 */
      cls = 'is-issue'; icon = ICON('arrowUp', 18); text = '有 ' + m.diffs.length + ' 項價格更新';
      btn = '<button type="button" class="cxstatus__btn" data-action="ck-view" data-key="ck-view">查看</button>';
    } else { cls = 'is-ok'; icon = ICON('check', 18); text = '餐點與時段可供應'; }
    return '<div class="cxstatus ' + cls + '" id="cx-status" role="status">' + icon + '<span class="cxstatus__text">' + text + '</span>' + btn + '</div>';
  }

  function ckIssuesHTML(m) {
    const items = m.items.map((it) => {
      const v = ckItemView(it);
      return '<li class="issue issue--' + v.tone + '"><span class="issue__icon" aria-hidden="true">' + ICON(v.icon, 18) + '</span>' +
        '<div class="issue__body"><p class="issue__name">' + esc(v.name) + (v.sub ? '<small>' + esc(v.sub) + '</small>' : '') + '</p>' +
        '<p class="issue__why">' + esc(v.why) + '</p>' +
        '<div class="issue__acts">' + v.acts.map((b) => ckBtn(b)).join('') + '</div></div></li>';
    }).join('');
    const diffs = m.diffs.map((d) =>
      '<li class="issue issue--price"><span class="issue__icon" aria-hidden="true">' + ICON('arrowUp', 18) + '</span>' +
      '<div class="issue__body"><p class="issue__name">' + esc(pname(d.line)) + '</p>' +
      '<p class="issue__why">價格已更新：' + money(d.line.was) + ' → ' + money(d.line.unit) + '<small>不計入「還有 n 項」，請確認新價格後送出</small></p></div></li>').join('');
    /* 聚焦標題時以 aria-describedby 指向視覺隱藏的摘要節點（說明句 + 各項原因，不重複標題的計數），朗讀一次；不另用 role="alert" */
    const sum = (state.ck.rejected ? '訂單尚未送出，資料都還在。' : '部分餐點狀態有變動，調整後即可送出。') +
      m.items.map((it) => { const v = ckItemView(it); return v.name + v.why; }).join('；');
    return '<section class="cxissues" id="cx-issues" aria-labelledby="cx-issues-title" aria-describedby="cx-issues-sum">' +
      '<h2 class="cxissues__title" id="cx-issues-title" tabindex="-1">有 ' + m.blocking + ' 項餐點需要調整</h2>' +
      '<p class="cxissues__desc" id="cx-issues-desc">' + (state.ck.rejected ? '訂單尚未送出，已填寫的資料都還在。' : '部分餐點狀態有變動，調整後即可送出。') + '</p>' +
      '<p class="sr-only" id="cx-issues-sum">' + esc(sum) + '</p>' +
      '<div class="cxissues__all"><button type="button" class="btn btn--secondary issue__btn" data-action="ck-apply" data-key="ck-apply">全部套用建議</button>' +
      '<span class="cxissues__sum">' + esc(ckSuggestText(m)) + '</span></div>' +
      '<ul class="cxissues__list">' + items + diffs + '</ul></section>';
  }

  function ckSummaryHTML(m) {
    const diffs = m.diffs.map((d) =>
      '<li class="issue issue--price"><span class="issue__icon" aria-hidden="true">' + ICON('arrowUp', 18) + '</span>' +
      '<div class="issue__body"><p class="issue__name">' + esc(pname(d.line)) + '</p>' +
      '<p class="issue__why">價格已更新：' + money(d.line.was) + ' → ' + money(d.line.unit) + '</p></div></li>').join('');
    if (!state.ck.log.length) {
      return '<section class="cxissues cxissues--price" aria-labelledby="cx-sum-title">' +
        '<h2 class="cxissues__title" id="cx-sum-title" tabindex="-1">價格已更新，請確認</h2><ul class="cxissues__list">' + diffs + '</ul></section>';
    }
    return '<section class="cxsummary" aria-labelledby="cx-sum-title">' +
      '<div class="cxsummary__row"><span class="cxsummary__icon" aria-hidden="true">' + ICON('check', 18) + '</span>' +
      '<h2 class="cxsummary__title" id="cx-sum-title" tabindex="-1">已調整：' + esc(ckLogText()) + '</h2>' +
      '<button type="button" class="cxsummary__undo" data-action="ck-undo-all" data-key="ck-undo-all">復原</button></div>' +
      (diffs ? '<ul class="cxissues__list">' + diffs + '</ul>' : '') + '</section>';
  }

  /* 訂單明細行：依異動標示（CMP-17 invalid / limited / reduced 與價格更新）；就地動作僅 ≥ 1024 顯示，與清單共用同一份狀態 */
  function ckLineHTML(l, m) {
    let flag = null;
    const soldout = m.items.find((i) => i.type === 'soldout' && i.line === l);
    const lim = m.items.find((i) => i.type === 'limited' && i.line === l);
    if (soldout) flag = { tone: 'danger', icon: 'close', text: '今日售完', acts: [{ a: 'ck-rm', id: l.id, key: 'ln-rm:' + l.id, text: '移除', label: '移除' + pname(l), icon: 'trash', danger: true }] };
    else if (lim) flag = { tone: 'warning', icon: 'alert', text: '今日只剩 ' + lim.left + ' 份', tail: '（已選 ' + lim.have + ' 份）', acts: [
      { a: 'ck-qty', id: l.id, key: 'ln-qty:' + l.id, text: '改為 ' + lim.left + ' 份', label: '將' + pname(l) + '改為 ' + lim.left + ' 份' },
      { a: 'ck-rm', id: l.id, key: 'ln-rm:' + l.id, text: '移除', label: '移除' + pname(l), icon: 'trash', danger: true }] };
    else if (l.reducedFrom) flag = { tone: 'info', icon: 'check', text: '已調整為 ' + l.qty + ' 份（原 ' + l.reducedFrom + ' 份）', acts: [] };
    else if (l.was != null && l.was !== l.unit) flag = { tone: 'warning', icon: 'arrowUp', text: '價格已更新：' + money(l.was) + ' → ' + money(l.unit), acts: [] };
    /* 狀態槽：預留高度（min-height，無狀態時空白佔位），狀態出現 / 消失、動作鈕消失都不推擠下方的小計與送出鈕（R-J / M19） */
    const slot = '<span class="cxline__slot' + (flag ? '' : ' is-empty') + '">' + (flag
      ? '<span class="cxline__flag"><span class="cxline__fi" aria-hidden="true">' + ICON(flag.icon, 14) + '</span>' +
        '<span class="cxline__ft">' + esc(flag.text) + (flag.tail ? '<span class="nw">' + esc(flag.tail) + '</span>' : '') + '</span></span>' +
        (flag.acts.length ? '<span class="cxline__acts">' + flag.acts.map((b) => ckBtn(b, ' btn--sm')).join('') + '</span>' : '')
      : '') + '</span>';
    return '<li class="cxline' + (flag ? ' cxline--' + flag.tone : '') + '" data-line="' + l.id + '">' +
      '<span class="cxline__name"><span class="tnum">' + l.qty + '×</span> ' + esc(pname(l)) +
      (l.opt ? ' <small>' + esc(l.opt) + (l.note ? '・' + esc(l.note) : '') + '</small>' : '') + '</span>' +
      '<span class="price tnum">' + money(l.unit * l.qty) + '</span>' + slot + '</li>';
  }

  function ckSlotsHTML() {
    const X = state.cx;
    return '<div class="slots" role="group" aria-label="預約時段（今天）">' + SLOTS.map((t) => {
      if (SLOT_FULL.includes(t)) {
        return '<button type="button" class="slot is-full" aria-disabled="true" data-action="noop" data-key="slot:' + t + '"><span>' + t + '</span><small>已額滿</small></button>';
      }
      return '<button type="button" class="slot' + (X.slot === t ? ' is-selected' : '') + '" aria-pressed="' + (X.slot === t) + '" data-action="slot" data-id="' + t + '" data-key="slot:' + t + '"><span>' + t + '</span></button>';
    }).join('') + '</div>';
  }

  function ckSubmitHTML(m) {
    const locked = CK_ON && m.blocking > 0;
    const confirmPrice = CK_ON && !locked && m.diffs.length > 0 && ckPriceUp() && ckAck();
    const label = (confirmPrice ? '確認新價格並送出 · ' : '送出訂單 · ') + money(total());
    const note = CK_ON ? '<p class="submitnote" id="submit-note">' + (locked ? '還有 ' + m.blocking + ' 項需要處理' : '') + '</p>' : '';
    const aks = FINE_POINTER && !KIOSK ? ' aria-keyshortcuts="Control+Enter Meta+Enter"' : '';
    return '<div class="fixedbar"><div class="fixedbar__inner">' + note +
      '<div class="submitrow"><button type="button" class="btn btn--primary btn--lg" data-action="submit" data-key="submit-order"' +
      (locked ? ' aria-disabled="true" aria-describedby="submit-note"' : '') + aks + '>' + label + '</button>' +
      (KIOSK ? '' : '<span class="submitkey" aria-hidden="true">Ctrl/⌘ + Enter</span>') + '</div></div></div>';
  }

  function checkoutScreen() {
    const X = state.cx;
    const n = state.cart.length;
    const m = ckModel();
    const fulfilAside = {
      pickup: STORE.address,
      delivery: '外送費 ' + money(DELIVERY_FEE),
      dinein: '請告知取餐號碼',
    }[state.fulfil];
    const radio = (name, value, checked, label, sub) =>
      '<label class="radiocard' + (checked ? ' is-checked' : '') + '"><input type="radio" name="' + name + '" value="' + value + '" data-cx="' + name + '" data-key="cx:' + name + ':' + value + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="radiocard__mark"></span><span class="radiocard__check">' + ICON('check', 16) + '</span>' +
      '<span class="radiocard__text">' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span></label>';
    const check = (key, checked, label, sub) =>
      '<label class="check"><input type="checkbox" data-cx-check="' + key + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="check__box">' + ICON('check', 14) + '</span><span class="check__text">' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span></label>';
    const back = '<a class="iconbtn" href="' + hrefTo('menu') + '" aria-label="返回菜單"' + AKS('b') + ' data-key="back">' + ICON('chevL', 24) + '</a>' + KH('b');
    const top = '<div class="app pagewrap" data-screen="checkout">' + skipLinksHTML('task') +
      '<header class="appbar appbar--page">' + back + '<h1 class="appbar__title" tabindex="-1">結帳</h1>' + taskHelpHTML() + '</header>';
    const foot = KIOSK ? '' : footerHTML('task');

    if (!n) {
      return top + '<main class="cx" id="menu" tabindex="-1">' + emptyCartHTML() +
        '<a class="btn btn--primary btn--lg btn--block" href="' + hrefTo('menu') + '">回到菜單</a></main>' + foot + dialogHTML() + '</div>';
    }

    const showList = CK_ON && m.blocking > 0 && state.ck.expanded;
    const showSum = CK_ON && m.blocking === 0 && (state.ck.log.length > 0 || (m.diffs.length > 0 && state.ck.expanded));
    const limitedInCart = state.cart.some((l) => { const f = FULL.find((p) => p.id === l.pid); return !!(f && f.tags.includes('limited')); });

    const left =
      '<main class="cx" id="menu" tabindex="-1">' +
        ckStatusHTML(m) +
        (X.hint && !KIOSK
          ? '<div class="hint">' + ICON('info', 18) + '<span>已有帳號？<a href="#login" data-action="login">登入</a>以快速帶入 · 可略過</span>' +
            '<button type="button" class="iconbtn hint__skip" style="margin:-8px -8px -8px auto;color:var(--color-text-muted)" data-action="hide-hint" data-key="hide-hint" aria-label="略過提示">' + ICON('close', 18) + '</button></div>'
          : '') +
        (showList ? ckIssuesHTML(m) : '') + (showSum ? ckSummaryHTML(m) : '') +
        '<section class="cxcard"><h2 class="cxcard__title"><span class="step">1</span>取餐方式<span class="aside">' + fulfilAside + '</span></h2>' +
          segmentedHTML('segmented--lg') +
          '<div class="cxcard__divider" role="presentation"></div>' +
          '<h2 class="cxcard__title"><span class="step">2</span>取餐時間</h2>' +
          '<div class="radiocards radiocards--cols2">' +
            radio('when', 'asap', X.when === 'asap', '盡快', '預計 15–20 分鐘') +
            radio('when', 'later', X.when === 'later', '預約', X.slot ? '今天 ' + X.slot : '選擇日期與時段') +
          '</div>' + (X.when === 'later' ? ckSlotsHTML() : '') + '</section>' +
        '<section class="cxcard"><h2 class="cxcard__title"><span class="step">3</span>聯絡資訊</h2>' +
          '<div class="fieldrow">' +
            '<label class="field"><span class="field__label">姓名</span><input class="input" type="text" placeholder="王小明" autocomplete="name"></label>' +
            '<label class="field"><span class="field__label">手機</span><input class="input" type="tel" inputmode="tel" placeholder="0912 345 678" autocomplete="tel"></label>' +
          '</div>' +
          (KIOSK ? '' : check('remember', X.remember, '記住我的資料（僅存於此裝置）')) +
        '</section>' +
        '<section class="cxcard"><h2 class="cxcard__title"><span class="step">4</span>付款方式</h2>' +
          (KIOSK
            ? '<div class="radiocards">' + radio('pay', 'cash', true, '現金（櫃檯付款）', '取餐時於櫃檯付款') + '</div>'
            : '<div class="radiocards radiocards--cols3">' +
                radio('pay', 'cash', X.pay === 'cash', '現金', '取餐時付款') +
                radio('pay', 'linepay', X.pay === 'linepay', 'LINE Pay', '行動支付') +
                radio('pay', 'card', X.pay === 'card', '信用卡', '線上刷卡') +
              '</div>') +
        '</section>' +
        '<section class="cxcard cxcard--row"><div class="invoice"><span class="step">5</span><span class="invoice__label">發票</span>' +
          '<span class="invoice__value">隨餐附紙本</span>' +
          '<button type="button" class="btn btn--neutral btn--sm" aria-expanded="false">其他方式' + ICON('chevD', 16) + '</button></div></section>' +
        '<section class="cxcard"><div class="cxcard__titlerow"><h2 class="cxcard__title"><span class="step">6</span>備註與餐具</h2>' +
          check('utensils', X.utensils, '需要餐具') + '</div>' +
          '<label class="field"><span class="sr-only">給店家的備註</span><input class="input" type="text" placeholder="給店家的備註，例如：不要香菜"></label>' +
        '</section>' +
      '</main>';

    const side =
      '<aside class="cxside' + (CK_ON ? ' cxside--ck' : '') + '" aria-label="訂單明細與送出">' +
        '<section class="cxcard cxcard--sum"><h2 class="cxcard__title"><span class="step">7</span>訂單明細<span class="aside">' + n + ' 項</span></h2>' +
          '<ul class="cxlines">' + state.cart.map((l) => ckLineHTML(l, m)).join('') + '</ul>' + totalsHTML() +
          (limitedInCart ? '<p class="cxcard__caption">' + ICON('info', 16) + '<span>限量餐點於送出訂單後才會保留</span></p>' : '') +
        '</section>' +
        ckSubmitHTML(m) +
      '</aside>';

    return top + '<div class="cxwrap">' + left + side + '</div>' + foot + dialogHTML() + '</div>';
  }

  /* 結帳互動：改為 n 份、移除（Toast 復原 6 秒）、改選時段、全部套用建議、復原 */
  function ckFocusTitle(opts) {
    const h = $('#cx-issues-title') || $('#cx-sum-title');
    if (!h) return false;
    h.focus({ preventScroll: true });
    if (!opts || opts.scroll !== false) h.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
    return true;
  }
  function ckFocusNext() {
    const b = root.querySelector('.cxissues .issue__acts button');
    if (b) { b.focus({ preventScroll: true }); return; }
    const t = $('#cx-sum-title');
    if (t) { t.focus({ preventScroll: true }); return; }
    const sub = $('[data-key="submit-order"]');
    if (sub) sub.focus({ preventScroll: true });
  }
  const ckBegin = () => { if (!state.ck.base) state.ck.base = ckSnap(); };
  const ckLeft = () => ckModel().blocking;
  const ckAfterMsg = (head) => head + '，金額 ' + money(total()) + (ckLeft() ? '，還有 ' + ckLeft() + ' 項需要處理' : '，可以送出了');

  function ckRemove(lineId) {
    const i = state.cart.findIndex((l) => l.id === lineId);
    if (i < 0) return;
    const nm = pname(state.cart[i]);
    const snap = ckSnap();
    ckBegin();
    state.cart.splice(i, 1);
    state.ck.log.push('移除' + nm);
    state.ck.ver += 1;
    const v = state.ck.ver;
    render();
    ckFocusNext();
    say('已移除：' + nm + (ckLeft() ? '，還有 ' + ckLeft() + ' 項需要處理' : '，可以送出了'), () => {
      if (state.ck.ver !== v) { announce('無法復原：結帳內容已有其他變更'); return; }
      ckRestore(snap);
      state.ck.ver += 1;
      render();
      announce('已復原：' + nm);
    });
  }
  function ckSetQty(lineId) {
    const m = ckModel();
    const it = m.items.find((x) => x.type === 'limited' && x.line.id === lineId);
    const l = state.cart.find((x) => x.id === lineId);
    if (!it || !l) return;
    ckBegin();
    l.reducedFrom = l.qty;
    l.qty = it.left;
    state.ck.log.push(pname(l) + '改為 ' + it.left + ' 份');
    state.ck.ver += 1;
    render();
    ckFocusNext();
    announce(ckAfterMsg(pname(l) + '已改為 ' + it.left + ' 份'));
  }
  function ckSetSlot(t) {
    ckBegin();
    state.cx.slot = t;
    state.ck.log.push('時段改為 ' + t);
    state.ck.ver += 1;
    render();
    ckFocusNext();
    announce('取餐時段已改為 ' + t + (ckLeft() ? '，還有 ' + ckLeft() + ' 項需要處理' : '，可以送出了'));
  }
  function ckOtherSlot() {
    state.cx.slot = null;
    state.ck.ver += 1;
    render();
    const first = root.querySelector('.slot:not(.is-full)');
    if (first) { first.focus({ preventScroll: true }); first.scrollIntoView({ block: 'center' }); }
    announce('請選擇取餐時段，還有 ' + ckLeft() + ' 項需要處理');
  }
  function ckApplyCore() {
    const m = ckModel();
    if (!m.blocking) return 0;
    ckBegin();
    const parts = [];
    m.items.forEach((it) => {
      if (it.type === 'soldout') {
        const i = state.cart.indexOf(it.line);
        if (i >= 0) state.cart.splice(i, 1);
        parts.push('移除' + pname(it.line));
      }
    });
    m.items.forEach((it) => {
      if (it.type === 'limited') {
        it.line.reducedFrom = it.line.qty;
        it.line.qty = it.left;
        parts.push(pname(it.line) + '改為 ' + it.left + ' 份');
      }
    });
    m.items.forEach((it) => {
      if (it.type === 'slot' || it.type === 'slotempty') { state.cx.slot = SLOT_SUGGEST; parts.push('時段改為 ' + SLOT_SUGGEST); }
    });
    state.ck.log = state.ck.log.concat(parts);
    state.ck.ver += 1;
    return parts.length;
  }
  function ckApplyAll() {
    const k = ckApplyCore();
    if (!k) return;
    state.ck.rejected = false;
    render();
    ckFocusTitle({ scroll: false });
    announce('已調整 ' + k + ' 項，可以送出了');
  }
  function ckUndoAll() {
    if (!state.ck.base) return;
    ckRestore(state.ck.base);
    state.ck.base = null;
    state.ck.log = [];
    state.ck.expanded = true;
    state.ck.ver += 1;
    render();
    ckFocusTitle({ scroll: false });
    announce('已復原，還有 ' + ckLeft() + ' 項需要處理');
  }
  function ckView() {
    state.ck.expanded = true;
    render();
    ckFocusTitle();
  }
  /* 送出（鎖定時不送出：展開清單並聚焦標題；價格差異需先展示再送出） */
  function ckTrySubmit() {
    const m = ckModel();
    if (CK_ON && m.blocking > 0) {
      state.ck.expanded = true;
      render();
      ckFocusTitle();
      announce('還有 ' + m.blocking + ' 項需要處理');
      return false;
    }
    if (ckPriceUp() && !ckAck()) {
      state.ck.expanded = true;
      render();
      ckFocusTitle();
      announce('總額由 ' + money(ckOldTotal()) + ' 變為 ' + money(total()) + '，確認後再按一次送出');
      return false;
    }
    if (KIOSK) navigate('done', { mode: 'kiosk' }); else navigate('tracking');
    return true;
  }

  function trackingScreen() {
    const steps = [
      { cls: 'is-done', label: '訂單已送出', time: '12:20', dot: ICON('check', 14) },
      { cls: 'is-current', label: '製作中', time: '12:21', dot: '' },
      { cls: '', label: '可取餐', time: '預計 12:35', dot: '' },
      { cls: '', label: '已取餐', time: '', dot: '' },
    ];
    const lines = state.cart.length ? state.cart : clone(DEFAULT_CART);
    const sum = lines.reduce((s, l) => s + l.unit * l.qty, 0);
    return '<div class="app pagewrap" data-screen="tracking">' + skipLinksHTML('task') + kbnHTML() +
      '<header class="appbar appbar--page"><a class="iconbtn" href="' + hrefTo('menu') + '" aria-label="返回菜單" data-key="back">' + ICON('chevL', 24) + '</a><h1 class="appbar__title" tabindex="-1">訂單追蹤</h1>' + taskHelpHTML() + '</header>' +
      '<main class="tr" id="menu" tabindex="-1">' +
        '<section class="statuscard">' +
          '<p class="statuscard__label">取餐號碼</p>' +
          '<p class="pickno"><span aria-hidden="true">A027</span><span class="sr-only">A 0 2 7</span></p>' +
          '<div class="statusrow"><p class="statusline"><span class="dot"></span>製作中・預計 12:35 可取餐</p>' +
            '<button type="button" class="btn btn--ghost btn--sm statusrow__refresh" data-action="refresh" data-key="refresh"' + AKS('u') + '>' + ICON('repeat', 16) + '立即更新' + KH('u') + '</button></div>' +
          '<p class="statuscard__order">訂單編號 <b>ZO261014K7M3QX</b></p>' +
        '</section>' +
        '<section class="trcard"><h2 class="trcard__title">訂單進度</h2><ol class="timeline">' +
          steps.map((s) => '<li class="tl ' + s.cls + '"' + (s.cls === 'is-current' ? ' aria-current="step"' : '') + '><span class="tl__dot">' + s.dot + '</span>' +
            '<span class="tl__text"><span class="tl__label">' + s.label + '</span>' + (s.time ? '<span class="tl__time">' + s.time + '</span>' : '') + '</span></li>').join('') +
        '</ol></section>' +
        '<section class="trcard"><h2 class="trcard__title">取餐資訊</h2><div class="infolist">' +
          '<div class="infolist__row">' + ICON('receipt', 16) + '<span>自取・<b>' + STORE.name + '</b></span></div>' +
          '<div class="infolist__row">' + ICON('pin', 16) + '<span>' + STORE.address + '</span></div>' +
          '<div class="infolist__row">' + ICON('phone', 16) + '<span>' + STORE.phone + '</span></div>' +
        '</div></section>' +
        '<details class="trcard trdetails"><summary>訂單明細<span class="sum">' + lines.length + ' 項・' + money(sum) + '</span>' + ICON('chevD', 18) + '</summary>' +
          '<div class="trdetails__body"><ul class="cxlines">' + lines.map((l) => {
            const p = byId(l.pid);
            return '<li class="cxline"><span class="cxline__name"><span class="tnum">' + l.qty + '×</span> ' + esc(p ? p.name : l.pid) +
              (l.opt ? ' <small>' + esc(l.opt) + (l.note ? '・' + esc(l.note) : '') + '</small>' : '') + '</span>' +
              '<span class="price tnum">' + money(l.unit * l.qty) + '</span></li>';
          }).join('') + '</ul>' +
          '<dl class="totals"><div><dt>小計</dt><dd>' + money(sum) + '</dd></div><div class="is-none"><dt>運費</dt><dd>—</dd></div>' +
          '<div class="is-none"><dt>折扣</dt><dd>—</dd></div><div class="totals__total"><dt>總計</dt><dd>' + money(sum) + '</dd></div></dl></div></details>' +
        '<div class="actions">' +
          '<a class="btn btn--neutral" href="tel:' + STORE.phone.replace(/-/g, '') + '">' + ICON('phone', 18) + '致電店家</a>' +
          '<a class="btn btn--primary" href="' + hrefTo('menu') + '" data-key="again-order"' + AKS('a') + '>' + ICON('repeat', 18) + '再來一單' + KH('a', true) + '</a>' +
        '</div>' +
        '<aside class="softcard" aria-label="選填：建立會員">' +
          '<div class="softcard__text"><b>想保存這筆訂單？</b>以手機建立會員（可略過）<br><a class="link" href="#member" data-action="login">建立會員</a></div>' +
          '<button type="button" class="iconbtn" aria-label="略過並關閉">' + ICON('close', 20) + '</button>' +
        '</aside>' +
      '</main>' + (KIOSK ? '' : footerHTML('task')) + dialogHTML() + '</div>';
  }

  /* 觸控面板完成畫面：取餐號碼超大字、櫃檯付款說明、30 秒倒數、「開始新訂單」與「再看一下」 */
  function doneScreen() {
    return '<div class="app kiosk-done" data-screen="done"><main class="done" id="menu">' +
      '<h1 class="done__label">取餐號碼</h1>' +
      '<p class="done__no tnum"><span aria-hidden="true">A027</span><span class="sr-only">A 0 2 7</span></p>' +
      '<p class="done__msg">請至櫃檯付款並等候叫號</p>' +
      '<p class="done__count"><span id="done-count" class="tnum">30</span> 秒後自動回到首頁</p>' +
      '<div class="done__btns">' +
        '<a class="btn btn--primary btn--xl" href="' + hrefTo('menu', { mode: 'kiosk' }) + '" data-key="done-new">開始新訂單</a>' +
        '<button type="button" class="btn btn--neutral btn--xl" data-action="done-stay" data-key="done-stay">再看一下</button>' +
      '</div>' +
      '</main></div>';
  }

  const BRAND_META = [
    { key: 'red', name: '辣椒紅', brand: '#D93A22', c1: 4.59, c2: 4.88, l1: '白字/主色' },
    { key: 'green', name: '抹茶綠', brand: '#2E7D4F', c1: 5.05, c2: 4.56, l1: '白字/主色' },
    { key: 'coffee', name: '咖啡棕', brand: '#7A4B2A', c1: 7.32, c2: 6.51, l1: '白字/主色' },
    { key: 'orange', name: '活力橘', brand: '#BA520A', c1: 4.88, c2: 4.75, l1: '白字/主色' },
    { key: 'blue', name: '海洋藍', brand: '#1F5FBF', c1: 6.09, c2: 5.42, l1: '白字/主色' },
    { key: 'black', name: '極簡黑', brand: '#18181B', c1: 17.72, c2: 15.13, l1: '白字/主色' },
    { key: 'yellow', name: '檸檬黃', brand: '#FACC15', c1: 11.57, c2: 4.6, l1: '深字/主色' },
  ];

  function themesScreen() {
    const card = (b) =>
      '<article class="tcard" data-brand="' + b.key + '" aria-label="' + b.name + '">' +
        '<div class="tcard__head"><span class="tcard__swatch" aria-hidden="true"></span>' +
          '<div><div class="tcard__name">' + b.name + '</div><div class="tcard__hex">' + b.key + ' · ' + b.brand + '</div></div>' +
          '<div class="tcard__ratios"><span>' + b.l1 + ' <b>' + b.c1.toFixed(2) + '</b></span><span>文字/淺底 <b>' + b.c2.toFixed(2) + '</b></span></div></div>' +
        '<div class="tcard__btns"><span class="btn btn--primary">主要按鈕</span><span class="btn btn--secondary">次要按鈕</span></div>' +
        '<div class="tcard__chips"><span class="chip is-selected">選取中</span><span class="chip">未選取</span></div>' +
        '<div class="tcard__mini"><div class="tcard__minihead"><div class="pmedia pmedia--photo" aria-hidden="true"><span class="pmedia__glyph">🍱</span></div>' +
          '<div><div class="name">古早味排骨飯</div><span class="price tnum">$110</span></div></div>' +
          '<div class="tcard__minirow"><span class="act"><span class="btn-add">' + ICON('plus', 14) + '<span>加入</span></span></span>' +
          '<span class="act"><span class="stepper"><span class="stepper__btn stepper__btn--minus">' + ICON('minus', 14) + '</span><output class="stepper__count">2</output>' +
          '<span class="stepper__btn stepper__btn--plus">' + ICON('plus', 14) + '</span></span></span></div></div>' +
        '<div class="tcard__foot"><span class="link link--static">查看菜單' + ICON('chevR', 16) + '</span><span class="tag tag--hot">熱銷</span></div>' +
      '</article>';
    const legend =
      '<article class="tcard legend"><h2>對比度規則</h2><ul>' +
        '<li>文字 ≥ 4.5:1；元件邊框 ≥ 3:1</li>' +
        '<li>主要按鈕：<code>on-brand</code> 壓在 <code>brand</code></li>' +
        '<li>連結與選取字：<code>brand-text</code></li>' +
        '<li>危險／錯誤：<code>danger</code>，不用品牌色</li>' +
        '<li><code>brand-soft-strong</code> 不放小字</li>' +
        '<li>檸檬黃：主色上改用深色字</li>' +
      '</ul><p class="legend__note">代幣前綴皆為 <code>--color-</code></p></article>';
    return '<div class="app themes" data-screen="themes">' +
      '<div class="themes__head"><h1 class="themes__title">主題色一覽</h1>' +
      '<p class="themes__sub">單一品牌色．七組可換（?brand=）．數值為 WCAG 對比度</p></div>' +
      '<div class="themes__grid">' + BRAND_META.map(card).join('') + legend + '</div></div>';
  }

  function view() {
    switch (P.screen) {
      case 'checkout': return checkoutScreen();
      case 'tracking': return trackingScreen();
      case 'themes': return themesScreen();
      case 'done': return doneScreen();
      default: return menuScreen(); /* menu、sheet、shortcuts、idle */
    }
  }

  /* ------------------------------------------------------------------ 8. 渲染與焦點 */
  const $ = (sel) => root.querySelector(sel);
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const focusablesIn = (c) => Array.prototype.slice.call(c.querySelectorAll(FOCUSABLE)).filter(isVisible);
  const hasOverlay = () => !!(state.sheet || state.cartOpen || state.dialog);
  const topOverlay = () => { const all = root.querySelectorAll('[data-overlay]'); return all.length ? all[all.length - 1] : null; };

  function snapshot() {
    const a = document.activeElement;
    const sc = $('.chips__scroller');
    const sh = $('.sheet__scroll');
    const ol = $('.orderpanel__list');
    const ck = a && a.dataset && a.dataset.key ? a.dataset.key : null;
    return {
      winY: window.scrollY,
      chips: sc ? sc.scrollLeft : 0,
      sheet: sh ? sh.scrollTop : 0,
      list: ol ? ol.scrollTop : 0,
      key: ck,
      s: a && 'selectionStart' in a ? a.selectionStart : null,
      e: a && 'selectionEnd' in a ? a.selectionEnd : null,
    };
  }

  function focusKey(key, opts) {
    if (!key) return false;
    const el = root.querySelector('[data-key="' + key + '"]');
    if (el && !el.disabled) { el.focus(opts || { preventScroll: false }); return true; }
    return false;
  }

  function restore(k) {
    window.scrollTo(0, k.winY);
    const sc = $('.chips__scroller'); if (sc) sc.scrollLeft = k.chips;
    const sh = $('.sheet__scroll'); if (sh) sh.scrollTop = k.sheet;
    const ol = $('.orderpanel__list'); if (ol) ol.scrollTop = k.list;
    if (k.key) {
      const el = root.querySelector('[data-key="' + k.key + '"]');
      if (el && !el.disabled) {
        el.focus({ preventScroll: true });
        if (k.s != null && el.setSelectionRange) { try { el.setSelectionRange(k.s, k.e); } catch (err) { /* noop */ } }
      }
    }
  }

  /* 浮層開啟時焦點進入浮層：安全的預設按鈕（確認對話框＝取消、閒置警示＝繼續點餐）→ 標題 → 浮層本身 */
  function focusOverlay(ov) {
    const target = ov.querySelector('[data-autofocus]') || ov.querySelector('[tabindex="-1"]') || ov;
    if (!ov.hasAttribute('tabindex') && target === ov) ov.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }

  function render() {
    const keep = snapshot();
    root.innerHTML = view();
    html.classList.toggle('is-locked', hasOverlay());
    restore(keep);
    const ov = topOverlay();
    if (ov && !ov.contains(document.activeElement)) focusOverlay(ov);
    syncHints();
    kbnSync();
  }

  /* ------------------------------------------------------------------ 9. 行為 */
  let liveEl = null;
  let liveAssertEl = null;
  let toastEl = null;
  let toastMsg = null;
  let toastUndo = null;
  let toastTimer = null;
  let toastLeft = 0;
  let toastSince = 0;
  let toastOnUndo = null;

  function mountAux() {
    liveEl = document.createElement('div');
    liveEl.id = 'live'; liveEl.className = 'sr-only';
    liveEl.setAttribute('aria-live', 'polite'); liveEl.setAttribute('aria-atomic', 'true');
    liveAssertEl = document.createElement('div');
    liveAssertEl.id = 'live-assertive'; liveAssertEl.className = 'sr-only';
    liveAssertEl.setAttribute('aria-live', 'assertive'); liveAssertEl.setAttribute('aria-atomic', 'true');
    toastEl = document.createElement('div');
    toastEl.id = 'toast'; toastEl.className = 'toast'; toastEl.setAttribute('role', 'region'); toastEl.setAttribute('aria-label', '通知');
    toastMsg = document.createElement('span');
    toastMsg.className = 'toast__msg';
    toastUndo = document.createElement('button');
    toastUndo.type = 'button'; toastUndo.className = 'toast__undo'; toastUndo.textContent = '復原';
    toastEl.appendChild(toastMsg);
    toastEl.appendChild(toastUndo);
    document.body.appendChild(liveEl);
    document.body.appendChild(liveAssertEl);
    document.body.appendChild(toastEl);
    /* 含動作的 Toast：滑鼠移入或取得焦點時暫停計時，離開後以剩餘時間繼續 */
    const pause = () => { if (toastTimer && toastOnUndo) { clearTimeout(toastTimer); toastTimer = null; toastLeft = Math.max(1500, toastLeft - (Date.now() - toastSince)); } };
    const resume = () => { if (!toastTimer && toastEl.classList.contains('is-on')) startToastTimer(); };
    toastEl.addEventListener('mouseenter', pause);
    toastEl.addEventListener('focusin', pause);
    toastEl.addEventListener('mouseleave', resume);
    toastEl.addEventListener('focusout', (ev) => { if (!toastEl.contains(ev.relatedTarget)) resume(); });
    toastUndo.addEventListener('click', () => { const fn = toastOnUndo; hideToast(); if (fn) fn(); });
  }
  function announce(msg, assertive) {
    const el = assertive ? liveAssertEl : liveEl;
    if (!el) return;
    el.textContent = '';
    setTimeout(() => { el.textContent = msg; }, 30);
  }
  function startToastTimer() {
    clearTimeout(toastTimer);
    toastSince = Date.now();
    toastTimer = setTimeout(hideToast, toastLeft);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    toastTimer = null;
    toastOnUndo = null;
    if (toastEl) toastEl.classList.remove('is-on');
  }
  /* 含動作（復原）的 Toast 停留 6 秒；一般訊息 3.2 秒 */
  function toast(msg, onUndo) {
    if (!toastEl) return;
    kbnYield(); /* Toast 優先：鍵盤提醒讓位（同次載入不再出現） */
    toastMsg.textContent = msg;
    toastOnUndo = onUndo || null;
    toastEl.classList.toggle('has-undo', !!onUndo);
    toastEl.classList.add('is-on');
    toastLeft = onUndo ? 6000 : 3200;
    startToastTimer();
  }
  const say = (msg, onUndo) => { announce(msg); toast(msg, onUndo); };

  const currentKey = () => {
    const a = document.activeElement;
    if (!a || a === document.body || !root.contains(a)) return null;
    if (a.dataset && a.dataset.key) return a.dataset.key;
    const c = a.closest && a.closest('[data-key]');
    return c ? c.dataset.key : null;
  };
  const cardEl = (pid) => root.querySelector('.pcard[data-pid="' + pid + '"]');
  const focusedCard = () => {
    const a = document.activeElement;
    const c = a && a.closest ? a.closest('.pcard') : null;
    return c && c.dataset.pid ? byId(c.dataset.pid) : null;
  };
  const focusedLine = () => {
    const a = document.activeElement;
    const el = a && a.closest ? a.closest('.cartline') : null;
    return el && el.dataset.line ? state.cart.find((l) => l.id === el.dataset.line) : null;
  };

  function setActiveCard(pid) {
    if (KIOSK || state.activeCard === pid) return;
    state.activeCard = pid;
    root.querySelectorAll('.pcard').forEach((c) => {
      const on = c.dataset.pid === pid;
      c.setAttribute('tabindex', on ? '0' : '-1');
      c.querySelectorAll('[data-rov]').forEach((x) => x.setAttribute('tabindex', on ? '0' : '-1'));
    });
  }

  /* 浮層：開啟前記錄觸發點，關閉後還原焦點 */
  function pushReturn(key) { state.returnKeys.push(key || currentKey() || null); }
  function afterClose() {
    const key = state.returnKeys.pop();
    if (!(state.sheet || state.cartOpen || state.dialog)) html.classList.remove('is-locked');
    if (key) focusKey(key);
  }

  function openSheet(pid, lineId, demo, returnKey) {
    const p = byId(pid);
    if (!p || p.soldOut) return;
    let sel = defaultSel(p);
    let qty = 1;
    let note = '';
    let mem = null;
    if (lineId) {
      const l = state.cart.find((x) => x.id === lineId);
      if (l) {
        sel = Object.assign(sel, clone(l.sel || {}));
        qty = l.qty;
        note = l.note || '';
      }
    } else {
      const m = memoryFor(p);
      if (m && m.kind === 'options' && !m.partial) { sel = clone(m.sel); note = m.note; mem = { applied: true, text: m.text }; }
      else if (m && m.kind === 'options' && m.partial) { mem = { partial: true }; }
      else if (demo && pid === 'lurou' && sel.topping) { sel.topping = ['egg']; } /* 展示用：小碗 + 滷蛋 = $47 */
    }
    pushReturn(returnKey);
    state.sheet = { pid: pid, lineId: lineId || null, sel: sel, qty: qty, note: note, mem: mem };
  }

  /* 購物車變更 → 版本 +1；回傳可用於復原的快照 */
  const cartSnapshot = () => ({ cart: clone(state.cart), seq: state.seq, ver: state.ver });
  const bump = () => { state.ver += 1; return state.ver; };
  function undoTo(snap, label) {
    return function () {
      if (snap.ver + 1 !== state.ver) { announce('無法復原：購物車已有其他變更'); return; }
      state.cart = snap.cart;
      state.seq = snap.seq;
      state.ver += 1;
      render();
      announce('已復原：' + label + '，' + cartSummary());
    };
  }

  function addLine(p, sel, note, qty) {
    const unit = unitPrice(p, sel);
    const opt = optText(p, sel);
    const same = state.cart.find((l) => l.pid === p.id && l.opt === opt && (l.note || '') === note);
    if (same) { same.qty += qty; return same; }
    const line = { id: 'n' + (++state.seq), pid: p.id, qty: qty, unit: unit, opt: opt, note: note, sel: clone(sel) };
    state.cart.push(line);
    return line;
  }

  const lineText = (p, line) => p.name + (line.opt ? '（' + line.opt + '）' : '');
  const addedMsg = (p, line) => '已加入購物車：' + lineText(p, line) + '，' + cartSummary();
  /* 一鍵再點：已再點：{品名}（{選項摘要}）$ {該行金額}，目前 {n} 項，共 $ {小計} */
  const repeatedMsg = (p, line) => '已再點：' + lineText(p, line) + (line.opt ? '' : ' ') + money(line.unit * line.qty) + '，' + cartSummary();

  function commitSheet() {
    const S = state.sheet;
    const p = byId(S.pid);
    const note = S.note.trim();
    const snap = cartSnapshot();
    let msg;
    let isNew = false;
    if (S.lineId) {
      const l = state.cart.find((x) => x.id === S.lineId);
      if (l) {
        l.qty = S.qty;
        l.note = note;
        if (p.groups.length) { l.sel = clone(S.sel); l.unit = unitPrice(p, S.sel); l.opt = optText(p, S.sel); }
        msg = '已更新購物車：' + lineText(p, l) + '，' + cartSummary();
      }
    } else {
      const line = addLine(p, S.sel, note, S.qty);
      msg = addedMsg(p, line);
      isNew = true;
    }
    bump();
    state.sheet = null;
    render();
    afterClose();
    if (msg) say(msg, isNew ? undoTo(snap, p.name) : null);
  }

  function directAdd(p) {
    const same = state.cart.find((l) => l.pid === p.id && !l.opt && !l.note);
    if (same) { same.qty += 1; return same; }
    const line = { id: 'n' + (++state.seq), pid: p.id, qty: 1, unit: p.price, opt: '', note: '', sel: defaultSel(p) };
    state.cart.push(line);
    return line;
  }

  /* 加入：無必選群組 → 直接加入（Toast 含復原）；否則開啟面板。fromKeyboard：之後把焦點留在商品卡 */
  function cardAdd(id, fromKeyboard) {
    const p = byId(id);
    if (!p) return;
    if (p.soldOut) { announce(p.name + ' 今日售完'); return; }
    if (needsSheet(p)) { openSheet(id, null, false, 'card:' + id); render(); return; }
    const snap = cartSnapshot();
    const l = lastLine(id);
    let line;
    if (l) { l.qty += 1; line = l; } else line = directAdd(p);
    bump();
    render();
    if (fromKeyboard) focusKey('card:' + id);
    say(addedMsg(p, line), undoTo(snap, p.name));
  }

  /* 步進器的「＋」：僅更新數量並通報，不顯示 Toast */
  function cardInc(id) {
    const p = byId(id);
    if (!p || p.soldOut) return;
    if (needsSheet(p)) { openSheet(id, null, false, 'card:' + id); render(); return; }
    const l = lastLine(id);
    if (l) l.qty += 1; else directAdd(p);
    bump();
    render();
    announce(p.name + ' 數量 ' + qtyOf(id) + '，' + cartSummary());
  }

  function cardDec(id) {
    const l = lastLine(id);
    if (!l) return;
    l.qty -= 1;
    const p = byId(id);
    if (l.qty <= 0) state.cart.splice(state.cart.indexOf(l), 1);
    bump();
    render();
    announce(p.name + ' 數量 ' + (l.qty > 0 ? l.qty : 0) + '，' + cartSummary());
  }

  /* 再點上次：一鍵加入記憶中的選項；任一選項已失效則改為開啟面板並提示，不在使用者不知情下加入 */
  function repeatAdd(id, keepKey) {
    const p = byId(id);
    const m = p && memoryFor(p);
    if (!p || p.soldOut || !m) return false;
    if (m.kind === 'options' && m.partial) { openSheet(id, null, false, keepKey || 'card:' + id); render(); return true; }
    const snap = cartSnapshot();
    const line = m.kind === 'plain'
      ? (function () { const l = state.cart.find((x) => x.pid === p.id && !x.opt && !x.note); if (l) { l.qty += 1; return l; } return directAdd(p); })()
      : addLine(p, m.sel, m.note, 1);
    bump();
    render();
    if (keepKey) focusKey(keepKey);
    say(repeatedMsg(p, line), undoTo(snap, p.name));
    return true;
  }

  function openDialog(type, extra) {
    pushReturn();
    if (type === 'shortcuts' && KN.phase !== 'off') { clearTimeout(KN.timer); KN.timer = null; KN.dot = false; KN.phase = 'closed'; } /* 已進入偏好：不再提醒，⌨ 上的圓點消失 */
    state.dialog = Object.assign({ type: type }, extra || {});
    render();
    if (extra && extra.focus === 'prefs') {
      const pf = $('#prefs');
      if (pf) { pf.scrollIntoView({ block: 'start' }); const sw = pf.querySelector('button'); if (sw) sw.focus({ preventScroll: true }); }
    }
  }
  function closeDialog() {
    if (!state.dialog) return;
    const wasIdle = state.dialog.type === 'idle';
    state.dialog = null;
    if (wasIdle) stopIdleCountdown();
    render();
    afterClose();
  }
  function closeSheet() {
    state.sheet = null;
    render();
    afterClose();
  }
  function closeCart() {
    state.cartOpen = false;
    render();
    afterClose();
  }

  function removeLine(lineId) {
    const i = state.cart.findIndex((l) => l.id === lineId);
    if (i < 0) return;
    const l = state.cart[i];
    const p = byId(l.pid);
    const snap = cartSnapshot();
    state.cart.splice(i, 1);
    bump();
    render();
    /* 移除後焦點：下一個品項；無則「前往結帳」 */
    const host = state.cartOpen ? $('.cartsheet') : $('#orderpanel');
    const lines = host ? host.querySelectorAll('.cartline') : [];
    const next = lines[Math.min(i, lines.length - 1)] || (host && host.querySelector('.btn'));
    if (next) next.focus({ preventScroll: true });
    say('已移除：' + (p ? p.name : '品項') + '，' + cartSummary(), undoTo(snap, p ? p.name : '品項'));
  }

  function lineQty(lineId, delta) {
    const l = state.cart.find((x) => x.id === lineId);
    if (!l) return;
    const p = byId(l.pid);
    if (l.qty + delta < 1) { askRemove(lineId, 'line:' + lineId); return; }
    l.qty = Math.min(20, l.qty + delta);
    bump();
    render();
    focusKey('line:' + lineId);
    announce((p ? p.name : '品項') + ' 數量 ' + l.qty + '，' + cartSummary());
  }

  function askRemove(lineId, returnKey) {
    pushReturn(returnKey);
    state.dialog = { type: 'confirm', lineId: lineId };
    render();
  }

  function editLine(lineId) {
    const l = state.cart.find((x) => x.id === lineId);
    if (!l) return;
    const rk = state.cartOpen ? null : 'line:' + lineId;
    if (state.cartOpen) { state.cartOpen = false; state.returnKeys.pop(); }
    openSheet(l.pid, l.id, false, rk || 'open-cart-m');
    render();
  }

  /* 收藏：訪客只顯示可略過的登入提示（BR-33），會員才實際切換 */
  function toggleFav(pid) {
    const p = byId(pid);
    if (!p) return;
    if (P.login !== 'member') { say('登入後可收藏喜愛的餐點'); return; }
    const i = state.fav.indexOf(pid);
    if (i >= 0) state.fav.splice(i, 1); else state.fav.push(pid);
    render();
    focusKey('card:' + pid);
    say((state.fav.includes(pid) ? '已加入我的最愛：' : '已取消收藏：') + p.name);
  }

  const panelVisible = () => window.matchMedia('(min-width: 1024px)').matches && P.screen !== 'checkout' && P.screen !== 'tracking';
  function openCart() {
    if (P.screen === 'checkout' || P.screen === 'tracking') { navigate('menu', { sheet: null }, '#cart'); return; }
    if (panelVisible()) {
      const panel = $('#orderpanel');
      const first = panel && panel.querySelector('.cartline, .btn');
      (first || panel).focus();
      announce('我的訂單，' + cartSummary());
    } else {
      pushReturn();
      state.cartOpen = true;
      render();
      announce('我的訂單，' + cartSummary());
    }
  }

  function focusSearch() {
    if (P.screen === 'checkout' || P.screen === 'tracking') { navigate('menu', { sheet: null }, '#search'); return; }
    if (window.matchMedia('(min-width: 768px)').matches) {
      const i = $('#search-d');
      if (i) { i.focus(); i.select(); }
    } else {
      state.searchOpen = true;
      render();
      const i = $('#search-m');
      if (i) i.focus();
    }
  }

  function goMenu() {
    if (P.screen !== 'menu' && P.screen !== 'sheet' && P.screen !== 'shortcuts') { navigate('menu', { sheet: null }); return; }
    state.cat = 'all'; state.q = ''; state.searchOpen = false;
    render();
    window.scrollTo(0, 0);
    announce('回到菜單');
  }

  function jumpCategory(n) {
    const cats = catChips();
    let id = 'all';
    let label = '全部';
    if (n > 0) {
      const c = cats[n - 1];
      if (!c) return;
      id = c.id; label = c.name;
    }
    state.cat = id; state.q = '';
    render();
    focusKey('cat:' + id);
    scrollMenuTop();
    announce('已切換到：' + label + '，' + catCount(id) + ' 項');
  }

  function scrollMenuTop() {
    const m = $('#menu');
    if (!m) return;
    const stick = window.innerWidth >= 768 ? 64 + 64 : 56 + 64;
    const top = m.getBoundingClientRect().top + window.scrollY - stick;
    if (window.scrollY > top) window.scrollTo(0, Math.max(0, top));
  }

  function toggleLayout() {
    state.layout = currentLayout() === 'grid' ? 'list' : 'grid';
    render();
    announce('已切換為' + (state.layout === 'grid' ? '圖卡' : '清單') + '版面');
  }

  function restoreDefault() {
    const S = state.sheet;
    if (!S || !S.mem || !S.mem.applied) return;
    const p = byId(S.pid);
    S.sel = defaultSel(p);
    S.note = '';
    S.mem = null;
    render();
    focusKey('sheet-commit');
    announce('已恢復預設選項，' + money(unitPrice(p, S.sel) * S.qty));
  }

  function doRefresh() {
    say('訂單狀態已更新：製作中，預計 12:35 可取餐');
  }

  /* kiosk：閒置倒數與完成畫面倒數 */
  let idleTimer = null;
  let idleTick = null;
  let doneTick = null;
  let doneLeft = 30;
  function resetKiosk() {
    state.cart = [];
    state.sheet = null; state.cartOpen = false; state.dialog = null;
    state.cat = 'all'; state.q = ''; state.fulfil = 'dinein';
  }
  function stopIdleCountdown() { clearInterval(idleTick); idleTick = null; }
  function startIdleCountdown() {
    stopIdleCountdown();
    idleTick = setInterval(() => {
      if (!state.dialog || state.dialog.type !== 'idle') { stopIdleCountdown(); return; }
      state.dialog.left -= 1;
      const c = document.getElementById('idle-count');
      if (c) c.textContent = state.dialog.left;
      if (state.dialog.left > 0 && state.dialog.left % 10 === 0) announce('還有 ' + state.dialog.left + ' 秒將重新開始，購物車會清空', true);
      if (state.dialog.left <= 0) {
        stopIdleCountdown();
        if (P.screen === 'idle') { navigate('menu', { mode: 'kiosk' }); return; }
        resetKiosk();
        render();
        armIdle();
      }
    }, 1000);
  }
  function openIdle() {
    if (state.dialog) return;
    state.dialog = { type: 'idle', left: 30 };
    render();
    announce('還在嗎？30 秒後將重新開始，購物車會清空', true);
    startIdleCountdown();
  }
  function armIdle() {
    clearTimeout(idleTimer);
    if (KIOSK && (P.screen === 'menu' || P.screen === 'sheet')) idleTimer = setTimeout(openIdle, 60000);
  }
  function closeDialogIdle() {
    stopIdleCountdown();
    if (P.screen === 'idle') { navigate('menu', { mode: 'kiosk' }); return; }
    state.dialog = null;
    render();
    armIdle();
  }
  function startDoneCountdown() {
    clearInterval(doneTick);
    doneLeft = 30;
    const c = document.getElementById('done-count');
    if (c) c.textContent = doneLeft;
    doneTick = setInterval(() => {
      doneLeft -= 1;
      const el = document.getElementById('done-count');
      if (el) el.textContent = doneLeft;
      if (doneLeft > 0 && doneLeft % 10 === 0) announce('還有 ' + doneLeft + ' 秒自動回到首頁', true);
      if (doneLeft <= 0) { clearInterval(doneTick); navigate('menu', { mode: 'kiosk' }); }
    }, 1000);
  }

  /* ---- 鍵盤提醒（KeyboardNotice，CMP-41；FR-SY-18、BR-42、NFR-18）----
     偵測到第一次可信的實體鍵盤按鍵後，以不佔流的 fixed 浮動卡提醒「可開啟單鍵快速鍵」：
     ≥ 768 錨定於頂部 ⌨ 按鈕下方；< 768 與 Toast 同槽（CartBar 與底部 Tab 之上）。
     不位移版面、不呼叫 focus()；12 秒後收成 ⌨ 上的小圓點（≥ 768；< 768 沒有 ⌨，直接收起）；Toast / 浮層搶走時讓位；
     顯示中焦點移到被卡片遮住的元件時轉為稍後；結帳、付款與觸控面板不出現（BR-42：路由只排除結帳 PG-04 與付款 PG-05，
     訂單追蹤 PG-06 與菜單、商品面板、偏好對話框同樣可出現；原型沒有付款畫面，故 eligible 為 menu / sheet / shortcuts / tracking）。
     原型只在記憶體保存狀態（重新載入會重新偵測）。 */
  const KN = {
    eligible: !KIOSK && ['menu', 'sheet', 'shortcuts', 'tracking'].includes(P.screen),
    phase: 'off', /* off | watching | pending | visible | confirmed | dot（已收起，⌨ 上有圓點）| closed */
    dot: false,
    left: 12000,
    since: 0,
    timer: null,
    tick: null,
    pendingSince: 0,
    clearSince: 0,
    hover: false,
    inside: false,
    back: null, /* 焦點進入提醒前的元素（data-key），收起後還原 */
    ev: [], /* 純觸控裝置的證據（時間與按鍵） */
    hit: null, /* 觸發提醒的按鍵若是快速鍵（例如 c），內文改用「剛才按的「c」是快速鍵…」變體 */
  };
  const kbnOpen = () => KN.phase === 'visible' || KN.phase === 'confirmed';
  const kbnEl = () => document.getElementById('kbn');
  const toastVisible = () => !!(toastEl && toastEl.classList.contains('is-on'));

  function kbnHTML() {
    if (!KN.eligible) return '';
    const open = kbnOpen();
    const conf = KN.phase === 'confirmed';
    const btns = conf
      ? '<button type="button" class="btn btn--neutral" data-action="kbn-all" data-key="kbn-all">查看全部</button>' +
        '<button type="button" class="btn btn--neutral" data-action="kbn-undo" data-key="kbn-undo">復原</button>'
      : '<button type="button" class="btn btn--primary" data-action="kbn-open" data-key="kbn-open" aria-label="開啟單鍵快速鍵" aria-describedby="kbn-sr-open">開啟</button>' +
        '<button type="button" class="btn btn--ghost" data-action="kbn-decline" data-key="kbn-decline" aria-describedby="kbn-sr-no">不用了</button>' +
        '<span class="sr-only" id="kbn-sr-open">使用螢幕閱讀器時，單鍵快速鍵可能與瀏覽模式的按鍵衝突，建議保持關閉。</span>' +
        '<span class="sr-only" id="kbn-sr-no">之後不會再自動提醒，仍可在偏好設定開啟。</span>';
    return '<div class="kbn" id="kbn" role="group" aria-label="鍵盤快速鍵提醒" data-state="' + (conf ? 'confirmed' : 'prompt') + '"' + (open ? '' : ' hidden') + '>' +
      '<div class="kbn__head"><span class="kbn__icon" aria-hidden="true">' + ICON('keyboard', 20) + '</span>' +
        '<p class="kbn__title">' + (conf ? '已開啟單鍵快速鍵。' : '偵測到實體鍵盤') + '</p>' +
        '<div class="kbn__btns">' + btns + '</div></div>' +
      '<p class="kbn__body">' + (conf
        ? '按 <kbd class="keyhint keyhint--doc">?</kbd> 查看全部。'
        : KN.hit
          ? '剛才按的「' + esc(KN.hit) + '」是快速鍵，目前尚未開啟。要開啟單鍵快速鍵嗎？'
          : '要開啟單鍵快速鍵嗎？例如按 c 開購物車、按 s 搜尋。可隨時在偏好設定關閉。') + '</p>' +
      '</div>';
  }

  /* 就地換成目前狀態的提醒（不重繪整頁，避免位移與失去焦點）；焦點在卡內時盡量還原 */
  function kbnPaint(enter) {
    const el = kbnEl();
    if (!el) return;
    const act = document.activeElement;
    const had = !!(act && act !== el && el.contains(act));
    const key = had && act.dataset ? act.dataset.key : null;
    const tmp = document.createElement('div');
    tmp.innerHTML = kbnHTML();
    const next = tmp.firstElementChild;
    if (!next) return;
    if (enter) next.classList.add('is-enter');
    el.replaceWith(next);
    KN.hover = next.matches(':hover');
    KN.inside = false;
    if (had) {
      const again = key && root.querySelector('[data-key="' + key + '"]');
      if (kbnOpen() && again && next.contains(again)) again.focus({ preventScroll: true });
      else if (!KN.back || !focusKey(KN.back)) { const mm = $('#menu'); if (mm) mm.focus({ preventScroll: true }); }
    }
    kbnSyncDot();
  }
  function kbnSyncDot() {
    const b = root.querySelector('.topbar__help, .appbar__help');
    if (!b) return;
    const d = b.querySelector('.kbdot');
    if (KN.dot && !d) b.insertAdjacentHTML('beforeend', '<span class="kbdot" aria-hidden="true"></span>');
    if (!KN.dot && d) d.remove();
    b.setAttribute('aria-label', '鍵盤快速鍵與偏好' + (KN.dot ? '，有新提示' : ''));
  }

  function kbnStartTimer(ms) {
    clearTimeout(KN.timer);
    KN.left = ms;
    KN.since = performance.now();
    KN.timer = setTimeout(() => {
      KN.timer = null;
      if (KN.phase === 'visible') kbnSnooze(); else if (KN.phase === 'confirmed') kbnClose();
    }, ms);
  }
  function kbnPause(force) {
    if (!KN.timer || !(force || KN.hover || KN.inside)) return;
    clearTimeout(KN.timer);
    KN.timer = null;
    KN.left = Math.max(1500, KN.left - (performance.now() - KN.since));
  }
  function kbnResume() {
    if (!KN.timer && kbnOpen() && !KN.hover && !KN.inside && document.visibilityState === 'visible') kbnStartTimer(KN.left);
  }
  /* 頁面隱藏時暫停計時（FLOW-25 阻擋與讓位條件），回到可見後以剩餘時間繼續 */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') kbnPause(true); else kbnResume();
  });

  /* 逾時 / Esc / 被 Toast 或浮層搶走 / 焦點被卡片遮住：≥ 768 收成 ⌨ 上的小圓點（入口仍在）；< 768 沒有 ⌨，直接收起（入口為頁尾與跳過連結）。
     圓點只在「點 ⌨ / 開啟偏好對話框 / 以任何途徑啟用單鍵快速鍵」時清除（見 openDialog、toggle-shortcuts） */
  const kbnHelpVisible = () => !KIOSK && !!(window.matchMedia && window.matchMedia('(min-width: 768px)').matches);
  function kbnSnooze() {
    clearTimeout(KN.timer); KN.timer = null;
    if (!kbnHelpVisible()) { KN.phase = 'closed'; KN.dot = false; kbnPaint(); return; }
    KN.phase = 'dot';
    KN.dot = true;
    kbnPaint();
  }
  function kbnClose() {
    clearTimeout(KN.timer); KN.timer = null;
    KN.phase = 'closed';
    KN.dot = false;
    kbnPaint();
  }
  /* 被搶走：提示狀態 → 稍後（圓點）；確認狀態已完成使用者的決定，直接收起、不留圓點（FLOW-25 CONFIRMED → OFF） */
  function kbnYield() { if (KN.phase === 'visible') kbnSnooze(); else if (KN.phase === 'confirmed') kbnClose(); }
  function kbnEsc() { if (KN.phase === 'confirmed') kbnClose(); else kbnSnooze(); }

  const kbnBlocked = () => hasOverlay() || toastVisible() || document.visibilityState !== 'visible' || window.innerHeight < 480 ||
    isEditableTarget(document.activeElement);
  function kbnCoversFocus() {
    const a = document.activeElement;
    const c = kbnEl();
    if (!a || a === document.body || a === document.documentElement || !c || c.contains(a)) return false;
    const r = a.getBoundingClientRect();
    const k = c.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !(r.right <= k.left || r.left >= k.right || r.bottom <= k.top || r.top >= k.bottom);
  }
  function kbnShow() {
    KN.phase = 'visible';
    KN.dot = false;
    kbnPaint(true);
    if (kbnCoversFocus()) { KN.phase = 'pending'; kbnPaint(); kbnTickStart(true); return; } /* 不遮蔽焦點（FOCUS_COVERED）：改為待命 */
    kbnStartTimer(12000);
    announce('偵測到實體鍵盤，可以開啟單鍵快速鍵。');
  }
  function kbnTickStart(keep) {
    clearInterval(KN.tick);
    if (!keep) KN.pendingSince = performance.now(); /* 證據保留 60 秒；因焦點遮擋回到待命時不重算 */
    KN.clearSince = 0;
    KN.tick = setInterval(() => {
      if (KN.phase !== 'pending') { clearInterval(KN.tick); KN.tick = null; return; }
      const now = performance.now();
      if (now - KN.pendingSince > 60000) { clearInterval(KN.tick); KN.tick = null; if (KN.phase === 'pending') KN.phase = 'watching'; return; }
      if (kbnBlocked()) { KN.clearSince = 0; return; }
      if (!KN.clearSince) { KN.clearSince = now; return; }
      if (now - KN.clearSince >= 300) { clearInterval(KN.tick); KN.tick = null; kbnShow(); }
    }, 150);
  }
  function kbnReached() {
    KN.phase = 'pending';
    if (!kbnBlocked()) kbnShow(); else kbnTickStart();
  }

  /* 偵測（對應 07 §7.5 的 classifyKeyboardEvidence）：可信、非重複、非組字、無 Alt / Ctrl / ⌘，且以實體鍵碼 code 判斷
     （修飾鍵、Esc、Space、PageUp / PageDown、Home / End 與無實體 code 的事件一律不算）：
       NAV  = Tab / Shift + Tab（不論焦點位置，含輸入元件內）；Enter、方向鍵須「目標不是可編輯元件且焦點不在 body」
       CHAR = 字母 / 數字 / / = - ?，且焦點不在輸入元件（輸入元件內的打字不算；EDIT_TYPING 為 P2 選配，原型不實作）
     非輸入元件下 key 為 Process 的事件仍以 code 計；桌機（any-pointer: fine）1 次即達標，純觸控裝置需 Tab，或 10 秒內 ≥ 3 次且含非 Enter 鍵 */
  const KBN_TEXT_CODE = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|NumpadAdd|NumpadSubtract|Slash|Equal|Minus)$/;
  function kbnDetect(e) {
    if (KN.phase !== 'watching') return;
    if (!e.isTrusted || e.defaultPrevented || e.repeat || e.isComposing) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const code = typeof e.code === 'string' ? e.code : '';
    const a = document.activeElement;
    const onBody = !a || a === document.body || a === document.documentElement;
    const editable = isEditableTarget(e.target);
    let kind = null;
    if (code === 'Tab') kind = 'TAB';
    else if (editable && e.keyCode === 229) return; /* 輸入元件內的輸入法組字 */
    else if (code === 'Enter' || code === 'NumpadEnter' || /^Arrow(Up|Down|Left|Right)$/.test(code)) {
      if (!editable && !onBody) kind = code === 'Enter' || code === 'NumpadEnter' ? 'ENTER' : 'NAV';
    } else if (KBN_TEXT_CODE.test(code) && !editable) kind = 'CHAR';
    if (!kind) return;
    /* 按到的是（啟用後會觸發動作的）快速鍵：提醒內文改用「剛才按的「c」是快速鍵」變體 */
    const nk = kind === 'CHAR' ? normalizeKey(e) : null;
    KN.hit = nk && !(e.shiftKey && /^[a-z0-9]$/.test(nk)) && HOTKEYS.some((h) => !h.alwaysOn && h.keys.includes(nk)) ? nk : null;
    const fine = !!(window.matchMedia && window.matchMedia('(any-pointer: fine)').matches);
    if (!fine && kind !== 'TAB') {
      const now = performance.now();
      KN.ev = KN.ev.filter((x) => now - x.t < 10000).concat([{ t: now, kind: kind }]);
      if (!(KN.ev.length >= 3 && KN.ev.some((x) => x.kind !== 'ENTER'))) return;
    }
    kbnReached();
  }

  function kbnAccept(byKeyboard) {
    const act = document.activeElement;
    const fromCard = !!(byKeyboard && act && act.closest && act.closest('#kbn')); /* 只有鍵盤操作才把焦點移到「查看全部」，避免滑鼠使用者的計時被焦點暫停 */
    clearTimeout(KN.timer); KN.timer = null;
    state.shortcutsOn = true;
    KN.phase = 'confirmed';
    KN.dot = false;
    render(); /* 徽章出現（局部重排可接受） */
    kbnStartTimer(6000);
    if (fromCard) focusKey('kbn-all', { preventScroll: true });
    announce('單鍵快速鍵已開啟，按問號查看全部。');
  }
  function kbnDecline() {
    KN.phase = 'closed';
    KN.dot = false;
    clearTimeout(KN.timer); KN.timer = null;
    kbnPaint();
    announce('已不再提醒。可在偏好設定開啟單鍵快速鍵。');
  }
  function kbnUndo() {
    /* 收起當下焦點仍在卡片內才還原先前焦點；焦點已離開卡片（例如已移到搜尋框）時不得移動焦點（R-Z） */
    const act = document.activeElement;
    const c = kbnEl();
    const had = !!(act && c && c.contains(act));
    state.shortcutsOn = false;
    KN.phase = 'closed';
    KN.dot = false;
    clearTimeout(KN.timer); KN.timer = null;
    render();
    if (had && (!KN.back || !focusKey(KN.back))) { const mm = $('#menu'); if (mm) mm.focus({ preventScroll: true }); }
    announce('單鍵快速鍵已關閉。');
  }
  function kbnAll() {
    KN.phase = 'closed';
    KN.dot = false;
    clearTimeout(KN.timer); KN.timer = null;
    kbnPaint();
    openDialog('shortcuts');
  }
  /* 浮層開啟（Dialog / 面板 / 抽屜）：提醒讓位；打開偏好對話框即視為已看到提示（見 openDialog） */
  function kbnSync() {
    if (!KN.eligible) return;
    if (kbnOpen() && hasOverlay()) kbnYield();
    kbnSyncDot();
  }
  function kbnInit() {
    if (!KN.eligible) return;
    if (P.hints === 'auto' && !state.shortcutsOn) KN.phase = 'watching';
    if (P.reminder === '1' && !state.shortcutsOn) kbnReached(); /* 載入時直接顯示（截圖用） */
  }
  /* 滑鼠移入 / 焦點進入提醒時暫停計時，離開後以剩餘時間繼續 */
  root.addEventListener('mouseover', (e) => { if (e.target.closest && e.target.closest('#kbn')) { KN.hover = true; kbnPause(); } });
  root.addEventListener('mouseout', (e) => {
    const c = e.target.closest && e.target.closest('#kbn');
    if (c && !(e.relatedTarget && c.contains(e.relatedTarget))) { KN.hover = false; kbnResume(); }
  });
  root.addEventListener('focusin', (e) => {
    const c = e.target.closest && e.target.closest('#kbn');
    if (!c) return;
    KN.inside = true;
    const r = e.relatedTarget;
    if (r && r.dataset && r.dataset.key && !c.contains(r)) KN.back = r.dataset.key;
    kbnPause();
  });
  root.addEventListener('focusout', (e) => {
    const c = e.target.closest && e.target.closest('#kbn');
    if (c && !(e.relatedTarget && c.contains(e.relatedTarget))) { KN.inside = false; kbnResume(); }
  });
  /* 顯示中，焦點移到被卡片遮住的元件（例如訂單面板第一個品項）：不遮蔽焦點（WCAG 2.4.11），提醒轉為稍後（FOCUS_COVERED） */
  document.addEventListener('focusin', (e) => {
    if (!kbnOpen()) return;
    const c = kbnEl();
    if (!c || c.contains(e.target)) return;
    requestAnimationFrame(() => { if (kbnOpen() && kbnCoversFocus()) kbnYield(); });
  }, true);

  /* ------------------------------------------------------------------ 10. 互動 */
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const a = el.dataset.action;
    const id = el.dataset.id;
    if (a === 'noop' || a === 'opt') return;
    if (el.tagName === 'A') e.preventDefault();
    switch (a) {
      case 'cat': state.cat = id; state.q = ''; render(); scrollMenuTop(); announce('已切換到：' + (id === 'all' ? '全部' : (CATEGORIES.find((c) => c.id === id) || {}).name)); break;
      case 'fulfil': state.fulfil = id; render(); announce('取餐方式：' + fulfilName(id)); break;
      case 'layout': state.layout = id; render(); announce('已切換為' + (id === 'grid' ? '圖卡' : '清單') + '版面'); break;
      case 'add': cardAdd(id); break;
      case 'inc': cardInc(id); break;
      case 'dec': cardDec(id); break;
      case 'again': repeatAdd(id, el.dataset.key); break;
      case 'open': openSheet(id, null, false, 'card:' + id); render(); break;
      case 'edit': editLine(el.dataset.line); break;
      case 'remove-line': askRemove(el.dataset.line, el.dataset.key); break;
      case 'confirm-remove': {
        const lid = state.dialog && state.dialog.lineId;
        state.dialog = null;
        state.returnKeys.pop();
        removeLine(lid);
        break;
      }
      case 'close-dialog': closeDialog(); break;
      case 'close-sheet': closeSheet(); break;
      case 'sheet-inc': state.sheet.qty = Math.min(20, state.sheet.qty + 1); render(); announce('數量 ' + state.sheet.qty); break;
      case 'sheet-dec': state.sheet.qty = Math.max(1, state.sheet.qty - 1); render(); announce('數量 ' + state.sheet.qty); break;
      case 'sheet-commit': commitSheet(); break;
      case 'restore-default': restoreDefault(); break;
      case 'sheet-remove': {
        const i = state.cart.findIndex((l) => l.id === state.sheet.lineId);
        if (i >= 0) { state.cart.splice(i, 1); bump(); }
        state.sheet = null; render(); afterClose(); break;
      }
      case 'open-cart': openCart(); break;
      case 'close-cart': closeCart(); break;
      case 'toggle-search':
        state.searchOpen = !state.searchOpen;
        if (!state.searchOpen) state.q = '';
        render();
        if (state.searchOpen) { const i = $('[data-key="search-m"]'); if (i) i.focus(); }
        break;
      case 'hide-hint': state.cx.hint = false; render(); break;
      case 'help': openDialog('shortcuts'); break;
      case 'prefs': openDialog('shortcuts', { focus: 'prefs' }); break;
      case 'toggle-shortcuts':
        state.shortcutsOn = !state.shortcutsOn;
        if (state.shortcutsOn && KN.phase !== 'off') { KN.phase = 'closed'; KN.dot = false; } /* 已由其他途徑啟用：不再提醒，圓點清除 */
        render();
        announce(state.shortcutsOn ? '單鍵快速鍵已開啟，按問號查看全部。' : '單鍵快速鍵已關閉。');
        break;
      case 'kbn-open': kbnAccept(e.detail === 0); break;
      case 'kbn-decline': kbnDecline(); break;
      case 'kbn-undo': kbnUndo(); break;
      case 'kbn-all': kbnAll(); break;
      case 'submit': ckTrySubmit(); break;
      case 'ck-view': ckView(); break;
      case 'ck-apply': ckApplyAll(); break;
      case 'ck-undo-all': ckUndoAll(); break;
      case 'ck-rm': ckRemove(id); break;
      case 'ck-qty': ckSetQty(id); break;
      case 'ck-slot': ckSetSlot(id); break;
      case 'ck-slot-other': ckOtherSlot(); break;
      case 'slot': {
        const m0 = ckModel();
        if (CK_ON && m0.items.some((x) => x.type === 'slot' || x.type === 'slotempty')) ckSetSlot(id);
        else { state.cx.slot = id; render(); announce('取餐時段已改為 ' + id); }
        break;
      }
      case 'toggle-memory': state.memoryPref = !state.memoryPref; render(); announce('點餐記憶已' + (state.memoryPref ? '開啟' : '關閉')); break;
      case 'toggle-text': state.textLarge = !state.textLarge; syncPrefs(); render(); announce('大字模式已' + (state.textLarge ? '開啟' : '關閉')); break;
      case 'motion': state.motion = id; syncPrefs(); render(); announce('減少動態：' + ({ system: '跟隨系統', on: '開', off: '關' }[id])); break;
      case 'clear-data': Object.keys(MEMORY).forEach((k) => delete MEMORY[k]); render(); say('已清除'); break;
      case 'store': openDialog('store'); break;
      case 'login': openDialog('login'); break;
      case 'orders': navigate('tracking'); break;
      case 'clear-memory': Object.keys(MEMORY).forEach((k) => delete MEMORY[k]); state.dialog = null; render(); afterClose(); say('已清除點餐記憶'); break;
      case 'refresh': doRefresh(); break;
      case 'skip': { const t = document.getElementById(el.dataset.target); if (t) { t.focus(); t.scrollIntoView({ block: 'start' }); } break; }
      case 'chips-prev': case 'chips-next': {
        const sc = $('.chips__scroller');
        if (sc) sc.scrollBy({ left: (a === 'chips-next' ? 1 : -1) * Math.round(sc.clientWidth * 0.7), behavior: reduceMotion() ? 'auto' : 'smooth' });
        break;
      }
      case 'kiosk-large': state.large = !state.large; html.dataset.large = state.large ? '1' : '0'; render(); break;
      case 'idle-continue': closeDialogIdle(); break;
      case 'idle-restart': stopIdleCountdown(); if (P.screen === 'idle') { navigate('menu', { mode: 'kiosk' }); } else { resetKiosk(); render(); armIdle(); } break;
      case 'done-stay': startDoneCountdown(); announce('已重新計時，30 秒後自動回到首頁'); break;
      default: break;
    }
  });

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('input[data-action="opt"]') && state.sheet) {
      const p = byId(state.sheet.pid);
      const g = p.groups.find((x) => x.id === t.dataset.group);
      if (!g) return;
      let cur = (state.sheet.sel[g.id] || []).slice();
      if (g.multi) {
        if (t.checked) { if (!g.max || cur.length < g.max) cur.push(t.value); }
        else cur = cur.filter((v) => v !== t.value);
      } else {
        cur = [t.value];
      }
      state.sheet.sel[g.id] = cur;
      render();
      return;
    }
    if (t.matches('input[data-cx]')) { state.cx[t.dataset.cx] = t.value; render(); return; }
    if (t.matches('input[data-cx-check]')) { state.cx[t.dataset.cxCheck] = t.checked; render(); }
  });

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('[data-search]')) {
      state.q = t.value;
      const m = $('#menu');
      if (m) m.innerHTML = '<h1 class="sr-only">' + STORE.name + '・菜單</h1>' + sectionsHTML();
      root.querySelectorAll('.chip[data-action="cat"]').forEach((c) => c.setAttribute('aria-current', String(!state.q && c.dataset.id === state.cat)));
      return;
    }
    if (t.matches('[data-note]') && state.sheet) state.sheet.note = t.value;
  });

  root.addEventListener('focusin', (e) => {
    const c = e.target.closest ? e.target.closest('.pcard') : null;
    if (c && c.dataset.pid) setActiveCard(c.dataset.pid);
    /* 橫向捲動區（分類膠囊、常點）：焦點元素只露出一點點時瀏覽器不會捲動，這裡確保完整可見 */
    const sc = e.target.closest ? e.target.closest('.common__list, .chips__scroller') : null;
    if (sc && e.target.scrollIntoView) e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  /* ---- 鍵盤：快速鍵（BR-34）；所有 keydown 只在此處理 ---- */
  function scopeCtx(e) {
    const modalOpen = hasOverlay();
    let scopes;
    let modalScope;
    if (state.dialog) { scopes = ['global']; modalScope = undefined; }
    else if (state.sheet) { scopes = ['sheet', 'global']; modalScope = 'sheet'; }
    else if (state.cartOpen) { scopes = ['cart', 'global']; modalScope = 'cart'; }
    else if (P.screen === 'checkout') scopes = ['checkout', 'global'];
    else if (P.screen === 'tracking') scopes = ['order', 'global'];
    else scopes = panelVisible() ? ['menu', 'cart', 'global'] : ['menu', 'global'];
    return {
      enabled: hotkeysEnabled(),
      scopes: scopes,
      editable: isEditableTarget(e.target),
      modalOpen: modalOpen,
      modalScope: modalScope,
    };
  }

  function perform(r) {
    const k = r.arg;
    switch (r.action) {
      case 'help': if (state.dialog && state.dialog.type === 'shortcuts') closeDialog(); else openDialog('shortcuts'); return true;
      case 'search': focusSearch(); return true;
      case 'goMenu': goMenu(); return true;
      case 'openCart': openCart(); return true;
      case 'goOrders': if (P.screen === 'tracking') announce('目前已在訂單頁'); else navigate('tracking'); return true;
      case 'goStore': openDialog('store'); return true;
      case 'goLogin': openDialog('login'); return true;
      case 'jumpCategory': jumpCategory(parseInt(k, 10)); return true;
      case 'toggleLayout': toggleLayout(); return true;
      case 'addFocused': { const p = focusedCard(); if (p) cardAdd(p.id, true); else announce('請先以方向鍵選取商品'); return true; }
      case 'repeatFocused': {
        const p = focusedCard();
        const m = p && memoryFor(p);
        if (p && m && m.kind === 'options') repeatAdd(p.id, 'card:' + p.id);
        else announce(p ? '這項商品沒有點餐記憶' : '請先以方向鍵選取商品');
        return true;
      }
      case 'toggleFavorite': { const p = focusedCard(); if (p) toggleFav(p.id); else announce('請先以方向鍵選取商品'); return true; }
      case 'qtyUp':
      case 'qtyDown': {
        const delta = r.action === 'qtyUp' ? 1 : -1;
        if (r.scope === 'sheet') {
          state.sheet.qty = Math.max(1, Math.min(20, state.sheet.qty + delta));
          render();
          focusKey(delta > 0 ? 'sheet-inc' : 'sheet-dec');
          announce('數量 ' + state.sheet.qty);
          return true;
        }
        const l = focusedLine();
        if (!l) return false;
        lineQty(l.id, delta);
        return true;
      }
      case 'confirmAdd': commitSheet(); return true;
      case 'restoreDefault': restoreDefault(); return true;
      case 'editLine': { const l = focusedLine(); if (!l) return false; editLine(l.id); return true; }
      case 'removeLine': { const l = focusedLine(); if (!l) return false; askRemove(l.id, 'line:' + l.id); return true; }
      case 'checkout': {
        const a = state.cartOpen ? $('[data-key="cart-checkout"]') : $('[data-key="go-checkout"]');
        if (!a || !a.getAttribute('href') || a.getAttribute('aria-disabled') === 'true') return false;
        location.href = a.getAttribute('href');
        return true;
      }
      case 'back': navigate('menu', { sheet: null }); return true;
      case 'submitOrder': { if (!$('[data-key="submit-order"]')) return false; ckTrySubmit(); return true; }
      case 'again': navigate('menu', { sheet: null }); return true;
      case 'refresh': doRefresh(); return true;
      case 'close': return closeTop();
      default: return false;
    }
  }

  /* Esc 的順序（07 §7.5 的 closeTarget）：關閉最上層浮層 → 收起鍵盤提醒（可見且焦點在其中）→ 搜尋框有字則清除並失焦
     → 其餘不動作（不做頁面返回）。焦點不在提醒內時 Esc 不被提醒劫持 */
  function closeTop() {
    if (state.dialog) { if (state.dialog.type === 'idle') closeDialogIdle(); else closeDialog(); return true; }
    if (state.sheet) { closeSheet(); return true; }
    if (state.cartOpen) { closeCart(); return true; }
    const kc = kbnOpen() && kbnEl();
    if (kc && kc.contains(document.activeElement)) { kbnEsc(); return true; }
    if (state.q) {
      state.q = '';
      render();
      const i = $('[data-search]');
      if (i) { i.value = ''; i.blur(); }
      announce('已清除搜尋');
      return true;
    }
    return false;
  }

  /* 方向鍵（導覽）：商品卡網格、分類膠囊、單選分段控制、購物車品項；不屬於單字元快速鍵 */
  function moveCard(from, key) {
    const els = Array.prototype.slice.call(root.querySelectorAll('.pcard'));
    if (!els.length) return;
    const i = els.indexOf(from);
    let target = null;
    if (key === 'Home') target = els[0];
    else if (key === 'End') target = els[els.length - 1];
    else if (key === 'ArrowRight') target = els[i + 1];
    else if (key === 'ArrowLeft') target = els[i - 1];
    else {
      const r = from.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const down = key === 'ArrowDown';
      const cands = els.filter((x) => { const b = x.getBoundingClientRect(); return down ? b.top >= r.bottom - 4 : b.bottom <= r.top + 4; });
      if (cands.length) {
        const dist = (x) => { const b = x.getBoundingClientRect(); return down ? b.top - r.bottom : r.top - b.bottom; };
        const rowDist = Math.min.apply(null, cands.map(dist));
        const row = cands.filter((x) => dist(x) - rowDist < 24);
        row.sort((a, b) => Math.abs((a.getBoundingClientRect().left + a.getBoundingClientRect().width / 2) - cx) - Math.abs((b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2) - cx));
        target = row[0];
      }
    }
    if (target) target.focus();
  }

  function handleNavKeys(e) {
    const a = document.activeElement;
    if (!a || e.ctrlKey || e.metaKey || e.altKey || state.dialog) return false;
    const k = e.key;
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (a.classList && a.classList.contains('pcard') && !state.sheet && !state.cartOpen) {
      if (arrows.includes(k) || k === 'Home' || k === 'End') { e.preventDefault(); moveCard(a, k); return true; }
      if (k === 'Enter' || k === ' ') {
        e.preventDefault();
        if (a.dataset.pid && !byId(a.dataset.pid).soldOut) { openSheet(a.dataset.pid, null, false, 'card:' + a.dataset.pid); render(); }
        return true;
      }
    }
    if (a.matches && a.matches('.chip[data-action="cat"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(k)) {
      const chips = Array.prototype.slice.call(a.parentElement.querySelectorAll('.chip'));
      const i = chips.indexOf(a);
      const t = k === 'Home' ? chips[0] : k === 'End' ? chips[chips.length - 1] : chips[i + (k === 'ArrowRight' ? 1 : -1)];
      if (t) { e.preventDefault(); chips.forEach((c) => c.setAttribute('tabindex', c === t ? '0' : '-1')); t.focus(); }
      return true;
    }
    if (a.matches && a.matches('button[role="radio"]') && arrows.concat(['Home', 'End']).includes(k)) {
      const group = Array.prototype.slice.call(a.parentElement.querySelectorAll('button[role="radio"]'));
      const i = group.indexOf(a);
      const fwd = k === 'ArrowRight' || k === 'ArrowDown';
      const t = k === 'Home' ? group[0] : k === 'End' ? group[group.length - 1] : group[(i + (fwd ? 1 : group.length - 1)) % group.length];
      if (t) { e.preventDefault(); t.click(); }
      return true;
    }
    if (a.classList && a.classList.contains('cartline') && ['ArrowUp', 'ArrowDown'].includes(k)) {
      const lines = Array.prototype.slice.call(a.parentElement.querySelectorAll('.cartline'));
      const t = lines[lines.indexOf(a) + (k === 'ArrowDown' ? 1 : -1)];
      if (t) { e.preventDefault(); t.focus(); }
      return true;
    }
    return false;
  }

  /* 搜尋框內 ↓ 或 Enter：把焦點移到第一個結果商品卡（元件原生導覽，不屬於單字元快速鍵；輸入法組字中不處理） */
  function searchToResults(e) {
    if (e.isComposing || e.keyCode === 229 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    if (e.key !== 'ArrowDown' && e.key !== 'Enter') return false;
    const t = e.target;
    if (!t || !t.matches || !t.matches('[data-search]')) return false;
    const first = root.querySelector('#menu .pcard');
    if (!first) return false;
    e.preventDefault();
    first.focus();
    return true;
  }

  function trapTab(e) {
    const ov = topOverlay();
    if (!ov) return;
    const f = focusablesIn(ov);
    if (!f.length) { e.preventDefault(); ov.focus(); return; }
    const first = f[0];
    const last = f[f.length - 1];
    const a = document.activeElement;
    if (!ov.contains(a)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && (a === first || a === ov || a.getAttribute('tabindex') === '-1')) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  }

  function onKeydown(e) {
    /* 實體鍵盤偵測（只用於提醒，不隱藏或停用任何輸入方式）；觸控面板模式不偵測 */
    if (!KIOSK) kbnDetect(e);
    if (e.key === 'Tab') { trapTab(e); return; }
    /* 觸控面板：不偵測、無單鍵快速鍵與方向鍵導覽（hotkeysEnabled() 為 false，resolveHotkey 只讓 alwaysOn 的
       Esc 與 Ctrl/⌘ + Enter 通過；Esc 以 closeTop 關閉任何浮層，閒置警示 = 繼續點餐） */
    if (!KIOSK) {
      if (searchToResults(e)) return;
      /* 方向鍵導覽（非單字元快速鍵）：不受快速鍵開關影響，輸入法組字中不處理 */
      if (!e.isComposing && e.keyCode !== 229 && !isEditableTarget(e.target) && handleNavKeys(e)) return;
    }
    const r = resolveHotkey(e, scopeCtx(e));
    if (!r) return;
    if (perform(r)) e.preventDefault();
  }
  document.addEventListener('keydown', onKeydown, true);
  ['pointerdown', 'touchstart', 'keydown'].forEach((t) => document.addEventListener(t, () => { if (KIOSK) armIdle(); }, true));

  /* ------------------------------------------------------------------ 11. 啟動 */
  mountAux();
  syncHints();
  syncPrefs();
  html.dataset.large = '0';
  if (P.screen === 'sheet') {
    state.activeCard = P.sheet;
    openSheet(P.sheet, null, true, 'card:' + P.sheet);
  }
  if (P.screen === 'shortcuts') state.dialog = { type: 'shortcuts' };
  if (P.screen === 'idle') state.dialog = { type: 'idle', left: 30 };
  if (P.focus) state.activeCard = P.focus;
  render();
  if (P.focus && P.screen !== 'sheet') {
    html.classList.add('kbd-nav');
    const c = cardEl(P.focus);
    if (c) c.focus({ preventScroll: true });
  }
  if (P.screen === 'idle') { startIdleCountdown(); announce('還在嗎？30 秒後將重新開始，購物車會清空', true); }
  kbnInit();
  if (P.screen === 'checkout') {
    /* 結帳頁首預留高度（min-height）的狀態列：先「正在確認餐點與時段…」，再依結果切換（不位移版面） */
    if (P.issues === 'done') { ckApplyCore(); state.ck.expanded = false; state.ck.rejected = false; render(); }
    if (CK_ON && P.issues === '1') ckFocusTitle({ scroll: false });
    setTimeout(() => {
      state.ck.phase = 'ready';
      const el = document.getElementById('cx-status');
      if (el) {
        const tmp = document.createElement('div');
        tmp.innerHTML = ckStatusHTML(ckModel());
        el.replaceWith(tmp.firstElementChild);
      }
      const m = ckModel();
      if (m.blocking > 0 && !state.ck.expanded) announce(m.items.map((i) => ckItemView(i).name + ckItemView(i).why).join('；') + '，結帳頁已標示');
    }, 600);
  }
  if (P.screen === 'done') startDoneCountdown();
  if (KIOSK) armIdle();
  if (location.hash === '#search') focusSearch();
  if (location.hash === '#cart') openCart();
})();
