package org.pomelo.lynx

import android.content.Context
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.tasm.behavior.LynxContext
import java.util.UUID
import org.json.JSONObject
import org.pomelo.lynx.DevBundleCache
import org.pomelo.lynx.DevBundleFetcher
import org.pomelo.lynx.DevConfig
import org.pomelo.lynx.MainActivity
import org.pomelo.lynx.log.PomeloLog

/**
 * Android 返回键桥(批次 3)。
 *
 * 流程(与 iOS 的边缘返回不同:iOS 是宿主手势直接驱动页面平移,
 * Android 返回键是离散事件,需要先问 JS"这一下该做什么"):
 *
 *   1. `MainActivity.onBackPressed` 不直接 finish,改为调
 *      [queryBack],通过 `PomeloNavigation.backquery` 全局事件把
 *      `requestId` 发给 JS(叠加 `PomeloHost` 老壳无此模块时的兜底)。
 *   2. JS(`src/native/hardware-back.ts`)用注册的处理器决定:
 *      pop 路由 / 关闭浮层 / 不处理,并回 `PomeloHost.resolveBack`。
 *   3. 原生收到 `handled=false`(或超时未回)时 `finish()` 退出应用。
 *
 * 模块同时暴露 [canGoBack] 供 JS 主动查询(返回键视觉指示等,暂未用)。
 */
class PomeloHostModule(context: Context) : LynxModule(context) {

    init {
        // 最新创建的实例拥有返回键投递权(对齐 PomeloLogModule 的 sink 模式:
        // 页面重载后旧实例的 context 已失效,不能继续发事件)。
        PomeloHostModuleBridge.current = this
    }

    /** 当前待回答的返回查询;一次只允许一个。 */
    private var pendingRequestId: String? = null
    private var pendingAt: Long = 0

    /**
     * 返回键按下:向 JS 发查询事件。
     * @return false 表示 JS 侧不可达(未加载完成),调用方应直接按系统默认处理。
     */
    fun queryBack(onUnhandled: () -> Unit): Boolean {
        val lynxContext = mContext as? LynxContext ?: return false
        val previous = pendingRequestId
        if (previous != null) {
            // 上一次查询还没回:JS 卡死或页面未挂监听。视为未处理。
            PomeloLog.warn("navigation", "back query $previous unanswered; treating as unhandled")
            pendingRequestId = null
            onUnhandled()
            return true
        }
        val requestId = UUID.randomUUID().toString()
        pendingRequestId = requestId
        pendingAt = System.currentTimeMillis()
        val payload = JSONObject()
        payload.put("requestId", requestId)
        val params = com.lynx.react.bridge.JavaOnlyArray()
        params.pushString(payload.toString())
        lynxContext.sendGlobalEvent(BACK_QUERY_EVENT, params)
        PomeloLog.debug("navigation", "back query $requestId sent")
        // 未应答兜底:JS 8 秒内不回(老 bundle 无监听)按未处理退出。
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            if (pendingRequestId == requestId) {
                pendingRequestId = null
                PomeloLog.warn("navigation", "back query $requestId timed out")
                onUnhandled()
            }
        }, BACK_TIMEOUT_MS)
        return true
    }

    /** JS 的回答:handled=true 表示页面已自行消化(pop/关闭浮层)。 */
    @LynxMethod
    fun resolveBack(requestId: String, handled: Boolean, callback: Callback) {
        if (requestId != pendingRequestId) {
            // 过期或重复的回答,忽略。
            PomeloLog.debug("navigation", "stale back answer $requestId")
            callback.invoke(JSONObject().put("ok", false).toString())
            return
        }
        pendingRequestId = null
        PomeloLog.debug("navigation", "back answer $requestId handled=$handled")
        callback.invoke(JSONObject().put("ok", true).toString())
        if (!handled) {
            unhandledCallback?.invoke()
        }
    }

    // === dev server 热切换(对齐 iOS PomeloHostModule) ===============

    /**
     * 连接 dev server:先完整下载并校验 bundle,成功后才重建 LynxView。
     * 失败时当前页面不动。回调参数:成功为 null,失败为错误码字符串。
     */
    @LynxMethod
    fun applyDevServer(url: String, callback: Callback) {
        val target = url.trim()
        if (!isDevServerURL(target)) {
            callback.invoke("devserver_invalid_url")
            return
        }
        val appContext = androidContext()
        if (!DevConfig.enabled(appContext)) {
            callback.invoke("devserver_unsupported")
            return
        }
        Thread {
            val bytes = DevBundleFetcher.fetch(target)
            if (bytes == null) {
                main.post { callback.invoke("devserver_unreachable") }
                return@Thread
            }
            DevBundleCache.save(appContext, target, bytes)
            DevConfig.storeDevServerUrl(appContext, target)
            main.post {
                callback.invoke("")
                activity()?.reloadLynxView()
            }
        }.start()
    }

    /** 断开 dev server:清配置与缓存,立即重建内嵌 bundle(无需冷启动)。 */
    @LynxMethod
    fun clearDevServer(callback: Callback) {
        val appContext = androidContext()
        DevConfig.storeDevServerUrl(appContext, null)
        DevBundleCache.clear(appContext)
        main.post {
            callback.invoke("")
            activity()?.reloadLynxView()
        }
    }

    /** 刷新当前来源(优先已配置的 dev URL);下载失败则回报错误且不重载。 */
    @LynxMethod
    fun reloadBundle(callback: Callback) {
        val appContext = androidContext()
        val devUrl = if (DevConfig.enabled(appContext)) DevConfig.devServerUrl(appContext) else null
        if (devUrl == null) {
            main.post {
                callback.invoke("")
                activity()?.reloadLynxView()
            }
            return
        }
        Thread {
            val bytes = DevBundleFetcher.fetch(devUrl)
            if (bytes == null) {
                // 保留旧缓存:本次刷新失败不该把能跑的页面弄坏。
                main.post { callback.invoke("devserver_unreachable") }
                return@Thread
            }
            DevBundleCache.save(appContext, devUrl, bytes)
            main.post {
                callback.invoke("")
                activity()?.reloadLynxView()
            }
        }.start()
    }

    /** HEAD 探测:回调 [errorCode|null, statusCode] 数组(与 iOS 同形)。 */
    @LynxMethod
    fun probeDevServer(url: String, callback: Callback) {
        val target = url.trim()
        if (!isDevServerURL(target)) {
            invokeProbe(callback, "devserver_invalid_url", -1)
            return
        }
        Thread {
            val (status, error) = DevBundleFetcher.probe(target)
            invokeProbe(callback, error.ifEmpty { null }, status)
        }.start()
    }

    private fun invokeProbe(callback: Callback, error: String?, status: Int) {
        val params = com.lynx.react.bridge.JavaOnlyArray()
        if (error == null) params.pushNull() else params.pushString(error)
        params.pushInt(status)
        main.post { callback.invoke(params) }
    }

    /** JS 侧要求 URL 指向 `.lynx.bundle`(见 src/native/platform.ts isDevServerURL)。 */
    private fun isDevServerURL(value: String): Boolean {
        if (!value.startsWith("http://") && !value.startsWith("https://")) return false
        val path = value.substringBefore('?').substringBefore('#')
        return path.endsWith(".lynx.bundle")
    }

    private fun androidContext(): Context = (mContext as LynxContext).getContext()

    // === 外观(与 iOS setAppearanceMode 同签名) =====================

    /**
     * 把「跟随系统/浅色/深色」同步给系统,让系统弹窗、输入法、通知
     * 跟随 App 主题(JS 自己渲染的页面不受影响)。
     * 只支持 Android 12+(UiModeManager.setApplicationNightMode);
     * 低版本静默忽略——JS 侧用 capability 探测,不依赖。
     */
    @LynxMethod
    fun setAppearanceMode(mode: String) {
        if (mode != "system" && mode != "light" && mode != "dark") return
        if (android.os.Build.VERSION.SDK_INT < 31) return
        main.post {
            runCatching {
                val manager = androidContext()
                    .getSystemService(Context.UI_MODE_SERVICE) as android.app.UiModeManager
                val nightMode = when (mode) {
                    "light" -> android.app.UiModeManager.MODE_NIGHT_NO
                    "dark" -> android.app.UiModeManager.MODE_NIGHT_YES
                    else -> android.app.UiModeManager.MODE_NIGHT_AUTO
                }
                manager.setApplicationNightMode(nightMode)
                PomeloLog.debug("appearance", "applicationNightMode=$mode")
            }
        }
    }

    /** Android 没有 iOS 那种边缘返回手势(系统手势由系统接管),no-op。 */
    @LynxMethod
    fun setEdgeBackEnabled(enabled: Boolean) {
        // 保留方法以让两端 JS 走同一能力探测路径。
    }

    /** 当前 Activity(dev server 重载需要重建它的 LynxView)。 */
    private fun activity(): MainActivity? = MainActivityRegistry.current

    private val main = android.os.Handler(android.os.Looper.getMainLooper())

    /** 由 MainActivity 注入:未处理时的默认行为(通常是 moveTaskToBack/finish)。 */
    var unhandledCallback: (() -> Unit)? = null

    companion object {
        const val BACK_QUERY_EVENT = "PomeloNavigation.backquery"
        private const val BACK_TIMEOUT_MS = 8_000L
    }
}

/**
 * 最新存活的 [PomeloHostModule] 实例;Activity 的返回键从这里路由。
 * 实例在创建时自注册,页面重载会创建新模块实例并接管。
 */
object PomeloHostModuleBridge {
    @Volatile var current: PomeloHostModule? = null

    /** 绑定 Activity 的未处理回调,返回当前模块实例。 */
    fun bindForActivity(activity: MainActivity): PomeloHostModule? {
        val module = current ?: return null
        module.unhandledCallback = { activity.moveTaskToBack(true) }
        return module
    }
}
