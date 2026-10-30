import { useNavigate } from '@tanstack/react-router';

import { t } from '../../i18n/index.js';
import { PageTopBar } from '../../shared/layouts/PageTopBar.js';
import {
  themePalettePreference,
  useThemePalette,
} from '../../shared/theme/theme-palette-preference.js';
import { THEME_PALETTE_OPTIONS } from '../../shared/theme/theme-palettes.js';
import { useResolvedScheme } from '../../shared/theme/use-resolved-scheme.js';
import './ThemePalettePage.css';
import './settings.css';

/**
 * 主题色子页:每张卡片用对应 palette 的完整 token 渲染预览。
 * 卡片自身挂 `theme-<palette>-<scheme>` class,所以预览颜色与真实页面同源。
 */
export function ThemePalettePage() {
  const navigate = useNavigate();
  const selected = useThemePalette();
  const scheme = useResolvedScheme();

  return (
    <view className="settings" data-testid="theme-palette-page">
      <PageTopBar
        title={t('themePalette.title')}
        backLabel={t('settings.title')}
        onBack={() => navigate({ to: '/settings' })}
        testid="theme-palette-topbar"
        backTestid="theme-palette-back"
      />
      <scroll-view className="settings__scroll" scroll-orientation="vertical">
        <text className="theme-palette__note">{t('themePalette.note')}</text>
        <view className="theme-palette__list">
          {THEME_PALETTE_OPTIONS.map((option) => {
            const active = option.id === selected;
            return (
              <view
                key={option.id}
                className={`theme-${option.id}-${scheme} theme-palette-card${
                  active ? ' theme-palette-card--selected' : ''
                }`}
                bindtap={() => {
                  'background only';
                  void themePalettePreference.setPalette(option.id);
                }}
                accessibility-element={true}
                accessibility-label={t(option.labelKey)}
                accessibility-traits="button"
                data-testid={`theme-palette-${option.id}`}
              >
                <view className="theme-palette-card__header">
                  <text className="theme-palette-card__title">
                    {t(option.labelKey)}
                  </text>
                  {active ? (
                    <text className="theme-palette-card__check">✓</text>
                  ) : null}
                </view>
                <view className="theme-palette-card__preview">
                  <text className="theme-palette-card__sample">
                    {t('themePalette.sample')}
                  </text>
                  <text className="theme-palette-card__sample-muted">
                    {t('themePalette.sampleMuted')}
                  </text>
                  <view className="theme-palette-card__swatches">
                    <view className="theme-palette-card__swatch theme-palette-card__swatch--primary" />
                    <view className="theme-palette-card__swatch theme-palette-card__swatch--secondary" />
                  </view>
                </view>
              </view>
            );
          })}
        </view>
        <view className="settings__tail" />
      </scroll-view>
    </view>
  );
}
