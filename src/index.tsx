import '@lynx-js/preact-devtools';
import '@lynx-js/react/debug';
// 黑屏二分实验 C1:暂不引入 AbortController polyfill(块内嫌疑一号)。
// import './shims/abort-controller.js';
import { root } from '@lynx-js/react';

import { App } from './router.js';

root.render(<App />);

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
