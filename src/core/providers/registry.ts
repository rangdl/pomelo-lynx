import { FnMusicProvider } from '@pomelo/provider-fnmusic';
import {
  type MusicProvider,
  ProviderError,
  type ProviderFetch,
  type ProviderSession,
} from '@pomelo/provider-sdk';
import { SongloftProvider } from '@pomelo/provider-songloft';
import { SubsonicProvider } from '@pomelo/provider-subsonic';

import { readLynxGlobal } from '../../native/native-modules.js';
import { getPomeloStorage } from '../storage/index.js';

/**
 * Provider 注册表:统一管理"当前使用哪个音乐源"。
 *
 * 之前这里写死一个 Songloft 单例,加第二种源时每个调用点都要改。现在改成:
 * - 每种源一个惰性单例(由 `create` 工厂建)
 * - 当前选中项持久化在 `PomeloStorage.prefs` 的 `active_provider`
 * - 业务代码只通过 `getActiveProvider()` 拿实例,不关心具体是谁
 *
 * 每个 provider 的会话各自存在自己的 secure key 下,切换源不会互相覆盖。
 */

export interface ProviderDescriptor {
  /** 稳定 ID,持久化到 prefs;新增源时不要改已有值。 */
  id: string;
  displayName: string;
  /** 连接表单提示:服务端地址的示例/说明。 */
  serverHint: string;
  /** 该源是否支持用 API Key 代替密码(Navidrome 有,Subsonic 官方没有)。 */
  supportsApiKey: boolean;
  create: () => MusicProvider;
}

const ACTIVE_PROVIDER_KEY = 'active_provider';

function runtimeFetch(): ProviderFetch {
  const lynx = readLynxGlobal();
  if (typeof lynx?.fetch === 'function') {
    return lynx.fetch.bind(lynx) as ProviderFetch;
  }
  if (typeof fetch === 'function') return fetch;
  return () =>
    Promise.reject(
      new ProviderError('provider_network', '当前环境不支持网络请求'),
    );
}

function runtimeRuntime() {
  const storage = getPomeloStorage();
  return {
    fetch: runtimeFetch(),
    secure: {
      get: (key: string) => storage.secure.get(key),
      set: (key: string, value: string) => storage.secure.set(key, value),
      remove: (key: string) => storage.secure.remove(key),
    },
  };
}

/**
 * 已支持的 Provider 清单。
 *
 * Subsonic 与 Navidrome 共用一套实现:两者都是 Subsonic REST 兼容服务,
 * Navidrome 官方声明兼容 v1.16.1。差异只在显示名和是否支持 API Key。
 * 不用拆成两个类——那会让设置页出现两个几乎一样、用户无法分辨的选项。
 */
export const PROVIDERS: readonly ProviderDescriptor[] = [
  {
    id: 'songloft',
    displayName: 'Songloft',
    serverHint: '例如 http://192.168.1.10:58091',
    supportsApiKey: false,
    create: () => new SongloftProvider(runtimeRuntime()),
  },
  {
    id: 'navidrome',
    displayName: 'Navidrome',
    serverHint: '例如 http://192.168.1.10:4533',
    supportsApiKey: true,
    create: () =>
      new SubsonicProvider(runtimeRuntime(), {
        providerId: 'navidrome',
        displayName: 'Navidrome',
        sessionKey: 'pomelo.provider.navidrome.session.v1',
      }),
  },
  {
    id: 'subsonic',
    displayName: 'Subsonic',
    serverHint: '例如 http://192.168.1.10:4040',
    supportsApiKey: false,
    create: () =>
      new SubsonicProvider(runtimeRuntime(), {
        providerId: 'subsonic',
        displayName: 'Subsonic',
        sessionKey: 'pomelo.provider.subsonic.session.v1',
      }),
  },
  {
    id: 'fnmusic',
    displayName: '飞牛音乐',
    serverHint: '例如 http://192.168.1.10:5666',
    supportsApiKey: false,
    create: () => new FnMusicProvider(runtimeRuntime()),
  },
];

const instances = new Map<string, MusicProvider>();

export function findProviderDescriptor(id: string): ProviderDescriptor | null {
  return PROVIDERS.find((entry) => entry.id === id) ?? null;
}

/** 按 ID 取 provider 单例;ID 未知时抛错,不静默回落到别的源。 */
export function getProvider(id: string): MusicProvider {
  const cached = instances.get(id);
  if (cached) return cached;
  const descriptor = findProviderDescriptor(id);
  if (!descriptor) {
    throw new ProviderError('provider_not_found', `未知的音乐源:${id}`);
  }
  const created = descriptor.create();
  instances.set(id, created);
  return created;
}

/**
 * 当前生效的音乐源 ID。
 *
 * 默认 Songloft(保持老用户升级后行为不变);prefs 里的值无效时同样回落,
 * 但**不会**改写 prefs——避免一次读取失败就把用户的选择抹掉。
 *
 * 结果缓存在内存里:这个函数在渲染路径上被频繁调用,不能每次都读存储。
 */
let cachedActiveId: string | null = null;

export async function loadActiveProviderId(): Promise<string> {
  if (cachedActiveId) return cachedActiveId;
  const storage = getPomeloStorage();
  let raw: string | null = null;
  try {
    raw = await storage.prefs.get(ACTIVE_PROVIDER_KEY);
  } catch {
    raw = null;
  }
  cachedActiveId = raw && findProviderDescriptor(raw) ? raw : 'songloft';
  return cachedActiveId;
}

/** 同步读缓存值;冷启动前调用会回落到默认源。 */
export function activeProviderId(): string {
  return cachedActiveId ?? 'songloft';
}

export async function setActiveProviderId(id: string): Promise<void> {
  if (!findProviderDescriptor(id)) {
    throw new ProviderError('provider_not_found', `未知的音乐源:${id}`);
  }
  cachedActiveId = id;
  await getPomeloStorage().prefs.set(ACTIVE_PROVIDER_KEY, id);
}

/** 业务代码统一入口:拿到当前选中的 provider。 */
export function getActiveProvider(): MusicProvider {
  return getProvider(activeProviderId());
}

export function activeProviderDescriptor(): ProviderDescriptor {
  const found = findProviderDescriptor(activeProviderId());
  if (found) return found;
  const fallback = PROVIDERS[0];
  if (!fallback)
    throw new ProviderError('provider_not_found', '没有可用的音乐源');
  return fallback;
}

/**
 * 尝试恢复**任意**已登录的 provider。
 *
 * 冷启动时优先恢复当前选中项;若它没有会话,再按顺序尝试其它源——
 * 这样用户切换过源之后旧源仍能被唤起(例如队列里还有旧源的曲目)。
 */
export async function restoreAnyProvider(): Promise<ProviderSession | null> {
  const active = activeProviderId();
  const ordered = [
    ...PROVIDERS.filter((entry) => entry.id === active),
    ...PROVIDERS.filter((entry) => entry.id !== active),
  ];
  for (const descriptor of ordered) {
    try {
      const session = await getProvider(descriptor.id).restore();
      if (session) return session;
    } catch {
      // 单个源恢复失败不能阻断其它源。
    }
  }
  return null;
}
