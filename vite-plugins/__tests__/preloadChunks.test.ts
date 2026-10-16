import { describe, expect, it } from 'vitest';
import { chunksToPreload, preloadTags } from '../preloadChunks';
import type { BundleLike } from '../preloadChunks';

const chunk = (
  fileName: string,
  imports: string[],
  extra: { isEntry?: boolean; facadeModuleId?: string } = {},
) => ({ type: 'chunk' as const, fileName, imports, ...extra });

const bundle: BundleLike = {
  'assets/index.js': chunk('assets/index.js', ['assets/vendor-react.js', 'assets/format.js'], { isEntry: true }),
  'assets/vendor-react.js': chunk('assets/vendor-react.js', []),
  'assets/format.js': chunk('assets/format.js', []),
  'assets/createMockClient.js': chunk('assets/createMockClient.js', ['assets/slots.js', 'assets/format.js'], {
    facadeModuleId: '/repo/src/services/api/mock/createMockClient.ts',
  }),
  'assets/slots.js': chunk('assets/slots.js', []),
  'assets/MenuPage.js': chunk('assets/MenuPage.js', ['assets/useCartPreview.js', 'assets/vendor-react.js'], {
    facadeModuleId: '/repo/src/features/menu/MenuPage.tsx',
  }),
  'assets/useCartPreview.js': chunk('assets/useCartPreview.js', ['assets/slots.js']),
  'assets/index.css': { type: 'asset' },
};

describe('chunksToPreload', () => {
  it('動態入口與它的靜態相依都要預載；入口本來就預載的 chunk 不重複', () => {
    const files = chunksToPreload(bundle, [
      'src/services/api/mock/createMockClient.ts',
      'src/features/menu/MenuPage.tsx',
    ]);
    expect(files).toEqual([
      'assets/createMockClient.js',
      'assets/slots.js',
      'assets/MenuPage.js',
      'assets/useCartPreview.js',
    ]);
    expect(files).not.toContain('assets/format.js');
    expect(files).not.toContain('assets/vendor-react.js');
    expect(new Set(files).size).toBe(files.length);
  });

  it('找不到的入口略過；沒有入口時回傳空陣列', () => {
    expect(chunksToPreload(bundle, ['src/nope.ts'])).toEqual([]);
    expect(chunksToPreload(bundle, [])).toEqual([]);
  });

  it('Windows 路徑分隔符號也能比對', () => {
    const win: BundleLike = {
      ...bundle,
      'assets/MenuPage.js': chunk('assets/MenuPage.js', [], {
        facadeModuleId: 'C:\\repo\\src\\features\\menu\\MenuPage.tsx',
      }),
    };
    expect(chunksToPreload(win, ['src/features/menu/MenuPage.tsx'])).toEqual(['assets/MenuPage.js']);
  });
});

describe('preloadTags', () => {
  it('輸出 modulepreload 並帶 crossorigin（與 import() 的 CORS 模式一致，避免重複下載）', () => {
    const [tag] = preloadTags(['assets/a.js'], '/');
    expect(tag).toEqual({
      tag: 'link',
      attrs: { rel: 'modulepreload', crossorigin: true, href: '/assets/a.js' },
      injectTo: 'head',
    });
  });

  it('子路徑部署：base 前綴；base 缺少結尾斜線時補上', () => {
    expect(preloadTags(['assets/a.js'], '/repo/')[0]?.attrs?.['href']).toBe('/repo/assets/a.js');
    expect(preloadTags(['assets/a.js'], '/repo')[0]?.attrs?.['href']).toBe('/repo/assets/a.js');
  });
});
