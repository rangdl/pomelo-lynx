package org.pomelo.lynx

import android.content.Context
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.tasm.behavior.LynxContext
import java.util.UUID
import org.json.JSONObject
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
