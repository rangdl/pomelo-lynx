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
    # Versions copied from songloft-player-lynx's pods.rb.
    #
    # WHY 4.0.1 AND NOT EXACTLY 4.0.0 (cross-platform version skew — read this
    # first when iOS and Android behave differently):
    #   1. iOS resolves Lynx / LynxService / XElement in LOCKSTEP (each XElement
    #      and LynxService subspec depends on `Lynx = <same version>`), so the
    #      whole family has to move together — you cannot mix 4.0.0 and 4.0.1.
    #   2. The 4.0.0 podspec could not be used on songloft's machine at all: the
    #      CocoaPods trunk CDN cache holds a TRUNCATED `Lynx/4.0.0/
    #      Lynx.podspec.json` (21 kB against ~235 kB), and CocoaPods dies with
    #      `JSON::ParserError` before it can resolve anything.
    # 4.0.1 is the nearest usable release and is the same major/minor as
    # Android's `org.lynxsdk.lynx:*:4.0.0`, i.e. the same engine line and
    # bundle-format compatibility.
    pod 'Lynx', '4.0.1', :subspecs => ['Framework']

    # `Lynx/Framework` depends on `LynxBase/Framework` and `LynxServiceAPI`
    # **without any version constraint**, so an unpinned resolve cheerfully
    # pairs Lynx 4.0.1 with a 4.2.0-nightly LynxBase (newest wins). Pin both to
    # Lynx's own release — nightlies of the base layer under a stable engine is
    # exactly the kind of mismatch that produces unreproducible device-only
    # breakage.
    pod 'LynxBase', '4.0.1', :subspecs => ['Framework']
    pod 'LynxServiceAPI', '4.0.1'

    # JS engine. Lynx 4.0.1's `Framework` subspec pins `PrimJS/quickjs = 4.0.0`,
    # so PrimJS stays on 4.0.0 (mirrors Android's `org.lynxsdk.lynx:primjs:4.0.0`).
    pod 'PrimJS', '4.0.0', :subspecs => ['quickjs', 'napi']

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
    pod 'LynxService', '4.0.1', :subspecs => subspecs

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
