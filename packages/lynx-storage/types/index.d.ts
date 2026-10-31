export type StorageArea = 'prefs' | 'secure';
export interface PomeloStorageNativeModule {
  getItem(
    area: StorageArea,
    key: string,
    callback: (value: string | null) => void,
  ): void;
  setItem(area: StorageArea, key: string, value: string): void;
  removeItem(area: StorageArea, key: string): void;
  getKeys(area: StorageArea, callback: (keys: string[]) => void): void;
  getPath?(name: string, callback: (path: string) => void): void;
}
