# UI 组件与页面骨架约束

本文是 pomelo-lynx 的 UI 框架入口。**新增页面或控件前先读本文**;如果现有
组件不够用,先扩展共享组件,不要在新的 feature 里重新手写一套。

## 1. 目录

```text
src/shared/theme/
  tokens.css           颜色角色默认值
  palettes.css         四套 palette 的完整亮/暗变体
  layout-tokens.css    间距/圆角/字号/控件高度(非颜色)

src/shared/layouts/
  PageTopBar.tsx       子页顶栏
  SettingsSubPage.tsx  标准滚动子页骨架 + PageLargeTitle + PageTail

src/shared/ui/
  SettingsGroup.tsx    分组卡片/分隔线
  ListRow.tsx          标准设置行
  Switch.tsx           iOS 开关
  SwitchRow.tsx        ListRow + Switch
  TextField.tsx        输入框(边框/focus/键盘避让)
  Button.tsx           操作按钮
  Hint.tsx             说明/错误/警告文本
  IconBadge.tsx        设置行图标块 + tone 色板
  PaletteSwatches.tsx  主/次色点
```

业务组件留在 `src/features/**`,只组合以上原语。

## 2. 强制规则

### 页面骨架

- 标准滚动子页必须使用 `SettingsSubPage`:
  - 关于、开发者、主题色等。
  - 它负责根 `.settings`、`PageTopBar`、`scroll-view` 和 `PageTail`。
- 不要在页面里重复:
  - `<PageTopBar>`
  - `.settings__scroll`
  - `.settings__tail`
  - 顶部安全区 `safe-area-inset-top`
- 根 tab 页(设置 / 播放)使用 `PageLargeTitle` + `scroll-view` + `PageTail`;
  `SettingsLargeTitle` 保留为旧别名。
- 日志页是列表型页面例外:使用 `PageTopBar` + 自定义 `.logs` 布局,但设置区
  仍必须使用 `SettingsGroup` / `ListRow` / `SwitchRow` / `Button` / `Hint`。

### 设置行

- 统一使用 `SettingsGroup` + `ListRow`。
- 分隔线统一用 `SettingsGroupDivider`。
- 不再新增 `.settings-row`、`.logs__setting`、`.dev-server__row` 这类自定义行。
- 开关使用 `SwitchRow`;不要把开关塞进 `ListRow` 的 `trailing` 里重新写
  51×31 的 CSS。

### 输入框

- 统一使用 `TextField`。
- `avoid-keyboard`、`avoid-keyboard-spacing`、`set-soft-input-mode`、
  边框/focus 只允许出现在 `TextField.tsx`。
- 不要在业务页面写 `<input>` 或 `dev-server__input-frame`。
- 异步加载/重置外部值时,通过 `inputKey` 让原生 input 重新挂载。

### 按钮

- 统一使用 `Button`,按语义选 variant:
  - `primary`:主操作
  - `secondary`:次操作
  - `danger`:断开/删除
  - `text`:轻量文字操作
- 不要再写 `.dev-server__btn` / `.logs__action`。

### 提示与错误

- 统一使用 `Hint`:
  - `muted`:普通说明
  - `caption`:更弱的辅助说明
  - `warning`:警告
  - `error`:错误
- 不要在页面里重新定义 note/error 的字号、行高和 padding。

### 图标

- 统一使用 `ListRow` 的 `iconGlyph` + `iconTone`,或独立 `IconBadge`。
- 不要在业务页面写 `iconColor="#..."`。
- 图标 tone 色板集中在 `IconBadge.css`;新增 tone 只改这里。
- 图标是品牌色例外,不随 palette 变体变化。

### 主题色预览

- 主/次色点统一使用 `PaletteSwatches`。
- 主题色卡片统一使用 `ThemePaletteCard`;卡片自己挂
  `theme-<palette>-<scheme>` 完整变体。
- 不要在页面里重新写 swatch/card 的颜色和尺寸。

### 设计 token

共享原语优先使用:

```css
var(--space-1..5)
var(--radius-control)
var(--radius-card)
var(--font-caption)
var(--font-note)
var(--font-body)
var(--font-row-title)
var(--font-group-title)
var(--font-large-title)
var(--font-topbar)
var(--line-caption)
var(--line-note)
var(--control-height)
var(--tap-target)
var(--page-inline)
```

- 非颜色 token 放在 `layout-tokens.css`,不要放进 `tokens.css`;
  `tokens.css` 的 `:root` 被主题契约测试按颜色 token 校验。
- 颜色只用 `tokens.css` / `palettes.css` 的语义角色。
- 新增共享原语时优先复用这些 token;业务页面不要为同类控件再引入新的
  10/12/14px 魔法数字。

## 3. 标准用法

### 页面

```tsx
<SettingsSubPage
  title="关于"
  backLabel="设置"
  onBack={() => navigate({ to: '/settings' })}
  testid="about-page"
  topbarTestid="about-topbar"
  backTestid="about-back"
>
  <SettingsGroup title="客户端更新">
    ...
  </SettingsGroup>
</SettingsSubPage>
```

### 开关行

```tsx
<SwitchRow
  label="自动检查更新"
  detail="启动时自动检查并下载更新"
  checked={enabled}
  onChange={setEnabled}
  testid="client-update-automatic"
  switchTestid="client-update-automatic-switch"
/>
```

### 输入

```tsx
<TextField
  label="代理地址"
  value={draft}
  onChange={setDraft}
  onBlur={commit}
  onConfirm={commit}
  hint="仅支持 https://"
  error={error}
  testid="update-proxy-input"
/>
```

### 按钮

```tsx
<Button
  grow
  variant="secondary"
  label="刷新"
  disabled={saving}
  onTap={refresh}
  testid="dev-server-refresh"
/>
```

### 提示

```tsx
<Hint tone="caption">每 3 秒探测</Hint>
<Hint tone="error" testid="dev-server-error">{error}</Hint>
```

输入框内部的 hint/error 由 `TextField` 自动用 `inset={false}` 对齐边框;
业务页面不要自己调 padding。

### 行尾值 + 箭头

`ListRow` 同时支持 `value` 和 `chevron`,例如日志设置行:

```tsx
<ListRow label="显示级别" value="信息 · info" chevron onTap={...} />
```

### 图标

```tsx
<ListRow iconGlyph="⌂" iconTone="azure" label="客户端" />
<IconBadge glyph="↻" tone="green" />
```

## 4. 新增组件流程

1. 先判断能否用现有原语组合;能用组合就不要新增组件。
2. 如果必须新增,放到 `src/shared/ui` 或 `src/shared/layouts`。
3. 使用 `layout-tokens.css` 的 token 和颜色角色。
4. 补测试:
   - 原语渲染测试
   - `scripts/__tests__/ui-contract.node-test.mjs` 源码约束
5. 更新本文和 `docs/page-design.md`。
6. 验证:
   - `pnpm test`
   - `pnpm run lint`
   - `pnpm run build`
   - `pnpm run e2e:web`
   - iOS 真机/dev server 视觉检查

## 5. 明确禁止

- 在 feature 内新增 switch/input/button/note 的重复 CSS。
- 在 feature 内写 `iconColor="#..."`。
- 在 feature 内写 `avoid-keyboard` 或 input frame。
- 在标准子页重复 `PageTopBar + settings__scroll + settings__tail`。
- 在标准设置区新增自定义行替代 `ListRow`。
- 把非颜色 token 写进 `tokens.css`。
- 用 `key={themeVariant}` 重建 Shell(已有主题契约会拦截)。
- 直接把 Markdown/任意 HTML 渲染进设置行。
- 在 feature CSS 里新增 `__switch`、`input-frame`、`dev-server__btn`、
  note/error/draft/status 等共享控件样式。`ui-contract` 会扫描
  `src/features/settings/*.css` 并失败。

发现约束和实际冲突时,先更新共享组件/契约,不要静默在页面里绕过。
