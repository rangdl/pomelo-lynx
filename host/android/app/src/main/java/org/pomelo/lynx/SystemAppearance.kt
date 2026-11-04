package org.pomelo.lynx

import android.app.Activity
import android.content.res.Configuration
import androidx.core.view.WindowInsetsCompat
import org.pomelo.lynx.log.PomeloLog

/**
 * 宿主外观契约:深浅色 + 安全区。
 *
 * 与 iOS(`ViewController.appearancePayload`)同构:
 *   - 首帧值写进 `LynxLoadMeta.globalProps`(JS 侧 `readSystemAppearance`);
 *   - 运行中变化通过 `PomeloAppearance.changed` 全局事件推送
 *     (JS 侧 `subscribeSystemAppearance`,带 `reason` 字段;
 *     只有 `trait`/`foreground`/`firstScreen` 才允许改 colorScheme)。
 *
 * 字段与单位必须与 iOS 完全一致:colorScheme 为 "light"/"dark",
 * safe* 为逻辑像素(px / density)——JS 侧 ShellLayout 用宿主 px 值覆盖
 * `--safe-*` token。
 */
object SystemAppearance {

    /** JS 侧订阅的全局事件名(见 src/native/system-appearance.ts)。 */
    const val EVENT = "PomeloAppearance.changed"

    /** 当前深浅色;系统未进入 Night 模式一律按亮色。 */
    fun colorScheme(activity: Activity): String {
        val mode = activity.resources.configuration.uiMode and
            Configuration.UI_MODE_NIGHT_MASK
        return if (mode == Configuration.UI_MODE_NIGHT_YES) "dark" else "light"
    }

    /**
     * 当前安全区(逻辑像素)。必须在 view 附着且有 insets 后调用;
     * `onCreate` 阶段 insets 尚未分发,返回 0 与 JS 默认值一致,
     * 首个非零值由 `firstScreen`/`foreground` 事件补齐。
     */
    fun payload(activity: Activity, reason: String): Map<String, Any> {
        val insets = WindowInsetsCompat.toWindowInsetsCompat(
            activity.window.decorView.rootWindowInsets ?: return base(activity, reason),
        )
        val density: Float = activity.resources.displayMetrics.density
        fun dp(v: Int): Double = v / density.toDouble()
        // systemBars 覆盖状态栏/导航栏,与 iOS safeAreaInsets 语义一致;
        // displayCutout 单独取,避免刘海未计入 systemBars 的机型漏算。
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
        val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
        fun max(a: Int, b: Int): Int = if (a > b) a else b
        return mapOf(
            "colorScheme" to colorScheme(activity),
            "safeTop" to dp(max(bars.top, cutout.top)),
            "safeBottom" to dp(max(bars.bottom, cutout.bottom)),
            "safeLeft" to dp(max(bars.left, cutout.left)),
            "safeRight" to dp(max(bars.right, cutout.right)),
            "reason" to reason,
        )
    }

    /** insets 未分发时(onCreate 阶段)的全零安全区。 */
    private fun base(activity: Activity, reason: String): Map<String, Any> =
        mapOf(
            "colorScheme" to colorScheme(activity),
            "safeTop" to 0.0,
            "safeBottom" to 0.0,
            "safeLeft" to 0.0,
            "safeRight" to 0.0,
            "reason" to reason,
        )

    /** globalProps 初值:不带 reason(它不是外观字段,只是事件路由用)。 */
    fun globalPropsEntry(activity: Activity): Map<String, Any> =
        payload(activity, "firstScreen").minus("reason")
}
