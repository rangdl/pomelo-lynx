package org.pomelo.lynx

import android.content.Context
import com.lynx.tasm.provider.AbsTemplateProvider
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
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
     * Dev-server 下载:15s 超时,只接受 200 + 非空 + 合法 Lynx bundle。
     * 200 也可能是 HTML 错误页/代理页,所以进解码器前先用头部长度校验,
     * 否则只会得到无法定位的 10204 解码错误。失败返回 null 由调用方回落。
     */
    private fun fetchRemote(urlString: String): ByteArray? {
        val url = try {
            URL(urlString)
        } catch (e: Exception) {
            PomeloLog.error("devserver", "invalid dev URL: $urlString")
            return null
        }
        if (url.protocol != "http" && url.protocol != "https") {
            PomeloLog.error("devserver", "unsupported scheme: ${url.protocol}")
            return null
        }
        var connection: HttpURLConnection? = null
        return try {
            connection = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                requestMethod = "GET"
                useCaches = false
            }
            val status = connection.responseCode
            if (status != 200) {
                PomeloLog.error("devserver", "fetch returned status $status")
                return null
            }
            val bytes = connection.inputStream.use { it.readBytes() }
            if (bytes.isEmpty()) {
                PomeloLog.error("devserver", "fetched empty body")
                return null
            }
            if (!isLynxBundle(bytes)) {
                PomeloLog.error("devserver", "fetched data is not a lynx bundle (${bytes.size}B)")
                return null
            }
            PomeloLog.info("devserver", "fetched ${bytes.size}B")
            bytes
        } catch (e: IOException) {
            PomeloLog.error("devserver", "fetch failed: ${e.javaClass.simpleName}")
            null
        } finally {
            connection?.disconnect()
        }
    }

    /** Lynx bundle 头部:前 4 字节小端声明文件总长度。 */
    private fun isLynxBundle(data: ByteArray): Boolean {
        if (data.size < 4) return false
        var declared = 0L
        for (index in 0 until 4) {
            declared = declared or ((data[index].toLong() and 0xFF) shl (8 * index))
        }
        return declared == data.size.toLong()
    }

    companion object {
        const val MAIN_BUNDLE = "main.lynx.bundle"
        const val PROBE_BUNDLE = "probe.lynx.bundle"
        private const val TIMEOUT_MS = 15_000
    }
}
