// e2e/helpers/color.ts —— 在瀏覽器內取得元素的實際前景 / 背景色並計算 WCAG 對比（UAT-14）
import type { Locator } from '@playwright/test';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface ColorSample {
  fg: Rgb;
  bg: Rgb;
  /** 焦點環顏色：優先取 outline，否則取最外層 box-shadow（`focus-ring-fill` 的雙層環）；無則為 null */
  outline: Rgb | null;
  outlineWidth: number;
}

/** 相對亮度（WCAG 2.x） */
function luminance({ r, g, b }: Rgb): number {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 取元素的 `color`、有效背景色（往上找第一個不透明背景）與 `outline-color`。
 * 以 canvas 把任意 CSS 色彩（含 oklch、color-mix）轉為 sRGB。
 */
export async function sampleColors(locator: Locator): Promise<ColorSample> {
  return locator.evaluate((el) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('canvas 不可用');
    const parse = (css: string): { r: number; g: number; b: number; a: number } => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const style = getComputedStyle(el);
    const fg = parse(style.color);
    // 往上找第一個「不透明」背景
    let node: Element | null = el;
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    while (node !== null) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.a >= 0.99) {
        bg = c;
        break;
      }
      node = node.parentElement;
    }
    let outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
    const hasOutline = style.outlineStyle !== 'none' && outlineWidth > 0;
    let outline = hasOutline ? parse(style.outlineColor) : null;
    if (outline === null && style.boxShadow !== 'none') {
      const re =
        /((?:rgba?|color|oklch|oklab|lab|lch|hsla?)\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/g;
      let last: RegExpExecArray | null = null;
      for (let m = re.exec(style.boxShadow); m !== null; m = re.exec(style.boxShadow)) last = m;
      if (last !== null && last[1] !== undefined) {
        outline = parse(last[1]);
        outlineWidth = Number.parseFloat(last[5] ?? '0') || 0;
      }
    }
    const strip = ({ r, g, b }: { r: number; g: number; b: number }) => ({ r, g, b });
    return {
      fg: strip(fg),
      bg: strip(bg),
      outline: outline === null ? null : strip(outline),
      outlineWidth,
    };
  });
}

/**
 * 等顏色穩定後再取樣：主題切換有 150ms 的顏色轉場，轉場途中的中間值不代表最終呈現。
 * 連續兩次取樣（間隔 100ms）相同即視為穩定，最長等 2 秒。
 */
export async function sampleStableColors(locator: Locator): Promise<ColorSample> {
  let previous = await sampleColors(locator);
  const deadline = Date.now() + 2000;
  for (;;) {
    await locator.page().waitForTimeout(100);
    const next = await sampleColors(locator);
    if (JSON.stringify(next) === JSON.stringify(previous) || Date.now() > deadline) return next;
    previous = next;
  }
}
