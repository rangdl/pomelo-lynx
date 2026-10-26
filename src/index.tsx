import '@lynx-js/preact-devtools';
import '@lynx-js/react/debug';
// AbortController polyfill 最先加载(iOS JSC 可能缺失)。
import './shims/abort-controller.js';
import { root } from '@lynx-js/react';

import { App } from './router.js';

root.render(<App />);

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
