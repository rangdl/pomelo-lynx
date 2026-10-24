import '@lynx-js/preact-devtools';
import '@lynx-js/react/debug';
// AbortController polyfill 必须先于 router 构造加载(iOS JSC 缺失会导致黑屏)。
import './shims/abort-controller.js';
import { root } from '@lynx-js/react';

import { App } from './router.js';

root.render(<App />);

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
