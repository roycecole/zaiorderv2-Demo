// src/features/cart/cartMath.ts —— 購物車的純函式衍生值（品項數、小計、快速加入行…）
// cartStore 的 action 簽名不變動；需要衍生資料一律放在這裡（或 useCartCount）。
import type { CartLine } from '@/domain/cart';
import type { ID } from '@/domain/types';

/** 單行金額（以加入當下的快照單價計；價格以伺服器 quote 為準，見 07 §7.2） */
export function lineSubtotal(line: Pick<CartLine, 'quantity' | 'snapshot'>): number {
  return line.snapshot.unitPrice * line.quantity;
}

/** 購物車小計（快照價；背景 quote 回來後，頁面以 quote.subtotal 為準） */
export function cartSubtotal(
  lines: ReadonlyArray<Pick<CartLine, 'quantity' | 'snapshot'>>,
): number {
  return lines.reduce((sum, l) => sum + lineSubtotal(l), 0);
}

/** 全部份數加總 */
export function cartQuantity(lines: ReadonlyArray<Pick<CartLine, 'quantity'>>): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/** 同商品在購物車內的總份數（所有行加總） */
export function quantityOfProduct(
  lines: ReadonlyArray<Pick<CartLine, 'productId' | 'quantity'>>,
  productId: ID,
): number {
  return lines.reduce((sum, l) => (l.productId === productId ? sum + l.quantity : sum), 0);
}

/**
 * 卡片「快速加入」所對應的行：沒有選項、沒有備註（FR-MN-11：卡片上的 `− n ＋` 只作用於這一行）。
 * 以快速加入（BR-30）加入的行必然符合此條件。
 */
export function quickAddLine<L extends Pick<CartLine, 'productId' | 'optionIds' | 'note'>>(
  lines: ReadonlyArray<L>,
  productId: ID,
): L | undefined {
  return lines.find(
    (l) => l.productId === productId && l.optionIds.length === 0 && (l.note ?? '').trim() === '',
  );
}

/** 選項摘要：「大碗・滷蛋」；沒有選項時回傳空字串 */
export function optionSummary(labels: ReadonlyArray<string>): string {
  return labels.join('・');
}

/** 行的顯示說明（選項摘要 + 備註）；皆無時為空陣列，呼叫端不輸出空白行（FR-CT-08） */
export function lineMetaParts(
  line: Pick<CartLine, 'note' | 'snapshot'>,
  noteLabel: string,
): string[] {
  const parts: string[] = [];
  const options = optionSummary(line.snapshot.optionLabels);
  if (options !== '') parts.push(options);
  const note = (line.note ?? '').trim();
  if (note !== '') parts.push(`${noteLabel}${note}`);
  return parts;
}
