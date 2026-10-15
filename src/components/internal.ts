// src/components/internal.ts —— components 內部共用常數（不對外匯出）

/** lucide 圖示的統一尺寸：預設 20px、觸控面板 28px（--icon-size；03 §4.6、§5.6） */
export const ICON = 'size-(--icon-size) shrink-0';

/** 小尺寸圖示（徽章、提示內文）：固定 16px */
export const ICON_SM = 'size-4 shrink-0';

/** 可聚焦元素的基本焦點樣式已由 styles/index.css 的 :focus-visible 提供；此處僅供需要覆寫時引用 */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-text';

/**
 * 元件基底樣式含 `relative`（偽元素與徽章定位用）；呼叫端若以 className 指定 absolute / fixed / sticky，
 * 就不再輸出 `relative`，避免兩個 position utility 同時存在時由 CSS 順序決定結果。
 */
export const hasPositionClass = (className: string | undefined): boolean =>
  className !== undefined && /(^|\s)(absolute|fixed|sticky)(\s|$)/.test(className);
