package org.pomelo.lynx

import android.content.Context
import org.json.JSONObject

/**
 * 构建通道与实时开发开关。
 *
 * `channel` 来自 `assets/native-host.json`（由 `scripts/gen-native-host.mjs`
 * 生成：tag 构建为 `stable`，其余为 `dev`）。与 iOS 同构：dev 通道或
 * debug 包才启用 devtool 与 dev server；`assembleRelease` 打出的 dev 通道包
 * 也能连开发服务器，staged 正式包保持关闭。
 *
 * 开发地址存在 `pomelo_prefs` 的 `dev_server_url`，与 JS 侧
 * `src/features/settings/DevServerSection.tsx` 使用同一个 SharedPreferences
 * 文件和 key。
 */
object DevConfig {
    private const val PREFS_FILE = "pomelo_prefs"
    private const val KEY_DEV_SERVER_URL = "dev_server_url"

    @Volatile
    private var cachedChannel: String? = null

    /** 读取构建通道；assets 缺失时按包类型保守回落。 */
    fun channel(context: Context): String {
        cachedChannel?.let { return it }
        val fallback = if (BuildConfig.DEBUG) "dev" else "stable"
        val value =
            runCatching {
                context.applicationContext.assets.open("native-host.json").use { input ->
                    JSONObject(input.bufferedReader().readText())
                        .optString("channel", fallback)
                }
            }.getOrNull() ?: fallback
        cachedChannel = value
        return value
    }

    /** 是否启用 devtool 与 dev server。 */
    fun enabled(context: Context): Boolean =
        BuildConfig.DEBUG || channel(context) == "dev"

    /** 已持久化的开发服务器地址；非 http(s) 视作未配置。 */
    fun devServerUrl(context: Context): String? =
        prefs(context)
            .getString(KEY_DEV_SERVER_URL, null)
            ?.trim()
            ?.takeIf { it.startsWith("http://") || it.startsWith("https://") }

    /** 写入/清空开发服务器地址（intent extra 与开发者页共用）。 */
    fun storeDevServerUrl(context: Context, url: String?) {
        val editor = prefs(context).edit()
        if (url.isNullOrBlank()) editor.remove(KEY_DEV_SERVER_URL) else editor.putString(KEY_DEV_SERVER_URL, url.trim())
        editor.apply()
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
}
