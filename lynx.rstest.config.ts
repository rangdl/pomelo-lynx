// rstest 专用配置:顶层单环境(等价于原 lynx 环境设置)。
// withLynxConfig/toRstestConfig 不处理主配置里的 environments,
// 多环境会让测试拿到错误的目标转换(表现为 `React is not defined`)。
import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';
import { pluginTypeCheck } from '@rsbuild/plugin-type-check';

export default defineConfig({
  source: {
    entry: {
      main: './src/index.tsx',
      probe: './src/probe/index.tsx',
    },
  },
  plugins: [pluginReactLynx(), pluginTypeCheck()],
});
