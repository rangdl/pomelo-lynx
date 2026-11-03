import type { ProviderAlbum, ProviderPlaylist } from '@pomelo/provider-sdk';

/**
 * 当前打开的歌单详情上下文。
 *
 * 详情页用**静态路由**(见 src/routes.ts:memory history、无地址栏,
 * ShellLayout 的 ROUTE_DEPTH / PAGE_COMPONENTS / PAGE_STACKS 都是按
 * `AppPath` 穷举的 `Record`),所以歌单 id 不进 URL:调用方在跳转前
 * 写入这里,详情页挂载时读取。
 *
 * 只保留最后一个目标——同一层页面栈里只会有一个详情页。
 */
let currentPlaylist: ProviderPlaylist | null = null;

export function setCurrentPlaylist(playlist: ProviderPlaylist | null): void {
  currentPlaylist = playlist;
}

export function getCurrentPlaylist(): ProviderPlaylist | null {
  return currentPlaylist;
}

/** 当前打开的专辑详情上下文;与歌单同样的静态路由约定。 */
let currentAlbum: ProviderAlbum | null = null;

export function setCurrentAlbum(album: ProviderAlbum | null): void {
  currentAlbum = album;
}

export function getCurrentAlbum(): ProviderAlbum | null {
  return currentAlbum;
}
