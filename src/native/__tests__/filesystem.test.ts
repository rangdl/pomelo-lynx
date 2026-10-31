import { afterEach, beforeEach, describe, expect, test } from '@rstest/core';

import {
  fileSystemAvailable,
  getPath,
  list,
  readText,
  remove,
  writeText,
} from '../filesystem.js';

const globals = globalThis as unknown as {
  NativeModules?: Record<string, unknown>;
};

function reply(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

function install(overrides: Record<string, unknown> = {}): void {
  globals.NativeModules = {
    PomeloFileSystem: {
      getPath: (
        _area: string,
        _relative: string,
        callback: (json: string) => void,
      ) =>
        callback(
          reply({
            ok: true,
            path: '/data/app',
            userVisible: false,
            purgeable: false,
            backedUp: true,
            writable: true,
          }),
        ),
      list: (
        _area: string,
        _relative: string,
        callback: (json: string) => void,
      ) =>
        callback(
          reply({
            ok: true,
            entries: [
              {
                name: 'a.txt',
                path: '/data/app/a.txt',
                isDirectory: false,
                size: 3,
                modified: 10,
              },
            ],
          }),
        ),
      stat: (
        _area: string,
        _relative: string,
        callback: (json: string) => void,
      ) =>
        callback(
          reply({
            ok: true,
            name: 'a.txt',
            path: '/data/app/a.txt',
            isDirectory: false,
            size: 3,
            modified: 10,
            readonly: false,
          }),
        ),
      exists: (
        _area: string,
        _relative: string,
        callback: (json: string) => void,
      ) => callback(reply({ ok: true, exists: true })),
      readText: (
        _area: string,
        _relative: string,
        callback: (json: string) => void,
      ) => callback(reply({ ok: true, text: 'hello' })),
      writeText: (
        _area: string,
        _relative: string,
        _value: string,
        callback: (json: string) => void,
      ) => callback(reply({ ok: true })),
      appendText: (
        _area: string,
        _relative: string,
        _value: string,
        callback: (json: string) => void,
      ) => callback(reply({ ok: true })),
      readBase64: (
        _area: string,
        _relative: string,
        callback: (json: string) => void,
      ) => callback(reply({ ok: true, base64: 'aGVsbG8=' })),
      writeBase64: (
        _area: string,
        _relative: string,
        _value: string,
        callback: (json: string) => void,
      ) => callback(reply({ ok: true })),
      mkdir: (
        _area: string,
        _relative: string,
        callback: (json: string) => void,
      ) => callback(reply({ ok: true })),
      remove: (
        _area: string,
        _relative: string,
        _recursive: boolean,
        callback: (json: string) => void,
      ) => callback(reply({ ok: true })),
      move: (
        _area: string,
        _from: string,
        _to: string,
        callback: (json: string) => void,
      ) => callback(reply({ ok: true })),
      copy: (
        _area: string,
        _from: string,
        _to: string,
        callback: (json: string) => void,
      ) => callback(reply({ ok: true })),
      ...overrides,
    },
  };
}

describe('filesystem facade', () => {
  beforeEach(() => {
    globals.NativeModules = undefined;
  });
  afterEach(() => {
    globals.NativeModules = undefined;
  });

  test('缺少模块时明确不可用', async () => {
    expect(fileSystemAvailable()).toBe(false);
    await expect(getPath('appData')).rejects.toThrow('filesystem_unavailable');
  });

  test('解析目录信息与列表', async () => {
    install();
    expect(fileSystemAvailable()).toBe(true);
    await expect(getPath('appData')).resolves.toEqual({
      path: '/data/app',
      userVisible: false,
      purgeable: false,
      backedUp: true,
      writable: true,
    });
    await expect(list('cache')).resolves.toEqual([
      {
        name: 'a.txt',
        path: '/data/app/a.txt',
        isDirectory: false,
        size: 3,
        modified: 10,
      },
    ]);
    await expect(readText('documents', 'a.txt')).resolves.toBe('hello');
  });

  test('写入和删除参数原样传给原生', async () => {
    const writes: unknown[][] = [];
    const removes: unknown[][] = [];
    install({
      writeText: (
        area: string,
        relative: string,
        value: string,
        callback: (json: string) => void,
      ) => {
        writes.push([area, relative, value]);
        callback(reply({ ok: true }));
      },
      remove: (
        area: string,
        relative: string,
        recursive: boolean,
        callback: (json: string) => void,
      ) => {
        removes.push([area, relative, recursive]);
        callback(reply({ ok: true }));
      },
    });

    await writeText('appData', 'queue.json', '[]');
    await remove('appData', 'tmp', true);
    expect(writes).toEqual([['appData', 'queue.json', '[]']]);
    expect(removes).toEqual([['appData', 'tmp', true]]);
  });

  test('原生错误码转成 rejection', async () => {
    install({
      readText: (
        _area: string,
        _relative: string,
        callback: (json: string) => void,
      ) => callback(reply({ ok: false, error: 'path_escape' })),
    });
    await expect(readText('appData', '../secret')).rejects.toThrow(
      'path_escape',
    );
  });
});
