package org.pomelo.lynx.platform

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import org.pomelo.lynx.log.PomeloLog

/**
 * Android 客户端更新闭环:下载 APK → 校验 sha256/大小 → 交系统安装器。
 *
 * 为什么不让 JS 侧直接 `openURL` 打开下载页:那样用户下到的是浏览器里的
 * 未知文件,既无法校验摘要,也不受加速代理以外的控制。这里与 iOS 的
 * "打开下载地址/TrollStore 安装"对称,但补上 roadmap 要求的
 * **APK 摘要校验后再提示安装**。
 *
 * 安全约束(全部 fail-closed):
 *   - 只接受 https/http URL;
 *   - 期望 sha256 必须是我们自己从 `client.json` 拿到的 64 位十六进制;
 *   - 下载大小与期望值不一致、摘要不匹配 → 删除文件并报错;
 *   - 安装走 FileProvider content:// + ACTION_VIEW,不申请静默安装权限。
 */
object ApkInstaller {

    private const val MAX_APK_BYTES = 200L * 1024 * 1024
    private const val TIMEOUT_MS = 60_000

    private val SHA256 = Regex("^[0-9a-f]{64}$")

    /** 用户可见的安装目录(FileProvider 的 cache-path 需覆盖)。 */
    private fun installDir(context: Context): File =
        File(context.cacheDir, "updates").apply { mkdirs() }

    /**
     * @param url      从 `client.json` 解析出的 APK 下载地址(可走加速代理)
     * @param sha256   期望摘要(小写十六进制,`client.json` 的 assets[].sha256)
     * @param expectedSize 期望字节数;<=0 表示不校验大小(仍校验摘要)
     */
    fun downloadAndInstall(
        context: Context,
        url: String,
        sha256: String,
        expectedSize: Long,
        callback: Callback,
    ) {
        if (!url.startsWith("https://") && !url.startsWith("http://")) {
            answer(callback, "apk_invalid_url")
            return
        }
        if (!SHA256.matches(sha256.lowercase())) {
            answer(callback, "apk_invalid_digest")
            return
        }
        Thread {
            val file = try {
                download(context, url, sha256.lowercase(), expectedSize)
            } catch (e: IOException) {
                PomeloLog.warn("update", "apk download failed: ${e.javaClass.simpleName}")
                null
            }
            if (file == null) {
                answer(callback, "apk_download_failed")
                return@Thread
            }
            // 通过 FileProvider 暴露给系统安装器(Android 7+ 禁止 file:// URI)。
            val uri = runCatching {
                FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            }.getOrNull()
            if (uri == null) {
                answer(callback, "apk_unavailable")
                return@Thread
            }
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(
                        uri,
                        "application/vnd.android.package-archive",
                    )
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                val opened = runCatching {
                    context.startActivity(intent)
                    true
                }.getOrDefault(false)
                if (opened) {
                    PomeloLog.info("update", "APK installer opened")
                    answer(callback, "")
                } else {
                    // 未授权「安装未知应用」时系统会拒绝;文件保留,用户可重试。
                    answer(callback, "apk_installer_unavailable")
                }
            }
        }.start()
    }

    private fun download(
        context: Context,
        urlString: String,
        sha256: String,
        expectedSize: Long,
    ): File? {
        val url = URL(urlString)
        var connection: HttpURLConnection? = null
        try {
            connection = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                requestMethod = "GET"
                useCaches = false
            }
            val status = connection.responseCode
            if (status != 200) {
                PomeloLog.warn("update", "apk fetch status $status")
                return null
            }
            val declared = connection.contentLengthLong
            if (declared > MAX_APK_BYTES) {
                PomeloLog.warn("update", "apk too large: $declared")
                return null
            }
            if (expectedSize > 0 && declared > 0 && declared != expectedSize) {
                PomeloLog.warn("update", "apk size mismatch $declared != $expectedSize")
                return null
            }
            val target = File(installDir(context), "pomelo-lynx-android-release.apk")
            if (target.exists()) target.delete()
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            connection.inputStream.use { input ->
                target.outputStream().use { out ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        total += read
                        if (total > MAX_APK_BYTES) {
                            PomeloLog.warn("update", "apk exceeded limit while streaming")
                            target.delete()
                            return null
                        }
                        digest.update(buffer, 0, read)
                        out.write(buffer, 0, read)
                    }
                }
            }
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            if (actual != sha256) {
                PomeloLog.warn("update", "apk digest mismatch")
                target.delete()
                return null
            }
            if (total <= 0) {
                target.delete()
                return null
            }
            PomeloLog.info("update", "apk verified $total bytes")
            return target
        } finally {
            connection?.disconnect()
        }
    }

    private fun answer(callback: Callback, error: String) {
        val params = JavaOnlyArray()
        params.pushString(error)
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            runCatching { callback.invoke(params) }
        }
    }
}
