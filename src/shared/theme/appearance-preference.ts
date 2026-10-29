import { useEffect, useState } from '@lynx-js/react';

import {
  getPomeloStorage,
  type PomeloStorage,
} from '../../core/storage/index.js';
import { setNativeAppearanceMode } from '../../native/platform.js';
import type { ColorScheme } from '../../native/system-appearance.js';

/** 外观偏好:跟随系统 / 固定浅色 / 固定深色。 */
export type AppearanceMode = 'system' | 'light' | 'dark';

export const APPEARANCE_PREF_KEY = 'appearance_mode';

/** 把偏好和系统主题合成为实际主题。 */
export function resolveTheme(
  mode: AppearanceMode,
  system: ColorScheme,
): ColorScheme {
  return mode === 'system' ? system : mode;
}

/**
 * 设备本地外观偏好。偏好异步从 `PomeloStorage.prefs` 读取,默认 system;
 * 宿主/Web 存储失败时保持内存值,不影响页面启动。
 */
export class AppearancePreference {
  private mode: AppearanceMode = 'system';
  private revision = 0;
  private userSelected = false;
  private hydration: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: () => PomeloStorage = getPomeloStorage,
  ) {}

  getMode(): AppearanceMode {
    return this.mode;
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
        const raw = await this.storage().prefs.get(APPEARANCE_PREF_KEY);
        // 读取期间/之前用户已经手动选择,不能用旧值覆盖。
        if (this.userSelected || revision !== this.revision) return;
        if (raw === 'system' || raw === 'light' || raw === 'dark') {
          this.mode = raw;
          setNativeAppearanceMode(raw);
          this.emit();
        }
      } catch {
        /* 存储不可用时保持 system。 */
      }
    })();
    return this.hydration;
  }

  setMode(mode: AppearanceMode): Promise<void> {
    this.userSelected = true;
    this.revision++;
    this.mode = mode;
    setNativeAppearanceMode(mode);
    this.emit();
    return this.storage()
      .prefs.set(APPEARANCE_PREF_KEY, mode)
      .catch(() => {});
  }
}

export const appearancePreference = new AppearancePreference();

/** 订阅偏好的 React Hook;首次挂载时触发一次异步 hydrate。 */
export function useAppearanceMode(): AppearanceMode {
  const [mode, setMode] = useState(() => appearancePreference.getMode());
  useEffect(() => {
    const unsubscribe = appearancePreference.subscribe(() => {
      setMode(appearancePreference.getMode());
    });
    void appearancePreference.hydrate();
    return unsubscribe;
  }, []);
  return mode;
}
