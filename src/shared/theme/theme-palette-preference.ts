import { useEffect, useState } from '@lynx-js/react';

import {
  getPomeloStorage,
  type PomeloStorage,
} from '../../core/storage/index.js';
import type { ColorScheme } from '../../native/system-appearance.js';

/** 调色板 ID;新增 palette 时同步新增 CSS 变体并更新契约测试。 */
export type ThemePaletteId = 'default' | 'violet' | 'sunset' | 'teal';

export const THEME_PALETTE_IDS: readonly ThemePaletteId[] = [
  'default',
  'violet',
  'sunset',
  'teal',
];
export const DEFAULT_THEME_PALETTE: ThemePaletteId = 'default';
export const THEME_PALETTE_PREF_KEY = 'theme_palette';

function isThemePaletteId(value: unknown): value is ThemePaletteId {
  return (
    typeof value === 'string' &&
    (THEME_PALETTE_IDS as readonly string[]).includes(value)
  );
}

/** 把调色板与明暗合成 CSS 变体名(不含 `theme-` 前缀)。 */
export function resolveThemeVariant(
  palette: ThemePaletteId,
  scheme: ColorScheme,
): string {
  return `${palette}-${scheme}`;
}

/**
 * 调色板偏好。和外观模式分开存储(`theme_palette`),这样旧版本只认识
 * `appearance_mode` 时也能正常回落 default。
 */
export class ThemePalettePreference {
  private palette: ThemePaletteId = DEFAULT_THEME_PALETTE;
  private revision = 0;
  private userSelected = false;
  private hydration: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: () => PomeloStorage = getPomeloStorage,
  ) {}

  getPalette(): ThemePaletteId {
    return this.palette;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* 一个坏订阅者不能影响其它订阅者。 */
      }
    }
  }

  hydrate(): Promise<void> {
    if (this.hydration) return this.hydration;
    const revision = this.revision;
    this.hydration = (async () => {
      try {
        const raw = await this.storage().prefs.get(THEME_PALETTE_PREF_KEY);
        if (this.userSelected || revision !== this.revision) return;
        if (isThemePaletteId(raw)) {
          this.palette = raw;
          this.emit();
        }
      } catch {
        /* 存储不可用时保持 default。 */
      }
    })();
    return this.hydration;
  }

  setPalette(palette: ThemePaletteId): Promise<void> {
    this.userSelected = true;
    this.revision++;
    this.palette = palette;
    this.emit();
    return this.storage()
      .prefs.set(THEME_PALETTE_PREF_KEY, palette)
      .catch(() => {});
  }
}

export const themePalettePreference = new ThemePalettePreference();

/** 订阅调色板偏好;首次挂载时触发一次异步 hydrate。 */
export function useThemePalette(): ThemePaletteId {
  const [palette, setPalette] = useState(() =>
    themePalettePreference.getPalette(),
  );
  useEffect(() => {
    const unsubscribe = themePalettePreference.subscribe(() => {
      setPalette(themePalettePreference.getPalette());
    });
    void themePalettePreference.hydrate();
    return unsubscribe;
  }, []);
  return palette;
}
