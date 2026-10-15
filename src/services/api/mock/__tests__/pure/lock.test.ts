// FLOW-22 / O-06：Mock db 的臨界區（Web Locks）與降級
import { describe, expect, it } from 'vitest';
import { DB_LOCK_NAME, withDbLock } from '../../lock';
import type { LockManagerLike } from '../../lock';

/** 依 Web Locks 語意：同名鎖互斥，依序執行 */
function fakeLocks(): LockManagerLike & { log: string[] } {
  let tail: Promise<unknown> = Promise.resolve();
  const log: string[] = [];
  return {
    log,
    request<T>(name: string, cb: () => Promise<T> | T): Promise<T> {
      log.push(name);
      const run = tail.then(() => cb());
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

describe('withDbLock', () => {
  it('鎖名稱為 zaiorder:db', () => {
    expect(DB_LOCK_NAME).toBe('zaiorder:db');
  });

  it('同一把鎖序列化：臨界區不交錯；回傳 fn 的結果', async () => {
    const locks = fakeLocks();
    const order: string[] = [];
    const crit = (id: string) =>
      withDbLock(() => {
        order.push(`${id}:start`);
        order.push(`${id}:end`);
        return id;
      }, locks);
    const results = await Promise.all([crit('a'), crit('b'), crit('c')]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
    expect(locks.log).toEqual([DB_LOCK_NAME, DB_LOCK_NAME, DB_LOCK_NAME]);
  });

  it('錯誤向外傳遞且不卡住後續', async () => {
    const locks = fakeLocks();
    await expect(
      withDbLock(() => {
        throw new Error('boom');
      }, locks),
    ).rejects.toThrow('boom');
    expect(await withDbLock(() => 'ok', locks)).toBe('ok');
  });

  it('不支援 Web Locks（locks 為 undefined）時降級為直接執行，仍回傳結果與丟出錯誤', async () => {
    expect(await withDbLock(() => 42, undefined)).toBe(42);
    await expect(
      withDbLock(() => {
        throw new Error('x');
      }, undefined),
    ).rejects.toThrow('x');
  });

  it('預設使用 globalThis.navigator.locks（jsdom 無 Web Locks → 降級直接執行）', async () => {
    expect(await withDbLock(() => 'direct')).toBe('direct');
  });

  it('兩個模擬分頁共用 storage：鎖內先 reload 再變更再 flush，交錯寫入不遺失；沒有 reload 的整包寫回會遺失（對照組）', async () => {
    interface Tab {
      cache: string[];
      reload(): void;
      flush(): void;
    }
    const mkTab = (storage: { json: string }): Tab => ({
      cache: JSON.parse(storage.json) as string[],
      reload() {
        this.cache = JSON.parse(storage.json) as string[];
      },
      flush() {
        storage.json = JSON.stringify(this.cache);
      },
    });
    const storage = { json: '[]' };
    const a = mkTab(storage);
    const b = mkTab(storage);
    const locks = fakeLocks();
    const add = (tab: Tab, id: string) =>
      withDbLock(() => {
        tab.reload();
        tab.cache.push(id);
        tab.flush();
        return id;
      }, locks);
    await Promise.all([add(a, 'a1'), add(b, 'b1'), add(a, 'a2'), add(b, 'b2'), add(a, 'a3')]);
    expect((JSON.parse(storage.json) as string[]).sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);

    const naive = { json: '[]' };
    const x = mkTab(naive);
    const y = mkTab(naive);
    x.cache.push('x1');
    y.cache.push('y1'); // 兩分頁都只改自己的快取
    x.flush();
    y.flush(); // 後寫者整包覆蓋
    expect(JSON.parse(naive.json)).toEqual(['y1']);
  });
});
