# 页面设计约束

新增页面、修改现有页面结构(顶栏、底栏、安全区、滚动容器、设置行)前必读。
本文记录当前实现中已经被真机/Web 验证过的硬约束;与代码冲突时以代码为准,
并同步更新本文。

## 1. 页面外壳

```
ShellLayout(全局唯一)
  shell
    shell__body        ← 顶部安全区只在这里加;display:flex 纵向
      page-stack       ← 当前 tab 的页面栈
        shell__page-layer × N  ← 祖先页保持挂载,绝对定位叠放
        shell__page-layer(top) ← 当前页,唯一参与进入动画
    shell__bottombar   ← 浮动胶囊,position: fixed
    more-sheet         ← 仅 >4 个 tab 时出现
```

硬约束:

- **顶部安全区只在 `.shell__body` 加一次**:`padding-top: env(safe-area-inset-top)`。
  页面、header、PageTopBar 都不要再加 `safe-area-inset-top`,否则二次下移。
- **`.shell__body` 不加 `padding-bottom`**:页面内容要从底栏下方滚过,
  玻璃/模糊才看得见。
- **可滚动页面自己加尾部 spacer**:底部留白必须是真实内容高度。
  Lynx iOS 的 `<scroll-view>` 自身 `padding-bottom` **不会**扩展滚动范围,
  必须用末尾 `<view>` spacer。
  - 设置/关于:`settings__tail = calc(84px + env(safe-area-inset-bottom))`
  - 日志:`logs__tail = calc(84px + env(safe-area-inset-bottom))`
  - 首页(不滚动):`.Home { padding-bottom: calc(68px + env(safe-area-inset-bottom)); }`
- 页面根节点必须是 `display: flex; flex-direction: column; height: 100%`
  (或 `flex: 1; min-height: 0`),滚动区用 `flex: 1; min-height: 0` 吃掉剩余高度。
- **页面栈按底部 tab 划分**:`PAGE_STACKS` 为每个 tab 维护一条祖先链;
  设置 tab 记住最后位置(`lastSettingsPathRef`),从首页切回时恢复到该子页。
  再点当前 tab 回到该 tab 的栈根。祖先页面保持挂载,所以侧滑时父页真实
  垫在当前页下面,不是只露出 shell 背景。

## 2. 顶部标题栏

### 根 tab 页(设置)

- 大标题是**滚动区外的固定 topbar**,不能放进 `scroll-view`。
- 结构:`.settings__header` 在 `.settings__scroll` 之前。
- 尺寸:标题 34px / 700;header `padding: 16px 20px 12px`。
- 滚动容器从 header 下方开始,滚动内容不会进入状态栏区域。

### 子页(关于、日志等)

- 统一使用 `PageTopBar`(`src/shared/layouts/PageTopBar.tsx`)。
- 44px 内容高度;左右各 88px;返回按钮 44px 命中区;
  标题 17px / 600 居中。
- **不写 safe-top**;安全区由 `.shell__body` 统一处理。
- 结构:根 view(100% 高) → `PageTopBar` → `scroll-view`(flex:1) → 内容 + tail spacer。
- 开发者页(`/settings/developer`)同样遵守子页结构:设置页只保留一个
  「开发者」入口行,Dev Server 与调试通道都放在子页内。
- iOS 左边缘右滑返回:宿主 `UIScreenEdgePanGestureRecognizer` 持续发
  `PomeloNavigation.swipe`(`begin/change/end` + 位移),JS 主线程平移
  `.shell__page` 跟手;超过 28% 屏宽或速度 > 500 时滑出并 pop 历史,
  否则回弹。只有 `/settings/*` 子页响应,根 tab 不响应。
- 手势由 JS 按路由开关(`setEdgeBackEnabled`):根 tab 关闭,子页开启。
- 侧滑返回只走**当前 tab 栈的父级**(`parentPath`),不能用全局
  `history.back()`;否则从首页切到设置子页后侧滑会回到首页。
- 手势识别后取消 LynxView 触摸,并在 LynxView 上方加透明 `UIView` 遮罩,
  阻断 scroll-view,同时不打断 touch 序列(禁用 LynxView 交互会导致结束
  回调丢失、页面卡在半途)。遮罩有 2s 安全回收。
- JS 侧还有 1.2s 看门狗:如果 `end` 事件丢失,自动回弹并清理 transform。
- 纵向边缘滑动仍交给页面滚动。
- 页面切换动画挂载在栈顶 `.shell__page-layer` 上:push 从右侧滑入、
  tab 切换 fade;pop 不重复播放,因为父页已经挂在下面。Lynx 没有原生
  导航栈,不要期待系统 interactivePop。

### 状态栏

- 不覆写 `preferredStatusBarStyle`;使用系统默认(浅色模式深字、深色模式浅字)。
- 页面内容从状态栏下方开始,不手写 `env(safe-area-inset-top)`。

## 3. 底部导航胶囊

- 浮动胶囊:`position: fixed`;水平居中;`bottom: calc(8px + env(safe-area-inset-bottom))`;
  高 60px、圆角 30px。
- 宽度自适应:`barWidth = 槽位数 × 84px + 8px`;左右最多 `100% - 24px - 安全区`。
- 槽位上限 4 个;超过 4 个时显示前 3 个 + 「更多」,更多打开底部面板。
- 选中指示器:
  - 单个滑动胶囊,宽度 `100% / 槽位数`,`translateX(index × 100%)`;
  - 指示器父层铺满底栏内容区,子层固定 `height: 48px` 并垂直居中;
    **不要用 top/bottom 双边定位**,iOS 边框取整会造成上下边距不一致;
  - 使用 `TabIndicator` 的主线程 spring/jelly 动画;
  - **不要从 background 再设置指示器的 transform**——首帧位置固定,
    之后只由主线程动画写。
- 选中项内容上下 padding 为 `4px / 4px`,与指示器同高,保持上下对称。
- 图标 24×24、标签 10px;图标在上、标签在下。
- 层级:blur 层 0、tint 1、指示器 2、tab 按钮 3、底栏容器 90、More 面板 100。
- 材质:
  - iOS:`<blur-view>` + `XElement/BlurView`(`blur-radius=24px`,`blur-effect=extra-light|dark`);
  - Web:web-core 把 `blur-view` 映射为 `x-blur-view`,内部是 `backdrop-filter`;
  - Android:当前只走 tint 兜底,`xelement-blur-view` 依赖与渲染仍在计划中;
  - **不要用 CSS `backdrop-filter`**:Lynx 不支持;`filter: blur()` 只会模糊元素自身。
- 页面内容必须能从胶囊下方滚过;不要在 shell 层预留底栏高度。

## 4. 设置条目

统一使用:

- `SettingsGroup`(`src/shared/ui/SettingsGroup.tsx`):组标题 20px / 700,
  卡片圆角 14px、内边距 `4px 0`,组外边距 `0 16px 8px`。
- `ListRow`(`src/shared/ui/ListRow.tsx`):
  - 行内边距 `11px 14px`;
  - 图标块 38×38、圆角 9、彩色背景、白色字形;
  - 标题 16px / 500;描述 12px、行高 17px;
  - 右侧值 15px 或箭头 22px;
  - 危险操作加 `danger`;禁用加 `disabled`(0.5 透明度);
  - toggle 行不要把 `onTap` 绑在整行上,避免和开关冒泡叠加。
- 分隔线:1px,`margin-left: 64px`(与图标列对齐)。
- 旧 `.settings-row` 只允许在未迁移的更新区使用;
  新页面优先 `ListRow`。
- 外观设置只保留一个「主题」条目:右侧是浅灰圆角控件(当前值 + `▾`);
  展开的是锚定在行右下角的绝对定位浮层 `appearance-anchor/appearance-popover`,
  不是把三行塞进分组。浮层宽 208px、选项行高 46px、带分隔线和 150ms
  scale/fade 展开动画;选项行用 `appearance-option`,点外部关闭,选中后收起。
- 「自动检查更新」用右侧 iOS 风格开关(`client-update__switch`,51×31,
  命中区 44px),不要再用「已开启/已关闭」文字。切换用现有
  `settings-row` 行布局,整行不绑 tap,避免与开关冒泡叠加。
- 输入框统一下发:
  `avoid-keyboard={true}`、`avoid-keyboard-spacing="12px"`、
  `set-soft-input-mode="resize"`;聚焦时由 Lynx 抬升根视图,避免键盘
  遮挡输入框。不要自己猜键盘高度。
- 输入框边框用内联样式(原生 input 的 className CSS 不可靠):
  默认 `1px solid var(--color-outline)`,focus 时切
  `var(--color-primary)`;配 `bindfocus/bindblur` 控制状态。

## 5. 颜色、主题与安全区

- 颜色只用 `src/shared/theme/tokens.css` 的语义 token;
  不要在页面 CSS/组件内联样式里写死 `#hex` 或 `rgba()`(图标块品牌色除外)。
- 颜色命名对齐 Flutter Material 3 ColorScheme:
  `surface / on-surface / primary / secondary / tertiary / *-container /
  outline / outline-variant / error`;旧 `bg / accent / text-*` 名称已迁移,
  新增代码不要再使用旧名。
- 深色模式由 `.theme-dark` 覆盖 token;主题类挂在 `.shell`。
- **`.theme-light` 必须显式覆盖 `.theme-dark` 的每个 token**。iOS Lynx
  移除 `.theme-dark` 后不会恢复 `:root` 值,d→浅切换时背景/文字会继续
  沿用深色 token;新增深色 token 时必须同步补浅色值。
  `scripts/__tests__/theme-tokens.node-test.mjs` 会校验这一点。
- `ShellLayout` 的根 `<view>` 以 `key={theme}` 强制重建:切换外观时整棵
  shell 重新挂载,避免 iOS 继续使用旧的自定义属性缓存。切换主题会重置
  当前页面内部状态(滚动位置等),这是可接受的低频操作。
- 外观偏好持久化在 `PomeloStorage.prefs` 的 `appearance_mode`:
  `system`(默认)/`light`/`dark`;设置页「外观」分组提供三个选项。
- 固定浅色/深色时,JS 通过 `PomeloPlatform.setAppearanceMode` 同步
  `overrideUserInterfaceStyle`;状态栏、键盘、系统弹窗都跟随应用选择。
  冷启动由 `ViewController` 读取同一 prefs key 并先行应用。
- 首页也使用主题 token:`.Home` 背景为 `var(--color-surface)`,装饰渐变在
  亮色下降低透明度;不要再写死 `#000` 或白色文字。
- `system` 模式由宿主 `globalProps.colorScheme` 初始化,并只接受
  `reason = trait / foreground / firstScreen` 的外观事件更新;
  `safeArea` 事件和旧宿主(无 `reason`)只同步安全区,不改主题。
- iOS 前台恢复时宿主会重读窗口 trait(并延迟补一次),后台瞬态 dark 不会
  被应用;只有 `activationState == .background` 的 trait 会被忽略,
  `inactive`(控制中心/设置切换)仍然立即更新,真正的系统主题变化不延迟。
- 安全区在实际使用点直接写 `env(safe-area-inset-*)`;
  **不要**把 `env()` 放进 CSS 自定义属性的默认值(iOS Lynx 解析失效,
  会导致 `bottom/left/right` 整条属性无效)。
- 不允许在页面里使用 `:root` 设背景/文字色(会污染其它页面);
  首页样式必须限定在 `.Home` 作用域。

## 6. 新增/修改页面检查清单

1. 是否是 Shell 下的页面?是则自动继承 `shell__body` 的顶部安全区和底栏。
2. 根节点是否 `height: 100%` / `flex: 1; min-height: 0`?
3. 顶栏是否在滚动区外?子页是否用 `PageTopBar`?
4. 是否**没有**重复写 `safe-area-inset-top`?
5. 滚动区是否 `flex: 1` 且在末尾有 `84px + safe-bottom` 的 tail spacer?
6. 设置条目是否用 `SettingsGroup` / `ListRow`?
7. 是否只使用 token 颜色、`<view>` / `<text>`(不用 `div`/`span`)?
8. 交互节点是否有 `data-testid`、可访问标签?
9. 是否验证了 Web(`pnpm e2e:web` 或 Playwright)和 iOS 真机?
   Android 原生能力改动只写计划,等 Android CI/设备恢复后再做。
10. 是否更新了本文与 `docs/roadmap.md`(如果改变了尺寸/平台能力)?

## 7. 当前未完成/不要假设

- Android `blur-view` 依赖(`xelement-blur-view`)尚未加入;
- iOS 26 液态玻璃/折射透镜未移植;
- >4 tab 的 More 面板代码已存在,但目前只有 2 个 tab,未在真机验收;
- 更新区内部仍是旧 `.settings-row` 行,未全部迁移到 `ListRow`;
- 开发者能力已移到独立子页,但 Dev Server/调试通道内部仍是旧
  `.dev-server__*` 行,未迁移到 `ListRow`。
