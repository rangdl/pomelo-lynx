# 页面设计约束

新增页面、修改现有页面结构(顶栏、底栏、安全区、滚动容器、设置行)前必读。
本文记录当前实现中已经被真机/Web 验证过的硬约束;与代码冲突时以代码为准,
并同步更新本文。UI 原语与禁止手写项见 [UI 组件约束](ui-kit.md)。

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
  - 标准子页:`SettingsSubPage` 自动渲染 `PageTail`
    (`settings__tail = calc(84px + env(safe-area-inset-bottom))`)
  - 日志列表:同样使用 `PageTail`,不要新增 `logs__tail`
  - 首页(不滚动):`.Home { padding-bottom: calc(68px + env(safe-area-inset-bottom)); }`
- 页面根节点必须是 `display: flex; flex-direction: column; height: 100%`
  (或 `flex: 1; min-height: 0`),滚动区用 `flex: 1; min-height: 0` 吃掉剩余高度。
- **页面栈按底部 tab 划分**:`PAGE_STACKS` 为每个 tab 维护一条祖先链;
  设置 tab 记住最后位置(`lastSettingsPathRef`),从首页切回时恢复到该子页。
  再点当前 tab 回到该 tab 的栈根。祖先页面保持挂载,所以侧滑时父页真实
  垫在当前页下面,不是只露出 shell 背景。

## 2. 顶部标题栏

### 根 tab 页(设置 / 播放)

- 大标题是**滚动区外的固定 topbar**,不能放进 `scroll-view`。
- 使用 `PageLargeTitle`(旧名 `SettingsLargeTitle`)。
- 结构:`settings__header` 在 `settings__scroll` 之前。
- 尺寸:标题 34px / 700;header `padding: 16px 20px 12px`。
- 滚动容器从 header 下方开始,滚动内容不会进入状态栏区域。
- 播放页是第三个根 tab,使用 `PageLargeTitle` + `SettingsGroup` +
  `ListRow` + `TextField` + `Button` + `Hint` + `PageTail`。

### 子页(关于、日志等)

- 统一使用 `PageTopBar`(`src/shared/layouts/PageTopBar.tsx`)。
- 44px 内容高度;左右各 88px;返回按钮 44px 命中区;
  标题 17px / 600 居中。
- **不写 safe-top**;安全区由 `.shell__body` 统一处理。
- 结构:根 view(100% 高) → `PageTopBar` → `scroll-view`(flex:1) → 内容 + tail spacer。
- 开发者页(`/settings/developer`)同样遵守子页结构:设置页只保留一个
  「开发者」入口行,Dev Server 与调试通道都放在子页内。
- 主题色子页(`/settings/theme`)也遵守子页结构:设置页外观分组保留
  「主题色」入口,子页用 `theme-<palette>-<scheme>` 卡片预览四套调色板。
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
  - 图标块统一由 `IconBadge` 渲染:38×38、圆角 9、tone 背景、白色字形;
  - 标题 16px / 500;描述 12px、行高 17px;
  - 右侧值 15px 或箭头 22px;
  - 危险操作加 `danger`;禁用加 `disabled`(0.5 透明度);
  - toggle 行不要把 `onTap` 绑在整行上,避免和开关冒泡叠加。
- **设置页每个入口行都要有 `detail` 描述**(关于/主题/主题色/开发者);
  只有纯值行或危险操作行可以省略。
- 关于页版本行统一为“右侧短版本号 + detail 具体信息”:
  「客户端」右值显示宿主版本的展示值(dev 带 `dev-` 前缀),detail 显示版本号与 commit;
  「Bundle 版本」右值显示 bundle 的展示版本,detail 显示 channel 与 commit。
- 更新区域拆成三张卡片:
  - 「加速设置」:代理开关 + HTTPS 地址输入 + 恢复默认;默认
    `https://gh-proxy.org`,关闭时全部直连。
  - 「客户端更新」:检查 native 安装包、更新内容、打开下载地址、
    打开发布页;iOS 必须提示“先下载到文件,不能直接安装”。
    下载入口只有一个:代理开启时打开加速地址,否则打开 GitHub 原始地址。
    下载入口下方提供「用 TrollStore 安装」,仅在 iOS 显示。
  - 「Bundle 热更新」:通道、自动检查更新、检查/下载/取消/待生效/恢复内置。
  - 两套链路不要混用 `client.json` 与 `version.json`;
    代理开关同时作用于 Release API、更新元数据和 Bundle/IPA 下载。
- 客户端下载入口只在检查成功且存在当前平台资产时显示;没有资产时只保留
  发布页。入口只有一个「打开下载地址」,detail 标注当前走「经代理加速」
  还是「GitHub 直连」,不要再拆成两行。
- 更新内容最多展示 8 条,不渲染 Markdown;完整记录通过发布页查看。
- 分隔线:1px,`margin-left: 64px`(与图标列对齐)。
- 设置页/关于页/更新区统一使用 `ListRow`;旧 `.settings-row`
  已全部迁移,不再新增。
- 外观分组包含两个条目:
  - 「主题」:右侧是浅灰圆角控件(当前值 + `▾`);展开的是锚定在行右下角
    的绝对定位浮层 `appearance-anchor/appearance-popover`,不是把三行塞进
    分组。浮层宽 208px、选项行高 46px、带分隔线和 150ms scale/fade 展开
    动画;选项行用 `appearance-option`,点外部关闭,选中后收起。
  - 「主题色」:右侧显示当前 palette 名称 + 主/次色点,点击进入
    `/settings/theme`;不要在设置页再放下拉。
- 自动更新/代理开关统一用 `SwitchRow`/`Switch`,不要在业务页面写
  51×31 开关 CSS。开关行整行不绑 tap,避免与开关冒泡叠加。
- 输入框统一用 `TextField`;`avoid-keyboard`、输入框边框/focus、
  `bindinput/bindblur` 只允许出现在该组件内。页面不要再写 `<input>`
  或 input frame。异步加载/重置外部值时用 `inputKey` 重新挂载。
- 操作按钮统一用 `Button`;提示/错误统一用 `Hint`;设置行图标统一用
  `ListRow iconGlyph + iconTone` 或 `IconBadge`。禁止在 feature 内写
  `iconColor="#..."`。
- 主题色点统一用 `PaletteSwatches`;主题色卡片统一用
  `ThemePaletteCard`。

## 5. 颜色、主题与安全区

- 颜色只用 `src/shared/theme/tokens.css` 的语义 token;
  不要在页面 CSS/组件内联样式里写死 `#hex` 或 `rgba()`(图标块品牌色除外)。
- 颜色命名对齐 Flutter Material 3 ColorScheme:
  `surface / on-surface / primary / secondary / tertiary / *-container /
  outline / outline-variant / error`;旧 `bg / accent / text-*` 名称已迁移,
  新增代码不要再使用旧名。
- 主题变体 class 形如 `.theme-default-light` / `.theme-default-dark`;Shell 同时挂 `.scheme-light` / `.scheme-dark` 供首页等非颜色逻辑使用。
- **每个 `theme-<palette>-<scheme>` 变体必须自包含全部 token**。iOS Lynx
  切换 class 后不会恢复 `:root` 值;新增颜色角色时,所有 palette 的亮/暗
  变体都要同步补齐。`scripts/__tests__/theme-tokens.node-test.mjs` 会校验
  完整性、亮色覆盖和核心角色存在。
- `ShellLayout` 直接切换 `theme-<palette>-<scheme>` 完整变体 class,
  **不要给根 view 加 `key={themeVariant}`**。每个变体都自包含全部 token,
  切换时不应重建页面树,否则会丢失滚动/输入状态并重播页面进入动画。
- 外观偏好持久化在 `PomeloStorage.prefs` 的 `appearance_mode`:
  `system`(默认)/`light`/`dark`;设置页「外观」分组提供三个选项。
- 调色板偏好持久化在 `theme_palette`:当前
  `default`/`violet`/`sunset`/`teal`,默认
  `default`;与 `appearance_mode` 正交。两者合成
  `theme-<palette>-<scheme>` 完整变体,切换时重建 shell。
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
3. 标准滚动子页是否使用 `SettingsSubPage`?不要再手写
   `PageTopBar + settings__scroll + settings__tail`。
4. 是否**没有**重复写 `safe-area-inset-top`?
5. 滚动区是否 `flex: 1` 且由 `PageTail` 提供尾部留白?
6. 设置条目是否用 `SettingsGroup` / `ListRow`?开关是否用 `SwitchRow`?
7. 输入框是否用 `TextField`?按钮是否用 `Button`?提示是否用 `Hint`?
8. 图标是否用 `iconGlyph/iconTone`?是否没有 `iconColor="#..."`?
9. 主题色点/卡片是否用 `PaletteSwatches` / `ThemePaletteCard`?
10. 是否只使用颜色 token + 布局 token,以及 `<view>` / `<text>`?
11. 交互节点是否有 `data-testid`、可访问标签?
12. 是否验证了 Web(`pnpm e2e:web` 或 Playwright)和 iOS 真机?
    Android 原生能力改动只写计划,等 Android CI/设备恢复后再做。
13. 是否更新了本文、`docs/ui-kit.md` 与 `docs/roadmap.md`?

## 7. 当前未完成/不要假设

- Android `blur-view` 依赖(`xelement-blur-view`)尚未加入;
- iOS 26 液态玻璃/折射透镜未移植;
- >4 tab 的 More 面板代码已存在,但目前只有 3 个 tab,未在真机验收;
- 开发者能力已移到独立子页,Dev Server/调试通道已迁移到
  `SettingsGroup`/`ListRow`/`TextField`/`Button`/`Hint`。
- 日志入口已从关于页移到设置页「支持」分组,路由为 `/settings/logs`。
- 客户端更新与 Bundle 热更新已拆分;客户端更新检查、`client.json`、
  固定文件名和 changelog 见 [发布与更新](release.md)。
