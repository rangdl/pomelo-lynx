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
 * 当前宿主平台标识(SystemInfo.platform),非 Lynx 环境返回 null。
 * 任一线程都可靠:web-core 会把它同步到 background worker。
 */
export function platformName(): string | null {
  const platform = readSystemInfo()?.platform;
  return typeof platform === 'string' ? platform.toLowerCase() : null;
}

/**
 * 是否运行在 Web 平台(任一线程都可靠)。web-core 的 SystemInfo.platform
 * 为 'web',并会同步到 background worker。
 */
export function isWebPlatform(): boolean {
  return platformName() === 'web';
}

/**
 * 是否 iOS 原生宿主。当前 dev server 与调试通道只在 iOS 宿主实现,
 * 设置页据此隐藏其它平台上不可用的开发者入口。
 */
export function isIosPlatform(): boolean {
  return platformName() === 'ios';
}
