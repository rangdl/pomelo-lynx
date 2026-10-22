package org.pomelo.lynx

import android.app.Activity
import android.os.Bundle
import android.widget.FrameLayout
import com.lynx.tasm.LynxError
import com.lynx.tasm.LynxLoadMeta
import com.lynx.tasm.LynxView
import com.lynx.tasm.LynxViewBuilder
import com.lynx.tasm.TemplateData
import org.pomelo.lynx.updater.BundleUpdates

/**
 * Single full-screen host Activity: builds one LynxView, wires a
 * [HostTemplateProvider] that reads the embedded bundle from assets (with the
 * hot-update selection hook), and renders `main.lynx.bundle` by default or
 * `probe.lynx.bundle` when launched with `--ez bundle probe`
 * (`adb shell am start -n org.pomelo.lynx/.MainActivity --ez bundle probe`).
 * No dev server / no Explorer — fully offline.
 *
 * `android:configChanges` (see manifest) keeps this Activity from being
 * recreated on rotation / theme changes — recreation would reload the whole
 * bundle and reset JS state.
 */
class MainActivity : Activity() {
    private var lynxView: LynxView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val view: LynxView = buildLynxView()
        view.addLynxViewClient(object : LynxViewClient() {
            override fun onLoadFailed(message: String?) {
                markStartupFailed()
            }

            override fun onReceivedError(error: LynxError?) {
                if (error?.isFatal == true) markStartupFailed()
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
        meta.setUrl(selectedBundle())
        meta.setGlobalProps(
            TemplateData.fromMap(
                mapOf(
                    "hostName" to "pomelo-host-android",
                    "hostVersion" to BuildConfig.VERSION_NAME,
                    "isDebug" to BuildConfig.DEBUG,
                ),
            ),
        )
        view.loadTemplate(meta.build())
    }

    /**
     * Bundle selection: `--ez bundle probe` at launch, `am start --ez bundle
     * probe` on a running instance (singleTask + onNewIntent reloads).
     * Anything else selects the main app bundle.
     */
    private fun selectedBundle(): String =
        if (intent?.getBooleanExtra(EXTRA_BUNDLE_PROBE, false) == true) {
            HostTemplateProvider.PROBE_BUNDLE
        } else {
            HostTemplateProvider.MAIN_BUNDLE
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
        meta.setUrl(selectedBundle())
        meta.setGlobalProps(
            TemplateData.fromMap(
                mapOf(
                    "hostName" to "pomelo-host-android",
                    "hostVersion" to BuildConfig.VERSION_NAME,
                    "isDebug" to BuildConfig.DEBUG,
                ),
            ),
        )
        view.loadTemplate(meta.build())
    }

    override fun onDestroy() {
        super.onDestroy()
        lynxView?.destroy()
        lynxView = null
    }

    companion object {
        const val EXTRA_BUNDLE_PROBE = "bundle_probe"
    }
}
