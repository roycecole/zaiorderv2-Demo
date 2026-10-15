// src/features/cart/cartStore.ts
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { maxAddable } from '@/domain/availability';
import { MAX_LINES, MAX_QTY_PER_LINE, cartLineKey, isCartExpired } from '@/domain/cart';
import type { CartLine, CartState } from '@/domain/cart';
import type { ID, OrderType } from '@/domain/types';
import { getClock } from '@/services/clock';
import { appLocalStorage, STORAGE_KEYS } from '@/services/storage/appStorage';

interface CartActions {
  /** 回傳 false 表示超過上限而未加入 */
  addLine(line: Omit<CartLine, 'lineId'>): boolean;
  replaceLine(lineId: string, next: Omit<CartLine, 'lineId'>): void;
  setQuantity(lineId: string, quantity: number): void;
  removeLine(lineId: string): void;
  clear(): void;
  setOrderType(orderType: OrderType): void;
  /** 購物車超過 24 小時未更新則清空（FR-CT-04） */
  purgeIfExpired(): void;
  /** 同商品在購物車內的份數；可排除某一行（編輯該行時） */
  quantityOfProduct(productId: ID, excludeLineId?: string): number;
  /** 步進器與「＋」可增加到的上限（FR-PD-04）：remaining 為 null 或省略時只受單行 20 份限制 */
  maxAddableFor(productId: ID, remaining: number | null | undefined, excludeLineId?: string): number;
  /** 異動清單「改為 n 份」與「全部套用建議」：依 { lineId, quantity } 調整，quantity 為 0 者移除（FLOW-23） */
  fitLinesToAvailable(fits: ReadonlyArray<{ lineId: string; quantity: number }>): void;
  /** 異動清單的「復原」（單項移除 6 秒、hover 或焦點暫停；全部套用建議的復原持續存在）：以先前的快照整批還原 */
  restoreLines(lines: CartLine[]): void;
}

const newId = () => crypto.randomUUID();
const nowMs = (): number => getClock().now().getTime();
/** 數量夾在 1～MAX_QTY_PER_LINE 的整數（VR-16）；非有限數視為 1 */
const clampQty = (q: number): number =>
  Number.isFinite(q) ? Math.max(1, Math.min(MAX_QTY_PER_LINE, Math.floor(q))) : 1;

export const useCartStore = create<CartState & CartActions>()(
  persist(
    (set, get) => ({
      lines: [],
      orderType: 'PICKUP',
      updatedAt: nowMs(),

      addLine: (input) => {
        const key = cartLineKey(input);
        const { lines } = get();
        const existing = lines.find((l) => cartLineKey(l) === key);
        if (existing) {
          const quantity = clampQty(existing.quantity + clampQty(input.quantity));
          set({
            lines: lines.map((l) => (l.lineId === existing.lineId ? { ...l, quantity } : l)),
            updatedAt: nowMs(),
          });
          return true;
        }
        if (lines.length >= MAX_LINES) return false;
        set({
          lines: [...lines, { ...input, lineId: newId(), quantity: clampQty(input.quantity) }],
          updatedAt: nowMs(),
        });
        return true;
      },

      replaceLine: (lineId, next) => {
        const key = cartLineKey(next);
        const others = get().lines.filter((l) => l.lineId !== lineId);
        const dup = others.find((l) => cartLineKey(l) === key);
        const lines = dup
          ? others.map((l) =>
              l.lineId === dup.lineId
                ? { ...l, quantity: clampQty(l.quantity + clampQty(next.quantity)) }
                : l,
            )
          : get().lines.map((l) =>
              l.lineId === lineId ? { ...next, quantity: clampQty(next.quantity), lineId } : l,
            );
        set({ lines, updatedAt: nowMs() });
      },

      setQuantity: (lineId, quantity) => {
        const q = clampQty(quantity);
        set({
          lines: get().lines.map((l) => (l.lineId === lineId ? { ...l, quantity: q } : l)),
          updatedAt: nowMs(),
        });
      },

      removeLine: (lineId) =>
        set({ lines: get().lines.filter((l) => l.lineId !== lineId), updatedAt: nowMs() }),

      clear: () => set({ lines: [], updatedAt: nowMs() }),

      setOrderType: (orderType) => set({ orderType, updatedAt: nowMs() }),

      purgeIfExpired: () => {
        if (get().lines.length > 0 && isCartExpired({ updatedAt: get().updatedAt }, nowMs())) {
          set({ lines: [], updatedAt: nowMs() });
        }
      },

      quantityOfProduct: (productId, excludeLineId) =>
        get()
          .lines.filter((l) => l.productId === productId && l.lineId !== excludeLineId)
          .reduce((sum, l) => sum + l.quantity, 0),

      maxAddableFor: (productId, remaining, excludeLineId) =>
        maxAddable(remaining, get().quantityOfProduct(productId, excludeLineId), MAX_QTY_PER_LINE),

      fitLinesToAvailable: (fits) => {
        const target = new Map(fits.map((f) => [f.lineId, Math.floor(f.quantity)]));
        const lines = get().lines.flatMap((l) => {
          const q = target.get(l.lineId);
          if (q === undefined) return [l];
          return q >= 1 ? [{ ...l, quantity: Math.min(MAX_QTY_PER_LINE, q) }] : [];
        });
        set({ lines, updatedAt: nowMs() });
      },

      restoreLines: (lines) => set({ lines: [...lines], updatedAt: nowMs() }),
    }),
    {
      name: STORAGE_KEYS.cart,
      version: 1,
      storage: createJSONStorage(() => appLocalStorage),
      partialize: (s) => ({ lines: s.lines, orderType: s.orderType, updatedAt: s.updatedAt }),
      // 還原時若已超過 24 小時，視為過期（FR-CT-04）
      merge: (persisted, current) => {
        const p = persisted as Partial<CartState> | undefined;
        if (!p || typeof p.updatedAt !== 'number' || isCartExpired({ updatedAt: p.updatedAt }, nowMs())) {
          return current;
        }
        return { ...current, ...p };
      },
    },
  ),
);

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEYS.cart) void useCartStore.persist.rehydrate();
  });
}
