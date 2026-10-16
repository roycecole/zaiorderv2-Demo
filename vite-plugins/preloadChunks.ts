// vite-plugins/preloadChunks.ts —— 在 index.html 預載「首屏一定會用到的動態 chunk」（NFR-03：LCP）
//
// 這些 chunk 是由程式碼 `import()` 載入的（資料來源 Mock / HTTP、首頁路由），瀏覽器要等入口 JS 下載並執行完
// 才知道要抓它們，形成「入口 → 資料來源 → 路由 chunk」的串聯等待。這裡改在 HTML 裡直接宣告 modulepreload，
// 讓它們跟入口 JS 同時下載（含各自的靜態相依 chunk，但排除入口本來就會預載的）。
// 之後程式碼執行 `import()` 時，瀏覽器直接使用已下載的模組，不會重複請求。
import type { HtmlTagDescriptor, Plugin } from 'vite';

/** 輸出 chunk 的最小結構（避免依賴 rollup / rolldown 的型別差異） */
export interface ChunkLike {
  type: 'chunk';
  fileName: string;
  imports: string[];
  isEntry?: boolean;
  facadeModuleId?: string | null;
}

export type BundleLike = Record<
  string,
  { type: string; fileName?: string; imports?: string[]; isEntry?: boolean; facadeModuleId?: string | null }
>;

export interface PreloadChunksOptions {
  /** 要預載的動態入口：原始檔路徑片段（與 chunk 的 facadeModuleId 比對，不分平台路徑分隔符號） */
  entries: string[];
}

const normalize = (path: string): string => path.replace(/\\/g, '/');

function chunksOf(bundle: BundleLike): Map<string, ChunkLike> {
  const map = new Map<string, ChunkLike>();
  for (const item of Object.values(bundle)) {
    if (item.type === 'chunk' && item.fileName !== undefined) {
      map.set(item.fileName, { type: 'chunk', fileName: item.fileName, imports: item.imports ?? [], isEntry: item.isEntry, facadeModuleId: item.facadeModuleId });
    }
  }
  return map;
}

/** 從某個 chunk 出發、沿靜態 imports 能到達的所有 chunk 檔名（含自己） */
function closure(start: ChunkLike, chunks: Map<string, ChunkLike>): Set<string> {
  const seen = new Set<string>();
  const stack: string[] = [start.fileName];
  while (stack.length > 0) {
    const name = stack.pop() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const dep of chunks.get(name)?.imports ?? []) stack.push(dep);
  }
  return seen;
}

/** 需要新增 modulepreload 的 chunk 檔名（依宣告順序，不含入口已預載者）；找不到的入口會被略過 */
export function chunksToPreload(bundle: BundleLike, entries: string[]): string[] {
  const chunks = chunksOf(bundle);
  // 入口 chunk 與它的靜態相依：Vite 已自動預載，不重複宣告
  const alreadyLoaded = new Set<string>();
  for (const chunk of chunks.values()) {
    if (chunk.isEntry === true) for (const name of closure(chunk, chunks)) alreadyLoaded.add(name);
  }
  const result: string[] = [];
  for (const entry of entries) {
    const needle = normalize(entry);
    const target = [...chunks.values()].find(
      (c) => c.facadeModuleId !== undefined && c.facadeModuleId !== null && normalize(c.facadeModuleId).endsWith(needle),
    );
    if (target === undefined) continue;
    for (const name of closure(target, chunks)) {
      if (!alreadyLoaded.has(name) && !result.includes(name)) result.push(name);
    }
  }
  return result;
}

export function preloadTags(files: string[], base: string): HtmlTagDescriptor[] {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return files.map((fileName) => ({
    tag: 'link',
    attrs: { rel: 'modulepreload', crossorigin: true, href: `${prefix}${fileName}` },
    injectTo: 'head',
  }));
}

export function preloadChunks(options: PreloadChunksOptions): Plugin {
  let base = '/';
  return {
    name: 'zaiorder:preload-chunks',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (ctx.bundle === undefined) return undefined;
        return preloadTags(chunksToPreload(ctx.bundle as unknown as BundleLike, options.entries), base);
      },
    },
  };
}
