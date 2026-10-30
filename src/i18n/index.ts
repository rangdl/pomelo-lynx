import { readLynxGlobal } from '../native/native-modules.js';

/**
 * 轻量 i18n:当前只覆盖主导航/设置/关于/日志的常用文案。
 * 语言由宿主通过 `lynx.__globalProps.language` 注入,默认中文。
 */
export type Locale = 'zh' | 'en';

export type MessageKey =
  | 'nav.home'
  | 'nav.settings'
  | 'nav.more'
  | 'settings.title'
  | 'settings.about'
  | 'settings.group.app'
  | 'settings.aboutDetail'
  | 'settings.group.appearance'
  | 'settings.group.developer'
  | 'settings.themePalette'
  | 'settings.themePaletteDetail'
  | 'settings.group.support'
  | 'settings.logs'
  | 'settings.logsDetail'
  | 'settings.developer'
  | 'settings.developerDetail'
  | 'developer.title'
  | 'themePalette.title'
  | 'themePalette.default'
  | 'themePalette.violet'
  | 'themePalette.sunset'
  | 'themePalette.teal'
  | 'themePalette.note'
  | 'themePalette.sample'
  | 'themePalette.sampleMuted'
  | 'appearance.theme'
  | 'appearance.themeDetail'
  | 'appearance.system'
  | 'appearance.light'
  | 'appearance.dark'
  | 'about.title'
  | 'about.back'
  | 'about.group.update'
  | 'about.group.acceleration'
  | 'about.group.clientUpdate'
  | 'about.group.bundleUpdate'
  | 'about.client'
  | 'about.bundleVersion'
  | 'about.copy'
  | 'about.copied'
  | 'about.copyFailed'
  | 'about.release'
  | 'about.checkClientUpdate'
  | 'about.checkClientUpdateDetail'
  | 'about.checkingClient'
  | 'about.clientUpdateAvailable'
  | 'about.clientUpToDate'
  | 'about.clientUpdateUnknown'
  | 'about.changes'
  | 'about.openDownload'
  | 'about.viaProxy'
  | 'about.directGithub'
  | 'about.webUpdate'
  | 'logs.title'
  | 'logs.back';

type Messages = Record<MessageKey, string>;

const MESSAGES: Record<Locale, Messages> = {
  zh: {
    'nav.home': '首页',
    'nav.settings': '设置',
    'nav.more': '更多',
    'settings.title': '设置',
    'settings.about': '关于',
    'settings.group.app': '应用',
    'settings.aboutDetail': '版本与更新',
    'settings.group.appearance': '外观',
    'settings.group.developer': '开发者',
    'settings.developer': 'Dev Server 与调试通道',
    'settings.developerDetail': '连接、刷新与调试中继',
    'settings.themePalette': '主题色',
    'settings.themePaletteDetail': '选择主色与二级强调色',
    'settings.group.support': '支持',
    'settings.logs': '日志',
    'settings.logsDetail': '查看运行日志',
    'themePalette.title': '主题色',
    'themePalette.default': '默认蓝',
    'themePalette.violet': '紫罗兰',
    'themePalette.sunset': '日落橙',
    'themePalette.teal': '青绿',
    'themePalette.note': '选择后立即应用,浅色和深色共用同一调色板。',
    'themePalette.sample': '主题文字',
    'themePalette.sampleMuted': '次要文字',
    'developer.title': '开发者',
    'appearance.theme': '主题',
    'appearance.themeDetail': '跟随系统、浅色或深色',
    'appearance.system': '跟随系统',
    'appearance.light': '浅色',
    'appearance.dark': '深色',
    'about.title': '关于',
    'about.back': '设置',
    'about.group.update': '更新',
    'about.group.acceleration': '加速设置',
    'about.group.clientUpdate': '客户端更新',
    'about.group.bundleUpdate': 'Bundle 热更新',
    'about.client': '客户端',
    'about.bundleVersion': 'Bundle 版本',
    'about.copy': '复制版本信息',
    'about.copied': '已复制',
    'about.copyFailed': '复制失败',
    'about.release': '打开发布页',
    'about.checkClientUpdate': '检查客户端更新',
    'about.checkClientUpdateDetail': '检查是否有新的安装包',
    'about.checkingClient': '正在检查…',
    'about.clientUpdateAvailable': '有新版本',
    'about.clientUpToDate': '已是最新',
    'about.clientUpdateUnknown': '无法确定',
    'about.changes': '更新内容',
    'about.openDownload': '打开下载地址',
    'about.viaProxy': '经代理加速',
    'about.directGithub': 'GitHub 直连',
    'about.webUpdate': 'Web 端随部署更新,无独立热更新',
    'logs.title': '日志',
    'logs.back': '设置',
  },
  en: {
    'nav.home': 'Home',
    'nav.settings': 'Settings',
    'nav.more': 'More',
    'settings.title': 'Settings',
    'settings.about': 'About',
    'settings.group.app': 'App',
    'settings.aboutDetail': 'Version and updates',
    'settings.group.appearance': 'Appearance',
    'settings.group.developer': 'Developer',
    'settings.developer': 'Dev server & debug tunnel',
    'settings.developerDetail': 'Connect, reload and debug relay',
    'settings.themePalette': 'Theme color',
    'settings.themePaletteDetail': 'Choose primary and secondary accents',
    'settings.group.support': 'Support',
    'settings.logs': 'Logs',
    'settings.logsDetail': 'View runtime logs',
    'themePalette.title': 'Theme color',
    'themePalette.default': 'Default blue',
    'themePalette.violet': 'Violet',
    'themePalette.sunset': 'Sunset',
    'themePalette.teal': 'Teal',
    'themePalette.note':
      'Applied immediately. Light and dark share the same palette.',
    'themePalette.sample': 'Primary text',
    'themePalette.sampleMuted': 'Secondary text',
    'developer.title': 'Developer',
    'appearance.theme': 'Theme',
    'appearance.themeDetail': 'Follow system, light or dark',
    'appearance.system': 'System',
    'appearance.light': 'Light',
    'appearance.dark': 'Dark',
    'about.title': 'About',
    'about.back': 'Settings',
    'about.group.update': 'Updates',
    'about.group.acceleration': 'Acceleration',
    'about.group.clientUpdate': 'Client update',
    'about.group.bundleUpdate': 'Bundle hot update',
    'about.client': 'Client',
    'about.bundleVersion': 'Bundle version',
    'about.copy': 'Copy version info',
    'about.copied': 'Copied',
    'about.copyFailed': 'Copy failed',
    'about.release': 'Open releases',
    'about.checkClientUpdate': 'Check client update',
    'about.checkClientUpdateDetail': 'Check for a new installer',
    'about.checkingClient': 'Checking…',
    'about.clientUpdateAvailable': 'Update available',
    'about.clientUpToDate': 'Up to date',
    'about.clientUpdateUnknown': 'Unable to determine',
    'about.changes': "What's new",
    'about.openDownload': 'Open download',
    'about.viaProxy': 'Via proxy',
    'about.directGithub': 'Direct from GitHub',
    'about.webUpdate': 'Web updates with the deployment',
    'logs.title': 'Logs',
    'logs.back': 'Settings',
  },
};

/** 宿主语言;缺失或非英文时回落中文。 */
export function currentLocale(): Locale {
  const language = readLynxGlobal()?.__globalProps?.language;
  return typeof language === 'string' && language.toLowerCase().startsWith('en')
    ? 'en'
    : 'zh';
}

/** 查词典。语言不会在运行中切换,因此不需要订阅/重渲染。 */
export function t(key: MessageKey): string {
  return MESSAGES[currentLocale()][key];
}
