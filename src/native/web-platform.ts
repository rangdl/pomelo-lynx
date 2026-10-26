/**
 * Web 平台探测(移植自 songloft-player-lynx,只保留热更新 UI 需要的部分)。
 */

import { readSystemInfo } from './native-modules.js';

/**
 * 当前 realm 是否有 DOM(可用于直接操作 window/document)。注意这不是平台
 * 判定:Web 端 app 代码跑在 Worker 里,没有 window/document。
 */
export function isWebEnvironment(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * 是否运行在 Web 平台(任一线程都可靠)。web-core 的 SystemInfo.platform
 * 为 'web',并会同步到 background worker。
 */
export function isWebPlatform(): boolean {
  const platform = readSystemInfo()?.['platform'];
  return typeof platform === 'string' && platform.toLowerCase() === 'web';
}
