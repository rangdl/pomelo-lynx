import { useEffect, useState } from '@lynx-js/react';

import {
  getPomeloStorage,
  type PomeloStorage,
} from '../../core/storage/index.js';

/**
 * 首页条目的标识。
 *
 * 新增条目时:在这里加 id、在 HOME_SECTION_LABELS 加标题、在
 * DEFAULT_HOME_SECTIONS 加默认位置,首页按同一顺序渲染。旧版本存下来的
 * 配置里没有新 id 时,会自动补到末尾(见 normalize)。
 */
export type HomeSectionId = 'recent' | 'playlists' | 'albums';

export interface HomeSectionConfig {
  id: HomeSectionId;
  visible: boolean;
}

/** 配置页展示用的标题。 */
export const HOME_SECTION_LABELS: Record<HomeSectionId, string> = {
  recent: '最近添加',
  playlists: '歌单',
  albums: '专辑',
};

/** 默认顺序与默认显隐。 */
export const DEFAULT_HOME_SECTIONS: readonly HomeSectionConfig[] = [
  { id: 'recent', visible: true },
  { id: 'playlists', visible: true },
  { id: 'albums', visible: true },
];

export const HOME_SECTIONS_PREF_KEY = 'home_sections';

const KNOWN_IDS: readonly HomeSectionId[] = DEFAULT_HOME_SECTIONS.map(
  (section) => section.id,
);

function isSectionId(value: unknown): value is HomeSectionId {
  return (
    typeof value === 'string' &&
    (KNOWN_IDS as readonly string[]).includes(value)
  );
}

/**
 * 把存储里的任意 JSON 归一成合法配置:
 * - 丢弃未知 id(旧版本删掉的条目)
 * - 去重(同一条目只出现一次)
 * - 把缺失的已知 id 按默认顺序追加到末尾(新版本新增的条目)
 */
export function normalizeHomeSections(value: unknown): HomeSectionConfig[] {
  const seen = new Set<HomeSectionId>();
  const sections: HomeSectionConfig[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = (item as { id?: unknown } | null)?.id;
      if (!isSectionId(id) || seen.has(id)) continue;
      seen.add(id);
      sections.push({
        id,
        visible: (item as { visible?: unknown }).visible !== false,
      });
    }
  }
  for (const fallback of DEFAULT_HOME_SECTIONS) {
    if (!seen.has(fallback.id)) sections.push({ ...fallback });
  }
  return sections;
}

/**
 * 首页条目布局偏好(顺序 + 显隐)。
 *
 * 与调色板偏好同一套模式:内存值先响应,异步 hydrate 补齐,写入失败
 * 只影响持久化、不影响本次会话。
 */
export class HomeSectionsPreference {
  private sections: HomeSectionConfig[] = [...DEFAULT_HOME_SECTIONS];
  private revision = 0;
  private userSelected = false;
  private hydration: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: () => PomeloStorage = getPomeloStorage,
  ) {}

  getSections(): readonly HomeSectionConfig[] {
    return this.sections;
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
        const raw = await this.storage().prefs.get(HOME_SECTIONS_PREF_KEY);
        if (this.userSelected || revision !== this.revision) return;
        if (typeof raw !== 'string' || !raw) return;
        this.sections = normalizeHomeSections(JSON.parse(raw));
        this.emit();
      } catch {
        /* 存储不可用或内容损坏时保持默认布局。 */
      }
    })();
    return this.hydration;
  }

  setSections(sections: readonly HomeSectionConfig[]): Promise<void> {
    this.userSelected = true;
    this.revision++;
    this.sections = normalizeHomeSections(sections);
    this.emit();
    return this.storage()
      .prefs.set(HOME_SECTIONS_PREF_KEY, JSON.stringify(this.sections))
      .catch(() => {});
  }
}

export const homeSectionsPreference = new HomeSectionsPreference();

/** 订阅首页条目布局;首次挂载时触发一次异步 hydrate。 */
export function useHomeSections(): readonly HomeSectionConfig[] {
  const [sections, setSections] = useState(() =>
    homeSectionsPreference.getSections(),
  );
  useEffect(() => {
    const unsubscribe = homeSectionsPreference.subscribe(() => {
      setSections(homeSectionsPreference.getSections());
    });
    void homeSectionsPreference.hydrate();
    return unsubscribe;
  }, []);
  return sections;
}
