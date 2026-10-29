import { readLynxGlobal } from '../native/native-modules.js';

/**
 * 轻量 i18n:当前只覆盖主导航/设置/关于/日志的常用文案。
 * 语言由宿主通过 `lynx.__globalProps.language` 注入,默认中文。
 */
export type Locale = 'zh' | 'en';

export type MessageKey =
  | 'nav.home'
  | 'nav.settings'
  | 'settings.title'
  | 'settings.about'
  | 'about.title'
  | 'about.back'
  | 'about.host'
  | 'about.bundleVersion'
  | 'about.hostVersion'
  | 'about.copy'
  | 'about.copied'
  | 'about.copyFailed'
  | 'about.release'
  | 'about.logs'
  | 'about.webUpdate'
  | 'logs.title'
  | 'logs.back';

type Messages = Record<MessageKey, string>;

const MESSAGES: Record<Locale, Messages> = {
  zh: {
    'nav.home': '首页',
    'nav.settings': '设置',
    'settings.title': '设置',
    'settings.about': '关于',
    'about.title': '关于',
    'about.back': '设置',
    'about.host': '宿主',
    'about.bundleVersion': 'Bundle 版本',
    'about.hostVersion': '宿主版本',
    'about.copy': '复制版本信息',
    'about.copied': '已复制',
    'about.copyFailed': '复制失败',
    'about.release': '打开发布页',
    'about.logs': '日志',
    'about.webUpdate': 'Web 端随部署更新,无独立热更新',
    'logs.title': '日志',
    'logs.back': '关于',
  },
  en: {
    'nav.home': 'Home',
    'nav.settings': 'Settings',
    'settings.title': 'Settings',
    'settings.about': 'About',
    'about.title': 'About',
    'about.back': 'Settings',
    'about.host': 'Host',
    'about.bundleVersion': 'Bundle version',
    'about.hostVersion': 'Host version',
    'about.copy': 'Copy version info',
    'about.copied': 'Copied',
    'about.copyFailed': 'Copy failed',
    'about.release': 'Open releases',
    'about.logs': 'Logs',
    'about.webUpdate': 'Web updates with the deployment',
    'logs.title': 'Logs',
    'logs.back': 'About',
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
