import { describe, expect, it } from 'vitest';
import { describeSite, htmlMeta, isHiddenFromSearch, metaTags, robotsTxt } from '../htmlMeta';

const PROD = { demo: false, kiosk: false };
const DEMO = { demo: true, kiosk: false };
const KIOSK = { demo: false, kiosk: true };

const robots = (o: { demo: boolean; kiosk: boolean }) =>
  metaTags(o).find((t) => t.attrs?.['name'] === 'robots');

describe('noindex 只在 Demo / 觸控面板專機注入（正式建置要能被收錄）', () => {
  it('正式建置：沒有 robots meta，robots.txt 允許收錄', () => {
    expect(isHiddenFromSearch(PROD)).toBe(false);
    expect(robots(PROD)).toBeUndefined();
    expect(robotsTxt(PROD)).toContain('Allow: /');
    expect(robotsTxt(PROD)).not.toContain('Disallow');
  });

  it.each([
    ['Demo', DEMO],
    ['觸控面板專機', KIOSK],
    ['兩者皆是', { demo: true, kiosk: true }],
  ])('%s：注入 noindex，robots.txt 全面禁止', (_name, options) => {
    expect(isHiddenFromSearch(options)).toBe(true);
    expect(robots(options)?.attrs).toEqual({ name: 'robots', content: 'noindex' });
    expect(robotsTxt(options)).toContain('Disallow: /');
  });
});

describe('描述與 Open Graph', () => {
  it('Demo 的描述註明示範站台；正式建置不含「示範」', () => {
    expect(describeSite(DEMO)).toContain('示範站台');
    expect(describeSite(PROD)).not.toContain('示範');
  });

  it('description 與 og:description 一致，並含 og:type / og:locale / og:title', () => {
    for (const options of [PROD, DEMO]) {
      const tags = metaTags(options);
      const byKey = (k: string, v: string) => tags.find((t) => t.attrs?.[k] === v)?.attrs?.['content'];
      expect(byKey('name', 'description')).toBe(describeSite(options));
      expect(byKey('property', 'og:description')).toBe(describeSite(options));
      expect(byKey('property', 'og:type')).toBe('website');
      expect(byKey('property', 'og:locale')).toBe('zh_TW');
      expect(byKey('property', 'og:title')).toBeTruthy();
    }
  });

  it('所有標籤都注入 <head>', () => {
    expect(metaTags(DEMO).every((t) => t.injectTo === 'head')).toBe(true);
  });
});

describe('plugin 掛載點', () => {
  it('transformIndexHtml 回傳標籤；generateBundle 輸出 robots.txt', () => {
    const plugin = htmlMeta(DEMO);
    const transform = plugin.transformIndexHtml as () => unknown[];
    expect(transform().length).toBeGreaterThan(3);

    const emitted: Array<{ fileName?: string; source?: unknown }> = [];
    const generate = plugin.generateBundle as (this: { emitFile: (f: unknown) => void }) => void;
    generate.call({ emitFile: (f) => emitted.push(f as { fileName?: string; source?: unknown }) });
    expect(emitted).toEqual([{ type: 'asset', fileName: 'robots.txt', source: 'User-agent: *\nDisallow: /\n' }]);
  });
});
