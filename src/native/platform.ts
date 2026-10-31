import { readNativeModules } from './native-modules.js';
import { isWebEnvironment } from './web-platform.js';

/**
 * `NativeModules.PomeloPlatform` 的最小接口。
 *
 * 写方法按 Lynx 原生模块约定 fire-and-forget;需要确认结果的操作用
 * Callback(`setClipboardWithResult` / `shareFile`)。可选方法用于兼容
 * 尚未包含该能力的热更新旧壳。
 */
export interface PomeloPlatformNativeModule {
  openURL(url: string): void;
  setKeepScreenOn(enabled: boolean): void;
  setClipboard?(text: string): void;
  setClipboardWithResult?(
    text: string,
    callback: (error: string | null) => void,
  ): void;
  shareFile?(
    base64: string,
    fileName: string,
    mimeType: string,
    callback: (error: string | null) => void,
  ): void;
  pickAndUploadFile?(
    uploadUrl: string,
    fieldName: string,
    mimeType: string,
    callback: (result: unknown) => void,
  ): void;
  /** dev server 热切换(仅新版 iOS 宿主提供)。 */
  applyDevServer?(url: string, callback: (error: unknown) => void): void;
  clearDevServer?(callback: (error: unknown) => void): void;
  reloadBundle?(callback: (error: unknown) => void): void;
  probeDevServer?(url: string, callback: (result: unknown) => void): void;
  /** 把应用外观同步到 UIKit(状态栏/键盘/系统弹窗)。 */
  setAppearanceMode?(mode: 'system' | 'light' | 'dark'): void;
  /** 按路由开关左边缘返回手势。 */
  setEdgeBackEnabled?(enabled: boolean): void;
  /** 用 TrollStore 的 apple-magnifier scheme 安装 IPA。 */
  openTrollStore?(url: string): void;
  /** 5sing 测试接口的受限 HTTP GET(只允许 5sing API 域名)。 */
  fetchFiveSingText?(
    request: string,
    callback: (result: unknown) => void,
  ): void;
}

/** 模块存在所必需的方法;缺一个就视为旧壳,整体降级。 */
const REQUIRED_METHODS = ['openURL', 'setKeepScreenOn'] as const;

const CALLBACK_TIMEOUT_MS = 5000;
/** dev bundle 下载可能明显超过普通桥调用;原生下载超时是 15s。 */
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_SHARE_BYTES = 16 * 1024 * 1024;

/** 读取原生模块并做能力探测;非 Lynx 宿主、旧壳或测试环境返回 null。 */
export function readPlatformModule(): PomeloPlatformNativeModule | null {
  const candidate = readNativeModules()?.PomeloPlatform as
    | Record<string, unknown>
    | undefined;
  if (
    !candidate ||
    REQUIRED_METHODS.some((name) => typeof candidate[name] !== 'function')
  )
    return null;
  return candidate as unknown as PomeloPlatformNativeModule;
}

/** 当前宿主是否提供 PomeloPlatform。 */
export function hasNativePlatform(): boolean {
  return readPlatformModule() !== null;
}

function isHttpURL(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/**
 * 用系统浏览器打开 http(s) URL。
 *
 * 只接受 http/https,避免把 `javascript:` / `file:` 等交给宿主;
 * 没有原生实现时,仅在能直接操作 DOM 的 Web realm 里退回 `window.open`。
 * 返回是否已交给某个实现处理。
 */
export function openURL(url: string): boolean {
  if (!isHttpURL(url)) return false;
  const module = readPlatformModule();
  if (module) {
    module.openURL(url);
    return true;
  }
  if (isWebEnvironment()) {
    const open = (
      globalThis as { open?: (url: string, target: string) => unknown }
    ).open;
    if (typeof open === 'function') {
      open(url, '_blank');
      return true;
    }
  }
  return false;
}

/**
 * 用 TrollStore 安装 IPA。
 *
 * TrollStore 1.3+ 接管 `apple-magnifier://install?url=`;需要在 TrollStore 设置中
 * 启用 URL Scheme。旧壳没有 `openTrollStore` 时返回 false,由页面提示用户打开
 * 下载页,不要退化成 openURL(旧壳会拒绝该 scheme)。
 */
export function openTrollStoreInstall(ipaURL: string): boolean {
  if (!isHttpURL(ipaURL)) return false;
  const module = readPlatformModule();
  if (!module?.openTrollStore) return false;
  const installURL = `apple-magnifier://install?url=${encodeURIComponent(ipaURL)}`;
  try {
    module.openTrollStore(installURL);
    return true;
  } catch {
    return false;
  }
}

/** 当前宿主是否提供受限的 5sing 测试请求。 */
export function hasNativeFiveSingFetch(): boolean {
  return typeof readPlatformModule()?.fetchFiveSingText === 'function';
}

const FIVE_SING_TIMEOUT_MS = 15_000;

/**
 * 通过原生 URLSession 请求 5sing 测试接口。
 * 原生只允许 5sing 的三个 API 域名,并返回 `[error, status, body]`。
 */
export function fetchFiveSingText(address: string): Promise<string> {
  const fetchText = readPlatformModule()?.fetchFiveSingText;
  if (!fetchText) return Promise.reject(new Error('five_sing_unavailable'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, body: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof error === 'string' && error.length > 0) {
        reject(new Error(error));
        return;
      }
      if (typeof body === 'string') {
        resolve(body);
        return;
      }
      reject(new Error('five_sing_body'));
    };
    const timer = setTimeout(
      () => finish('five_sing_timeout', ''),
      FIVE_SING_TIMEOUT_MS,
    );
    try {
      fetchText(JSON.stringify({ url: address }), (result) => {
        const tuple = Array.isArray(result) ? result : [];
        finish(tuple[0], tuple[2]);
      });
    } catch (error) {
      finish(error instanceof Error ? error.message : 'five_sing_network', '');
    }
  });
}

/** 把回调形状的原生方法包成带超时的 Promise;回调参数非空字符串即失败。 */
function callbackPromise(
  invoke: (callback: (error: unknown) => void) => void,
  timeoutMs = CALLBACK_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof error === 'string' && error.length > 0)
        reject(new Error(error));
      else resolve();
    };
    const timer = setTimeout(() => {
      finish('platform_timeout');
    }, timeoutMs);
    try {
      invoke(finish);
    } catch (error) {
      finish(error instanceof Error ? error.message : 'platform_failed');
    }
  });
}

/**
 * 写入系统剪贴板。优先用带结果的 `setClipboardWithResult`,旧壳退回
 * `setClipboard`(无法确认结果,直接 resolve);Web realm 尝试
 * `navigator.clipboard`。都不可用时 reject `clipboard_unavailable`。
 */
export function setClipboard(text: string): Promise<void> {
  const module = readPlatformModule();
  const withResult = module?.setClipboardWithResult;
  if (withResult)
    return callbackPromise((callback) => withResult(text, callback));
  if (module?.setClipboard) {
    module.setClipboard(text);
    return Promise.resolve();
  }
  const clipboard = (
    globalThis as {
      navigator?: {
        clipboard?: { writeText?: (value: string) => Promise<void> };
      };
    }
  ).navigator?.clipboard;
  if (typeof clipboard?.writeText === 'function')
    return clipboard.writeText(text);
  return Promise.reject(new Error('clipboard_unavailable'));
}

/**
 * 请求/释放屏幕常亮。原生端按窗口生效(Activity 后台时系统会自动释放),
 * 无原生实现时静默降级;返回是否真的下发到宿主。
 */
export function setKeepScreenOn(enabled: boolean): boolean {
  const module = readPlatformModule();
  if (!module) return false;
  module.setKeepScreenOn(enabled);
  return true;
}

/**
 * 把应用外观偏好同步给原生 UIKit。旧壳/Web 没有该方法时静默降级;
 * 返回是否真的下发给宿主。
 */
export function setNativeEdgeBackEnabled(enabled: boolean): void {
  readPlatformModule()?.setEdgeBackEnabled?.(enabled);
}

export function setNativeAppearanceMode(
  mode: 'system' | 'light' | 'dark',
): boolean {
  const setMode = readPlatformModule()?.setAppearanceMode;
  if (!setMode) return false;
  try {
    setMode(mode);
    return true;
  } catch {
    return false;
  }
}

/** shareFile 的入参。base64 不带 `data:` 前缀。 */
export interface ShareFileInput {
  base64: string;
  fileName: string;
  mimeType: string;
}

function validateShareInput(input: ShareFileInput): string | null {
  if (!input.base64) return 'share_invalid_payload';
  // base64 解码后的大小上限与原生端保持一致,避免先跨线程搬运再被拒。
  if (input.base64.length > (MAX_SHARE_BYTES * 4) / 3 + 4)
    return 'share_payload_too_large';
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(input.fileName))
    return 'share_invalid_file_name';
  if (!/^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(input.mimeType))
    return 'share_invalid_mime_type';
  return null;
}

/**
 * 调起系统分享面板分享一个内存文件。文件先由原生端写入临时目录,
 * 不经过 JS 文件系统。
 */
export function shareFile(input: ShareFileInput): Promise<void> {
  const problem = validateShareInput(input);
  if (problem) return Promise.reject(new Error(problem));
  const share = readPlatformModule()?.shareFile;
  if (!share) return Promise.reject(new Error('share_unavailable'));
  return callbackPromise((callback) =>
    share(input.base64, input.fileName, input.mimeType, callback),
  );
}

/** pickAndUploadFile 的入参。mimeType 默认 application/octet-stream。 */
export interface PickAndUploadInput {
  uploadUrl: string;
  fieldName: string;
  mimeType?: string;
}

const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * 选择文件并 multipart 上传。原生回调形状固定为 `[error, body]`:
 * error 为空表示成功,body 是服务器响应文本。文件选择可能超过普通回调的
 * 5 秒窗口,这里单独给 120 秒。
 */
export function pickAndUploadFile(input: PickAndUploadInput): Promise<string> {
  const pick = readPlatformModule()?.pickAndUploadFile;
  if (!pick) return Promise.reject(new Error('upload_unavailable'));
  const uploadUrl = input.uploadUrl.trim();
  if (!isHttpURL(uploadUrl))
    return Promise.reject(new Error('upload_invalid_url'));
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.fieldName))
    return Promise.reject(new Error('upload_invalid_field'));
  const mimeType = (input.mimeType ?? 'application/octet-stream').trim();
  if (!/^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(mimeType))
    return Promise.reject(new Error('upload_invalid_mime_type'));

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, body?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof error === 'string' && error.length > 0)
        reject(new Error(error));
      else resolve(typeof body === 'string' ? body : '');
    };
    const timer = setTimeout(() => {
      finish('upload_timeout');
    }, UPLOAD_TIMEOUT_MS);
    try {
      pick(uploadUrl, input.fieldName, mimeType, (result) => {
        const pair = Array.isArray(result) ? result : [];
        finish(pair[0], pair[1]);
      });
    } catch (error) {
      finish(error instanceof Error ? error.message : 'upload_failed');
    }
  });
}

/**
 * 当前宿主是否支持 dev server 热切换。新版 iOS 宿主提供四个方法;
 * 旧壳/Web 返回 false,开发者页据此提示安装新包。
 */
export function hasDevServerControl(): boolean {
  const module = readPlatformModule();
  return Boolean(
    module?.applyDevServer &&
      module.clearDevServer &&
      module.reloadBundle &&
      module.probeDevServer,
  );
}

function isDevServerURL(value: string): boolean {
  if (!isHttpURL(value)) return false;
  const path = value.trim().split(/[?#]/)[0] ?? '';
  return path.endsWith('.lynx.bundle');
}

/**
 * 连接 dev server:原生先完整下载并校验 bundle,成功后才重建 LynxView。
 * 返回 resolve 表示下载成功(随后页面会重载);失败时当前页面不动。
 */
export function applyDevServer(url: string): Promise<void> {
  const method = readPlatformModule()?.applyDevServer;
  if (!method) return Promise.reject(new Error('devserver_unsupported'));
  const target = url.trim();
  if (!isDevServerURL(target))
    return Promise.reject(new Error('devserver_invalid_url'));
  return callbackPromise(
    (callback) => method(target, callback),
    DOWNLOAD_TIMEOUT_MS,
  );
}

/** 断开 dev server:清配置并立即重建内嵌 bundle,无需冷启动。 */
export function clearDevServer(): Promise<void> {
  const method = readPlatformModule()?.clearDevServer;
  if (!method) return Promise.reject(new Error('devserver_unsupported'));
  return callbackPromise((callback) => method(callback), DOWNLOAD_TIMEOUT_MS);
}

/** 刷新当前来源(优先已配置的 dev URL),下载成功后重建 LynxView。 */
export function reloadBundle(): Promise<void> {
  const method = readPlatformModule()?.reloadBundle;
  if (!method) return Promise.reject(new Error('devserver_unsupported'));
  return callbackPromise((callback) => method(callback), DOWNLOAD_TIMEOUT_MS);
}

export interface DevServerProbe {
  ok: boolean;
  status: number;
  error?: string;
}

const PROBE_TIMEOUT_MS = 6000;

/**
 * 轻量探测 dev server 是否可达。原生发 `HEAD` 请求,不下载完整 bundle。
 * 原生失败(超时/HTTP 错误)也 resolve 为 `ok: false`,方便页面轮询;
 * 只有缺方法或 URL 非法才 reject。
 */
export function probeDevServer(url: string): Promise<DevServerProbe> {
  const probe = readPlatformModule()?.probeDevServer;
  if (!probe) return Promise.reject(new Error('devserver_unsupported'));
  const target = url.trim();
  if (!isDevServerURL(target))
    return Promise.reject(new Error('devserver_invalid_url'));

  return new Promise<DevServerProbe>((resolve) => {
    let settled = false;
    const finish = (error: unknown, status: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const message =
        typeof error === 'string' && error.length > 0 ? error : '';
      const code = typeof status === 'number' ? status : -1;
      resolve({
        ok: message === '' && code >= 200 && code < 400,
        status: code,
        ...(message ? { error: message } : {}),
      });
    };
    const timer = setTimeout(
      () => finish('probe_timeout', -1),
      PROBE_TIMEOUT_MS,
    );
    try {
      probe(target, (result) => {
        const pair = Array.isArray(result) ? result : [];
        finish(pair[0], pair[1]);
      });
    } catch (error) {
      finish(error instanceof Error ? error.message : 'probe_failed', -1);
    }
  });
}
