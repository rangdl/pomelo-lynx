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
import { ListRow } from '../../shared/ui/ListRow.js';
import { SettingsGroup } from '../../shared/ui/SettingsGroup.js';
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
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const appearanceLabel = t(
    APPEARANCE_OPTIONS.find((option) => option.mode === appearanceMode)
      ?.labelKey ?? 'appearance.system',
  );
  // dev server 与调试通道目前只有 iOS 宿主实现;Android/Web 上不展示,
  // 避免出现点了必然失败的入口。
  const showDeveloperEntry = clientBuild.channel === 'dev' && isIosPlatform();

  return (
    <view className="settings" data-testid="settings-page">
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

        <SettingsGroup title={t('settings.group.appearance')}>
          <ListRow
            icon={<text className="list-row__icon-text">◐</text>}
            iconColor="#0ea5e9"
            label={t('appearance.theme')}
            onTap={() => setAppearanceOpen((open) => !open)}
            testid="appearance-row"
            accessibilityLabel={`${t('appearance.theme')}, ${appearanceLabel}`}
            trailing={
              <view className="appearance-select">
                <text className="appearance-select__value">
                  {appearanceLabel}
                </text>
                <text className="appearance-select__caret">
                  {appearanceOpen ? '▴' : '▾'}
                </text>
              </view>
            }
          />
          {appearanceOpen ? (
            <view className="appearance-menu" data-testid="appearance-menu">
              {APPEARANCE_OPTIONS.map((option) => {
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
        </SettingsGroup>
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
        <view className="settings__tail" />
      </scroll-view>
    </view>
  );
}
