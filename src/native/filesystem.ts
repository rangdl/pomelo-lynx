import { readNativeModules } from './native-modules.js';

export type FileArea =
  | 'appData'
  | 'cache'
  | 'temp'
  | 'documents'
  | 'noBackup'
  | 'external'
  | 'externalCache';

export interface PathInfo {
  path: string;
  userVisible: boolean;
  purgeable: boolean;
  backedUp: boolean;
  writable: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: number;
}

export interface FileStat extends FileEntry {
  readonly: boolean;
}

interface FileSystemModule {
  getPath(
    area: string,
    relative: string,
    callback: (json: string) => void,
  ): void;
  list(area: string, relative: string, callback: (json: string) => void): void;
  stat(area: string, relative: string, callback: (json: string) => void): void;
  exists(
    area: string,
    relative: string,
    callback: (json: string) => void,
  ): void;
  readText(
    area: string,
    relative: string,
    callback: (json: string) => void,
  ): void;
  writeText(
    area: string,
    relative: string,
    value: string,
    callback: (json: string) => void,
  ): void;
  appendText(
    area: string,
    relative: string,
    value: string,
    callback: (json: string) => void,
  ): void;
  readBase64(
    area: string,
    relative: string,
    callback: (json: string) => void,
  ): void;
  writeBase64(
    area: string,
    relative: string,
    value: string,
    callback: (json: string) => void,
  ): void;
  mkdir(area: string, relative: string, callback: (json: string) => void): void;
  remove(
    area: string,
    relative: string,
    recursive: boolean,
    callback: (json: string) => void,
  ): void;
  move(
    area: string,
    from: string,
    to: string,
    callback: (json: string) => void,
  ): void;
  copy(
    area: string,
    from: string,
    to: string,
    callback: (json: string) => void,
  ): void;
}

const REQUIRED = [
  'getPath',
  'list',
  'stat',
  'exists',
  'readText',
  'writeText',
  'appendText',
  'readBase64',
  'writeBase64',
  'mkdir',
  'remove',
  'move',
  'copy',
] as const;
const CALLBACK_TIMEOUT_MS = 30_000;

function module(): FileSystemModule | null {
  const value = readNativeModules()?.PomeloFileSystem as
    | Record<string, unknown>
    | undefined;
  return value && REQUIRED.every((name) => typeof value[name] === 'function')
    ? (value as unknown as FileSystemModule)
    : null;
}

export function fileSystemAvailable(): boolean {
  return module() !== null;
}

function invoke(
  run: (callback: (json: string) => void) => void,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('filesystem_timeout'));
    }, CALLBACK_TIMEOUT_MS);
    const finish = (error: Error | null, value?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value ?? {});
    };
    try {
      run((json) => {
        if (settled) return;
        try {
          const value: unknown = JSON.parse(json);
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            finish(new Error('filesystem_invalid_response'));
            return;
          }
          const record = value as Record<string, unknown>;
          if (record.ok !== true) {
            finish(
              new Error(
                typeof record.error === 'string'
                  ? record.error
                  : 'filesystem_failed',
              ),
            );
            return;
          }
          finish(null, record);
        } catch (error) {
          finish(
            error instanceof Error
              ? error
              : new Error('filesystem_invalid_response'),
          );
        }
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error('filesystem_failed'));
    }
  });
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function bool(value: unknown): boolean {
  return value === true;
}

function pathInfo(value: Record<string, unknown>): PathInfo {
  return {
    path: text(value.path),
    userVisible: bool(value.userVisible),
    purgeable: bool(value.purgeable),
    backedUp: bool(value.backedUp),
    writable: bool(value.writable),
  };
}

function entry(value: unknown): FileEntry {
  const item =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    name: text(item.name),
    path: text(item.path),
    isDirectory: bool(item.isDirectory),
    size: number(item.size),
    modified: number(item.modified),
  };
}

function required(): FileSystemModule {
  const value = module();
  if (!value) throw new Error('filesystem_unavailable');
  return value;
}

export async function getPath(
  area: FileArea,
  relative = '',
): Promise<PathInfo> {
  const value = required();
  return pathInfo(
    await invoke((callback) => value.getPath(area, relative, callback)),
  );
}

export async function list(
  area: FileArea,
  relative = '',
): Promise<FileEntry[]> {
  const value = required();
  const result = await invoke((callback) =>
    value.list(area, relative, callback),
  );
  return Array.isArray(result.entries) ? result.entries.map(entry) : [];
}

export async function stat(
  area: FileArea,
  relative: string,
): Promise<FileStat> {
  const value = required();
  const result = await invoke((callback) =>
    value.stat(area, relative, callback),
  );
  return {
    ...entry(result),
    readonly: bool(result.readonly),
  };
}

export async function exists(
  area: FileArea,
  relative: string,
): Promise<boolean> {
  const value = required();
  const result = await invoke((callback) =>
    value.exists(area, relative, callback),
  );
  return bool(result.exists);
}

export async function readText(
  area: FileArea,
  relative: string,
): Promise<string> {
  const value = required();
  const result = await invoke((callback) =>
    value.readText(area, relative, callback),
  );
  return text(result.text);
}

export async function writeText(
  area: FileArea,
  relative: string,
  content: string,
): Promise<void> {
  const value = required();
  await invoke((callback) =>
    value.writeText(area, relative, content, callback),
  );
}

export async function appendText(
  area: FileArea,
  relative: string,
  content: string,
): Promise<void> {
  const value = required();
  await invoke((callback) =>
    value.appendText(area, relative, content, callback),
  );
}

export async function readBase64(
  area: FileArea,
  relative: string,
): Promise<string> {
  const value = required();
  const result = await invoke((callback) =>
    value.readBase64(area, relative, callback),
  );
  return text(result.base64);
}

export async function writeBase64(
  area: FileArea,
  relative: string,
  content: string,
): Promise<void> {
  const value = required();
  await invoke((callback) =>
    value.writeBase64(area, relative, content, callback),
  );
}

export async function mkdir(area: FileArea, relative: string): Promise<void> {
  const value = required();
  await invoke((callback) => value.mkdir(area, relative, callback));
}

export async function remove(
  area: FileArea,
  relative: string,
  recursive = false,
): Promise<void> {
  const value = required();
  await invoke((callback) => value.remove(area, relative, recursive, callback));
}

export async function move(
  area: FileArea,
  from: string,
  to: string,
): Promise<void> {
  const value = required();
  await invoke((callback) => value.move(area, from, to, callback));
}

export async function copy(
  area: FileArea,
  from: string,
  to: string,
): Promise<void> {
  const value = required();
  await invoke((callback) => value.copy(area, from, to, callback));
}
