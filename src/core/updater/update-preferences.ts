import { getPomeloStorage } from '../storage/index.js';

/** prefs key:GitHub API / 下载代理前缀(gh-proxy 类服务),空 = 直连。 */
export const PREF_UPDATE_PROXY = 'update_proxy';

/** 读取更新代理;存储不可用时按直连处理。 */
export async function readUpdateProxy(): Promise<string> {
  try {
    return (
      (await getPomeloStorage().prefs.get(PREF_UPDATE_PROXY))?.trim() ?? ''
    );
  } catch {
    return '';
  }
}
