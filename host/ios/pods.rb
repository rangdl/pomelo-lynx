# Shared pod graph for the two iOS installation modes:
#
#   host/ios/Podfile          → 本地开发版,带 LynxService/Devtool(Inspector)
#   host/ios/release/Podfile  → CI 发版版,不带 Devtool
#
# 两套 graph 都指向同一个 Xcode 工程/沙盒,所以依赖版本必须只在这里维护,
# 避免两个 Podfile 各自漂移。
module PomeloPods
  def pomelo_pods(devtools:)
    # ---- Lynx SDK ----------------------------------------------------------
    # Versions follow the official reference integration
    # (lynx-family/integrating-lynx-demo-projects, ios/HelloLynxSwift) —
    # the only published configuration verified to render extend native
    # elements (`<input>`) on device.
    #
    # WHY 4.1.0 (not 4.0.1):
    #   1. iOS resolves Lynx / LynxService / XElement in LOCKSTEP (each
    #      XElement and LynxService subspec depends on `Lynx = <same version>`),
    #      so the whole family has to move together.
    #   2. XElement's `Input` subspec hard-depends on the matching engine;
    #      the reference app pairs XElement 4.1.0 with Lynx 4.1.0.
    # 4.1.0 is the same major/minor as Android's `org.lynxsdk.lynx:*:4.0.0`,
    # i.e. the same engine line and bundle-format compatibility.
    pod 'Lynx', '4.1.0', :subspecs => ['Framework']

    # `Lynx/Framework` depends on `LynxBase/Framework` and `LynxServiceAPI`
    # **without any version constraint**, so an unpinned resolve cheerfully
    # pairs Lynx 4.0.1 with a 4.2.0-nightly LynxBase (newest wins). Pin both to
    # Lynx's own release — nightlies of the base layer under a stable engine is
    # exactly the kind of mismatch that produces unreproducible device-only
    # breakage.
    pod 'LynxBase', '4.1.0', :subspecs => ['Framework']
    pod 'LynxServiceAPI', '4.1.0'

    # JS engine. The reference app pairs Lynx 4.1.0 with PrimJS 4.1.1
    # (Lynx's `Framework` subspec pins `PrimJS/quickjs` to that exact
    # version, so PrimJS must move with the engine).
    pod 'PrimJS', '4.1.1', :subspecs => ['quickjs', 'napi']

    # ---- Host services -----------------------------------------------------
    #   Image → `<image>` (backed by SDWebImage on iOS / Fresco on Android)
    #   Log   → engine logging
    # `Devtool` enables the Lynx Inspector Protocol (WebSocket) so `agent-lynx`
    # and the e2e/alignment tooling can drive this app exactly like
    # LynxExplorer. CocoaPods cannot switch subspecs per build configuration,
    # hence the second Podfile instead of an if inside one target.
    #
    # `Http` uses the SDK's LynxService/Http — pomelo-lynx has no
    # self-signed-TLS requirement (songloft did, which is why they replaced it
    # there).
    subspecs = ['Image', 'Log']
    subspecs += ['Devtool'] if devtools
    pod 'LynxService', '4.1.0', :subspecs => subspecs

    # ---- Extend native elements -------------------------------------------
    # `XElement` is the extend native element library (official docs
    # "More Elements"): it provides `<input>`, `<textarea>`, `<list>`, … on
    # iOS. WITHOUT it the engine has no element implementation to create, so
    # `<input>` is simply absent from the tree — it renders as nothing at all
    # (not a styling problem: no element, no view).
    #
    # Taken at the FULL default subspec set, exactly like the reference app
    # (integrating-lynx-demo-projects / ios/HelloLynxSwift): the element
    # registry lives in the framework as a whole, and picking a single
    # subspec is not a documented configuration — the reference app is the
    # only configuration verified to render `<input>` on device.
    pod 'XElement', '4.1.0'

    # LynxService/Image dependencies (versions pinned by the podspec itself).
    pod 'SDWebImage', '5.15.5'
    pod 'SDWebImageWebPCoder', '0.11.0'
  end

  def self.apply_build_settings(installer)
    # The pods declare lower floors; our floor wins so the Swift runtime the
    # modern Xcode links against is actually available.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        if config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < 15.0
          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'
        end
        # The Lynx/Devtool pods emit deprecation warnings (keyWindow on iOS 13+)
        # that the default Xcode 26 settings escalate to -Werror. Host code
        # stays strict; third-party pods must not fail the build over SDK churn.
        config.build_settings['GCC_WARN_INHIBIT_ALL_WARNINGS'] = 'YES'
        config.build_settings['GCC_TREAT_WARNINGS_AS_ERRORS'] = 'NO'
      end
    end
  end
end
