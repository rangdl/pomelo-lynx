// 黑屏诊断:必须是第一个 import——ESM 按序评估,本模块一加载即自报阶段。
import './shims/crash-guard.js';

import '@lynx-js/preact-devtools';
import '@lynx-js/react/debug';
// AbortController polyfill 必须先于 router 构造加载(iOS JSC 缺失会导致黑屏)。
import './shims/abort-controller.js';
import { root } from '@lynx-js/react';
import { App } from './router.js';
import { markStage } from './shims/crash-guard.js';

markStage('④ 全部 import 评估完成,即将 root.render(<App />)');
root.render(<App />);

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
