// src/components/Toast.tsx —— 輕量通知（CMP-25）：ToastProvider + useToast
import clsx from 'clsx';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { usePageVisibility } from '@/hooks/usePageVisibility';
import { t } from '@/i18n/zh-TW';
import { ICON_SM } from './internal';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  /** 動作文字（例：「復原」）；按下後先呼叫 `onAction` 再關閉 Toast */
  label: string;
  onAction: () => void;
}

export interface ToastOptions {
  message: ReactNode;
  /** 預設 `info`；`error` 預設以 assertive 通報，其餘 polite */
  tone?: ToastTone;
  action?: ToastAction;
  /**
   * 顯示時間（毫秒）。預設：不含動作 3000、含動作 6000（03 CMP-25）。
   * 傳 `0` 表示不自動關閉（會顯示關閉鈕）。滑鼠移入、取得焦點或頁面隱藏時暫停計時。
   */
  durationMs?: number;
  /** 覆寫通報等級（預設依 tone） */
  politeness?: 'polite' | 'assertive';
  /** 相同 id 的 Toast 會被視為同一則（取代並重新計時），避免連續操作時堆疊 */
  id?: string;
  /**
   * 換頁（路由 pathname 變更）時立即關閉，預設 false。給「只對當前頁面有意義」的 Toast，
   * 例如「已加入購物車・復原」：帶到新頁面後，「復原」會在使用者看不到變化的地方改動購物車。
   * 要在換頁後保留的提示（登入成功、再來一單導向購物車…）不要設定。實際關閉由外殼的
   * `useDismissToastsOnNavigate(pathname)` 呼叫 `dismissOnNavigate()` 觸發；只看 pathname，查詢字串變化不算換頁。
   */
  dismissOnNavigate?: boolean;
}

export interface ToastApi {
  /** 顯示 Toast，回傳其 id。一次只顯示一則：新的會立即取代目前顯示者。 */
  toast: (options: ToastOptions | string) => string;
  /** 關閉指定 id（未指定則關閉目前顯示的那一則） */
  dismiss: (id?: string) => void;
  /**
   * 關閉目前顯示中、且帶有 `dismissOnNavigate` 旗標的 Toast；其他 Toast 不受影響，沒有 Toast 時不做事。
   * 由外殼在路由 pathname 變更時呼叫（見 `useDismissToastsOnNavigate`），一般元件不需直接使用。
   */
  dismissOnNavigate: () => void;
}

interface ToastRecord {
  key: number;
  id: string;
  message: ReactNode;
  tone: ToastTone;
  action: ToastAction | undefined;
  durationMs: number;
  politeness: 'polite' | 'assertive';
  dismissOnNavigate: boolean;
}

const ToastContext = createContext<ToastApi | null>(null);
const ToastVisibleContext = createContext<boolean>(false);

const DEFAULT_MS = 3000;
const DEFAULT_MS_WITH_ACTION = 6000;

const TONE_ICON = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
} as const;

export interface ToastProviderProps {
  children: ReactNode;
  /**
   * Toast 顯示 / 消失時通知（供 KeyboardNotice 讓位、07 §7.5 的 `toastVisible` 阻擋條件使用）。
   * 也可在子樹內用 `useToastVisible()` 取得。
   */
  onVisibleChange?: (visible: boolean) => void;
}

/**
 * 掛在 app 根部。Toast 以 `position: fixed` 錨定：
 * - < 768：底部置中，距離底部 `--toast-offset-bottom`（預設為安全區域 + 12px）；
 *   有 CartBar / 底部 Tab 時，由 features 於 :root 設定該變數以避開，例如
 *   `document.documentElement.style.setProperty('--toast-offset-bottom', '156px')`
 * - ≥ 768：右下角，同樣距離底部 `--toast-offset-bottom`
 * 兩個常駐的 live region（`role="status"` polite、`role="alert"` assertive）在 Toast 出現前就存在，確保朗讀。
 */
export function ToastProvider({ children, onVisibleChange }: ToastProviderProps) {
  const [current, setCurrent] = useState<ToastRecord | null>(null);
  const counter = useRef(0);
  const visible = current !== null;

  const onVisibleChangeRef = useRef(onVisibleChange);
  useEffect(() => {
    onVisibleChangeRef.current = onVisibleChange;
  });
  const lastVisible = useRef(false);
  useEffect(() => {
    if (lastVisible.current === visible) return;
    lastVisible.current = visible;
    onVisibleChangeRef.current?.(visible);
  }, [visible]);

  const toast = useCallback((input: ToastOptions | string): string => {
    const options: ToastOptions = typeof input === 'string' ? { message: input } : input;
    counter.current += 1;
    const key = counter.current;
    const tone = options.tone ?? 'info';
    const id = options.id ?? `toast-${key}`;
    setCurrent({
      key,
      id,
      message: options.message,
      tone,
      action: options.action,
      durationMs: options.durationMs ?? (options.action ? DEFAULT_MS_WITH_ACTION : DEFAULT_MS),
      politeness: options.politeness ?? (tone === 'error' ? 'assertive' : 'polite'),
      dismissOnNavigate: options.dismissOnNavigate ?? false,
    });
    return id;
  }, []);

  const dismiss = useCallback((id?: string): void => {
    setCurrent((cur) => (cur !== null && (id === undefined || cur.id === id) ? null : cur));
  }, []);

  const dismissOnNavigate = useCallback((): void => {
    // 只清掉帶旗標的那一則；Toast 元件卸載時會一併清除它的計時器（ToastItem 以 key 區分，舊計時器不會誤關新的 Toast）
    setCurrent((cur) => (cur !== null && cur.dismissOnNavigate ? null : cur));
  }, []);

  const api = useMemo<ToastApi>(
    () => ({ toast, dismiss, dismissOnNavigate }),
    [toast, dismiss, dismissOnNavigate],
  );

  const closeCurrent = useCallback((key: number): void => {
    setCurrent((cur) => (cur !== null && cur.key === key ? null : cur));
  }, []);

  return (
    <ToastContext.Provider value={api}>
      <ToastVisibleContext.Provider value={visible}>
        {children}
        <div
          data-zo-toast-viewport=""
          className={clsx(
            'pointer-events-none fixed inset-x-0 bottom-(--toast-offset-bottom) z-60 flex justify-center px-4',
            'md:inset-x-auto md:right-6 md:justify-end md:px-0',
          )}
        >
          <div role="status" aria-live="polite" aria-atomic="true" className="max-w-full">
            {current !== null && current.politeness === 'polite' ? (
              <ToastItem key={current.key} record={current} onClose={closeCurrent} />
            ) : null}
          </div>
          <div role="alert" aria-live="assertive" aria-atomic="true" className="max-w-full">
            {current !== null && current.politeness === 'assertive' ? (
              <ToastItem key={current.key} record={current} onClose={closeCurrent} />
            ) : null}
          </div>
        </div>
      </ToastVisibleContext.Provider>
    </ToastContext.Provider>
  );
}

interface ToastItemProps {
  record: ToastRecord;
  onClose: (key: number) => void;
}

function ToastItem({ record, onClose }: ToastItemProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const pageVisible = usePageVisibility();
  const paused = hovered || focused || !pageVisible;
  const remainingRef = useRef(record.durationMs);
  const sticky = record.durationMs <= 0;

  useEffect(() => {
    if (sticky || paused) return;
    const startedAt = performance.now();
    const timer = setTimeout(() => onClose(record.key), Math.max(0, remainingRef.current));
    return () => {
      clearTimeout(timer);
      remainingRef.current -= performance.now() - startedAt;
    };
  }, [paused, sticky, record.key, onClose]);

  const Icon = TONE_ICON[record.tone];

  return (
    <div
      className={clsx(
        'pointer-events-auto flex max-w-[min(28rem,calc(100vw_-_2rem))] items-center gap-3 rounded-md bg-text px-4 py-3',
        'animate-zo-toast-in text-sm leading-5 font-medium text-bg shadow-lg',
        'forced-colors:border forced-colors:border-[CanvasText]',
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <Icon aria-hidden="true" className={ICON_SM} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{record.message}</span>
      {record.action ? (
        <button
          type="button"
          onClick={() => {
            record.action?.onAction();
            onClose(record.key);
          }}
          className={clsx(
            'hit-area -my-1 -mr-2 inline-flex min-h-8 shrink-0 items-center rounded-sm px-2 font-bold underline underline-offset-4',
            'focus-visible:outline-bg',
          )}
        >
          {record.action.label}
        </button>
      ) : null}
      {sticky ? (
        <button
          type="button"
          aria-label={t.common.close}
          onClick={() => onClose(record.key)}
          className="hit-area -mr-2 grid size-8 shrink-0 place-items-center rounded-full focus-visible:outline-bg"
        >
          <X aria-hidden="true" className={ICON_SM} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * 取得 `toast()` / `dismiss()`。必須位於 `<ToastProvider>` 內（與 `useApi` 一致，缺少時擲出錯誤）。
 * @example
 * const { toast } = useToast();
 * toast({ message: '已加入購物車', tone: 'success', action: { label: '復原', onAction: undo } });
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error('useToast 必須在 <ToastProvider> 內使用');
  return api;
}

/** 目前是否有 Toast 顯示中（KeyboardNotice 等需讓位的元件使用）。 */
export function useToastVisible(): boolean {
  return useContext(ToastVisibleContext);
}
