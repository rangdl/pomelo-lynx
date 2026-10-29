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

test('didRecieveError 只在 fatal 或未出首屏时回退 dev URL', () => {
  const source = read('ViewController.swift');
  const fallbackGuard = source.indexOf(
    'guard isFatal || !firstScreenReached else { return }',
  );
  const clearPref = source.indexOf(
    'prefs.removeObject(forKey: "dev_server_url")',
  );
  assert.ok(fallbackGuard >= 0, '缺少 fatal/firstScreenReached 守卫');
  assert.ok(clearPref >= 0, '缺少 dev_server_url 清理');
  assert.ok(
    fallbackGuard < clearPref,
    '必须先判断 fatal/首屏状态,再清 dev_server_url;否则 399/301 等首屏后非致命错误会误回退',
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
