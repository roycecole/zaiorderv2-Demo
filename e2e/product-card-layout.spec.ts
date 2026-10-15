// 商品卡版面對齊不變式（03 §6.6 ProductCard 規格、§6.7 資料缺漏與降級；FLOW-17）
//
// 量測 getBoundingClientRect，而不是比對像素：
//   (i)   動作群組右緣 = 縮圖右緣（有圖時）= 卡片內容區右緣（±1px）
//   (ii)  價格左緣 = 愛心圖示左緣（無愛心時為品名左緣）= 描述左緣（±2px）
//   (iii) 價格與動作同列時，垂直中線差 ≤ 1px
//   (iv)  縮圖頂端 = 品名列頂端（±2px）；底列位於縮圖下方
//   (v)   無水平捲動、元素互不重疊、都在卡片內
//   (vi)  愛心在品名左側（x 較小且同一列）；熱區 ≥ 44，且只向左與上下擴張，不蓋住品名（品名最左幾個像素點下去
//         是開面板，不是切換收藏）
//   (vii) 窄卡一律堆疊：內容寬 < 門檻（13.5rem；觸控面板 15.5rem，與 ProductCard 的容器查詢一致）時，
//         價格一列、動作一列（靠右）；其餘寬度價格與動作同列。型態只由卡片寬度決定，不依價格字數或動作種類，
//         因此同一畫面內所有卡片同型態、同排卡片的價格與按鈕縱向位置相同（見「窄欄一致性」）
//   (viii) 品名最多 2 行（03 §6.6、EC-21）：長品名以內層 span 截行，卡片高度不隨字數暴增
//   (ix)  數量徽章：與卡片外框 ≥ 4px；連同 2px 白色光暈不蓋到縮圖、文字行、價格與按鈕文字
// LIST 版面各變體（有圖、缺圖、精簡、再點、步進器、售完、限量）× 375 / 768 / 1280；GRID 另驗愛心在品名前、
// 底列左右與圖片齊。設定環境變數 CARD_SHOTS_DIR 時，另把每張卡的截圖存到該目錄（供人工檢視）。
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { addViaSheet, gotoApp, productCard, quickAdd } from './helpers/app';
import {
  DEMO_SECTION,
  loadRememberedSample,
  quickLoginDemoUser,
  setManualSoldOut,
  setMenuProfile,
  withDemoSection,
} from './helpers/demo';

const WIDTHS = [375, 768, 1280] as const;
const SHOTS_DIR = process.env.CARD_SHOTS_DIR;

// ── 量測 ─────────────────────────────────────────────────────────────────────

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

type ProbeOwner = 'heart' | 'other' | 'covered' | 'outside';

interface CardMetrics {
  card: Box;
  /** 卡片內容區（扣除邊框與內距）的左右緣 */
  content: { left: number; right: number };
  title: Box;
  name: Box;
  favorite: Box | null;
  favoriteIcon: Box | null;
  /** 愛心按鈕偽元素（熱區）的尺寸 */
  favoriteHit: { width: number; height: number } | null;
  /**
   * 愛心熱區探測（elementFromPoint）：品名最左側各點是否落在愛心上（應為空）；
   * 熱區左緣、上緣、下緣的點屬於 'heart'（熱區如宣告）、'other'（被卡片內其他元素蓋住）、
   * 'covered'（被固定 / 黏附的外殼元素蓋住，無法判斷）或 'outside'（落在卡片外的一般內容）
   */
  favoriteProbe: {
    nameEdgeHits: number[];
    left: ProbeOwner;
    top: ProbeOwner;
    bottom: ProbeOwner;
  } | null;
  /** 品名一行的行高（px）：品名高度 ≤ 2 行 */
  nameLineHeight: number;
  /** 品名文字是否被截斷（內層 span 的內容高於可見高度） */
  nameClamped: boolean;
  /** 數量徽章（已在購物車）與其宿主按鈕內的文字範圍 */
  badge: Box | null;
  badgeText: Box | null;
  media: Box | null;
  thumb: Box | null;
  desc: Box | null;
  price: Box;
  actions: Box;
  /** 動作群組內第一個可操作元件（步進器為「−」） */
  control: Box;
  footer: Box;
  /** 品名列內品名以外的標籤（徽章） */
  tags: Box[];
  /** 互不得重疊的區塊 */
  blocks: Array<{ label: string; box: Box }>;
  cardOverflow: boolean;
  /** 窄卡堆疊門檻（px）：卡片內容寬低於此值時，底列固定為價格一列、動作一列 */
  stackBelow: number;
}

type RawMetrics = Omit<CardMetrics, 'stackBelow'> & { rootPx: number; kiosk: boolean };

/** 與 ProductCard 底列的容器查詢門檻一致（rem；以 html 基準字級換算） */
const STACK_BELOW_REM = 13.5;
const STACK_BELOW_REM_KIOSK = 15.5;

async function measure(card: Locator): Promise<CardMetrics> {
  const raw = await card.evaluate((el): RawMetrics => {
    const box = (e: Element | null): Box | null => {
      if (e === null) return null;
      const b = e.getBoundingClientRect();
      return {
        left: b.left,
        right: b.right,
        top: b.top,
        bottom: b.bottom,
        width: b.width,
        height: b.height,
        cx: b.left + b.width / 2,
        cy: b.top + b.height / 2,
      };
    };
    const need = (e: Element | null, what: string): Box => {
      const b = box(e);
      if (b === null) throw new Error(`商品卡缺少 ${what}`);
      return b;
    };
    const part = (name: string): Element | null => el.querySelector(`[data-card-part="${name}"]`);
    const style = getComputedStyle(el);
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const kiosk = document.documentElement.getAttribute('data-mode') === 'kiosk';
    const cardBox = need(el, '卡片');
    const favorite = part('favorite');
    const favoriteAfter = favorite === null ? null : getComputedStyle(favorite, '::after');
    const title = part('title');
    const actions = part('actions');
    const tags = title === null ? [] : Array.from(title.children).slice(1);
    const nameEl = part('name');
    const nameLineHeight = nameEl === null ? 0 : parseFloat(getComputedStyle(nameEl).lineHeight);
    const nameSpan = nameEl?.querySelector('button > span') ?? null;
    const badgeEl = part('badge');
    // 徽章宿主按鈕內的文字（不含徽章本身）：以 Range 量測實際文字範圍
    let badgeText: Box | null = null;
    const host = badgeEl?.parentElement ?? null;
    if (host !== null) {
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      let l = Infinity;
      let r = -Infinity;
      let t = Infinity;
      let b = -Infinity;
      for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        if (badgeEl?.contains(n) === true || (n.textContent ?? '').trim() === '') continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const rect = range.getBoundingClientRect();
        l = Math.min(l, rect.left);
        r = Math.max(r, rect.right);
        t = Math.min(t, rect.top);
        b = Math.max(b, rect.bottom);
      }
      if (Number.isFinite(l)) {
        badgeText = {
          left: l,
          right: r,
          top: t,
          bottom: b,
          width: r - l,
          height: b - t,
          cx: (l + r) / 2,
          cy: (t + b) / 2,
        };
      }
    }
    // 愛心熱區探測
    const nameBox = box(nameEl);
    const favBox = box(favorite);
    let favoriteProbe: CardMetrics['favoriteProbe'] = null;
    if (favorite !== null && favoriteAfter !== null && nameBox !== null && favBox !== null) {
      const owner = (x: number, y: number): ProbeOwner => {
        const hit = document.elementFromPoint(x, y);
        if (hit === null) return 'outside';
        if (!el.contains(hit)) {
          // 外殼的固定 / 黏附元素（頂列、分類列、購物車列、Toast）蓋住該點
          for (let n: Element | null = hit; n !== null; n = n.parentElement) {
            const position = getComputedStyle(n).position;
            if (position === 'fixed' || position === 'sticky') return 'covered';
          }
          return 'outside';
        }
        return favorite.contains(hit) ? 'heart' : 'other';
      };
      const hitW = parseFloat(favoriteAfter.width);
      const hitH = parseFloat(favoriteAfter.height);
      const midY = nameBox.top + nameLineHeight / 2;
      favoriteProbe = {
        nameEdgeHits: [0.5, 1, 2, 3, 4, 6, 8].filter(
          (dx) => owner(nameBox.left + dx, midY) === 'heart',
        ),
        left: owner(favBox.right - hitW + 1, favBox.cy),
        top: owner(favBox.cx, favBox.cy - hitH / 2 + 1),
        bottom: owner(favBox.cx, favBox.cy + hitH / 2 - 1),
      };
    }
    const blocks: CardMetrics['blocks'] = [];
    const push = (label: string, e: Element | null): void => {
      const b = box(e);
      if (b !== null && b.width > 0 && b.height > 0) blocks.push({ label, box: b });
    };
    if (title !== null && title.firstElementChild !== null) push('品名組', title.firstElementChild);
    tags.forEach((tag, i) => push(`標籤 ${i + 1}`, tag));
    el.querySelectorAll('p').forEach((p, i) => {
      if (actions === null || !actions.contains(p)) push(`文字行 ${i + 1}`, p);
    });
    push('縮圖', part('thumb'));
    push('價格', part('price'));
    push('動作', actions);
    return {
      card: cardBox,
      content: {
        left: cardBox.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
        right: cardBox.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
      },
      title: need(title, '品名列'),
      name: need(part('name'), '品名'),
      favorite: box(favorite),
      favoriteIcon: box(favorite?.querySelector('svg') ?? null),
      favoriteHit:
        favoriteAfter === null
          ? null
          : {
              width: parseFloat(favoriteAfter.width),
              height: parseFloat(favoriteAfter.height),
            },
      media: box(part('media')),
      thumb: box(part('thumb')),
      desc: box(part('desc')),
      price: need(part('price'), '價格'),
      actions: need(actions, '動作群組'),
      control: need(actions?.querySelector('button') ?? null, '動作按鈕'),
      footer: need(part('footer'), '底列'),
      tags: tags.map((t) => box(t)).filter((b): b is Box => b !== null),
      blocks,
      favoriteProbe,
      nameLineHeight,
      nameClamped: nameSpan !== null && nameSpan.scrollHeight > nameSpan.clientHeight + 1,
      badge: box(badgeEl),
      badgeText,
      cardOverflow: el.scrollWidth > el.clientWidth + 1,
      rootPx,
      kiosk,
    };
  });
  const { rootPx, kiosk, ...rest } = raw;
  return { ...rest, stackBelow: (kiosk ? STACK_BELOW_REM_KIOSK : STACK_BELOW_REM) * rootPx };
}

const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
const fmt = (n: number): string => n.toFixed(1);

function overlaps(a: Box, b: Box): boolean {
  const eps = 0.5;
  return (
    a.left < b.right - eps &&
    b.left < a.right - eps &&
    a.top < b.bottom - eps &&
    b.top < a.bottom - eps
  );
}

/** 所有版面共通：互不重疊、都在卡片內、卡片內沒有水平溢出 */
function commonProblems(m: CardMetrics): string[] {
  const problems: string[] = [];
  const eps = 0.5;
  for (let i = 0; i < m.blocks.length; i += 1) {
    const a = m.blocks[i];
    if (a === undefined) continue;
    if (
      a.box.left < m.card.left - eps ||
      a.box.right > m.card.right + eps ||
      a.box.top < m.card.top - eps ||
      a.box.bottom > m.card.bottom + eps
    ) {
      problems.push(`${a.label} 超出卡片`);
    }
    for (let j = i + 1; j < m.blocks.length; j += 1) {
      const b = m.blocks[j];
      if (b !== undefined && overlaps(a.box, b.box)) problems.push(`${a.label} 與 ${b.label} 重疊`);
    }
  }
  if (m.cardOverflow) problems.push('卡片內有水平溢出');
  // (viii) 品名最多 2 行
  if (m.nameLineHeight > 0 && m.name.height > m.nameLineHeight * 2 + 1) {
    problems.push(
      `品名高 ${fmt(m.name.height)} 超過 2 行（行高 ${fmt(m.nameLineHeight)}）：截行沒有生效`,
    );
  }
  problems.push(...badgeProblems(m));
  return problems;
}

/** (ix) 數量徽章：與卡片外框 ≥ 4px；連同光暈不蓋到縮圖、文字行、價格與按鈕文字 */
function badgeProblems(m: CardMetrics): string[] {
  const problems: string[] = [];
  const badge = m.badge;
  if (badge === null) return problems;
  const GLOW = 2;
  const edge = {
    右: m.card.right - badge.right,
    上: badge.top - m.card.top,
    下: m.card.bottom - badge.bottom,
    左: badge.left - m.card.left,
  };
  for (const [side, gap] of Object.entries(edge)) {
    if (gap < 4 - 0.5) problems.push(`數量徽章${side}側離卡片外框只有 ${fmt(gap)}px（應 ≥ 4）`);
  }
  const glow: Box = {
    ...badge,
    left: badge.left - GLOW,
    right: badge.right + GLOW,
    top: badge.top - GLOW,
    bottom: badge.bottom + GLOW,
  };
  for (const { label, box: b } of m.blocks) {
    if (label === '動作') continue; // 徽章屬於動作群組的按鈕
    if (overlaps(glow, b)) problems.push(`數量徽章（含光暈）與 ${label} 重疊`);
  }
  // 按鈕文字：徽章是膠囊形（半徑 = 高 / 2），以「膠囊中心線到文字範圍的最短距離 − 半徑」為淨空；含光暈仍應 ≥ 0
  if (m.badgeText !== null) {
    const radius = badge.height / 2;
    const clearance =
      distanceSegmentToBox(badge.left + radius, badge.right - radius, badge.cy, m.badgeText) -
      radius;
    if (clearance < GLOW) {
      problems.push(
        `數量徽章離按鈕文字只有 ${fmt(clearance)}px（光暈 ${GLOW}px，應 ≥ ${GLOW}）；` +
          `徽章左緣 ${fmt(badge.left)}，文字右緣 ${fmt(m.badgeText.right)}`,
      );
    }
  }
  return problems;
}

/** 水平線段（x1..x2，y）到矩形的最短距離；相交為 0 */
function distanceSegmentToBox(x1: number, x2: number, y: number, box: Box): number {
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  if (y >= box.top && y <= box.bottom && hi >= box.left && lo <= box.right) return 0;
  const dy = Math.max(box.top - y, 0, y - box.bottom);
  const dx = Math.max(box.left - hi, 0, lo - box.right);
  return Math.hypot(dx, dy);
}

/** 愛心：在品名左側、同一列，熱區 ≥ 44 */
function favoriteProblems(m: CardMetrics): string[] {
  const problems: string[] = [];
  if (m.favorite === null || m.favoriteIcon === null) return problems;
  if (!(m.favorite.cx < m.name.left)) problems.push('愛心不在品名左側');
  if (!(m.favorite.cy >= m.name.top - 1 && m.favorite.cy <= m.name.bottom + 1)) {
    problems.push(
      `愛心與品名不同列（愛心中線 ${fmt(m.favorite.cy)}，品名 ${fmt(m.name.top)}–${fmt(m.name.bottom)}）`,
    );
  }
  if (m.favoriteHit === null || m.favoriteHit.width < 43.5 || m.favoriteHit.height < 43.5) {
    problems.push(`愛心熱區不足 44（${JSON.stringify(m.favoriteHit)}）`);
  }
  // 熱區不得蓋住品名；向左與上下擴張（偽元素右緣與按鈕右緣齊）
  const probe = m.favoriteProbe;
  if (probe !== null) {
    if (probe.nameEdgeHits.length > 0) {
      problems.push(
        `愛心熱區蓋住品名最左側（品名左緣 +${probe.nameEdgeHits.join('、')}px 的點會點到愛心）`,
      );
    }
    if (probe.left !== 'heart' && probe.left !== 'covered') {
      problems.push(`愛心熱區左緣的點不屬於愛心（${probe.left}）`);
    }
    if (probe.top === 'other') problems.push('愛心熱區上緣的點被卡片內其他元素蓋住');
    if (probe.bottom === 'other') problems.push('愛心熱區下緣的點被卡片內其他元素蓋住');
  }
  if (m.name.left < m.favorite.right - 0.5) {
    problems.push(
      `品名左緣 ${fmt(m.name.left)} 在愛心按鈕右緣 ${fmt(m.favorite.right)} 之內：愛心與品名重疊`,
    );
  }
  return problems;
}

/** 價格與動作是否分成兩列（動作在價格下方） */
function isStacked(m: Pick<CardMetrics, 'price' | 'actions'>): boolean {
  return m.actions.top >= m.price.bottom - 1;
}

/**
 * 底列（vii）：窄卡一律堆疊，其餘同列；同列時價格與動作的垂直中線相同。
 * 型態只由卡片內容寬決定（不看價格字數與動作種類），空間夠時也不得自行換行。
 */
function footerProblems(m: CardMetrics): string[] {
  const problems: string[] = [];
  const contentWidth = m.content.right - m.content.left;
  const shouldStack = contentWidth < m.stackBelow;
  const stacked = isStacked(m);
  if (shouldStack && !stacked) {
    problems.push(
      `窄卡（內容寬 ${fmt(contentWidth)} < ${fmt(m.stackBelow)}）應堆疊，但價格與動作在同一列`,
    );
  }
  if (!shouldStack && stacked) {
    problems.push(
      `內容寬 ${fmt(contentWidth)} ≥ ${fmt(m.stackBelow)}，價格與動作應在同一列，但動作換行了`,
    );
  }
  if (!stacked && !near(m.price.cy, m.control.cy, 1)) {
    problems.push(`價格中線 ${fmt(m.price.cy)} ≠ 動作中線 ${fmt(m.control.cy)}`);
  }
  return problems;
}

export interface ListExpect {
  /** 預期有縮圖（有圖或載入失敗的佔位縮圖） */
  thumb: boolean;
  /** 預期有愛心（會員） */
  heart: boolean;
}

function listProblems(m: CardMetrics, expectation: ListExpect): string[] {
  const problems = [...commonProblems(m), ...favoriteProblems(m)];
  if ((m.thumb !== null) !== expectation.thumb) {
    problems.push(`縮圖：預期 ${expectation.thumb ? '有' : '無'}`);
  }
  if ((m.favorite !== null) !== expectation.heart) {
    problems.push(`愛心：預期 ${expectation.heart ? '有' : '無'}`);
  }
  // (i) 右緣
  if (!near(m.actions.right, m.content.right, 1)) {
    problems.push(`動作右緣 ${fmt(m.actions.right)} ≠ 內容區右緣 ${fmt(m.content.right)}`);
  }
  if (m.thumb !== null) {
    if (!near(m.thumb.right, m.content.right, 1)) {
      problems.push(`縮圖右緣 ${fmt(m.thumb.right)} ≠ 內容區右緣 ${fmt(m.content.right)}`);
    }
    if (!near(m.actions.right, m.thumb.right, 1)) {
      problems.push(`動作右緣 ${fmt(m.actions.right)} ≠ 縮圖右緣 ${fmt(m.thumb.right)}`);
    }
    // (iv) 縮圖頂端 = 品名列頂端；底列在縮圖下方
    if (!near(m.thumb.top, m.title.top, 2)) {
      problems.push(`縮圖頂端 ${fmt(m.thumb.top)} ≠ 品名列頂端 ${fmt(m.title.top)}`);
    }
    if (m.footer.top < m.thumb.bottom - 0.5) {
      problems.push(`底列頂端 ${fmt(m.footer.top)} 在縮圖底端 ${fmt(m.thumb.bottom)} 之上`);
    }
    if (!near(m.thumb.width, 88, 1) && !near(m.thumb.width, 104, 1)) {
      problems.push(`縮圖寬 ${fmt(m.thumb.width)} 不是 88`);
    }
  }
  // (ii) 左緣
  const left = m.favoriteIcon?.left ?? m.name.left;
  if (!near(m.price.left, left, 2)) {
    problems.push(
      `價格左緣 ${fmt(m.price.left)} ≠ ${m.favoriteIcon ? '愛心' : '品名'}左緣 ${fmt(left)}`,
    );
  }
  if (!near(m.price.left, m.content.left, 2)) {
    problems.push(`價格左緣 ${fmt(m.price.left)} ≠ 內容區左緣 ${fmt(m.content.left)}`);
  }
  if (m.desc !== null && !near(m.price.left, m.desc.left, 2)) {
    problems.push(`價格左緣 ${fmt(m.price.left)} ≠ 描述左緣 ${fmt(m.desc.left)}`);
  }
  // (iii)(vii) 底列：窄卡堆疊、其餘同列且中線相同
  problems.push(...footerProblems(m));
  return problems;
}

function gridProblems(m: CardMetrics, expectation: { heart: boolean }): string[] {
  const problems = [...commonProblems(m), ...favoriteProblems(m)];
  const media = m.media;
  if (media === null) return [...problems, '圖卡沒有圖片區'];
  if ((m.favorite !== null) !== expectation.heart) {
    problems.push(`愛心：預期 ${expectation.heart ? '有' : '無'}`);
  }
  if (m.favorite !== null && m.favorite.top < media.bottom - 0.5) {
    problems.push('愛心浮在圖片上，應在品名前');
  }
  // 價格左緣 = 圖片左緣 = 愛心圖示左緣；動作右緣 = 圖片右緣
  if (!near(m.price.left, media.left, 2)) {
    problems.push(`價格左緣 ${fmt(m.price.left)} ≠ 圖片左緣 ${fmt(media.left)}`);
  }
  const left = m.favoriteIcon?.left ?? m.name.left;
  if (!near(m.price.left, left, 2)) {
    problems.push(
      `價格左緣 ${fmt(m.price.left)} ≠ ${m.favoriteIcon ? '愛心' : '品名'}左緣 ${fmt(left)}`,
    );
  }
  if (m.desc !== null && !near(m.price.left, m.desc.left, 2)) {
    problems.push(`價格左緣 ${fmt(m.price.left)} ≠ 描述左緣 ${fmt(m.desc.left)}`);
  }
  if (!near(m.actions.right, media.right, 1)) {
    problems.push(`動作右緣 ${fmt(m.actions.right)} ≠ 圖片右緣 ${fmt(media.right)}`);
  }
  // 標籤在圖片左上角（圖片區內，靠左）
  for (const tag of m.tags) {
    if (tag.left < media.left - 0.5 || tag.right > media.right + 0.5) {
      problems.push('標籤超出圖片區');
    }
  }
  problems.push(...footerProblems(m));
  return problems;
}

async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
    innerWidth: window.innerWidth,
  }));
  expect(
    scrollWidth,
    `${label}：scrollWidth ${scrollWidth} 不得大於 innerWidth ${innerWidth}`,
  ).toBeLessThanOrEqual(innerWidth);
}

async function shot(card: Locator, name: string): Promise<void> {
  if (SHOTS_DIR === undefined) return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  await card.scrollIntoViewIfNeeded();
  // 浮動元件（Toast、Demo 入口鈕、購物車列）可能蓋住卡片：截圖時暫時隱藏與卡片相交的固定定位元素
  const hidden = await card.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const touched: HTMLElement[] = [];
    document.querySelectorAll<HTMLElement>('body *').forEach((node) => {
      if (node.contains(el) || el.contains(node)) return;
      if (getComputedStyle(node).position !== 'fixed') return;
      const b = node.getBoundingClientRect();
      if (b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom) return;
      node.dataset.shotHidden = node.style.visibility;
      node.style.visibility = 'hidden';
      touched.push(node);
    });
    return touched.length;
  });
  await card.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
  if (hidden > 0) {
    await card.evaluate(() => {
      document.querySelectorAll<HTMLElement>('[data-shot-hidden]').forEach((node) => {
        node.style.visibility = node.dataset.shotHidden ?? '';
        delete node.dataset.shotHidden;
      });
    });
  }
}

async function checkList(
  page: Page,
  productId: string,
  expectation: ListExpect,
  label: string,
  width: number,
): Promise<CardMetrics> {
  const card = productCard(page, productId);
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  const m = await measure(card);
  expect(listProblems(m, expectation), `${label}（${productId}，${width}px）`).toEqual([]);
  await shot(card, `${label}-${width}`);
  return m;
}

async function checkGrid(
  page: Page,
  productId: string,
  expectation: { heart: boolean },
  label: string,
  width: number,
): Promise<CardMetrics> {
  const card = productCard(page, productId);
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  const m = await measure(card);
  expect(gridProblems(m, expectation), `${label}（${productId}，${width}px）`).toEqual([]);
  await shot(card, `${label}-${width}`);
  return m;
}

/** 以 Demo 面板把商品的「剩餘份數」設為 n（限量） */
async function setRemaining(
  page: Page,
  productName: string,
  label: '剩 1 份' | '剩 2 份',
): Promise<void> {
  await withDemoSection(page, DEMO_SECTION.stock, async (s) => {
    await s.getByRole('combobox', { name: '商品' }).selectOption({ label: productName });
    await s.getByRole('button', { name: label, exact: true }).click();
  });
}

async function chooseLayout(page: Page, label: '清單' | '圖卡'): Promise<void> {
  const radio = page.getByRole('radio', { name: label });
  // 原生 radio 是 sr-only，點擊會落在外層 label 上：直接點 label 內的文字
  await radio.check({ force: true });
  await expect(radio).toBeChecked();
}

// ── LIST ─────────────────────────────────────────────────────────────────────

for (const width of WIDTHS) {
  test.describe(`商品卡版面（清單）${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('會員：有圖、缺圖、再點、步進器、限量、售完 @mobile', async ({ page }) => {
      await gotoApp(page);
      await quickLoginDemoUser(page);
      await chooseLayout(page, '清單');
      await expect(productCard(page, 'prd_beef_noodle')).toBeVisible();
      // 預備：嘉義雞肉飯手動售完（有圖 + 售完）；招牌雞腿飯加入購物車（步進器）；古早味排骨飯限量剩 2 份並加到上限
      await setManualSoldOut(page, '嘉義雞肉飯', true);
      await setRemaining(page, '古早味排骨飯', '剩 2 份');
      await expect(productCard(page, 'prd_pork_chop')).toContainText('剩 2 份');
      await quickAdd(page, '招牌雞腿飯');
      await expect(productCard(page, 'prd_chicken_leg').getByRole('spinbutton')).toHaveText('1');
      await quickAdd(page, '古早味排骨飯');
      await page.getByRole('button', { name: '增加一份 古早味排骨飯' }).click();
      await expect(
        productCard(page, 'prd_pork_chop').getByText('今日只剩 2 份，已達上限'),
      ).toBeVisible();

      // 卡 1：有圖、愛心（已收藏）、熱銷 + 店長推薦、描述、上次選項、「↻ 再點」+「＋」
      const memory = await checkList(
        page,
        'prd_beef_noodle',
        { thumb: true, heart: true },
        'list-image-memory',
        width,
      );
      expect(memory.tags.length, '標籤數').toBeGreaterThanOrEqual(2);
      await expect(
        productCard(page, 'prd_beef_noodle').getByRole('button', { name: /^再點 紅燒牛肉麵/ }),
      ).toBeVisible();
      // 卡 2：有圖、起價、「＋ 加入」
      await checkList(
        page,
        'prd_oyster_vermicelli',
        { thumb: true, heart: true },
        'list-image-plain',
        width,
      );
      // 限量：有圖 + 「剩 5 份」標籤
      await expect(productCard(page, 'prd_combo_share')).toContainText('剩 5 份');
      await checkList(
        page,
        'prd_combo_share',
        { thumb: true, heart: true },
        'list-image-limited',
        width,
      );
      // 缺圖：有描述、無標籤；有描述 + 標籤；完全精簡（卡 3）
      await checkList(
        page,
        'prd_clam_soup',
        { thumb: false, heart: true },
        'list-noimage-desc',
        width,
      );
      await checkList(
        page,
        'prd_combo_single',
        { thumb: false, heart: true },
        'list-noimage-desc-tag',
        width,
      );
      const bare = await checkList(
        page,
        'prd_wonton_soup',
        { thumb: false, heart: true },
        'list-noimage-bare',
        width,
      );
      // 精簡卡：兩列（品名列 → 底列），價格在左下、動作在右下
      expect(bare.footer.top, '精簡卡的底列在品名列之下').toBeGreaterThanOrEqual(
        bare.title.bottom - 0.5,
      );
      expect(bare.card.height, '精簡卡最小高度').toBeGreaterThanOrEqual(56);
      // 步進器（無圖）與步進器達上限（說明列在底列下方，不影響價格與按鈕的對齊）
      await checkList(
        page,
        'prd_chicken_leg',
        { thumb: false, heart: true },
        'list-stepper',
        width,
      );
      await checkList(
        page,
        'prd_pork_chop',
        { thumb: false, heart: true },
        'list-stepper-max',
        width,
      );
      // 售完：無圖與有圖
      await expect(productCard(page, 'prd_kong_rou')).toContainText('今日售完');
      await checkList(page, 'prd_kong_rou', { thumb: false, heart: true }, 'list-soldout', width);
      await expect(productCard(page, 'prd_chicken_rice')).toContainText('今日售完');
      await checkList(
        page,
        'prd_chicken_rice',
        { thumb: true, heart: true },
        'list-soldout-image',
        width,
      );

      await expectNoHorizontalScroll(page, '菜單頁');
    });

    test('訪客：沒有愛心時價格左緣與品名左緣對齊；再點、精簡', async ({ page }) => {
      await gotoApp(page);
      await loadRememberedSample(page);
      await chooseLayout(page, '清單');
      await expect(productCard(page, 'prd_beef_noodle')).toContainText('上次：細麵・不辣');
      await checkList(
        page,
        'prd_beef_noodle',
        { thumb: true, heart: false },
        'guest-image-memory',
        width,
      );
      await checkList(
        page,
        'prd_oyster_vermicelli',
        { thumb: true, heart: false },
        'guest-image-plain',
        width,
      );
      await checkList(
        page,
        'prd_wonton_soup',
        { thumb: false, heart: false },
        'guest-noimage-bare',
        width,
      );
      await checkList(page, 'prd_kong_rou', { thumb: false, heart: false }, 'guest-soldout', width);
      await expectNoHorizontalScroll(page, '菜單頁（訪客）');
    });

    test('會員：數量徽章離外框 ≥ 4px，不蓋到縮圖、價格與按鈕文字', async ({ page }) => {
      await gotoApp(page);
      await quickLoginDemoUser(page);
      await chooseLayout(page, '清單');
      const beef = productCard(page, 'prd_beef_noodle');
      await expect(beef).toBeVisible();
      // 「↻ 再點」：紅燒牛肉麵已在購物車，徽章在「＋」圓鈕右上角
      await beef.getByRole('button', { name: /^再點 紅燒牛肉麵/ }).click();
      await expect(beef.locator('[data-card-part="badge"]')).toHaveText('1');
      const repeat = await checkList(
        page,
        'prd_beef_noodle',
        { thumb: true, heart: true },
        'list-badge-repeat',
        width,
      );
      expect(repeat.badge, '再點：徽章').not.toBeNull();
      // 「＋ 加入」（有圖、必選選項）：徽章在按鈕右上角，與「加入」文字之間留有淨空
      await addViaSheet(page, '蚵仔麵線');
      await expect(
        productCard(page, 'prd_oyster_vermicelli').locator('[data-card-part="badge"]'),
      ).toHaveText('1');
      const add = await checkList(
        page,
        'prd_oyster_vermicelli',
        { thumb: true, heart: true },
        'list-badge-add',
        width,
      );
      expect(add.badge, '加入：徽章').not.toBeNull();
      expect(add.badgeText, '加入：按鈕文字').not.toBeNull();
      // 缺圖 / 精簡卡
      await addViaSheet(page, '鮮肉餛飩湯');
      await checkList(
        page,
        'prd_wonton_soup',
        { thumb: false, heart: true },
        'list-badge-bare',
        width,
      );
      await expectNoHorizontalScroll(page, '菜單頁（已在購物車）');
    });

    test('愛心熱區不蓋住品名：點品名最左側開啟面板，不切換收藏', async ({ page }) => {
      await gotoApp(page);
      await quickLoginDemoUser(page);
      await chooseLayout(page, '清單');
      // 收藏清單載入後（紅燒牛肉麵是種子收藏）才讀取初始狀態
      await expect(
        productCard(page, 'prd_beef_noodle').locator('[data-card-part="favorite"]'),
      ).toHaveAttribute('aria-pressed', 'true');
      for (const [id, name] of [
        ['prd_beef_noodle', '紅燒牛肉麵'],
        ['prd_wonton_soup', '鮮肉餛飩湯'],
      ] as const) {
        const card = productCard(page, id);
        await card.scrollIntoViewIfNeeded();
        const heart = card.locator('[data-card-part="favorite"]');
        const pressed = await heart.getAttribute('aria-pressed');
        // 品名按鈕最左側的 2px：以前被愛心的 44px 熱區蓋住，點下去會誤切換收藏
        await card.locator('[data-card-part="name"] button').click({ position: { x: 1, y: 10 } });
        const sheet = page.getByRole('dialog', { name });
        await expect(sheet, `${name}：開啟商品面板`).toBeVisible();
        await expect(heart, `${name}：收藏狀態不變`).toHaveAttribute('aria-pressed', pressed ?? '');
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
      }
    });

    test('精簡菜單：品名列 → 底列兩列，價格靠左、動作靠右 @mobile', async ({ page }) => {
      await gotoApp(page);
      await quickLoginDemoUser(page);
      await setMenuProfile(page, '精簡');
      await expect(page.getByRole('radio', { name: '清單' })).toBeChecked();
      await expect(productCard(page, 'prd_pork_chop')).toBeVisible();
      await expect(page.locator('[data-product-card] img')).toHaveCount(0);
      await quickAdd(page, '古早味排骨飯');
      await expect(productCard(page, 'prd_pork_chop').getByRole('spinbutton')).toHaveText('1');

      const plain = await checkList(
        page,
        'prd_chicken_leg',
        { thumb: false, heart: true },
        'minimal-plain',
        width,
      );
      expect(plain.footer.top).toBeGreaterThanOrEqual(plain.title.bottom - 0.5);
      expect(plain.card.height).toBeGreaterThanOrEqual(56);
      await checkList(
        page,
        'prd_pork_chop',
        { thumb: false, heart: true },
        'minimal-stepper',
        width,
      );
      await expect(productCard(page, 'prd_kong_rou')).toContainText('今日售完');
      await checkList(
        page,
        'prd_kong_rou',
        { thumb: false, heart: true },
        'minimal-soldout',
        width,
      );
      await expectNoHorizontalScroll(page, '精簡菜單');
    });

    test('圖片載入失敗：佔位縮圖仍遵守同一套對齊', async ({ page }) => {
      await page.route('**/images/products/*', (route) => route.abort());
      await gotoApp(page);
      await quickLoginDemoUser(page);
      await chooseLayout(page, '清單');
      const card = productCard(page, 'prd_beef_noodle');
      await expect(card.locator('[data-placeholder]')).toBeVisible();
      await expect(card.locator('img')).toHaveCount(0);
      await checkList(
        page,
        'prd_beef_noodle',
        { thumb: true, heart: true },
        'list-placeholder-memory',
        width,
      );
      await checkList(
        page,
        'prd_oyster_vermicelli',
        { thumb: true, heart: true },
        'list-placeholder-plain',
        width,
      );
      await checkList(
        page,
        'prd_combo_share',
        { thumb: true, heart: true },
        'list-placeholder-limited',
        width,
      );
      await expectNoHorizontalScroll(page, '菜單頁（圖片載入失敗）');
    });
  });
}

// ── GRID ─────────────────────────────────────────────────────────────────────

for (const width of WIDTHS) {
  test.describe(`商品卡版面（圖卡）${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('會員：愛心在品名前（不浮在圖片上）；價格左、動作右與圖片左右齊', async ({ page }) => {
      await gotoApp(page);
      await quickLoginDemoUser(page);
      await chooseLayout(page, '圖卡');
      await expect(productCard(page, 'prd_beef_noodle')).toBeVisible();
      await quickAdd(page, '招牌雞腿飯');
      await expect(productCard(page, 'prd_chicken_leg').getByRole('spinbutton')).toHaveText('1');

      // 窄卡（兩欄）一律堆疊成「價格一列、動作一列」，其餘寬度價格與動作同列（footerProblems）
      await checkGrid(page, 'prd_beef_noodle', { heart: true }, 'grid-image-memory', width);
      await checkGrid(page, 'prd_oyster_vermicelli', { heart: true }, 'grid-image-plain', width);
      await checkGrid(page, 'prd_combo_share', { heart: true }, 'grid-image-limited', width);
      await checkGrid(page, 'prd_wonton_soup', { heart: true }, 'grid-placeholder', width);
      await checkGrid(page, 'prd_chicken_leg', { heart: true }, 'grid-stepper', width);
      await checkGrid(page, 'prd_kong_rou', { heart: true }, 'grid-soldout', width);
      await expectNoHorizontalScroll(page, '菜單頁（圖卡）');
    });

    test('會員：數量徽章離外框 ≥ 4px，不蓋到價格與按鈕文字', async ({ page }) => {
      await gotoApp(page);
      await quickLoginDemoUser(page);
      await chooseLayout(page, '圖卡');
      const beef = productCard(page, 'prd_beef_noodle');
      await expect(beef).toBeVisible();
      await beef.getByRole('button', { name: /^再點 紅燒牛肉麵/ }).click();
      await expect(beef.locator('[data-card-part="badge"]')).toHaveText('1');
      const repeat = await checkGrid(
        page,
        'prd_beef_noodle',
        { heart: true },
        'grid-badge-repeat',
        width,
      );
      expect(repeat.badge, '再點：徽章').not.toBeNull();
      await addViaSheet(page, '蚵仔麵線');
      await expect(
        productCard(page, 'prd_oyster_vermicelli').locator('[data-card-part="badge"]'),
      ).toHaveText('1');
      const add = await checkGrid(
        page,
        'prd_oyster_vermicelli',
        { heart: true },
        'grid-badge-add',
        width,
      );
      expect(add.badge, '加入：徽章').not.toBeNull();
      expect(add.badgeText, '加入：按鈕文字').not.toBeNull();
      await addViaSheet(page, '鮮肉餛飩湯');
      await checkGrid(page, 'prd_wonton_soup', { heart: true }, 'grid-badge-bare', width);
      await expectNoHorizontalScroll(page, '菜單頁（圖卡，已在購物車）');
    });

    test('愛心熱區不蓋住品名：點品名最左側開啟面板，不切換收藏', async ({ page }) => {
      await gotoApp(page);
      await quickLoginDemoUser(page);
      await chooseLayout(page, '圖卡');
      // 收藏清單載入後（紅燒牛肉麵是種子收藏）才讀取初始狀態
      await expect(
        productCard(page, 'prd_beef_noodle').locator('[data-card-part="favorite"]'),
      ).toHaveAttribute('aria-pressed', 'true');
      for (const [id, name] of [
        ['prd_beef_noodle', '紅燒牛肉麵'],
        ['prd_wonton_soup', '鮮肉餛飩湯'],
      ] as const) {
        const card = productCard(page, id);
        await card.scrollIntoViewIfNeeded();
        const heart = card.locator('[data-card-part="favorite"]');
        const pressed = await heart.getAttribute('aria-pressed');
        await card.locator('[data-card-part="name"] button').click({ position: { x: 1, y: 10 } });
        const sheet = page.getByRole('dialog', { name });
        await expect(sheet, `${name}：開啟商品面板`).toBeVisible();
        await expect(heart, `${name}：收藏狀態不變`).toHaveAttribute('aria-pressed', pressed ?? '');
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
      }
    });

    test('訪客：沒有愛心', async ({ page }) => {
      await gotoApp(page);
      await chooseLayout(page, '圖卡');
      await checkGrid(page, 'prd_oyster_vermicelli', { heart: false }, 'guest-grid-image', width);
      await checkGrid(page, 'prd_wonton_soup', { heart: false }, 'guest-grid-placeholder', width);
      await expectNoHorizontalScroll(page, '菜單頁（圖卡，訪客）');
    });
  });
}

// ── 窄欄一致性（圖卡、清單）──────────────────────────────────────────────────

interface FooterCard {
  id: string;
  /** 卡片頂端（同一列的卡片相同） */
  top: number;
  stacked: boolean;
  contentWidth: number;
  stackBelow: number;
  priceTop: number;
  controlTop: number;
  /** 動作群組內有說明列（步進器達上限）：群組較高，價格與按鈕位置因而上移，不納入同排比較 */
  hasNote: boolean;
}

/** 目前畫面上所有商品卡的底列型態與位置 */
async function measureFooters(page: Page): Promise<FooterCard[]> {
  return page.evaluate(
    ({ rem, remKiosk }): FooterCard[] => {
      const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const kiosk = document.documentElement.getAttribute('data-mode') === 'kiosk';
      return Array.from(document.querySelectorAll<HTMLElement>('[data-product-card]')).map((el) => {
        const style = getComputedStyle(el);
        const card = el.getBoundingClientRect();
        const price = el.querySelector('[data-card-part="price"]')?.getBoundingClientRect();
        const actions = el.querySelector('[data-card-part="actions"]');
        const control = actions?.querySelector('button')?.getBoundingClientRect();
        const actionsBox = actions?.getBoundingClientRect();
        if (price === undefined || control === undefined || actionsBox === undefined) {
          throw new Error(`商品卡 ${el.dataset.productCard ?? ''} 缺少價格或動作`);
        }
        return {
          id: el.dataset.productCard ?? '',
          top: Math.round(card.top),
          stacked: actionsBox.top >= price.bottom - 1,
          contentWidth:
            card.width -
            parseFloat(style.borderLeftWidth) -
            parseFloat(style.borderRightWidth) -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight),
          stackBelow: (kiosk ? remKiosk : rem) * rootPx,
          priceTop: price.top,
          controlTop: control.top,
          hasNote: actions?.querySelector('p') !== null,
        };
      });
    },
    { rem: STACK_BELOW_REM, remKiosk: STACK_BELOW_REM_KIOSK },
  );
}

/** 等版面（容器查詢、格線欄數）在新視窗寬度下重排完成 */
async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

// 圖卡：兩欄手機（320–430）、兩欄大螢幕手機 / 小平板（600）、三欄平板（768）、含側欄的桌機（1024 / 1280 / 1680）；
// 清單：單欄（≤ 767、1024）與兩欄（768、1280、1680）
const CONSISTENCY_CASES = [
  { layout: '圖卡', widths: [320, 360, 375, 414, 430, 600, 768, 1024, 1280, 1680] },
  { layout: '清單', widths: [320, 375, 600, 768, 1024, 1280, 1680] },
] as const;

for (const { layout, widths } of CONSISTENCY_CASES) {
  test.describe(`商品卡版面（${layout}）窄欄一致性`, () => {
    test('各視窗寬度：同一畫面所有卡片同為堆疊或同列；同排卡片的價格與按鈕縱向位置相同', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await gotoApp(page);
      await quickLoginDemoUser(page);
      await chooseLayout(page, layout);
      await expect(productCard(page, 'prd_beef_noodle')).toBeVisible();
      // 備齊動作區的各種寬度：再點 + ＋（紅燒牛肉麵）、步進器、步進器達上限（含說明列）、限量、售完、起價
      await setManualSoldOut(page, '嘉義雞肉飯', true);
      await setRemaining(page, '古早味排骨飯', '剩 2 份');
      await quickAdd(page, '招牌雞腿飯');
      await expect(productCard(page, 'prd_chicken_leg').getByRole('spinbutton')).toHaveText('1');
      await quickAdd(page, '古早味排骨飯');
      await page.getByRole('button', { name: '增加一份 古早味排骨飯' }).click();
      await expect(
        productCard(page, 'prd_pork_chop').getByText('今日只剩 2 份，已達上限'),
      ).toBeVisible();

      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await settleLayout(page);
        const cards = await measureFooters(page);
        expect(cards.length, `${width}px：商品卡數量`).toBeGreaterThan(10);

        // 1. 型態只由卡片寬度決定：所有卡片相同，且與門檻判斷一致
        const first = cards[0];
        if (first === undefined) throw new Error('沒有商品卡');
        const shouldStack = first.contentWidth < first.stackBelow;
        const odd = cards.filter((c) => c.stacked !== shouldStack).map((c) => c.id);
        expect(
          odd,
          `${layout} ${width}px（內容寬 ${fmt(first.contentWidth)}、門檻 ${fmt(first.stackBelow)}）：` +
            `應全部${shouldStack ? '堆疊' : '同列'}，以下卡片型態不同`,
        ).toEqual([]);

        // 2. 同一排的卡片：價格與按鈕的縱向位置相同（說明列使群組變高者不比較）
        const rows = new Map<number, FooterCard[]>();
        for (const c of cards) {
          if (c.hasNote) continue;
          rows.set(c.top, [...(rows.get(c.top) ?? []), c]);
        }
        for (const [top, row] of rows) {
          const base = row[0];
          if (base === undefined) continue;
          for (const c of row) {
            expect(
              Math.abs(c.priceTop - base.priceTop),
              `${layout} ${width}px 同排（頂端 ${top}）：${c.id} 價格頂端 ${fmt(c.priceTop)} ≠ ${base.id} ${fmt(base.priceTop)}`,
            ).toBeLessThanOrEqual(1);
            expect(
              Math.abs(c.controlTop - base.controlTop),
              `${layout} ${width}px 同排（頂端 ${top}）：${c.id} 按鈕頂端 ${fmt(c.controlTop)} ≠ ${base.id} ${fmt(base.controlTop)}`,
            ).toBeLessThanOrEqual(1);
          }
        }
        await expectNoHorizontalScroll(page, `菜單頁（${layout} ${width}px）`);
      }
    });
  });
}

// ── 長品名：最多 2 行 ────────────────────────────────────────────────────────

/** 36 字：LIST 360 以前會換到 4 行、GRID 360 到 5～6 行，卡片高度 361–431px */
const LONG_NAME = '手工現做慢火燉煮招牌香濃紅燒牛肉麵加大加料特製豪華套餐組合附小菜與飲料任選';

/** 直接改品名文字節點（版面由 CSS 決定；Mock 菜單沒有長名稱商品） */
async function setCardName(card: Locator, name: string): Promise<void> {
  await card.evaluate((el, text) => {
    const node = el.querySelector('[data-card-part="name"] button > span')?.firstChild;
    if (node === null || node === undefined) throw new Error('商品卡缺少品名文字');
    node.nodeValue = text;
  }, name);
}

for (const layout of ['清單', '圖卡'] as const) {
  for (const width of [320, 360, 1280]) {
    test.describe(`商品卡版面（${layout}）長品名 ${width}px`, () => {
      test.use({ viewport: { width, height: 900 } });

      test('品名最多 2 行：超出以省略截斷，卡片高度只多一行，對齊不變式維持', async ({ page }) => {
        await gotoApp(page);
        await quickLoginDemoUser(page);
        await chooseLayout(page, layout);
        await quickAdd(page, '招牌雞腿飯');
        await expect(productCard(page, 'prd_chicken_leg').getByRole('spinbutton')).toHaveText('1');
        await setManualSoldOut(page, '控肉飯', true);
        // 有圖 + 再點 + 2 個標籤；缺圖精簡；步進器；售完（標籤接在品名後）
        const cases = [
          ['prd_beef_noodle', true],
          ['prd_wonton_soup', false],
          ['prd_chicken_leg', false],
          ['prd_kong_rou', false],
        ] as const;
        const before = new Map<string, number>();
        for (const [id] of cases) {
          const card = productCard(page, id);
          await card.scrollIntoViewIfNeeded();
          before.set(id, (await measure(card)).card.height);
        }
        for (const [id] of cases) await setCardName(productCard(page, id), LONG_NAME);

        for (const [id, thumb] of cases) {
          const card = productCard(page, id);
          await card.scrollIntoViewIfNeeded();
          const m = await measure(card);
          const label = `${layout} ${width}px 長品名（${id}）`;
          const problems =
            layout === '清單'
              ? listProblems(m, { thumb, heart: true })
              : gridProblems(m, { heart: true });
          expect(problems, label).toEqual([]);
          // 36 字在窄卡一定超過 2 行：確實被截斷，且恰好 2 行
          if (width <= 360) expect(m.nameClamped, `${label}：應被截斷`).toBe(true);
          expect(
            Math.round(m.name.height / m.nameLineHeight),
            `${label}：品名行數`,
          ).toBeLessThanOrEqual(2);
          // 高度：相對原本一行品名，品名最多多一行；標籤（售完、新品）可能因此換到下一列，再多一列。
          // 以前不截行時，360px 的卡片高達 361–431px
          const base = before.get(id) ?? 0;
          expect(
            m.card.height,
            `${label}：卡片高度 ${fmt(m.card.height)}（原 ${fmt(base)}）`,
          ).toBeLessThanOrEqual(base + m.nameLineHeight * 2);
          // 完整品名仍是可存取名稱（只是視覺截行）
          await expect(card.getByRole('button', { name: LONG_NAME, exact: true })).toBeAttached();
          await shot(card, `longname-${layout}-${id}-${width}`);
        }
        await expectNoHorizontalScroll(page, `菜單頁（${layout}，長品名）`);
      });
    });
  }
}

// ── 極窄寬度、大字、觸控面板 ──────────────────────────────────────────────────

test.describe('商品卡版面：極窄寬度與大字', () => {
  test.use({ viewport: { width: 320, height: 800 } });

  test('320px：清單各變體不水平捲動、不重疊；底列型態只由卡片寬度決定 @mobile', async ({
    page,
  }) => {
    await gotoApp(page);
    await quickLoginDemoUser(page);
    await chooseLayout(page, '清單');
    await quickAdd(page, '招牌雞腿飯');
    await expect(productCard(page, 'prd_chicken_leg').getByRole('spinbutton')).toHaveText('1');
    for (const [id, thumb] of [
      ['prd_beef_noodle', true],
      ['prd_oyster_vermicelli', true],
      ['prd_wonton_soup', false],
      ['prd_chicken_leg', false],
      ['prd_kong_rou', false],
    ] as const) {
      await checkList(page, id, { thumb, heart: true }, `narrow-${id}`, 320);
    }
    await expectNoHorizontalScroll(page, '320px 菜單頁');
  });

  test('大字模式 + 200% 字級：不水平捲動、不重疊；窄卡堆疊後動作仍靠右', async ({ page }) => {
    await gotoApp(page);
    await quickLoginDemoUser(page);
    await chooseLayout(page, '清單');
    await quickAdd(page, '招牌雞腿飯');
    await expect(productCard(page, 'prd_chicken_leg').getByRole('spinbutton')).toHaveText('1');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-textscale', '1');
      document.documentElement.style.fontSize = '200%';
    });
    for (const [id, thumb] of [
      ['prd_beef_noodle', true],
      ['prd_oyster_vermicelli', true],
      ['prd_wonton_soup', false],
      ['prd_chicken_leg', false],
      ['prd_kong_rou', false],
    ] as const) {
      const card = productCard(page, id);
      await card.scrollIntoViewIfNeeded();
      const m = await measure(card);
      expect(listProblems(m, { thumb, heart: true }), `大字（${id}）`).toEqual([]);
      // 卡片本身不得超出視窗（頁面其他區塊的水平捲動不在此測試範圍）
      expect(m.card.left, `${id} 左緣`).toBeGreaterThanOrEqual(-0.5);
      expect(m.card.right, `${id} 右緣`).toBeLessThanOrEqual(320.5);
      await shot(card, `largetext-${id}`);
    }
  });
});

test.describe('商品卡版面：觸控面板', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('清單：目標 ≥ 56、縮圖 104、價格左 / 動作右；沒有愛心', async ({ page }) => {
    await gotoApp(page, { params: { mode: 'kiosk' } });
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'kiosk');
    await expect(page.locator('[data-product-card]').first()).toBeVisible();
    for (const [id, thumb] of [
      ['prd_oyster_vermicelli', true],
      ['prd_wonton_soup', false],
    ] as const) {
      const card = productCard(page, id);
      await card.scrollIntoViewIfNeeded();
      const m = await measure(card);
      expect(listProblems(m, { thumb, heart: false }), `觸控面板（${id}）`).toEqual([]);
      expect(m.control.height, '動作按鈕高度').toBeGreaterThanOrEqual(55.5);
      await shot(card, `kiosk-${id}`);
    }
  });

  test('清單：已在購物車的數量徽章離外框 ≥ 4px，不蓋到縮圖、價格與按鈕文字', async ({ page }) => {
    await gotoApp(page, { params: { mode: 'kiosk' } });
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'kiosk');
    await addViaSheet(page, '蚵仔麵線');
    await addViaSheet(page, '鮮肉餛飩湯');
    for (const [id, thumb] of [
      ['prd_oyster_vermicelli', true],
      ['prd_wonton_soup', false],
    ] as const) {
      const card = productCard(page, id);
      await expect(card.locator('[data-card-part="badge"]')).toHaveText('1');
      await card.scrollIntoViewIfNeeded();
      const m = await measure(card);
      expect(listProblems(m, { thumb, heart: false }), `觸控面板（${id}）`).toEqual([]);
      expect(m.badge, `${id}：徽章`).not.toBeNull();
      expect(m.control.height, '動作按鈕高度').toBeGreaterThanOrEqual(55.5);
      await shot(card, `kiosk-badge-${id}`);
    }
  });
});
