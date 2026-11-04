package org.pomelo.lynx.media

import android.content.Intent
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import org.pomelo.lynx.log.PomeloLog

/**
 * 后台播放服务。
 *
 * 只有 `MediaSessionService` 才会把播放提升为前台服务(带媒体通知),
 * 息屏/切到后台/system 内存压力下才不会被立刻杀掉。通知栏与锁屏按钮
 * 由 MediaSession 提供,播放实例在 [PlaybackEngine] 单例里(JS 侧
 * `PomeloPlayer` 模块与这里共用同一个 ExoPlayer)。
 *
 * 生命周期:服务被系统杀死后,若仍在播放,系统会通过 `onPlaybackResumption`
 * 重建——这里刻意不实现自动恢复(队列恢复由 JS 侧持久化负责,与 iOS 一致:
 * 冷启动不自动续播)。
 */
class PomeloPlaybackService : MediaSessionService() {

    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        session = PlaybackEngine.session(this)
        PomeloLog.info("media", "PlaybackService created")
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
        session

    /**
     * 用户从最近任务划掉 App:继续播放(音乐应用预期),不 stopSelf。
     * 对应 iOS 的后台音频行为。
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = session?.player
        if (player == null || !player.playWhenReady) {
            stopSelf()
            return
        }
        PomeloLog.info("media", "task removed; keep playing")
    }

    override fun onDestroy() {
        // 只解绑服务持有的引用;ExoPlayer 由 PlaybackEngine 单例持有,
        // 这样页面重建(热更新/配置变化)不会打断播放。
        session = null
        PomeloLog.info("media", "PlaybackService destroyed")
        super.onDestroy()
    }
}
