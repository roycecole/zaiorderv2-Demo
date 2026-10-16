// vite-plugins/htmlMeta.ts —— 依建置模式輸出 SEO 相關標籤與 robots.txt
//
// Demo 站台與觸控面板專機不該被搜尋引擎收錄（07 §11）；正式（非 Demo）建置則要能被收錄，
// 所以 `noindex` 不能寫死在 index.html，而是只在 `VITE_DEMO_MODE` / `VITE_KIOSK_MODE` 為 true 時注入。
import type { HtmlTagDescriptor, Plugin } from 'vite';

export interface HtmlMetaOptions {
  /** VITE_DEMO_MODE=true */
  demo: boolean;
  /** VITE_KIOSK_MODE=true */
  kiosk: boolean;
}

export const SITE_TITLE = 'ZaiOrder · 線上點餐';

export function describeSite({ demo }: HtmlMetaOptions): string {
  return demo
    ? 'ZaiOrder 台灣小吃店線上點餐（示範站台：資料僅存於你的瀏覽器）'
    : 'ZaiOrder 台灣小吃店線上點餐';
}

/** 不應被搜尋引擎收錄：Demo 站台與觸控面板專機 */
export function isHiddenFromSearch(options: HtmlMetaOptions): boolean {
  return options.demo || options.kiosk;
}

export function metaTags(options: HtmlMetaOptions): HtmlTagDescriptor[] {
  const description = describeSite(options);
  const meta = (attrs: Record<string, string>): HtmlTagDescriptor => ({
    tag: 'meta',
    attrs,
    injectTo: 'head',
  });
  return [
    ...(isHiddenFromSearch(options) ? [meta({ name: 'robots', content: 'noindex' })] : []),
    meta({ name: 'description', content: description }),
    meta({ property: 'og:type', content: 'website' }),
    meta({ property: 'og:locale', content: 'zh_TW' }),
    meta({ property: 'og:title', content: SITE_TITLE }),
    meta({ property: 'og:description', content: description }),
  ];
}

export function robotsTxt(options: HtmlMetaOptions): string {
  return isHiddenFromSearch(options)
    ? 'User-agent: *\nDisallow: /\n'
    : 'User-agent: *\nAllow: /\n';
}

export function htmlMeta(options: HtmlMetaOptions): Plugin {
  return {
    name: 'zaiorder:html-meta',
    transformIndexHtml: () => metaTags(options),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(options) });
    },
  };
}
