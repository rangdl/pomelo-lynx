package org.pomelo.lynx

import android.content.Context
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.pomelo.lynx.log.PomeloLog

/**
 * Dev server bundle 的下载与校验(Android 侧对齐 iOS
 * `HostTemplateProvider.fetch` + `ViewController.applyDevServer`)。
 *
 * 校验规则与内嵌/热更新一致:200 + 非空 + Lynx 头(前 4 字节小端声明总长度)。
 * 200 也可能是 HTML 错误页/代理页,不校验的话只会在解码器里得到无法定位的
 * 10204 错误。
 */
object DevBundleFetcher {

    const val TIMEOUT_MS = 15_000
    private const val PROBE_TIMEOUT_MS = 4_000

    /** HTTP HEAD 探测:返回 (statusCode, errorCode)。statusCode 为 -1 表示网络失败。 */
    fun probe(urlString: String): Pair<Int, String> {
        val url = parse(urlString) ?: return -1 to "devserver_invalid_url"
        var connection: HttpURLConnection? = null
        return try {
            connection = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = PROBE_TIMEOUT_MS
                readTimeout = PROBE_TIMEOUT_MS
                requestMethod = "HEAD"
                useCaches = false
            }
            val status = connection.responseCode
            if (status in 200..399) status to ""
            else status to "devserver_http_$status"
        } catch (e: IOException) {
            PomeloLog.warn("devserver", "probe failed: ${e.javaClass.simpleName}")
            -1 to "devserver_unreachable"
        } finally {
            connection?.disconnect()
        }
    }

    /** GET 下载并校验;失败返回 null(调用方决定回退策略)。 */
    fun fetch(urlString: String): ByteArray? {
        val url = parse(urlString) ?: return null
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

    private fun parse(urlString: String): URL? {
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
        return url
    }

    /** Lynx bundle 头部:前 4 字节小端声明文件总长度。 */
    fun isLynxBundle(data: ByteArray): Boolean {
        if (data.size < 4) return false
        var declared = 0L
        for (index in 0 until 4) {
            declared = declared or ((data[index].toLong() and 0xFF) shl (8 * index))
        }
        return declared == data.size.toLong()
    }
}

/**
 * `applyDevServer` 下载成功后暂存的 bundle。
 *
 * 为什么要缓存:`applyDevServer` 必须"先下载校验、成功后才重建 LynxView"
 * (iOS 同语义)。若重建时再由 provider 拉一次网络,第二次失败就会出现
 * "回调说成功但页面没变"。缓存带 URL 指纹,URL 变了自动失效。
 */
object DevBundleCache {

    private const val CACHE_FILE = "dev-bundle.cache"
    private const val META_FILE = "dev-bundle.url"

    @Synchronized
    fun save(context: Context, url: String, bytes: ByteArray) {
        runCatching {
            File(context.cacheDir, CACHE_FILE).writeBytes(bytes)
            File(context.cacheDir, META_FILE).writeText(url)
            PomeloLog.info("devserver", "cached ${bytes.size}B for $url")
        }
    }

    /** 命中返回字节;URL 不匹配或无缓存返回 null。 */
    @Synchronized
    fun load(context: Context, url: String): ByteArray? = runCatching {
        val meta = File(context.cacheDir, META_FILE)
        val data = File(context.cacheDir, CACHE_FILE)
        if (!meta.isFile || !data.isFile) return null
        if (meta.readText() != url) return null
        val bytes = data.readBytes()
        if (bytes.isEmpty() || !DevBundleFetcher.isLynxBundle(bytes)) return null
        PomeloLog.debug("devserver", "cache hit ${bytes.size}B")
        bytes
    }.getOrNull()

    @Synchronized
    fun clear(context: Context) {
        runCatching { File(context.cacheDir, CACHE_FILE).delete() }
        runCatching { File(context.cacheDir, META_FILE).delete() }
    }
}
