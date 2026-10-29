import '@lynx-js/preact-devtools';
import '@lynx-js/react/debug';
// AbortController polyfill 必须先于 router 构造加载(iOS JSC 缺失会导致黑屏)。
import './shims/abort-controller.js';
import './shared/theme/tokens.css';
import { root } from '@lynx-js/react';

import { initLogging } from './core/log/index.js';
import { App } from './router.js';

// console 接管 + 崩溃捕获 + session banner,先于首个渲染。
initLogging();
root.render(<App />);

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
