import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * iOS 原生源码契约闸门。
 *
 * 本机是 Linux,没有 Xcode/iOS SDK,Swift 类型错误只能在 CI 的 iOS job 暴露。
 * 这个测试把已经踩过的坑固化成源码级断言,让 `pnpm test`(CI 的 prepare job)
 * 就能失败,而不是等 macOS runner 跑完两分钟。
 *
 * 注意:这是启发式源码检查,不是编译器。它只覆盖已知陷阱,不能替代
 * `xcodebuild` 和真机验证。
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const IOS_DIR = join(ROOT, 'host/ios/PomeloLynx');
const PBXPROJ = join(ROOT, 'host/ios/PomeloLynx.xcodeproj/project.pbxproj');

const swiftFiles = readdirSync(IOS_DIR).filter((name) =>
  name.endsWith('.swift'),
);

function read(name) {
  return readFileSync(join(IOS_DIR, name), 'utf8');
}

test('LynxViewLifecycle 的 didRecieveError 使用 Error 且显式暴露 ObjC 选择器', () => {
  const source = read('ViewController.swift');
  assert.ok(source.includes('didRecieveError'), '必须实现 didRecieveError');
  assert.match(
    source,
    /@objc\(lynxView:didRecieveError:\)/,
    '可选协议方法必须显式写 @objc(lynxView:didRecieveError:),否则不会进入 ObjC 分发表',
  );
  assert.match(
    source,
    /didRecieveError error: Error/,
    '协议要求 Error 参数;NSError 只会得到 nearly-matches 告警',
  );
  assert.doesNotMatch(
    source,
    /didRecieveError error: NSError/,
    'didRecieveError 不能用 NSError',
  );
});

test('Any 回调不传 nil,成功用 NSNull()', () => {
  for (const file of swiftFiles) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /\bcallback\??\s*\(\s*nil\s*\)/,
      `${file}: (Any) -> Void 不能接收 nil,成功回调应传 NSNull()`,
    );
  }
});

test('dev URL 加载失败回退内嵌但保留配置供开发者页重试', () => {
  const source = read('ViewController.swift');
  const fallback =
    source.match(
      /private func fallbackToEmbeddedBundle\(\) \{([\s\S]*?)\n {2}\}/,
    )?.[1] ?? '';
  assert.ok(fallback, '缺少 fallbackToEmbeddedBundle');
  assert.match(
    fallback,
    /bundleURL = HostTemplateProvider\.mainBundle/,
    '回退时必须把加载地址切回内嵌 bundle',
  );
  assert.match(fallback, /reloadLynxView\(\)/, '回退后必须重建 LynxView');
  assert.doesNotMatch(
    fallback,
    /removeObject\(forKey: "dev_server_url"/,
    '服务器暂时不可达时不能清掉 dev_server_url,否则服务器恢复后无法自动重试',
  );

  const errorSection = source.slice(
    source.indexOf('didRecieveError error: Error'),
    source.indexOf('private func fallbackToEmbeddedBundle'),
  );
  assert.doesNotMatch(
    errorSection,
    /removeObject\(forKey: "dev_server_url"/,
    '错误处理分支不能清除 dev server 配置',
  );
});

test('系统主题变化不因 inactive 被丢弃', () => {
  const source = read('ViewController.swift');
  assert.doesNotMatch(
    source,
    /applicationState == \.active/,
    '切换系统主题时 app 常处于 inactive;用 applicationState == .active 过滤会造成明显延迟',
  );
  assert.match(
    source,
    /activationState == \.background/,
    '只应忽略真正进入后台的 trait,避免后台瞬态 dark',
  );
});

test('iOS 左边缘手势通过全局事件请求返回', () => {
  const viewController = read('ViewController.swift');
  assert.match(
    viewController,
    /UIScreenEdgePanGestureRecognizer/,
    '缺少左边缘返回手势',
  );
  assert.match(
    viewController,
    /PomeloNavigation\.back/,
    '手势必须发送 PomeloNavigation.back 给 JS 路由',
  );
  assert.match(viewController, /func handleEdgePan\(/);

  const navigation = readFileSync(
    join(ROOT, 'src/native/navigation.ts'),
    'utf8',
  );
  assert.match(navigation, /PomeloNavigation\.back/);
});

test('应用外观偏好同步 UIKit 并在冷启动读取 prefs', () => {
  const viewController = read('ViewController.swift');
  assert.match(
    viewController,
    /func applyAppearanceMode\(/,
    '控制器必须能把 system/light/dark 应用到 UIKit',
  );
  assert.match(
    viewController,
    /overrideUserInterfaceStyle/,
    '状态栏/键盘需要 overrideUserInterfaceStyle 才能跟随应用选择',
  );
  assert.match(
    viewController,
    /applyStoredAppearanceModeIfNeeded\(\)/,
    '冷启动必须读取 appearance_mode,避免首帧外观错误',
  );

  const module = read('PomeloPlatformModule.swift');
  assert.match(module, /"setAppearanceMode"/);
  assert.match(module, /@objc func setAppearanceMode\(/);
});

test('dev server 热切换先下载校验再重建 LynxView', () => {
  const viewController = read('ViewController.swift');
  assert.match(viewController, /func applyDevServer\(/);
  assert.match(viewController, /func reloadCurrentBundle\(/);
  assert.match(viewController, /func clearDevServer\(/);
  assert.match(
    viewController,
    /HostTemplateProvider\.fetchRemoteData\(url\)/,
    '连接/刷新必须复用预下载函数',
  );
  assert.match(
    viewController,
    /stageRemoteTemplate\(data, for: url\)/,
    '下载成功后必须先暂存,避免重建时重复请求',
  );

  const provider = read('HostTemplateProvider.swift');
  assert.match(provider, /static func fetchRemoteData\(/);
  assert.match(
    provider,
    /guard Self\.isLynxBundle\(data\)/,
    '下载后必须先校验 Lynx bundle 头部',
  );
  assert.match(
    provider,
    /takeRemoteTemplate\(for: url\)/,
    'loadTemplate 必须消费预下载数据',
  );
});

test('运行期会重新赋值的 bundleURL 必须声明为 var', () => {
  const source = read('ViewController.swift');
  if (/bundleURL\s*=\s*HostTemplateProvider\.mainBundle/.test(source)) {
    assert.match(
      source,
      /private var bundleURL\b/,
      'bundleURL 在回退时会被重新赋值,不能声明为 let',
    );
  }
});

test('禁止 (@escaping 类型)! 的 IUO 组合', () => {
  for (const file of swiftFiles) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /\(@escaping[^)]*\)!/,
      `${file}: @escaping 闭包再加 IUO 会触发 already-escaping 编译错误`,
    );
  }
});

test('Pomelo 原生模块在 buildConfig 与 pbxproj 中都有登记', () => {
  const viewController = read('ViewController.swift');
  const pbxproj = readFileSync(PBXPROJ, 'utf8');
  const modules = swiftFiles.filter((name) =>
    /^Pomelo.*Module\.swift$/.test(name),
  );

  assert.ok(modules.length > 0, '未找到 Pomelo 原生模块');
  for (const file of modules) {
    const className = file.replace(/\.swift$/, '');
    assert.ok(
      viewController.includes(`config.register(${className}.self)`),
      `${file}: 未在 ViewController.buildConfig 注册`,
    );
    assert.ok(
      pbxproj.includes(`${file} in Sources`),
      `${file}: 未加入 project.pbxproj 的 Sources build phase`,
    );
    assert.ok(
      pbxproj.includes(`path = ${file};`),
      `${file}: project.pbxproj 缺少 PBXFileReference`,
    );
  }
});

test('methodLookup 的每个选择器都能对应到 @objc func', () => {
  const modules = swiftFiles.filter((name) =>
    /^Pomelo.*Module\.swift$/.test(name),
  );
  const pattern =
    /"(\w+)":\s*NSStringFromSelector\(\s*#selector\((\w+)\.(\w+)\(([^)]*)\)\)\s*\)/gs;

  for (const file of modules) {
    const source = read(file);
    const entries = [...source.matchAll(pattern)];
    assert.ok(entries.length > 0, `${file}: 未解析到 methodLookup 条目`);
    for (const [, jsName, className, method] of entries) {
      assert.equal(
        className,
        file.replace(/\.swift$/, ''),
        `${file}: ${jsName} 指向了其它类 ${className}`,
      );
      assert.ok(
        source.includes(`@objc func ${method}(`),
        `${file}: methodLookup 的 ${jsName} 找不到 @objc func ${method}`,
      );
    }
  }
});
