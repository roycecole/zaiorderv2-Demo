// src/features/demo/DemoPanel.tsx —— Demo 工具面板（CMP-30、03 PG-18）
//
// < 768：Bottom Sheet（高度上限 70dvh、內部捲動）；≥ 768：左下角非 modal 浮動面板（寬 360），
// 背景仍可操作，讓展示者即時看到變更。兩者內容相同。
import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { IconButton } from '@/components';
import { Sheet } from '@/components/overlay';
import { formatDateTime } from '@/domain/format';
import { useClockNow } from '@/hooks/useClockNow';
import { useLatest } from '@/hooks/useLatest';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { demo as tDemo } from '@/i18n/strings/demo';
import { DEMO_PANEL_ID } from './constants';
import { useDemoContext } from './DemoContext';
import { DemoSection } from './parts';
import { describeScenario } from './scenario';
import { AccountSection } from './sections/AccountSection';
import { MenuAppearanceSection } from './sections/MenuAppearanceSection';
import { NetworkSection } from './sections/NetworkSection';
import { SimulationSection } from './sections/SimulationSection';
import { StockSection } from './sections/StockSection';
import { StoreTimeSection } from './sections/StoreTimeSection';
import { SubmitSection } from './sections/SubmitSection';

/** 面板內容：目前模擬時間、目前情境與各區塊 */
export function DemoPanelBody() {
  const { state, kiosk } = useDemoContext();
  const now = useClockNow(1000);
  const scenario = describeScenario(state);
  const shifted = state.clockOverride !== null;

  return (
    <div>
      <div className="space-y-2 pb-3">
        <p className="text-sm leading-5 text-text">
          <span className="font-semibold">{tDemo.panel.simulatedNow}</span>
          {'　'}
          <time dateTime={now.toISOString()} className="tabular-nums">
            {formatDateTime(now)}
          </time>
          {'　'}
          <span className="text-text-muted">
            {shifted ? tDemo.panel.clockShifted : tDemo.panel.clockReal}
          </span>
        </p>
        <div className="text-sm leading-5 text-text-sub">
          <p className="font-semibold text-text">{tDemo.panel.scenarioTitle}</p>
          {scenario.length === 0 ? (
            <p>{tDemo.panel.scenarioDefault}</p>
          ) : (
            <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
              {scenario.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-text-muted">{tDemo.panel.scenarioHint}</p>
        </div>
      </div>
      <DemoSection title={tDemo.sections.simulation} defaultOpen>
        <SimulationSection />
      </DemoSection>
      <DemoSection title={tDemo.sections.storeTime}>
        <StoreTimeSection />
      </DemoSection>
      <DemoSection title={tDemo.sections.network}>
        <NetworkSection />
      </DemoSection>
      <DemoSection title={tDemo.sections.menu}>
        <MenuAppearanceSection />
      </DemoSection>
      {kiosk ? null : (
        <>
          <DemoSection title={tDemo.sections.stock}>
            <StockSection />
          </DemoSection>
          <DemoSection title={tDemo.sections.submit}>
            <SubmitSection />
          </DemoSection>
        </>
      )}
      <DemoSection title={tDemo.sections.account}>
        <AccountSection />
      </DemoSection>
    </div>
  );
}

export interface DemoPanelShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 浮動入口按鈕：關閉後焦點回到這裡 */
  returnFocusRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/** 面板外殼 + 內容（DemoRoot 在第一次開啟時才動態載入此模組，見 DemoRoot.tsx） */
export function DemoPanel(props: Omit<DemoPanelShellProps, 'children'>) {
  return (
    <DemoPanelShell {...props}>
      <DemoPanelBody />
    </DemoPanelShell>
  );
}

export function DemoPanelShell({
  open,
  onOpenChange,
  returnFocusRef,
  children,
}: DemoPanelShellProps) {
  const wide = useMediaQuery('(min-width: 768px)');
  if (!open) return null;
  if (!wide) {
    return (
      <Sheet
        open
        onOpenChange={onOpenChange}
        title={tDemo.panel.title}
        description={tDemo.panel.description}
        returnFocusRef={returnFocusRef}
        className="max-md:max-h-[70dvh]"
      >
        <div id={DEMO_PANEL_ID} className="mt-3">
          {children}
        </div>
      </Sheet>
    );
  }
  return (
    <FloatingPanel onClose={() => onOpenChange(false)} returnFocusRef={returnFocusRef}>
      {children}
    </FloatingPanel>
  );
}

function FloatingPanel({
  onClose,
  returnFocusRef,
  children,
}: {
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);

  // 開啟時焦點移到標題（與 Sheet 一致）；關閉時還原到浮動按鈕
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
    const returnTarget = returnFocusRef.current;
    return () => {
      const active = document.activeElement;
      if (
        active === null ||
        active === document.body ||
        active.closest(`#${DEMO_PANEL_ID}`) !== null
      ) {
        returnTarget?.focus({ preventScroll: true });
      }
    };
  }, [returnFocusRef]);

  // Esc 收合：只在焦點位於面板內時處理（面板為非 modal，背景仍可操作）
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useLatest(onClose);
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const handler = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onCloseRef.current();
    };
    panel.addEventListener('keydown', handler);
    return () => panel.removeEventListener('keydown', handler);
  }, [onCloseRef]);

  return (
    <div
      ref={panelRef}
      id={DEMO_PANEL_ID}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className={clsx(
        'fixed bottom-[72px] left-4 z-40 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-border bg-bg shadow-lg',
        'max-h-[min(80dvh,720px)] kiosk:bottom-[88px]',
      )}
    >
      <div className="flex shrink-0 items-start justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className="text-h3 font-bold text-text">
            {tDemo.panel.title}
          </h2>
          <p className="text-sm leading-5 text-text-sub">{tDemo.panel.description}</p>
        </div>
        <IconButton label={tDemo.panel.close} icon={<X />} variant="soft" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-4">
        {children}
      </div>
    </div>
  );
}
