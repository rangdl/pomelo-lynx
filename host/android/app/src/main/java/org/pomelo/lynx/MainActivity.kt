package org.pomelo.lynx

import android.app.Activity
import android.os.Bundle
import android.widget.FrameLayout
import com.lynx.tasm.LynxError
import com.lynx.tasm.LynxLoadMeta
import com.lynx.tasm.LynxView
import com.lynx.tasm.LynxViewBuilder
import com.lynx.tasm.LynxViewClient
import com.lynx.tasm.TemplateData
import org.pomelo.lynx.log.PomeloLog
import org.pomelo.lynx.updater.BundleUpdates
import android.content.res.Configuration
import java.util.Locale

/**
 * Single full-screen host Activity: builds one LynxView, wires a
 * [HostTemplateProvider] that reads the embedded bundle from assets (with the
 * hot-update selection hook), and renders `main.lynx.bundle` by default or
 * `probe.lynx.bundle` when launched with `--ez bundle_probe true`
 * (`adb shell am start -n org.pomelo.lynx.debug/org.pomelo.lynx.MainActivity
 * --ez bundle_probe true` on the locally built debug package).
 * No dev server / no Explorer — fully offline.
 *
 * `android:configChanges` (see manifest) keeps this Activity from being
 * recreated on rotation / theme changes — recreation would reload the whole
 * bundle and reset JS state.
 */
class MainActivity : Activity() {
    private var lynxView: LynxView? = null
    /** 上次推送的外观签名;值不变时不重复发事件(对齐 iOS)。 */
    private var lastAppearanceSignature: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PomeloLog.info("lifecycle", "MainActivity onCreate")
        applyDevIntent()
        val view: LynxView = buildLynxView()
        view.addLynxViewClient(object : LynxViewClient() {
            override fun onFirstScreen() {
                PomeloLog.info("launch", "FIRST SCREEN reached")
                // insets 此时已分发,补上首帧可能为 0 的安全区。
                pushFirstScreenAppearance()
            }

            override fun onLoadFailed(message: String?) {
                PomeloLog.error("launch", "load failed: ${message ?: "unknown"}")
                markStartupFailed()
            }

            override fun onReceivedError(error: LynxError?) {
                if (error == null) return
                if (error.isFatal) {
                    PomeloLog.error("launch", "fatal lynx error: ${error.summaryMessage}")
                    markStartupFailed()
                } else {
                    PomeloLog.warn("launch", "lynx error: ${error.summaryMessage}")
                }
            }

            private fun markStartupFailed() {
                Thread {
                    runCatching { BundleUpdates.get(applicationContext)?.failStartup() }
                }.start()
            }
        })
        lynxView = view

        val root = FrameLayout(this)
        val match = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
        )
        root.addView(view, match)
        setContentView(root)

        // `LynxLoadMeta` carries globalProps *into* the load, so the very first
        // frame already has them (a native-module getter would answer after the
        // launch frame had painted).
        val meta = LynxLoadMeta.Builder()
        meta.setUrl(selectedUrl())
        meta.setGlobalProps(globalProps())
        view.loadTemplate(meta.build())
        PomeloLog.info("launch", "loadTemplate(${selectedUrl()}) invoked")
    }

    /**
     * Bundle selection: `--ez bundle_probe true` picks the probe bundle,
     * `--es dev_url <url>` points the app at a rspeedy dev server (dev channel
     * or debug build only), anything else selects the main app bundle.
     *
     * Dev URL 与开发者页共用 `pomelo_prefs` 的 `dev_server_url`;intent extra
     * 只是把它写进去,后续冷启动自动生效(与 iOS 的 prefs 行为一致)。
     */
    private fun selectedUrl(): String {
        if (DevConfig.enabled(this)) {
            DevConfig.devServerUrl(this)?.let { return it }
        }
        return selectedBundle()
    }

    private fun selectedBundle(): String =
        if (intent?.getBooleanExtra(EXTRA_BUNDLE_PROBE, false) == true) {
            HostTemplateProvider.PROBE_BUNDLE
        } else {
            HostTemplateProvider.MAIN_BUNDLE
        }

    /** `--es dev_url <url>` 写入持久化配置;空串表示清除。 */
    private fun applyDevIntent() {
        if (!DevConfig.enabled(this)) return
        val raw = intent?.getStringExtra(EXTRA_DEV_URL) ?: return
        val url = raw.trim()
        if (url.isEmpty()) {
            DevConfig.storeDevServerUrl(this, null)
            PomeloLog.info("devserver", "cleared dev server url")
            return
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            PomeloLog.warn("devserver", "ignored non-http dev url")
            return
        }
        DevConfig.storeDevServerUrl(this, url)
        PomeloLog.info("devserver", "stored dev server url")
    }

    /**
     * 与 iOS 相同的 globalProps 字段,供 JS 侧 client-identity 对齐;
     * 外观(colorScheme/safe*)与 language 同样与 iOS 对齐——JS 侧
     * `readSystemAppearance` / i18n 从这里读首帧值。
     */
    private fun globalProps(): TemplateData {
        val props = mutableMapOf<String, Any>(
            "hostName" to "pomelo-host-android",
            "hostVersion" to BuildConfig.VERSION_NAME,
            "hostBuild" to BuildConfig.VERSION_CODE.toString(),
            "hostChannel" to DevConfig.channel(this),
            "isDebug" to BuildConfig.DEBUG,
            // iOS 用 Locale.preferredLanguages.first;Android 用默认区域语言,
            // 形状同样是 BCP-47 前缀,JS 侧按 startsWith("en") 判断。
            "language" to Locale.getDefault().toLanguageTag(),
        )
        props.putAll(SystemAppearance.globalPropsEntry(this))
        return TemplateData.fromMap(props)
    }

    private fun buildLynxView(): LynxView {
        val builder = LynxViewBuilder()
        builder.setTemplateProvider(HostTemplateProvider(this))
        return builder.build(this)
    }

    override fun onNewIntent(intent: android.content.Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        val view = lynxView ?: return
        val meta = LynxLoadMeta.Builder()
        meta.setUrl(selectedUrl())
        meta.setGlobalProps(globalProps())
        view.loadTemplate(meta.build())
        PomeloLog.info("launch", "loadTemplate(${selectedUrl()}) invoked (reload)")
    }

    override fun onResume() {
        super.onResume()
        // 前台恢复通知页面:JS 侧 automatic-update 靠该事件补查到期任务
        // (src/native/app-lifecycle.ts 的 subscribeAppResumed)。
        val params = com.lynx.react.bridge.JavaOnlyArray()
        params.pushMap(com.lynx.react.bridge.JavaOnlyMap.from(emptyMap<String, Any>()))
        lynxView?.sendGlobalEvent(EVENT_APP_RESUMED, params)
        PomeloLog.info("lifecycle", "app resumed → JS")
        // 前台重读安全区(键盘收起/分屏/旋转后 insets 已变)。
        // reason=foreground 与 iOS 同义:允许 JS 同步 colorScheme。
        pushAppearance("foreground", includeColorScheme = true)
    }

    /**
     * manifest 声明了 uiMode 等配置变更不重建 Activity,深色模式切换/
     * 旋转/分屏都会走这里;同步推给 JS(对齐 iOS traitCollectionDidChange)。
     */
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        pushAppearance("trait", includeColorScheme = true)
    }

    /**
     * 首屏就绪后补一次非零安全区(onCreate 阶段 insets 尚未分发,globalProps
     * 里可能是 0);reason=firstScreen 允许 JS 同步 colorScheme。
     */
    private fun pushFirstScreenAppearance() {
        pushAppearance("firstScreen", includeColorScheme = true)
    }

    /**
     * 推送外观事件;值签名不变时跳过(对齐 iOS pushAppearance)。
     * includeColorScheme=false 时只推安全区——预留给未来“仅几何变化”的场景,
     * 避免瞬态配置误切主题。
     */
    private fun pushAppearance(reason: String, includeColorScheme: Boolean = true) {
        val view = lynxView ?: return
        val payload = SystemAppearance.payload(this, reason).toMutableMap()
        if (!includeColorScheme) payload.remove("colorScheme")
        val signature = payload.entries.sortedBy { it.key }.joinToString("|") { "${it.key}=${it.value}" }
        if (signature == lastAppearanceSignature) return
        lastAppearanceSignature = signature
        val params = com.lynx.react.bridge.JavaOnlyArray()
        params.pushMap(com.lynx.react.bridge.JavaOnlyMap.from(payload))
        view.sendGlobalEvent(SystemAppearance.EVENT, params)
        PomeloLog.debug("appearance", "push $reason $payload")
    }

    override fun onDestroy() {
        super.onDestroy()
        lynxView?.destroy()
        lynxView = null
    }

    companion object {
        const val EXTRA_BUNDLE_PROBE = "bundle_probe"
        const val EXTRA_DEV_URL = "dev_url"
        const val EVENT_APP_RESUMED = "PomeloLifecycle.resumed"
    }
}
