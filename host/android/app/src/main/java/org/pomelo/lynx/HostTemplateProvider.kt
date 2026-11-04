package org.pomelo.lynx

import android.content.Context
import com.lynx.tasm.provider.AbsTemplateProvider
import java.io.ByteArrayOutputStream
import java.io.IOException
import org.pomelo.lynx.log.PomeloLog
import org.pomelo.lynx.updater.BundleUpdates

/**
 * Reads a Lynx template bundle from the APK's assets — copied from the
 * official KotlinEmptyProject demo (via songloft-player-lynx) with two
 * additions: the hot-update selection hook, and a dev-server branch that
 * mirrors iOS `HostTemplateProvider`.
 *
 * Load order per launch:
 *   1. Dev server (`http(s)` uri, dev channel or debug build only) — the
 *      rspeedy dev server's freshly built bundle.
 *   2. `BundleUpdates.beginLaunch()` — a downloaded update that is pending
 *      trial (or an active one) if the disk state says so.
 *   3. Fall back to the embedded assets bundle — always available, the
 *      rollback floor. A broken dev URL must never leave the app unopenable.
 *
 * The launch-failure wiring (onLoadFailed / fatal LynxError in MainActivity)
 * calls `failStartup()`, so a bad update is skipped on the next process.
 */
class HostTemplateProvider(context: Context) : AbsTemplateProvider() {

    private val appContext: Context = context.applicationContext

    override fun loadTemplate(uri: String, callback: Callback) {
        PomeloLog.debug("template", "loadTemplate $uri")
        Thread {
            // Dev-server 分支:URL 是完整 http(s) 地址时直接网络拉取。失败
            // 回落内嵌 main bundle(与 iOS 的"坏 URL 不能打不开 app"一致)。
            if (DevConfig.enabled(appContext) && isRemoteUrl(uri)) {
                val remote = fetchRemote(uri)
                if (remote != null) {
                    callback.onSuccess(remote)
                } else {
                    PomeloLog.warn("devserver", "fetch failed; falling back to embedded bundle")
                    loadEmbedded(MAIN_BUNDLE, callback)
                }
                return@Thread
            }
            loadEmbedded(uri, callback)
        }.start()
    }

    /** 内嵌资源 + 热更新选择。 */
    private fun loadEmbedded(uri: String, callback: Callback) {
        try {
            if (uri == MAIN_BUNDLE) {
                val update = BundleUpdates.get(appContext)
                if (update == null) {
                    PomeloLog.info("update", "update store unavailable; embedded only")
                }
                val candidate = try {
                    update?.beginLaunch()
                } catch (e: Exception) {
                    PomeloLog.error("update", "beginLaunch failed: ${e.javaClass.simpleName}")
                    runCatching { update?.failStartup() }
                    null
                }
                if (candidate != null) {
                    PomeloLog.info("update", "using UPDATE bundle (${candidate.size} bytes)")
                    callback.onSuccess(candidate)
                    return
                }
                PomeloLog.info("update", "using embedded bundle (no eligible update)")
            }
            appContext.assets.open(uri).use { inputStream ->
                ByteArrayOutputStream().use { out ->
                    val buffer = ByteArray(1024)
                    var length: Int
                    while (inputStream.read(buffer).also { length = it } != -1) {
                        out.write(buffer, 0, length)
                    }
                    val bytes = out.toByteArray()
                    PomeloLog.info("template", "embedded $uri (${bytes.size} bytes)")
                    callback.onSuccess(bytes)
                }
            }
        } catch (e: IOException) {
            PomeloLog.error("template", "read template failed: $uri (${e.javaClass.simpleName})")
            callback.onFailed(e.message)
        }
    }

    private fun isRemoteUrl(uri: String): Boolean =
        uri.startsWith("http://") || uri.startsWith("https://")

    /**
     * Dev-server 下载:先看 `applyDevServer` 的缓存(已校验过),
     * 未命中再走网络。这样"回调报成功"与"页面真的换成新 bundle"
     * 不会因第二次网络失败而不一致。
     */
    private fun fetchRemote(urlString: String): ByteArray? =
        DevBundleCache.load(appContext, urlString) ?: DevBundleFetcher.fetch(urlString)

    companion object {
        const val MAIN_BUNDLE = "main.lynx.bundle"
        const val PROBE_BUNDLE = "probe.lynx.bundle"
    }
}
