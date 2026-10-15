// BR-32 品牌色對比保護、03 §4.8 七組預設品牌色（UAT-14）、EC-22 無效色碼
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_BRAND,
  INK,
  MIN_TEXT_CONTRAST,
  WHITE,
  brandCssVars,
  contrastRatio,
  deriveBrandTokens,
  hexToRgb,
  mix,
  normalizeHex,
  pickOnBrand,
  relativeLuminance,
  rgbToHex,
} from '../theme';

describe('色彩基礎', () => {
  it('normalizeHex：接受 #RGB / #RRGGBB（含大小寫、前後空白、缺少 #）並輸出大寫 #RRGGBB', () => {
    expect(normalizeHex('#d93a22')).toBe('#D93A22');
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    expect(normalizeHex(' #d93a22 ')).toBe('#D93A22');
    expect(normalizeHex('D93A22')).toBe('#D93A22');
  });

  it('normalizeHex：無效輸入回傳 null（不丟錯）', () => {
    for (const bad of [
      '',
      '   ',
      'not-a-color',
      '#12',
      '#12345',
      '#1234567',
      '#GGGGGG',
      'rgb(0,0,0)',
      null,
      undefined,
    ]) {
      expect(normalizeHex(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });

  it('hexToRgb / rgbToHex 互為反函式；rgbToHex 夾在 0～255 並四捨五入', () => {
    expect(hexToRgb('#D93A22')).toEqual({ r: 217, g: 58, b: 34 });
    expect(rgbToHex({ r: 217, g: 58, b: 34 })).toBe('#D93A22');
    expect(rgbToHex({ r: -5, g: 300, b: 127.6 })).toBe('#00FF80');
    expect(() => hexToRgb('nope')).toThrow(/Invalid hex color/);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (r, g, b) => {
          expect(hexToRgb(rgbToHex({ r, g, b }))).toEqual({ r, g, b });
        },
      ),
    );
  });

  it('相對亮度：白 = 1、黑 = 0；對比度：白對黑 = 21、同色 = 1、與順序無關', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#D93A22', '#D93A22')).toBeCloseTo(1, 10);
    expect(contrastRatio('#D93A22', '#FFFFFF')).toBeCloseTo(
      contrastRatio('#FFFFFF', '#D93A22'),
      10,
    );
  });

  it('mix：權重 0 / 1 取兩端，0.5 為中點；權重夾在 0～1', () => {
    expect(mix('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mix('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mix('#000000', '#FFFFFF', 7)).toBe('#FFFFFF');
    expect(mix('#000000', '#FFFFFF', -1)).toBe('#000000');
  });

  it('常數', () => {
    expect(WHITE).toBe('#FFFFFF');
    expect(INK).toBe('#18181B');
    expect(DEFAULT_BRAND).toBe('#D93A22');
    expect(MIN_TEXT_CONTRAST).toBe(4.5);
  });
});

describe('pickOnBrand：依序嘗試白、#18181B、純黑，取第一個對比 ≥ 4.5 者', () => {
  it('深色底用白字；亮色底用 #18181B；中等明度（#947D39）退到純黑', () => {
    expect(pickOnBrand('#18181B')).toBe(WHITE);
    expect(pickOnBrand('#D93A22')).toBe(WHITE);
    expect(pickOnBrand('#FACC15')).toBe(INK);
    expect(pickOnBrand('#947D39')).toBe('#000000');
    expect(contrastRatio(WHITE, '#947D39')).toBeLessThan(4.5);
    expect(contrastRatio(INK, '#947D39')).toBeLessThan(4.5);
    expect(contrastRatio('#000000', '#947D39')).toBeGreaterThanOrEqual(4.5);
  });
});

/** 03 §4.8「預設品牌色組」：[brand, onBrand, 主色對比, brandText 於淺底對比] */
const PRESETS: Record<string, [string, string, number, number]> = {
  red: ['#D93A22', '#FFFFFF', 4.59, 4.88],
  green: ['#2E7D4F', '#FFFFFF', 5.05, 4.56],
  coffee: ['#7A4B2A', '#FFFFFF', 7.32, 6.51],
  orange: ['#BA520A', '#FFFFFF', 4.88, 4.75],
  blue: ['#1F5FBF', '#FFFFFF', 6.09, 5.42],
  black: ['#18181B', '#FFFFFF', 17.72, 15.13],
  yellow: ['#FACC15', '#18181B', 11.57, 4.6],
};

describe('七組預設品牌色（UAT-14、03 §4.8 實測表）', () => {
  for (const [key, [hex, onBrand, onRatio, textSoft]] of Object.entries(PRESETS)) {
    it(`${key}：onBrand = ${onBrand}，主色對比 ${onRatio}，brandText 於淺底 ${textSoft}`, () => {
      const t = deriveBrandTokens(hex);
      expect(t.brand).toBe(hex);
      expect(t.onBrand).toBe(onBrand);
      expect(contrastRatio(t.onBrand, t.brand).toFixed(2)).toBe(onRatio.toFixed(2));
      expect(contrastRatio(t.onBrand, t.brand)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.onBrand, t.brandHover)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.brandText, WHITE)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.brandText, t.brandSoft).toFixed(2)).toBe(textSoft.toFixed(2));
      expect(contrastRatio(t.brandText, t.brandSoft)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('deriveBrandTokens', () => {
  it('無效或空值退回預設色，不丟錯（EC-22）', () => {
    expect(deriveBrandTokens(null).brand).toBe('#D93A22');
    expect(deriveBrandTokens(undefined).brand).toBe('#D93A22');
    expect(deriveBrandTokens('').brand).toBe('#D93A22');
    expect(deriveBrandTokens('not-a-color').brand).toBe('#D93A22');
    expect(deriveBrandTokens('#abc').brand).toBe('#AABBCC');
    expect(deriveBrandTokens(' #d93a22 ').brand).toBe('#D93A22');
  });

  it('brandHover 預設加深 12%、brandSoft / Strong 為與白色混合 92% / 82%', () => {
    const t = deriveBrandTokens('#D93A22');
    expect(t.brandHover).toBe(mix('#D93A22', '#000000', 0.12));
    expect(t.brandSoft).toBe(mix('#D93A22', WHITE, 0.92));
    expect(t.brandSoftStrong).toBe(mix('#D93A22', WHITE, 0.82));
  });

  it('深色文字因加深而對比不足時，hover 改為提亮 12%（#007DFF：深色字 4.54，加深後僅 3.63）', () => {
    const brand = '#007DFF';
    expect(deriveBrandTokens(brand).onBrand).toBe(INK);
    expect(contrastRatio(INK, mix(brand, '#000000', 0.12))).toBeLessThan(4.5);
    const t = deriveBrandTokens(brand);
    expect(t.brandHover).toBe(mix(brand, WHITE, 0.12));
    expect(contrastRatio(INK, t.brandHover)).toBeGreaterThanOrEqual(4.5);
  });

  it('深色文字加深後仍足夠時，hover 維持加深（檸檬黃）', () => {
    const t = deriveBrandTokens('#FACC15');
    expect(t.onBrand).toBe(INK);
    expect(t.brandHover).toBe(mix('#FACC15', '#000000', 0.12));
  });

  it('brandText 在白底與淺色底皆 ≥ 4.5，不足時自品牌色起逐步加深', () => {
    const light = deriveBrandTokens('#FACC15');
    expect(light.brandText).not.toBe('#FACC15');
    expect(contrastRatio(light.brandText, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light.brandText, light.brandSoft)).toBeGreaterThanOrEqual(4.5);
    // 已足夠深者不加深
    expect(deriveBrandTokens('#18181B').brandText).toBe('#18181B');
  });

  it('危險色不由品牌色推導：代幣只含品牌相關六項', () => {
    expect(Object.keys(deriveBrandTokens('#D93A22')).sort()).toEqual([
      'brand',
      'brandHover',
      'brandSoft',
      'brandSoftStrong',
      'brandText',
      'onBrand',
    ]);
  });

  it('中等明度缺口色 #947D39：onBrand 為純黑，hover 與 brandText 仍 ≥ 4.5', () => {
    const t = deriveBrandTokens('#947D39');
    expect(t.onBrand).toBe('#000000');
    expect(contrastRatio(t.onBrand, t.brandHover)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.brandText, t.brandSoft)).toBeGreaterThanOrEqual(4.5);
  });

  it('任意 500 種色相 / 明度組合都通過 AA 保護', () => {
    for (let i = 0; i < 500; i++) {
      const hex = rgbToHex({ r: (i * 37) % 256, g: (i * 91 + 17) % 256, b: (i * 53 + 101) % 256 });
      const t = deriveBrandTokens(hex);
      expect(contrastRatio(t.onBrand, t.brand), `${hex} on/brand`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.onBrand, t.brandHover), `${hex} on/hover`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.brandText, t.brandSoft), `${hex} text/soft`).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(t.brandText, WHITE), `${hex} text/white`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('RGB 格點掃描（約 4.9 萬色）：onBrand / hover / brandText 對比皆 ≥ 4.5，含中等明度缺口色', () => {
    let n = 0;
    let worstOn = Infinity;
    let worstHover = Infinity;
    let worstText = Infinity;
    for (let r = 0; r < 256; r += 5) {
      for (let g = 0; g < 256; g += 5) {
        for (let b = 0; b < 256; b += 15) {
          const t = deriveBrandTokens(rgbToHex({ r, g, b }));
          worstOn = Math.min(worstOn, contrastRatio(t.onBrand, t.brand));
          worstHover = Math.min(worstHover, contrastRatio(t.onBrand, t.brandHover));
          worstText = Math.min(worstText, contrastRatio(t.brandText, t.brandSoft));
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(40_000);
    expect(worstOn).toBeGreaterThanOrEqual(4.5);
    expect(worstHover).toBeGreaterThanOrEqual(4.5);
    expect(worstText).toBeGreaterThanOrEqual(4.5);
  });

  it('性質：任意 RGB 色皆滿足三項對比保護', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (r, g, b) => {
          const t = deriveBrandTokens(rgbToHex({ r, g, b }));
          expect(contrastRatio(t.onBrand, t.brand)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(t.onBrand, t.brandHover)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(t.brandText, t.brandSoft)).toBeGreaterThanOrEqual(4.5);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('brandCssVars', () => {
  it('輸出 :root 可用的六個 CSS 變數（鍵名與對應）', () => {
    const t = deriveBrandTokens('#2E7D4F');
    const vars = brandCssVars(t);
    expect(Object.keys(vars).sort()).toEqual([
      '--color-brand',
      '--color-brand-hover',
      '--color-brand-soft',
      '--color-brand-soft-strong',
      '--color-brand-text',
      '--color-on-brand',
    ]);
    expect(vars['--color-brand']).toBe(t.brand);
    expect(vars['--color-on-brand']).toBe(t.onBrand);
    expect(vars['--color-brand-hover']).toBe(t.brandHover);
    expect(vars['--color-brand-soft']).toBe(t.brandSoft);
    expect(vars['--color-brand-soft-strong']).toBe(t.brandSoftStrong);
    expect(vars['--color-brand-text']).toBe(t.brandText);
  });
});
