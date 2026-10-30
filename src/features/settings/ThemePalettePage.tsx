import { useNavigate } from '@tanstack/react-router';

import { t } from '../../i18n/index.js';
import { SettingsSubPage } from '../../shared/layouts/SettingsSubPage.js';
import {
  themePalettePreference,
  useThemePalette,
} from '../../shared/theme/theme-palette-preference.js';
import { THEME_PALETTE_OPTIONS } from '../../shared/theme/theme-palettes.js';
import { useResolvedScheme } from '../../shared/theme/use-resolved-scheme.js';
import { Hint } from '../../shared/ui/Hint.js';
import { ThemePaletteCard } from './ThemePaletteCard.js';
import './ThemePalettePage.css';

/**
 * 主题色子页:每张卡片用对应 palette 的完整 token 渲染预览。
 * 卡片和 swatch 由 ThemePaletteCard / PaletteSwatches 统一维护。
 */
export function ThemePalettePage() {
  const navigate = useNavigate();
  const selected = useThemePalette();
  const scheme = useResolvedScheme();

  return (
    <SettingsSubPage
      title={t('themePalette.title')}
      backLabel={t('settings.title')}
      onBack={() => navigate({ to: '/settings' })}
      testid="theme-palette-page"
      topbarTestid="theme-palette-topbar"
      backTestid="theme-palette-back"
      scrollTestid="theme-palette-scroll"
    >
      <view className="theme-palette">
        <Hint tone="muted">{t('themePalette.note')}</Hint>
        <view className="theme-palette__list">
          {THEME_PALETTE_OPTIONS.map((option) => (
            <ThemePaletteCard
              key={option.id}
              option={option}
              scheme={scheme}
              selected={option.id === selected}
              onSelect={() => {
                void themePalettePreference.setPalette(option.id);
              }}
            />
          ))}
        </view>
      </view>
    </SettingsSubPage>
  );
}
