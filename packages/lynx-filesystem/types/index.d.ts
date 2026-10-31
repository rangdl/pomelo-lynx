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
