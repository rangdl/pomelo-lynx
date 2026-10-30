import { getPomeloStorage } from '../storage/index.js';

/** 默认 GitHub 加速前缀;只在更新链路使用,不作为通用网络代理。 */
export const DEFAULT_UPDATE_PROXY = 'https://gh-proxy.org';

/** prefs key:代理地址(不含末尾斜杠也可),以及是否在更新链路启用。 */
export const PREF_UPDATE_PROXY = 'update_proxy';
export const PREF_UPDATE_PROXY_ENABLED = 'update_proxy_enabled';

// 与 release-resolver.withGithubProxy 的约束保持一致:HTTPS、主机、可选端口
// 和路径;禁止凭据、查询串、空白和反斜杠。
const PROXY_PATTERN =
  /^https:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?(?:\/[^\s?#@\\]*)?$/i;

export interface UpdateProxySettings {
  enabled: boolean;
  address: string;
}

export function normalizeUpdateProxy(value: string | null | undefined): string {
  return value?.trim() || DEFAULT_UPDATE_PROXY;
}

/** 用户输入校验;空值由调用方先补默认地址。 */
export function isValidUpdateProxy(value: string): boolean {
  return PROXY_PATTERN.test(value.trim());
}

function safeStoredProxy(value: string | null): string {
  const normalized = normalizeUpdateProxy(value);
  return isValidUpdateProxy(normalized) ? normalized : DEFAULT_UPDATE_PROXY;
}

/** 默认开启:国内网络下优先走加速;用户可在设置里关闭。 */
export async function readUpdateProxySettings(): Promise<UpdateProxySettings> {
  let enabledRaw: string | null = null;
  let addressRaw: string | null = null;
  try {
    const prefs = getPomeloStorage().prefs;
    [enabledRaw, addressRaw] = await Promise.all([
      prefs.get(PREF_UPDATE_PROXY_ENABLED),
      prefs.get(PREF_UPDATE_PROXY),
    ]);
  } catch {
    // 存储不可用时使用默认设置,避免更新入口整体失效。
  }
  return {
    enabled: enabledRaw == null ? true : enabledRaw === 'true',
    address: safeStoredProxy(addressRaw),
  };
}

export async function writeUpdateProxySettings(
  input: UpdateProxySettings,
): Promise<void> {
  const address = input.address.trim();
  if (!isValidUpdateProxy(address)) throw new Error('invalid_update_proxy');
  const prefs = getPomeloStorage().prefs;
  await prefs.set(PREF_UPDATE_PROXY_ENABLED, input.enabled ? 'true' : 'false');
  await prefs.set(PREF_UPDATE_PROXY, address);
}

/**
 * 更新链路实际使用的代理前缀;关闭时返回空字符串,让它走直连。
 * Bundle 和客户端更新都通过这一个入口读取,避免两套开关不一致。
 */
export async function readUpdateProxy(): Promise<string> {
  const settings = await readUpdateProxySettings();
  return settings.enabled ? settings.address : '';
}
