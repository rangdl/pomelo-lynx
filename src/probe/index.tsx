import '@lynx-js/react/debug';
import { root } from '@lynx-js/react';

import { Probe } from './Probe.js';

root.render(<Probe />);

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
