import { afterEach, beforeEach, describe, expect, test } from '@rstest/core';

import {
  hasNativePlatform,
  openURL,
  pickAndUploadFile,
  setClipboard,
  setKeepScreenOn,
  shareFile,
} from '../platform.js';

interface PlatformMock {
  openURL: (url: string) => void;
  setKeepScreenOn: (enabled: boolean) => void;
  setClipboard?: (text: string) => void;
  setClipboardWithResult?: (
    text: string,
    callback: (error: string | null) => void,
  ) => void;
  shareFile?: (
    base64: string,
    fileName: string,
    mimeType: string,
    callback: (error: string | null) => void,
  ) => void;
  pickAndUploadFile?: (
    uploadUrl: string,
    fieldName: string,
    mimeType: string,
    callback: (result: unknown) => void,
  ) => void;
}

const globals = globalThis as unknown as {
  NativeModules?: Record<string, unknown>;
};

describe('native platform facade', () => {
  beforeEach(() => {
    globals.NativeModules = undefined;
  });

  afterEach(() => {
    globals.NativeModules = undefined;
  });

  test('无原生模块时能力探测为 false,且拒绝非 http(s) URL', () => {
    expect(hasNativePlatform()).toBe(false);
    expect(openURL('javascript:alert(1)')).toBe(false);
    expect(openURL('ftp://example.com/file')).toBe(false);
  });

  test('旧壳缺少必需方法时整体视为不可用', () => {
    globals.NativeModules = {
      PomeloPlatform: {
        openURL: () => {},
      },
    };
    expect(hasNativePlatform()).toBe(false);
  });

  test('openURL 只把 http(s) 交给原生模块', () => {
    const calls: string[] = [];
    globals.NativeModules = {
      PomeloPlatform: {
        openURL: (url: string) => calls.push(url),
        setKeepScreenOn: () => {},
      } satisfies PlatformMock,
    };

    expect(openURL('https://example.com/releases')).toBe(true);
    expect(openURL('http://example.com')).toBe(true);
    expect(openURL('javascript:alert(1)')).toBe(false);
    expect(openURL('file:///etc/passwd')).toBe(false);
    expect(calls).toEqual([
      'https://example.com/releases',
      'http://example.com',
    ]);
  });

  test('setClipboard 优先使用带结果的回调并传播原生错误', async () => {
    const calls: string[] = [];
    let error: string | null = null;
    globals.NativeModules = {
      PomeloPlatform: {
        openURL: () => {},
        setKeepScreenOn: () => {},
        setClipboard: (text: string) => calls.push(`legacy:${text}`),
        setClipboardWithResult: (
          text: string,
          callback: (value: string | null) => void,
        ) => {
          calls.push(`result:${text}`);
          callback(error);
        },
      } satisfies PlatformMock,
    };

    await expect(setClipboard('hello')).resolves.toBeUndefined();
    expect(calls).toEqual(['result:hello']);

    error = 'clipboard_denied';
    await expect(setClipboard('again')).rejects.toThrow('clipboard_denied');
  });

  test('旧壳只有 setClipboard 时退化为无结果写入', async () => {
    const calls: string[] = [];
    globals.NativeModules = {
      PomeloPlatform: {
        openURL: () => {},
        setKeepScreenOn: () => {},
        setClipboard: (text: string) => calls.push(text),
      } satisfies PlatformMock,
    };

    await expect(setClipboard('legacy')).resolves.toBeUndefined();
    expect(calls).toEqual(['legacy']);
  });

  test('setKeepScreenOn 下发到宿主', () => {
    const calls: boolean[] = [];
    globals.NativeModules = {
      PomeloPlatform: {
        openURL: () => {},
        setKeepScreenOn: (enabled: boolean) => calls.push(enabled),
      } satisfies PlatformMock,
    };

    expect(setKeepScreenOn(true)).toBe(true);
    expect(setKeepScreenOn(false)).toBe(true);
    expect(calls).toEqual([true, false]);
  });

  test('shareFile 拒绝非法参数,不跨桥调用', async () => {
    const calls: unknown[] = [];
    globals.NativeModules = {
      PomeloPlatform: {
        openURL: () => {},
        setKeepScreenOn: () => {},
        shareFile: (...args: unknown[]) => calls.push(args),
      } satisfies PlatformMock,
    };

    await expect(
      shareFile({ base64: '', fileName: 'a.txt', mimeType: 'text/plain' }),
    ).rejects.toThrow('share_invalid_payload');
    await expect(
      shareFile({
        base64: 'AA==',
        fileName: '../a.txt',
        mimeType: 'text/plain',
      }),
    ).rejects.toThrow('share_invalid_file_name');
    await expect(
      shareFile({ base64: 'AA==', fileName: 'a.txt', mimeType: 'text' }),
    ).rejects.toThrow('share_invalid_mime_type');
    expect(calls).toEqual([]);
  });

  test('shareFile 把结果回调转成 Promise,缺方法时拒绝', async () => {
    let error: string | null = null;
    const calls: unknown[] = [];
    globals.NativeModules = {
      PomeloPlatform: {
        openURL: () => {},
        setKeepScreenOn: () => {},
        shareFile: (
          base64: string,
          fileName: string,
          mimeType: string,
          callback: (value: string | null) => void,
        ) => {
          calls.push([base64, fileName, mimeType]);
          callback(error);
        },
      } satisfies PlatformMock,
    };

    await expect(
      shareFile({ base64: 'AA==', fileName: 'a.txt', mimeType: 'text/plain' }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([['AA==', 'a.txt', 'text/plain']]);

    error = 'share_failed';
    await expect(
      shareFile({ base64: 'AA==', fileName: 'a.txt', mimeType: 'text/plain' }),
    ).rejects.toThrow('share_failed');

    globals.NativeModules = {
      PomeloPlatform: {
        openURL: () => {},
        setKeepScreenOn: () => {},
      } satisfies PlatformMock,
    };
    await expect(
      shareFile({ base64: 'AA==', fileName: 'a.txt', mimeType: 'text/plain' }),
    ).rejects.toThrow('share_unavailable');
  });

  test('pickAndUploadFile 校验参数且缺方法时拒绝', async () => {
    globals.NativeModules = {
      PomeloPlatform: {
        openURL: () => {},
        setKeepScreenOn: () => {},
      } satisfies PlatformMock,
    };
    await expect(
      pickAndUploadFile({
        uploadUrl: 'https://example.com/upload',
        fieldName: 'file',
      }),
    ).rejects.toThrow('upload_unavailable');

    const calls: unknown[] = [];
    globals.NativeModules = {
      PomeloPlatform: {
        openURL: () => {},
        setKeepScreenOn: () => {},
        pickAndUploadFile: (...args: unknown[]) => calls.push(args),
      } satisfies PlatformMock,
    };
    await expect(
      pickAndUploadFile({
        uploadUrl: 'ftp://example.com/upload',
        fieldName: 'file',
      }),
    ).rejects.toThrow('upload_invalid_url');
    await expect(
      pickAndUploadFile({
        uploadUrl: 'https://example.com/upload',
        fieldName: 'bad field',
      }),
    ).rejects.toThrow('upload_invalid_field');
    await expect(
      pickAndUploadFile({
        uploadUrl: 'https://example.com/upload',
        fieldName: 'file',
        mimeType: 'text',
      }),
    ).rejects.toThrow('upload_invalid_mime_type');
    expect(calls).toEqual([]);
  });

  test('pickAndUploadFile 把 [error, body] 回调转成 Promise', async () => {
    let result: unknown = [null, '{"ok":true}'];
    const calls: unknown[] = [];
    globals.NativeModules = {
      PomeloPlatform: {
        openURL: () => {},
        setKeepScreenOn: () => {},
        pickAndUploadFile: (
          uploadUrl: string,
          fieldName: string,
          mimeType: string,
          callback: (value: unknown) => void,
        ) => {
          calls.push([uploadUrl, fieldName, mimeType]);
          callback(result);
        },
      } satisfies PlatformMock,
    };

    await expect(
      pickAndUploadFile({
        uploadUrl: 'https://example.com/upload',
        fieldName: 'file',
        mimeType: 'image/png',
      }),
    ).resolves.toBe('{"ok":true}');
    expect(calls).toEqual([
      ['https://example.com/upload', 'file', 'image/png'],
    ]);

    result = ['upload_http_500', null];
    await expect(
      pickAndUploadFile({
        uploadUrl: 'https://example.com/upload',
        fieldName: 'file',
      }),
    ).rejects.toThrow('upload_http_500');

    result = ['upload_cancelled', null];
    await expect(
      pickAndUploadFile({
        uploadUrl: 'https://example.com/upload',
        fieldName: 'file',
      }),
    ).rejects.toThrow('upload_cancelled');
  });
});
