// src/features/demo/sections/MenuAppearanceSection.tsx —— 菜單資料完整度、主題色、輸入模式與點餐記憶（FR-DM-09～11）
import { useState } from 'react';
import { Button, TextField, useToast } from '@/components';
import { normalizeHex } from '@/domain/theme';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { useInputModeStore } from '@/features/prefs/inputModeStore';
import { demo as tDemo } from '@/i18n/strings/demo';
import { getClock } from '@/services/clock';
import { BRAND_PRESETS, brandHint, presetOf } from '../brand';
import { useDemoContext } from '../DemoContext';
import { ChoiceGroup, SubGroup } from '../parts';
import { sampleRemembered } from '../rememberedSample';

const PROFILE_CHOICES = (['FULL', 'MIXED', 'NO_IMAGES', 'MINIMAL'] as const).map((value) => ({
  value,
  label: tDemo.menu.profile[value],
}));

const INPUT_CHOICES = (['AUTO', 'KIOSK', 'KEYBOARD_HINTS'] as const).map((value) => ({
  value,
  label: tDemo.menu.inputMode[value],
}));

const THEME_STORE = 'store';
const THEME_CUSTOM = 'custom';

export function MenuAppearanceSection() {
  const { state, patchState } = useDemoContext();
  const { toast } = useToast();
  const [customInput, setCustomInput] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  const preset = presetOf(state.themeOverride);
  const themeValue: string =
    state.themeOverride === null ? THEME_STORE : (preset?.key ?? THEME_CUSTOM);
  const themeChoices = [
    { value: THEME_STORE, label: tDemo.menu.themeStore },
    ...BRAND_PRESETS.map((p) => ({ value: p.key, label: p.name })),
    ...(state.themeOverride !== null && preset === undefined
      ? [{ value: THEME_CUSTOM, label: `${tDemo.menu.themeCustom} ${state.themeOverride}` }]
      : []),
  ];
  const swatchOf = (value: string): string | undefined => {
    if (value === THEME_STORE) return undefined;
    if (value === THEME_CUSTOM) return state.themeOverride ?? undefined;
    return BRAND_PRESETS.find((p) => p.key === value)?.hex;
  };
  const onTheme = (value: string): void => {
    if (value === THEME_STORE) patchState({ themeOverride: null });
    else if (value !== THEME_CUSTOM) {
      const hex = BRAND_PRESETS.find((p) => p.key === value)?.hex;
      if (hex !== undefined) patchState({ themeOverride: hex });
    }
  };

  const applyCustom = (): void => {
    const hex = normalizeHex(customInput);
    if (hex === null) {
      setCustomError(tDemo.menu.themeCustomError);
      return;
    }
    setCustomError(null);
    patchState({ themeOverride: hex });
  };

  // 對比提示：優先顯示輸入中的色碼，其次目前覆寫色
  const hint =
    brandHint(customInput) ??
    (state.themeOverride !== null ? brandHint(state.themeOverride) : null);

  const replay = (): void => {
    usePrefsStore.getState().resetKeyboardNotice();
    useInputModeStore.getState().requestKeyboardNoticeReplay();
    toast({ message: tDemo.menu.replayToast, tone: 'info' });
  };

  const clearMemory = (): void => {
    usePrefsStore.getState().clearRemembered();
    toast({ message: tDemo.menu.memoryCleared, tone: 'info' });
  };

  const loadMemory = (): void => {
    const prefs = usePrefsStore.getState();
    prefs.patch({
      rememberChoices: true,
      lastChoices: { ...prefs.lastChoices, ...sampleRemembered(getClock().now().getTime()) },
    });
    toast({ message: tDemo.menu.memoryLoaded, tone: 'success' });
  };

  return (
    <>
      <ChoiceGroup
        legend={tDemo.menu.profileLegend}
        choices={PROFILE_CHOICES}
        value={state.menuProfile}
        onChange={(menuProfile) => patchState({ menuProfile })}
      />

      <div className="space-y-3">
        <ChoiceGroup
          legend={tDemo.menu.themeLegend}
          choices={themeChoices}
          value={themeValue}
          onChange={onTheme}
          swatch={swatchOf}
        />
        <div className="flex items-start gap-2">
          <TextField
            containerClassName="flex-1"
            label={tDemo.menu.themeCustomLabel}
            hint={tDemo.menu.themeCustomHint}
            placeholder="#2E7D4F"
            autoComplete="off"
            spellCheck={false}
            value={customInput}
            error={customError}
            onChange={(e) => {
              setCustomInput(e.target.value);
              setCustomError(null);
            }}
          />
          <Button variant="secondary" className="mt-7" onClick={applyCustom}>
            {tDemo.menu.themeApply}
          </Button>
        </div>
        {hint !== null ? (
          <div className="text-sm leading-5 text-text-sub" aria-live="polite">
            <p>
              {tDemo.menu.contrast(
                hint.onBrand === 'white'
                  ? tDemo.menu.onBrandWhite
                  : hint.onBrand === 'dark'
                    ? tDemo.menu.onBrandDark
                    : tDemo.menu.onBrandBlack,
                hint.onBrandRatio.toFixed(2),
                hint.brandOnWhiteRatio.toFixed(2),
              )}
            </p>
            {hint.lowOnWhite ? <p className="mt-1">{tDemo.menu.lightBrandNote}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <ChoiceGroup
          legend={tDemo.menu.inputLegend}
          hint={tDemo.menu.inputHint}
          choices={INPUT_CHOICES}
          value={state.inputMode}
          onChange={(inputMode) => patchState({ inputMode })}
        />
        <div>
          <Button variant="secondary" onClick={replay}>
            {tDemo.menu.replay}
          </Button>
          <p className="mt-1.5 text-sm leading-5 text-text-muted">
            {state.inputMode === 'AUTO' ? tDemo.menu.replayHint : tDemo.menu.replayBlocked}
          </p>
        </div>
      </div>

      <SubGroup legend={tDemo.menu.memoryLegend}>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={clearMemory}>
            {tDemo.menu.memoryClear}
          </Button>
          <Button variant="secondary" onClick={loadMemory}>
            {tDemo.menu.memoryLoad}
          </Button>
        </div>
      </SubGroup>
    </>
  );
}
