package org.pomelo.lynx

/**
 * 当前前台 [MainActivity] 的弱引用注册表。
 *
 * Lynx 原生模块拿不到 Activity(只拿得到 `LynxContext`),而 dev server
 * 热切换需要重建 Activity 里的 LynxView;播放器通知点击也要回到同一个
 * 任务栈。这里保存弱引用,Activity 销毁时清空,避免泄漏。
 */
object MainActivityRegistry {

    @Volatile
    private var ref: java.lang.ref.WeakReference<MainActivity>? = null

    fun attach(activity: MainActivity) {
        ref = java.lang.ref.WeakReference(activity)
    }

    fun detach(activity: MainActivity) {
        if (ref?.get() === activity) ref = null
    }

    val current: MainActivity?
        get() = ref?.get()
}
