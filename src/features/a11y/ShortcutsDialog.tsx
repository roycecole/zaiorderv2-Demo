// src/features/a11y/ShortcutsDialog.tsx —— 快速鍵與偏好（PG-19、CMP-35）
//
// 鍵位表由 HOTKEYS 登錄表產生（單一事實來源）；偏好立即生效、存於本機 prefs，不需按「儲存」。
// 由 HotkeyProvider 掛載並控制開關；入口：⌨ 按鈕、`?`、跳過連結、頁尾與鍵盤提醒確認狀態的「查看全部」。
import { useCallback, useId, useState } from 'react';
import { Badge, Button, Dialog, Kbd, RadioCard, RadioGroup, Switch } from '@/components';
import { HOTKEYS } from '@/domain/hotkeys';
import type { HotkeyDef, HotkeyScope } from '@/domain/hotkeys';
import type { MenuLayout } from '@/domain/menuLayout';
import { env } from '@/config/env';
import { t } from '@/i18n/zh-TW';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { ClearMyDataDialog } from './ClearMyData';
import { useHotkeyContext } from './hotkeyContext';
import type { HotkeyContextValue } from './hotkeyContext';
import { useOverlayScope } from './hotkeyHooks';

const SCOPE_ORDER: readonly HotkeyScope[] = [
  'global',
  'menu',
  'sheet',
  'cart',
  'checkout',
  'order',
];
const LAYOUT_OPTIONS: readonly MenuLayout[] = ['AUTO', 'GRID', 'LIST'];

/** 一列鍵位的鍵帽文字（不含「+」串接：鍵位表以並列呈現多個可用的鍵） */
function keyLabels(def: HotkeyDef): string[] {
  if (def.action === 'jumpCategory') return [...t.a11y.shortcuts.jumpCategoryKeys];
  return def.keys.map((k) => {
    if (k === 'Escape') return 'Esc';
    if (k === 'Ctrl+Enter') return t.a11y.shortcuts.ctrlEnter;
    return k;
  });
}

function ScopeTable({ scope, defs }: { scope: HotkeyScope; defs: readonly HotkeyDef[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h4 id={headingId} className="mb-1 text-sm leading-5 font-bold text-text">
        {t.a11y.shortcuts.scopeLabels[scope]}
      </h4>
      <ul className="m-0 list-none divide-y divide-border p-0">
        {defs.map((def) => (
          <li
            key={`${def.scope}-${def.action}`}
            className="flex items-start justify-between gap-3 py-2 text-sm leading-5"
          >
            <span className="min-w-0 text-text-sub">
              {def.label}
              {def.alwaysOn === true ? (
                <Badge tone="neutral" className="ml-2 align-middle">
                  {t.a11y.shortcuts.alwaysOn}
                </Badge>
              ) : null}
            </span>
            <span className="flex shrink-0 flex-wrap justify-end gap-1">
              {keyLabels(def).map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ShortcutsDialogView({ ctx }: { ctx: HotkeyContextValue }) {
  const { shortcuts, shortcutsFocus } = ctx;
  const open = shortcuts.isOpen;
  useOverlayScope(open);

  const hotkeysEnabled = usePrefsStore((s) => s.hotkeysEnabled);
  const rememberChoices = usePrefsStore((s) => s.rememberChoices);
  const largeText = usePrefsStore((s) => s.largeText);
  const reduceMotion = usePrefsStore((s) => s.reduceMotion);
  const menuLayoutOverride = usePrefsStore((s) => s.menuLayoutOverride);
  const patch = usePrefsStore((s) => s.patch);
  const enableHotkeys = usePrefsStore((s) => s.enableHotkeys);
  const disableHotkeys = usePrefsStore((s) => s.disableHotkeys);
  const forcedHints = useInputModeStore((s) => s.inputMode === 'KEYBOARD_HINTS');
  const enabled = hotkeysEnabled || forcedHints;
  const [clearOpen, setClearOpen] = useState(false);

  const hintId = useId();
  const prefsHeadingId = useId();
  const keysHeadingId = useId();
  const navHeadingId = useId();

  // 以「偏好設定」入口開啟時，捲到偏好區（元素掛載時執行一次）
  const prefsSectionRef = useCallback(
    (el: HTMLElement | null) => {
      if (
        el !== null &&
        shortcutsFocus === 'preferences' &&
        typeof el.scrollIntoView === 'function'
      ) {
        el.scrollIntoView({ block: 'start' });
      }
    },
    [shortcutsFocus],
  );

  const groups = SCOPE_ORDER.map((scope) => ({
    scope,
    defs: HOTKEYS.filter((h) => h.scope === scope),
  })).filter((g) => g.defs.length > 0);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) shortcuts.close();
        }}
        title={t.a11y.shortcuts.title}
        description={enabled ? t.a11y.shortcuts.descriptionOn : t.a11y.shortcuts.descriptionOff}
        size="lg"
        footer={
          <Button variant="primary" onClick={shortcuts.close}>
            {t.a11y.shortcuts.done}
          </Button>
        }
      >
        <div className="space-y-6 pb-2">
          <section aria-labelledby={keysHeadingId}>
            <h3 id={keysHeadingId} className="mb-2 text-h3 font-bold text-text">
              {t.a11y.shortcuts.keysSection}
            </h3>
            <Switch
              label={t.a11y.shortcuts.hotkeysSwitch}
              description={t.a11y.shortcuts.hotkeysSwitchHint}
              checked={hotkeysEnabled}
              aria-describedby={hintId}
              onCheckedChange={(checked) => (checked ? enableHotkeys() : disableHotkeys())}
            />
            <p id={hintId} className="mt-1 text-sm leading-5 text-text-muted">
              {t.a11y.shortcuts.screenReaderHint}
            </p>

            <p className="mt-4 mb-3 text-sm leading-5 text-text-sub">
              {enabled ? t.a11y.shortcuts.keymapOn : t.a11y.shortcuts.keymapOff}
            </p>
            <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
              {groups.map((g) => (
                <ScopeTable key={g.scope} scope={g.scope} defs={g.defs} />
              ))}
              <section aria-labelledby={navHeadingId} className="min-w-0">
                <h4 id={navHeadingId} className="mb-1 text-sm leading-5 font-bold text-text">
                  {t.a11y.shortcuts.navigationTitle}
                </h4>
                <ul className="m-0 list-none divide-y divide-border p-0">
                  {t.a11y.shortcuts.navigation.map((row) => (
                    <li
                      key={row.label}
                      className="flex items-start justify-between gap-3 py-2 text-sm leading-5"
                    >
                      <span className="min-w-0 text-text-sub">{row.label}</span>
                      <span className="flex shrink-0 flex-wrap justify-end gap-1">
                        {row.keys.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </section>

          <section
            ref={prefsSectionRef}
            aria-labelledby={prefsHeadingId}
            data-zo-section="preferences"
          >
            <h3 id={prefsHeadingId} className="mb-2 text-h3 font-bold text-text">
              {t.a11y.shortcuts.prefsSection}
            </h3>
            <div className="space-y-1">
              <Switch
                label={t.a11y.shortcuts.remember}
                description={t.a11y.shortcuts.rememberHint}
                checked={rememberChoices}
                onCheckedChange={(checked) => patch({ rememberChoices: checked })}
              />
              <Switch
                label={t.a11y.shortcuts.largeText}
                description={t.a11y.shortcuts.largeTextHint}
                checked={largeText}
                onCheckedChange={(checked) => patch({ largeText: checked })}
              />
              <Switch
                label={t.a11y.shortcuts.reduceMotion}
                description={t.a11y.shortcuts.reduceMotionHint}
                checked={reduceMotion}
                onCheckedChange={(checked) => patch({ reduceMotion: checked })}
              />
            </div>
            <RadioGroup
              name="zo-menu-layout"
              legend={t.a11y.shortcuts.menuLayout}
              hint={t.a11y.shortcuts.menuLayoutHint}
              columns={3}
              value={menuLayoutOverride}
              onChange={(value) => patch({ menuLayoutOverride: value as MenuLayout })}
              className="mt-4"
            >
              {LAYOUT_OPTIONS.map((option) => (
                <RadioCard
                  key={option}
                  value={option}
                  label={t.a11y.shortcuts.menuLayoutLabels[option]}
                />
              ))}
            </RadioGroup>
            <div className="mt-5">
              <Button variant="secondary" onClick={() => setClearOpen(true)}>
                {t.a11y.shortcuts.clearData}
              </Button>
              <p className="mt-1 text-sm leading-5 text-text-muted">
                {t.a11y.shortcuts.clearDataHint}
              </p>
            </div>
          </section>

          <p className="text-xs leading-4 text-text-muted">{t.a11y.shortcuts.footnote}</p>
          {env.demoMode ? (
            <p className="text-xs leading-4 text-text-muted">{t.a11y.shortcuts.demoFootnote}</p>
          ) : null}
        </div>
      </Dialog>
      <ClearMyDataDialog open={clearOpen} onOpenChange={setClearOpen} />
    </>
  );
}

/** PG-19。需在 HotkeyProvider 內（由它自動掛載；HotkeyProvider 之外不渲染任何內容）。 */
export function ShortcutsDialog() {
  const ctx = useHotkeyContext();
  if (ctx === null) return null;
  return <ShortcutsDialogView ctx={ctx} />;
}
