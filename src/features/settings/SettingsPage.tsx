import { useState } from '@lynx-js/react';
import { useNavigate } from '@tanstack/react-router';

import { clientBuild } from '../../core/config/constants.js';
import { t } from '../../i18n/index.js';
import { isIosPlatform } from '../../native/web-platform.js';
import {
  type AppearanceMode,
  appearancePreference,
  useAppearanceMode,
} from '../../shared/theme/appearance-preference.js';
import { useThemePalette } from '../../shared/theme/theme-palette-preference.js';
import { THEME_PALETTE_OPTIONS } from '../../shared/theme/theme-palettes.js';
import { ListRow } from '../../shared/ui/ListRow.js';
import {
  SettingsGroup,
  SettingsGroupDivider,
} from '../../shared/ui/SettingsGroup.js';
import './settings.css';

const APPEARANCE_OPTIONS: readonly {
  mode: AppearanceMode;
  labelKey: 'appearance.system' | 'appearance.light' | 'appearance.dark';
}[] = [
  { mode: 'system', labelKey: 'appearance.system' },
  { mode: 'light', labelKey: 'appearance.light' },
  { mode: 'dark', labelKey: 'appearance.dark' },
];

/** 设置页:条目列表。「关于」进入关于页(含客户端更新区)。 */
export function SettingsPage() {
  const navigate = useNavigate();
  const appearanceMode = useAppearanceMode();
  const themePalette = useThemePalette();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const paletteLabel = t(
    THEME_PALETTE_OPTIONS.find((option) => option.id === themePalette)
      ?.labelKey ?? 'themePalette.default',
  );
  const appearanceLabel = t(
    APPEARANCE_OPTIONS.find((option) => option.mode === appearanceMode)
      ?.labelKey ?? 'appearance.system',
  );
  // dev server 与调试通道目前只有 iOS 宿主实现;Android/Web 上不展示,
  // 避免出现点了必然失败的入口。
  const showDeveloperEntry = clientBuild.channel === 'dev' && isIosPlatform();

  const toggleAppearanceMenu = () => {
    'background only';
    setAppearanceOpen((open) => !open);
  };

  return (
    <view
      className="settings"
      bindtap={appearanceOpen ? () => setAppearanceOpen(false) : undefined}
      data-testid="settings-page"
    >
      <view className="settings__header">
        <text className="settings__title">{t('settings.title')}</text>
      </view>
      <scroll-view className="settings__scroll" scroll-orientation="vertical">
        <SettingsGroup title={t('settings.group.app')}>
          <ListRow
            icon={<text className="list-row__icon-text">ⓘ</text>}
            iconColor="#5a5ad6"
            label={t('settings.about')}
            detail={t('settings.aboutDetail')}
            chevron
            onTap={() => navigate({ to: '/settings/about' })}
            testid="settings-row-about"
          />
        </SettingsGroup>

        <view
          className={
            appearanceOpen
              ? 'appearance-group appearance-group--raised'
              : 'appearance-group'
          }
        >
          <SettingsGroup title={t('settings.group.appearance')}>
            <view className="appearance-anchor" catchtap={() => {}}>
              <ListRow
                icon={<text className="list-row__icon-text">◐</text>}
                iconColor="#0ea5e9"
                label={t('appearance.theme')}
                detail={t('appearance.themeDetail')}
                testid="appearance-row"
                trailing={
                  <view
                    className="appearance-select"
                    bindtap={toggleAppearanceMenu}
                    accessibility-element={true}
                    accessibility-label={`${t('appearance.theme')}, ${appearanceLabel}`}
                    accessibility-traits="button"
                    data-testid="appearance-trigger"
                  >
                    <text className="appearance-select__value">
                      {appearanceLabel}
                    </text>
                    <view
                      className={
                        appearanceOpen
                          ? 'appearance-select__caret appearance-select__caret--open'
                          : 'appearance-select__caret'
                      }
                      accessibility-element={false}
                    />
                  </view>
                }
              />
              {appearanceOpen ? (
                <view
                  className="appearance-popover"
                  style={{
                    // iOS 的 absolute + flex 子项不会自动撑高,必须显式给高度。
                    height: `${APPEARANCE_OPTIONS.length * 46 + 14}px`,
                  }}
                  data-testid="appearance-menu"
                >
                  {APPEARANCE_OPTIONS.map((option, index) => {
                    const selected = appearanceMode === option.mode;
                    return (
                      <view
                        key={option.mode}
                        className={
                          selected
                            ? 'appearance-option appearance-option--selected'
                            : 'appearance-option'
                        }
                        bindtap={() => {
                          void appearancePreference.setMode(option.mode);
                          setAppearanceOpen(false);
                        }}
                        accessibility-element={true}
                        accessibility-label={t(option.labelKey)}
                        accessibility-traits="button"
                        data-testid={`appearance-${option.mode}`}
                      >
                        {index > 0 ? (
                          <view className="appearance-option-divider" />
                        ) : null}
                        <text className="appearance-option__label">
                          {t(option.labelKey)}
                        </text>
                        {selected ? (
                          <text className="appearance-check">✓</text>
                        ) : null}
                      </view>
                    );
                  })}
                </view>
              ) : null}
            </view>
            <SettingsGroupDivider />
            <ListRow
              icon={<text className="list-row__icon-text">◨</text>}
              iconColor="#7c3aed"
              label={t('settings.themePalette')}
              detail={t('settings.themePaletteDetail')}
              accessibilityLabel={`${t('settings.themePalette')}, ${paletteLabel}`}
              onTap={() => navigate({ to: '/settings/theme' })}
              testid="settings-row-theme-palette"
              trailing={
                <view className="theme-palette-value">
                  <view className="theme-palette-value__swatches">
                    <view className="theme-palette-value__dot" />
                    <view className="theme-palette-value__dot theme-palette-value__dot--secondary" />
                  </view>
                  <text className="list-row__value">{paletteLabel}</text>
                  <text className="list-row__arrow">›</text>
                </view>
              }
            />
          </SettingsGroup>
        </view>
        {showDeveloperEntry ? (
          <SettingsGroup title={t('settings.group.developer')}>
            <ListRow
              icon={<text className="list-row__icon-text">⚙</text>}
              iconColor="#6b7280"
              label={t('settings.developer')}
              detail={t('settings.developerDetail')}
              chevron
              onTap={() => navigate({ to: '/settings/developer' })}
              testid="settings-row-developer"
            />
          </SettingsGroup>
        ) : null}
        <SettingsGroup title={t('settings.group.support')}>
          <ListRow
            icon={<text className="list-row__icon-text">≡</text>}
            iconColor="#6b7280"
            label={t('settings.logs')}
            detail={t('settings.logsDetail')}
            chevron
            onTap={() => navigate({ to: '/settings/logs' })}
            testid="settings-row-logs"
          />
        </SettingsGroup>
        <view className="settings__tail" />
      </scroll-view>
    </view>
  );
}
