import type { MessageKey } from '../../i18n/index.js';
import type { ThemePaletteId } from './theme-palette-preference.js';

export interface ThemePaletteOption {
  id: ThemePaletteId;
  labelKey: MessageKey;
}

/** 设置页和主题色子页共用的展示顺序。 */
export const THEME_PALETTE_OPTIONS: readonly ThemePaletteOption[] = [
  { id: 'default', labelKey: 'themePalette.default' },
  { id: 'violet', labelKey: 'themePalette.violet' },
  { id: 'sunset', labelKey: 'themePalette.sunset' },
  { id: 'teal', labelKey: 'themePalette.teal' },
];
