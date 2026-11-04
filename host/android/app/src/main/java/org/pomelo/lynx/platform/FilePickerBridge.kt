package org.pomelo.lynx.platform

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.pomelo.lynx.MainActivity
import org.pomelo.lynx.log.PomeloLog

/**
 * `PomeloPlatform.pickAndUploadFile` 的 Android 实现:
 * `ACTION_OPEN_DOCUMENT` 选文件 + OkHttp multipart 上传。
 *
 * 与 iOS(`packages/lynx-platform/ios/src/PomeloPlatformModule.swift`
 * 的 `pickAndUploadFile`)严格对齐:
 *   - 入参校验正则与错误码完全相同;
 *   - 回调形状固定为 `[error, body]`(error 为 null 表示成功);
 *   - 上传上限 32 MiB、响应体上限 1 MiB;
 *   - 新请求覆盖旧请求,旧请求按 `upload_cancelled` 回调(JS 不会悬着)。
 *
 * Activity 结果走 [onActivityResult](由 MainActivity 转发),因为模块本身
 * 拿不到 Activity。
 */
object FilePickerBridge {

    private const val REQUEST_CODE = 4211
    private const val MAX_UPLOAD_BYTES = 32 * 1024 * 1024
    private const val MAX_RESPONSE_BYTES = 1024 * 1024
    private const val HTTP_TIMEOUT_SECONDS = 60L

    private data class Pending(
        val uploadUrl: String,
        val fieldName: String,
        val mimeType: String,
        val callback: Callback,
    )

    private var pending: Pending? = null

    private val http = OkHttpClient.Builder()
        .connectTimeout(HTTP_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(HTTP_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .writeTimeout(HTTP_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .build()

    private fun isHTTPURL(value: String): Boolean {
        if (!value.startsWith("http://") && !value.startsWith("https://")) return false
        return runCatching { Uri.parse(value).host?.isNotEmpty() == true }.getOrDefault(false)
    }

    /** 打开系统文件选择器;校验失败直接错误回调(与 iOS 同序)。 */
    fun pick(
        activity: Activity?,
        uploadUrl: String,
        fieldName: String,
        mimeType: String,
        callback: Callback,
    ) {
        if (!isHTTPURL(uploadUrl)) {
            answer(callback, "upload_invalid_url", null)
            return
        }
        if (!Regex("^[A-Za-z0-9_-]{1,64}$").matches(fieldName)) {
            answer(callback, "upload_invalid_field", null)
            return
        }
        if (!Regex("^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$").matches(mimeType)) {
            answer(callback, "upload_invalid_mime_type", null)
            return
        }
        if (activity == null) {
            answer(callback, "upload_unavailable", null)
            return
        }

        // 新请求覆盖旧请求;旧请求按取消回调,避免 JS 永远等待。
        pending?.let { previous ->
            answer(previous.callback, "upload_cancelled", null)
        }
        pending = Pending(uploadUrl, fieldName, mimeType, callback)

        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mimeType
            // 某些 Provider 对精确 mime 过滤过严,放开为任意类型兜底。
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf(mimeType))
        }
        runCatching {
            activity.startActivityForResult(intent, REQUEST_CODE)
        }.onFailure {
            pending = null
            answer(callback, "upload_unavailable", null)
        }
    }

    /** 由 MainActivity.onActivityResult 调用;返回是否消费了本次结果。 */
    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode != REQUEST_CODE) return false
        val request = pending ?: return true
        pending = null
        if (resultCode != Activity.RESULT_OK) {
            answer(request.callback, "upload_cancelled", null)
            return true
        }
        val uri = data?.data
        if (uri == null) {
            answer(request.callback, "upload_read_failed", null)
            return true
        }
        Thread { readAndUpload(uri, request) }.start()
        return true
    }

    private fun readAndUpload(uri: Uri, request: Pending) {
        val context = MainActivityRegistry.context()
        if (context == null) {
            answer(request.callback, "upload_read_failed", null)
            return
        }
        val bytes: ByteArray?
        try {
            bytes = readLimited(context, uri, MAX_UPLOAD_BYTES)
        } catch (e: IOException) {
            PomeloLog.warn("upload", "read failed: ${e.javaClass.simpleName}")
            answer(request.callback, "upload_read_failed", null)
            return
        }
        if (bytes == null) {
            answer(request.callback, "upload_too_large", null)
            return
        }
        if (bytes.isEmpty()) {
            answer(request.callback, "upload_empty_file", null)
            return
        }
        upload(bytes, displayName(context, uri), request)
    }

    /** 读取最多 [limit] 字节;超出返回 null(调用方按 too_large 处理)。 */
    private fun readLimited(
        context: android.content.Context,
        uri: Uri,
        limit: Int,
    ): ByteArray? {
        val input = context.contentResolver.openInputStream(uri) ?: return null
        return input.use { stream ->
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(64 * 1024)
            var total = 0
            while (true) {
                val read = stream.read(buffer)
                if (read <= 0) break
                total += read
                if (total > limit) return@use null
                out.write(buffer, 0, read)
            }
            out.toByteArray()
        }
    }

    private fun displayName(context: android.content.Context, uri: Uri): String {
        val name = runCatching {
            context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
            }
        }.getOrNull()
        return safeFileName(name ?: uri.lastPathSegment ?: "")
    }

    /** 只保留安全字符,避免 multipart 头注入(与 iOS safeFileName 同义)。 */
    private fun safeFileName(raw: String): String {
        val cleaned = raw.replace(Regex("[^A-Za-z0-9._-]"), "_").take(120)
        return if (cleaned.isEmpty()) "upload.bin" else cleaned
    }

    private fun upload(data: ByteArray, fileName: String, request: Pending) {
        val boundary = "----PomeloBoundary${UUID.randomUUID()}"
        val head = buildString {
            append("--$boundary\r\n")
            append(
                "Content-Disposition: form-data; name=\"${request.fieldName}\"; " +
                    "filename=\"$fileName\"\r\n",
            )
            append("Content-Type: ${request.mimeType}\r\n\r\n")
        }.toByteArray()
        val tail = "\r\n--$boundary--\r\n".toByteArray()
        val body = ByteArray(head.size + data.size + tail.size)
        System.arraycopy(head, 0, body, 0, head.size)
        System.arraycopy(data, 0, body, head.size, data.size)
        System.arraycopy(tail, 0, body, head.size + data.size, tail.size)

        val httpRequest = Request.Builder()
            .url(request.uploadUrl)
            .post(body.toRequestBody("multipart/form-data; boundary=$boundary".toMediaType()))
            .build()
        try {
            http.newCall(httpRequest).execute().use { response ->
                if (!response.isSuccessful) {
                    answer(request.callback, "upload_http_${response.code}", null)
                    return
                }
                val body = response.body
                val text: String? = if (body == null) {
                    ""
                } else {
                    body.byteStream().use { input -> readTextLimited(input, MAX_RESPONSE_BYTES) }
                }
                if (text == null) {
                    answer(request.callback, "upload_response_too_large", null)
                } else {
                    answer(request.callback, null, text)
                }
            }
        } catch (e: IOException) {
            PomeloLog.warn("upload", "post failed: ${e.javaClass.simpleName}")
            answer(request.callback, "upload_failed", null)
        }
    }

    /** 读取文本响应,超过 [limit] 字节返回 null。 */
    private fun readTextLimited(input: java.io.InputStream, limit: Int): String? {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        var total = 0
        while (true) {
            val read = input.read(buffer)
            if (read <= 0) break
            total += read
            if (total > limit) return null
            out.write(buffer, 0, read)
        }
        return out.toByteArray().toString(Charsets.UTF_8)
    }

    /** 统一回答:JavaOnlyArray[error|null, body|null],与 iOS NSArray 同形。 */
    private fun answer(callback: Callback, error: String?, body: String?) {
        val params = JavaOnlyArray()
        if (error == null) params.pushNull() else params.pushString(error)
        if (body == null) params.pushNull() else params.pushString(body)
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            runCatching { callback.invoke(params) }
        }
    }
}
