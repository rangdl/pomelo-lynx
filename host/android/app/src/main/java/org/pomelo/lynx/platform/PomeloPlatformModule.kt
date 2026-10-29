package org.pomelo.lynx.platform

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.WindowManager
import androidx.core.content.FileProvider
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.tasm.behavior.LynxContext
import java.io.File
import org.pomelo.lynx.log.PomeloLog

/**
 * Lynx native module `NativeModules.PomeloPlatform` — 宿主平台基础能力。
 *
 * 方法名与 `src/native/platform.ts` 逐字对应:
 *   - `openURL` / `setKeepScreenOn`            写,fire-and-forget
 *   - `setClipboard` / `setClipboardWithResult` 剪贴板,后者用 Callback 回报结果
 *   - `shareFile`                              系统分享面板,Callback 回报结果
 *
 * 所有会碰到窗口状态的操作都 post 到主线程:模块方法运行在 Lynx JS 线程,
 * 直接操作 ClipboardManager / Window 可能抛错,宽泛的 catch 会把它吞掉。
 * 回调约定与 JS facade 一致:成功 `null`,失败为非空字符串错误码。
 */
class PomeloPlatformModule(context: Context) : LynxModule(context) {

    private val mainHandler = Handler(Looper.getMainLooper())

    private fun appContext(): Context = (mContext as LynxContext).getContext()

    private fun activity(): Activity? = appContext() as? Activity

    @LynxMethod
    fun openURL(url: String) {
        val parsed = runCatching { Uri.parse(url) }.getOrNull()
        val scheme = parsed?.scheme?.lowercase()
        if (parsed == null || (scheme != "http" && scheme != "https") ||
            parsed.host.isNullOrBlank()
        ) {
            PomeloLog.warn(TAG, "openURL rejected unsupported url")
            return
        }
        mainHandler.post {
            try {
                val intent = Intent(Intent.ACTION_VIEW, parsed)
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                appContext().startActivity(intent)
            } catch (error: Throwable) {
                PomeloLog.warn(TAG, "openURL failed: ${error.javaClass.simpleName}")
            }
        }
    }

    /** 窗口级常亮;Activity 进入后台时系统会自行释放。 */
    @LynxMethod
    fun setKeepScreenOn(enabled: Boolean) {
        mainHandler.post {
            val window = activity()?.window ?: return@post
            if (enabled) {
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }

    @LynxMethod
    fun setClipboard(text: String) {
        writeClipboard(text, null)
    }

    @LynxMethod
    fun setClipboardWithResult(text: String, callback: Callback) {
        writeClipboard(text, callback)
    }

    private fun writeClipboard(text: String, callback: Callback?) {
        mainHandler.post {
            try {
                val manager = appContext()
                    .getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    ?: throw IllegalStateException("clipboard_unavailable")
                manager.setPrimaryClip(ClipData.newPlainText("PomeloLynx", text))
                callback?.invoke(null as Any?)
            } catch (error: Throwable) {
                callback?.invoke(error.message ?: "clipboard_failed")
            }
        }
    }

    /**
     * 把 base64 写入 cache/share 后调起系统分享面板。文件名和 MIME 在 JS
     * 侧已校验,这里再做一次纵深防御;旧文件在每次分享前清空,避免缓存堆积。
     */
    @LynxMethod
    fun shareFile(base64: String, fileName: String, mimeType: String, callback: Callback) {
        if (base64.length > MAX_BASE64_CHARS) {
            callback.invoke("share_payload_too_large")
            return
        }
        if (!FILE_NAME.matches(fileName)) {
            callback.invoke("share_invalid_file_name")
            return
        }
        if (!MIME_TYPE.matches(mimeType)) {
            callback.invoke("share_invalid_mime_type")
            return
        }
        mainHandler.post {
            try {
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                val context = appContext()
                val directory = File(context.cacheDir, "share").apply {
                    deleteRecursively()
                    mkdirs()
                }
                val file = File(directory, fileName)
                file.writeBytes(bytes)
                val uri = FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    file,
                )
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = mimeType
                    putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                val chooser = Intent.createChooser(send, null).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(chooser)
                callback.invoke(null as Any?)
            } catch (error: Throwable) {
                callback.invoke(error.message ?: "share_failed")
            }
        }
    }

    companion object {
        private const val TAG = "platform"
        private val FILE_NAME = Regex("^[A-Za-z0-9._-]{1,128}$")
        private val MIME_TYPE = Regex("^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$")
        private const val MAX_BASE64_CHARS = 16 * 1024 * 1024 * 4 / 3 + 4
    }
}
