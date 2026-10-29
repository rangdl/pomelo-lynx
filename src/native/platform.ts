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
}

/** 模块存在所必需的方法;缺一个就视为旧壳,整体降级。 */
const REQUIRED_METHODS = ['openURL', 'setKeepScreenOn'] as const;

const CALLBACK_TIMEOUT_MS = 5000;
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

/** 把回调形状的原生方法包成带超时的 Promise;回调参数非空字符串即失败。 */
function callbackPromise(
  invoke: (callback: (error: unknown) => void) => void,
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
    }, CALLBACK_TIMEOUT_MS);
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
