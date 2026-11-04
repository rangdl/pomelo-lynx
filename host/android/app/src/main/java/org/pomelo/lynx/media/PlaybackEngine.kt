package org.pomelo.lynx.media

import android.content.Context
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import org.pomelo.lynx.MainActivity
import org.pomelo.lynx.log.PomeloLog

/**
 * 播放引擎单例:持有唯一的 ExoPlayer 与 MediaSession。
 *
 * 为什么要有这一层(而不是让 `PomeloPlayerModule` 自己 new ExoPlayer):
 *
 * 1. **音频焦点**:`setAudioAttributes(..., handleAudioFocus = true)` 让 media3
 *    自动处理来电/其它 App 抢焦点(掉焦点暂停、恢复时按需续播),并处理
 *    拔耳机(`setHandleAudioBecomingNoisy`)——对齐 iOS 的
 *    `AVAudioSession` category=.playback + interruptionNotification。
 * 2. **后台播放**:`MediaSessionService` 才持有前台服务,息屏/切后台不被杀;
 *    单纯 WAKE_LOCK 权限不会让 ExoPlayer 进入前台服务。
 * 3. **锁屏遥控**:MediaSession 暴露 play/pause/stop/seek/next/previous,
 *    对齐 iOS `MPRemoteCommandCenter` 的 six commands。
 *
 * 队列仍由 `PomeloPlayerModule` 自己管理(一次只喂一个 MediaItem),
 * 所以 next/previous 通过 [QueueNavigator] 回调到模块的队列逻辑,
 * 而不是让 ExoPlayer 走 Timeline。
 */
object PlaybackEngine {

    /** 队列导航钩子:由 PomeloPlayerModule 注入(next/previous 的真实实现)。 */
    interface QueueNavigator {
        fun hasNext(): Boolean
        fun hasPrevious(): Boolean
        fun skipToNext()
        fun skipToPrevious()
    }

    @Volatile
    private var exoPlayer: ExoPlayer? = null

    @Volatile
    private var mediaSession: MediaSession? = null

    @Volatile
    var navigator: QueueNavigator? = null

    /** 构建(或复用)播放器;所有音频策略在这里集中设置。 */
    @Synchronized
    fun player(context: Context): ExoPlayer {
        exoPlayer?.let { return it }
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()
        val exo = ExoPlayer.Builder(context.applicationContext)
            .setAudioAttributes(audioAttributes, /* handleAudioFocus = */ true)
            // 息屏后继续缓冲/播放需要 wakelock(manifest 已声明 WAKE_LOCK)。
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        exoPlayer = exo
        registerBecomingNoisy(context.applicationContext, exo)
        PomeloLog.info("media", "ExoPlayer created (audio focus + wake mode)")
        return exo
    }

    /** 构建(或复用)MediaSession;系统通知栏与锁屏遥控都由它提供。 */
    @Synchronized
    fun session(context: Context): MediaSession {
        mediaSession?.let { return it }
        val base = player(context)
        val sessionPlayer = QueueAwarePlayer(base)
        val session = MediaSession.Builder(context.applicationContext, sessionPlayer)
            .setSessionActivity(openAppIntent(context.applicationContext))
            .build()
        mediaSession = session
        // 显式启动绑定服务:MediaSessionService 只有被启动过才能把播放
        // 提升为前台服务并弹媒体通知。(在应用前台时 startService 安全;
        // 服务内部再由 media3 按需 startForeground。)
        runCatching {
            context.applicationContext.startService(
                android.content.Intent(context.applicationContext, PomeloPlaybackService::class.java),
            )
        }
        PomeloLog.info("media", "MediaSession created")
        return session
    }

    /** 点媒体通知/锁屏回到宿主 Activity(而不是新开一个任务栈)。 */
    private fun openAppIntent(context: Context): android.app.PendingIntent {
        val intent = android.content.Intent(context, MainActivity::class.java)
            .addFlags(
                android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP,
            )
        return android.app.PendingIntent.getActivity(
            context,
            0,
            intent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or
                android.app.PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /**
     * 拔耳机/断开蓝牙时暂停,避免突然外放。
     *
     * 为什么用广播而不是 `AudioAttributes.setHandleAudioBecomingNoisy`:
     * 后者在各 media3 版本间的载体不稳定(1.4 的 AudioAttributes.Builder
     * 上已不可用),广播是平台 API,行为等价且无版本风险。对齐 iOS 的
     * `AVAudioSession` 路由变化处理。
     */
    private fun registerBecomingNoisy(context: Context, exo: ExoPlayer) {
        if (noisyReceiver != null) return
        val receiver = object : android.content.BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: android.content.Intent?) {
                if (intent?.action != android.media.AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                    return
                }
                PomeloLog.info("media", "audio becoming noisy; pausing")
                exo.pause()
            }
        }
        runCatching {
            context.registerReceiver(
                receiver,
                android.content.IntentFilter(android.media.AudioManager.ACTION_AUDIO_BECOMING_NOISY),
            )
            noisyReceiver = receiver
        }
    }

    private var noisyReceiver: android.content.BroadcastReceiver? = null
     *
     * 我们一次只给播放器一个 MediaItem(见模块 load()),所以 ExoPlayer 自己
     * 认为"没有下一首"。这里覆盖 hasNext/hasPrevious/seekToNext/seekToPrevious,
     * 让锁屏、耳机按键、通知栏按钮都能驱动真实队列。
     */
    private class QueueAwarePlayer(base: Player) : ForwardingPlayer(base) {

        private fun queueHasNext(): Boolean = navigator?.hasNext() == true

        private fun queueHasPrevious(): Boolean = navigator?.hasPrevious() == true

        override fun hasNext(): Boolean = queueHasNext()

        override fun hasPrevious(): Boolean = queueHasPrevious()

        override fun seekToNext() {
            navigator?.skipToNext()
        }

        override fun seekToNextMediaItem() {
            navigator?.skipToNext()
        }

        override fun seekToPrevious() {
            navigator?.skipToPrevious()
        }

        override fun seekToPreviousMediaItem() {
            navigator?.skipToPrevious()
        }

        /** 没有下一首/上一首时不要向通知栏暴露对应按钮。 */
        override fun getAvailableCommands(): Player.Commands {
            val builder = super.getAvailableCommands().buildUpon()
            if (queueHasNext()) {
                builder.add(Player.COMMAND_SEEK_TO_NEXT)
                builder.add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
            } else {
                builder.remove(Player.COMMAND_SEEK_TO_NEXT)
                builder.remove(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
            }
            if (queueHasPrevious()) {
                builder.add(Player.COMMAND_SEEK_TO_PREVIOUS)
                builder.add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
            } else {
                builder.remove(Player.COMMAND_SEEK_TO_PREVIOUS)
                builder.remove(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
            }
            return builder.build()
        }
    }

    /** 应用退出时释放(当前由系统回收进程兜底,保留钩子便于测试)。 */
    @Synchronized
    fun release() {
        mediaSession?.release()
        mediaSession = null
        exoPlayer?.release()
        exoPlayer = null
        navigator = null
    }
}
