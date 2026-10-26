import type { BuildIdentity } from '../updater/update-contract.js';

/**
 * 由 lynx.config.ts 从共享 release 元数据注入(__POMELO_BUILD__)。
 * fallback 只用于非打包测试;应用构建总是拿到注入值。
 */
declare const __POMELO_BUILD__: BuildIdentity | undefined;

export const clientBuild: BuildIdentity =
  typeof __POMELO_BUILD__ === 'undefined'
    ? {
        version: 'dev',
        git_commit: 'unknown',
        build_time: 'unknown',
        build_number: 1,
        package_version: '0.0.0',
        native_version: '0.0.0',
        channel: 'dev',
        release_tag: 'dev',
      }
    : __POMELO_BUILD__;
export const clientVersion = clientBuild.version;
