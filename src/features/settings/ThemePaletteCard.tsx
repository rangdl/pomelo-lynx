import { t } from '../../i18n/index.js';
import type { ThemePaletteOption } from '../../shared/theme/theme-palettes.js';
import { PaletteSwatches } from '../../shared/ui/PaletteSwatches.js';
import './ThemePaletteCard.css';

/** 主题色预览卡:卡片自身挂完整 palette variant,预览与真实页面同源。 */
export function ThemePaletteCard({
  option,
  scheme,
  selected,
  onSelect,
}: {
  option: ThemePaletteOption;
  scheme: 'light' | 'dark';
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <view
      className={`theme-${option.id}-${scheme} theme-palette-card${
        selected ? ' theme-palette-card--selected' : ''
      }`}
      bindtap={() => {
        'background only';
        onSelect();
      }}
      accessibility-element={true}
      accessibility-label={t(option.labelKey)}
      accessibility-traits="button"
      data-testid={`theme-palette-${option.id}`}
    >
      <view className="theme-palette-card__header">
        <text className="theme-palette-card__title">{t(option.labelKey)}</text>
        {selected ? <text className="theme-palette-card__check">✓</text> : null}
      </view>
      <view className="theme-palette-card__preview">
        <text className="theme-palette-card__sample">
          {t('themePalette.sample')}
        </text>
        <text className="theme-palette-card__sample-muted">
          {t('themePalette.sampleMuted')}
        </text>
        <view className="theme-palette-card__swatches">
          <PaletteSwatches size="lg" />
        </view>
      </view>
    </view>
  );
}
