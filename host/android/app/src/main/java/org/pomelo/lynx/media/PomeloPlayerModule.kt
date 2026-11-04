package org.pomelo.lynx.media

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.tasm.behavior.LynxContext
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject
import org.pomelo.lynx.log.PomeloLog

/**
 * `NativeModules.PomeloPlayer` 的 Android 实现(Media3 ExoPlayer),
 * 与 iOS `PomeloPlayerModule`(packages/lynx-media/ios/src)逐方法对齐。
 *
 * 契约要点(两端的 JS facade 是同一份 src/native/player.ts):
 *   - 状态快照事件 `PomeloPlayer.state`:JSON 字符串(与 iOS stateJSON 同形),
 *     字段 state/url/position/duration/error/queueIndex/lyric/rate/volume/
 *     engine/refreshing。
 *   - 语义事件 `PomeloPlayer.event`:对象载荷,type ∈ track/loaded/started/
 *     paused/waiting/ended/stopped/error/refresh_required/refresh_applied/
 *     refresh_failed。
 *   - 401/403 检测(ExoPlayer 错误码 http 会带状态)→ `refresh_required`,
 *     JS 刷新链接后回 `resolveRefresh(requestId, ...)` 原位换源。
 *   - 歌词:`setLyrics` + `PomeloPlayer.lyric` 逐行事件。
 *
 * 所有方法都跳回主线程(ExoPlayer 要求);callback 由 Lynx 桥回调。
 */
class PomeloPlayerModule(context: Context) : LynxModule(context) {

    private val main = Handler(Looper.getMainLooper())
    private var player: ExoPlayer? = null

    // === 队列与当前项 ================================================
    private data class QueueItem(
        val url: String,
        val title: String,
        val artist: String,
        val album: String,
        val artwork: String,
        val headers: Map<String, String>,
    )

    private var queue = mutableListOf<QueueItem>()
    private var queueIndex = -1

    // === 状态镜像(JS 读的都来自这里,与 iOS 同名同义) ================
    private var stateName = "idle"
    private var currentURL = ""
    private var position = 0.0
    private var duration = 0.0
    private var errorCode = ""
    private var currentLyric = ""
    private var lyricMode = "title"
    private var lyricLines = listOf<Pair<Double, String>>() // (time, text) 按时间升序
    private var playbackRate = 1f
    private var desiredPlaying = false
    private var hasReportedLoaded = false
    private var refreshAttempts = 0

    private data class PendingRefresh(
        val requestId: String,
        val queueIndex: Int,
        val url: String,
        val position: Double,
        var shouldPlay: Boolean,
    )

    private var pendingRefresh: PendingRefresh? = null
    private var refreshTimeout: Runnable? = null
    /** load 切源中:抑制 ExoPlayer 回调里的状态事件(避免中间态)。 */
    private var loadingNext = false

    /** 0.5s 周期 tick(对齐 iOS addPeriodicTimeObserver):推位置/歌词。 */
    private val tick = object : Runnable {
        override fun run() {
            val exo = player ?: return
            if (currentURL.isEmpty() || stateName == "idle") return
            position = (exo.currentPosition / 1000.0).coerceAtLeast(0.0)
            updateLyric(position)
            emit()
            main.postDelayed(this, TICK_MS)
        }
    }

    private fun startTicking() {
        main.removeCallbacks(tick)
        main.postDelayed(tick, TICK_MS)
    }

    private fun stopTicking() {
        main.removeCallbacks(tick)
    }

    // === 播放器生命周期 ==============================================

    private fun ensurePlayer(): ExoPlayer? {
        if (player != null) return player
        // LynxContext.getContext() 是应用级 Context(见 PomeloStorageModule)。
        val appContext = (mContext as? LynxContext)?.getContext() ?: return null
        // 单例引擎:音频焦点、wakelock、MediaSession(通知/锁屏)都在里面。
        val exo = PlaybackEngine.player(appContext)
        exo.addListener(playerListener)
        player = exo
        // 锁屏/通知栏/耳机按键的 next/previous 回到本模块的队列逻辑。
        PlaybackEngine.navigator = object : PlaybackEngine.QueueNavigator {
            override fun hasNext(): Boolean = queueIndex + 1 < queue.size
            override fun hasPrevious(): Boolean = queueIndex > 0
            override fun skipToNext() {
                main.post { next() }
            }

            override fun skipToPrevious() {
                main.post { previous() }
            }
        }
        // 建好 session 才有前台服务与媒体通知。
        PlaybackEngine.session(appContext)
        return exo
    }

    private val playerListener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            val exo = player ?: return
            if (loadingNext) return
            when (playbackState) {
                Player.STATE_READY -> {
                    val seconds = exo.duration.let { if (it > 0) it / 1000.0 else 0.0 }
                    if (seconds.isFinite() && seconds > 0) duration = seconds
                    if (!hasReportedLoaded) {
                        hasReportedLoaded = true
                        emitEvent("loaded")
                    }
                    refreshAttempts = 0
                }
                Player.STATE_ENDED -> advanceAfterEnd()
                Player.STATE_IDLE -> { /* stop()/error 自己管理状态 */ }
                Player.STATE_BUFFERING -> { /* playWhenReady 保持 */ }
            }
            syncPlayState(exo)
            emit()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            val exo = player ?: return
            if (loadingNext) return
            if (isPlaying) {
                if (stateName != "ended") stateName = "playing"
                refreshAttempts = 0
                emitEvent("started")
                startTicking()
            } else {
                if (stateName != "paused" && stateName != "error" && stateName != "ended") {
                    stateName =
                        if (exo.playbackState == Player.STATE_BUFFERING) "loading" else "paused"
                }
                stopTicking()
            }
            syncPlayState(exo)
            emit()
        }

        override fun onPlayerError(error: PlaybackException) {
            if (loadingNext) return
            handleItemFailure(error)
        }
    }

    /** 把 ExoPlayer 的缓冲/就绪状态映射到 iOS 同名的 stateName。 */
    private fun syncPlayState(exo: ExoPlayer) {
        if (stateName == "error" || stateName == "ended" || stateName == "idle") return
        when {
            exo.isPlaying -> stateName = "playing"
            exo.playbackState == Player.STATE_BUFFERING && desiredPlaying -> stateName = "loading"
            exo.playbackState == Player.STATE_READY && !desiredPlaying -> stateName = "paused"
        }
    }

    private fun handleItemFailure(error: PlaybackException?) {
        val status = httpStatus(error)
        if (status == 401 || status == 403) {
            if (requestRefresh(status)) return
        }
        if (stateName == "error" && errorCode == "player_item_failed") return
        stateName = "error"
        errorCode = "player_item_failed"
        desiredPlaying = false
        emitEvent("error", mapOf("error" to errorCode, "status" to status))
        emit()
    }

    /** 从 ExoPlayer 错误链里取 HTTP 状态码;取不到为 0。 */
    private fun httpStatus(error: PlaybackException?): Int {
        var cause: Throwable? = error
        var depth = 0
        while (cause != null && depth < 8) {
            // media3 的 HttpDataSource.InvalidResponseCodeException.responseCode
            val code = try {
                val field = cause.javaClass.getField("responseCode")
                (field.get(cause) as? Int) ?: -1
            } catch (_: Exception) {
                -1
            }
            if (code in 400..599) return code
            cause = cause.cause
            depth++
        }
        return 0
    }

    // === 事件发射 =====================================================

    private fun emit() {
        val lynxContext = mContext as? LynxContext ?: return
        val params = JavaOnlyArray()
        params.pushString(stateJSON())
        lynxContext.sendGlobalEvent(STATE_EVENT, params)
    }

    private fun emitEvent(type: String, extra: Map<String, Any?> = emptyMap()) {
        val lynxContext = mContext as? LynxContext ?: return
        val value = JavaOnlyMap()
        value.putString("type", type)
        value.putString("url", eventURL(currentURL))
        value.putInt("queueIndex", queueIndex)
        value.putString("title", currentTitle())
        value.putString("artist", currentArtist())
        value.putString("album", currentAlbum())
        value.putDouble("position", position)
        value.putDouble("duration", duration)
        for ((key, item) in extra) {
            when (item) {
                is String -> value.putString(key, item)
                is Int -> value.putInt(key, item)
                is Boolean -> value.putBoolean(key, item)
                is Double -> value.putDouble(key, item)
            }
        }
        val params = JavaOnlyArray()
        params.pushMap(value)
        lynxContext.sendGlobalEvent(EVENT_NAME, params)
    }

    /** 状态快照(与 iOS payload() 同形)。 */
    private fun stateJSONObject(): JSONObject = JSONObject()
        .put("state", stateName)
        .put("url", eventURL(currentURL))
        .put("position", position)
        .put("duration", duration)
        .put("error", errorCode)
        .put("queueIndex", queueIndex)
        .put("lyric", currentLyric)
        .put("rate", playbackRate.toDouble())
        .put("volume", volume.toDouble())
        .put("engine", "system")
        .put("refreshing", pendingRefresh != null)

    private fun stateJSON(): String = try {
        stateJSONObject().toString()
    } catch (_: Exception) {
        "{\"error\":\"player_state_failed\"}"
    }

    /** 事件里不暴露查询串中的 token(与 iOS eventURL 一致的防御)。 */
    private fun eventURL(raw: String): String {
        val queryStart = raw.indexOf('?')
        if (queryStart < 0) return raw
        val base = raw.substring(0, queryStart)
        val sensitive = setOf("access_token", "refresh_token", "token", "authorization")
        val kept = raw.substring(queryStart + 1).split('&').filter { part ->
            val name = part.substringBefore('=').lowercase()
            part.isNotEmpty() && name !in sensitive
        }
        return if (kept.isEmpty()) base else "$base?${kept.joinToString("&")}"
    }

    private fun currentTitle(): String {
        val item = queue.getOrNull(queueIndex)
        val fallback = currentURL.substringAfterLast('/')
        return item?.title?.ifEmpty { fallback } ?: fallback
    }

    private fun currentArtist(): String =
        queue.getOrNull(queueIndex)?.artist?.ifEmpty { "Pomelo Lynx" } ?: "Pomelo Lynx"

    private fun currentAlbum(): String = queue.getOrNull(queueIndex)?.album ?: ""

    private var volume = 1f

    // === load / 队列 ==================================================

    private fun httpURL(raw: String?): String? {
        if (raw.isNullOrEmpty()) return null
        if (!raw.startsWith("http://") && !raw.startsWith("https://")) return null
        return raw
    }

    private fun mediaItem(url: String): MediaItem {
        val builder = MediaItem.Builder().setUri(url)
        val metadata = MediaMetadata.Builder()
            .setTitle(currentTitle().ifEmpty { null })
            .setArtist(currentArtist().ifEmpty { null })
            .setAlbumTitle(currentAlbum().ifEmpty { null })
        queue.getOrNull(queueIndex)?.artwork?.takeIf { it.isNotEmpty() }?.let { artwork ->
            runCatching { metadata.setArtworkUri(android.net.Uri.parse(artwork)) }
        }
        builder.setMediaMetadata(metadata.build())
        // headers 通过 HeaderedDataSourceFactory 注入(见 load)。
        return builder.build()
    }

    private fun load(
        url: String,
        autoplay: Boolean,
        index: Int? = null,
        headers: Map<String, String> = emptyMap(),
        callback: Callback? = null,
    ) {
        val exo = ensurePlayer()
        if (exo == null) {
            callback?.invoke(errorJSON("player_audio_session_failed"))
            return
        }
        cancelPendingRefresh()
        loadingNext = true // load 内部的 stop/prepare 会触发回调,别推中间态
        exo.stop()
        exo.clearMediaItems()

        pendingRefresh = null
        hasReportedLoaded = false
        desiredPlaying = autoplay
        refreshAttempts = 0
        currentURL = url
        queueIndex = if (index != null) {
            if (index in queue.indices) index else -1
        } else {
            queue.indexOfFirst { it.url == url }
        }
        val effectiveHeaders =
            if (headers.isEmpty() && queueIndex in queue.indices) queue[queueIndex].headers
            else headers
        lyricLines = emptyList()
        currentLyric = ""
        position = 0.0
        duration = 0.0
        errorCode = ""
        stateName = "loading"

        val item = mediaItem(url)
        // 带自定义 headers 的源需要专属 DataSource;普通源直接用默认工厂。
        if (effectiveHeaders.isEmpty()) {
            exo.setMediaItem(item)
        } else {
            val appContext = (mContext as? LynxContext)?.getContext() ?: return
            val dsFactory = HeaderedDataSourceFactory(appContext, effectiveHeaders)
            val source = androidx.media3.exoplayer.source.DefaultMediaSourceFactory(dsFactory)
                .createMediaSource(item)
            exo.setMediaSource(source)
        }
        loadingNext = false
        exo.prepare()
        exo.playWhenReady = autoplay
        exo.playbackParameters = androidx.media3.common.PlaybackParameters(playbackRate)
        emitEvent("track", mapOf("autoplay" to autoplay))
        emit()
        callback?.invoke("{\"ok\":true}")
    }

    private fun advanceAfterEnd() {
        if (queueIndex in queue.indices && queueIndex + 1 < queue.size) {
            loadQueueItem(queueIndex + 1)
            return
        }
        stateName = "ended"
        desiredPlaying = false
        player?.pause()
        emitEvent("ended")
        emit()
    }

    private fun loadQueueItem(index: Int) {
        if (index !in queue.indices) return
        load(queue[index].url, autoplay = true, index = index, headers = queue[index].headers)
    }

    // === 鉴权刷新(iOS requestRefresh 对齐) ============================

    private fun requestRefresh(status: Int): Boolean {
        if (pendingRefresh != null) return true
        if (refreshAttempts >= 3) return false
        if (queueIndex !in queue.indices) return false
        refreshAttempts++
        val request = PendingRefresh(
            requestId = UUID.randomUUID().toString(),
            queueIndex = queueIndex,
            url = currentURL,
            position = position,
            shouldPlay = desiredPlaying,
        )
        pendingRefresh = request
        stateName = "loading"
        errorCode = ""
        player?.pause()

        val timeout = Runnable {
            if (pendingRefresh?.requestId == request.requestId) {
                pendingRefresh = null
                refreshTimeout = null
                stateName = "error"
                errorCode = "player_refresh_timeout"
                desiredPlaying = false
                emitEvent(
                    "refresh_failed",
                    mapOf("requestId" to request.requestId, "error" to errorCode),
                )
                emit()
            }
        }
        refreshTimeout = timeout
        main.postDelayed(timeout, REFRESH_TIMEOUT_MS)
        emitEvent(
            "refresh_required",
            mapOf("requestId" to request.requestId, "status" to status),
        )
        emit()
        return true
    }

    private fun cancelPendingRefresh() {
        refreshTimeout?.let { main.removeCallbacks(it) }
        refreshTimeout = null
        pendingRefresh = null
    }

    // === LynxMethod(JS 可见) =========================================

    @LynxMethod
    fun load(requestJson: String, callback: Callback) {
        val request = try {
            JSONObject(requestJson)
        } catch (_: Exception) {
            callback.invoke(errorJSON("player_invalid_url"))
            return
        }
        val url = httpURL(request.optString("url"))
        if (url == null) {
            callback.invoke(errorJSON("player_invalid_url"))
            return
        }
        val autoplay = request.optBoolean("autoplay", true)
        val headers = parseHeaders(request.optJSONObject("headers"))
        main.post {
            load(url, autoplay, headers = headers, callback = callback)
        }
    }

    @LynxMethod
    fun setQueue(requestJson: String) {
        val request = try {
            JSONObject(requestJson)
        } catch (_: Exception) {
            return
        }
        val rawItems = request.optJSONArray("items") ?: return
        if (rawItems.length() > MAX_QUEUE_ITEMS) return
        val items = mutableListOf<QueueItem>()
        for (i in 0 until rawItems.length()) {
            val raw = rawItems.optJSONObject(i) ?: return
            val url = httpURL(raw.optString("url")) ?: return
            items.add(
                QueueItem(
                    url = url,
                    title = metadataText(raw.optString("title")),
                    artist = metadataText(raw.optString("artist")),
                    album = metadataText(raw.optString("album")),
                    artwork = httpURL(raw.optString("artwork")) ?: "",
                    headers = parseHeaders(raw.optJSONObject("headers")),
                )
            )
        }
        val rawIndex = request.optInt("index", -1)
        val index = if (rawIndex in items.indices) rawIndex else -1
        main.post {
            queue = items
            queueIndex = index
            emit()
        }
    }

    @LynxMethod
    fun next() {
        main.post {
            if (queueIndex + 1 < queue.size) loadQueueItem(queueIndex + 1)
        }
    }

    @LynxMethod
    fun previous() {
        main.post {
            if (queueIndex > 0) {
                loadQueueItem(queueIndex - 1)
            } else {
                seek(0.0)
            }
        }
    }

    @LynxMethod
    fun play() {
        main.post {
            val exo = player ?: return@post
            if (queueIndex < 0 && currentURL.isEmpty()) return@post
            desiredPlaying = true
            exo.play()
            pendingRefresh?.shouldPlay = true
            stateName = "playing"
            emit()
        }
    }

    @LynxMethod
    fun pause() {
        main.post {
            val exo = player ?: return@post
            exo.pause()
            desiredPlaying = false
            pendingRefresh?.shouldPlay = false
            if (currentURL.isNotEmpty()) {
                stateName = "paused"
                emitEvent("paused")
            }
            emit()
        }
    }

    @LynxMethod
    fun seek(seconds: Double) {
        if (!seconds.isFinite()) return
        main.post {
            val exo = player ?: return@post
            if (currentURL.isEmpty()) return@post
            val maximum = if (duration > 0) duration else seconds
            val target = seconds.coerceIn(0.0, maximum)
            exo.seekTo((target * 1000).toLong())
            position = target
            emit()
        }
    }

    @LynxMethod
    fun stop() {
        main.post {
            val exo = player
            loadingNext = true
            if (exo != null) {
                exo.stop()
                exo.clearMediaItems()
            }
            loadingNext = false
            stopTicking()
            cancelPendingRefresh()
            currentURL = ""
            lyricLines = emptyList()
            currentLyric = ""
            stateName = "idle"
            position = 0.0
            duration = 0.0
            errorCode = ""
            queueIndex = -1
            desiredPlaying = false
            hasReportedLoaded = false
            refreshAttempts = 0
            emitEvent("stopped")
            emit()
        }
    }

    @LynxMethod
    fun setLyrics(requestJson: String) {
        val request = try {
            JSONObject(requestJson)
        } catch (_: Exception) {
            return
        }
        val rawLines = request.optJSONArray("lines") ?: return
        if (rawLines.length() > MAX_LYRIC_LINES) return
        val lines = mutableListOf<Pair<Double, String>>()
        for (i in 0 until rawLines.length()) {
            val raw = rawLines.optJSONObject(i) ?: continue
            val time = raw.optDouble("time", Double.NaN)
            if (time.isNaN() || !time.isFinite() || time < 0) continue
            val text = raw.optString("text").take(240).trim()
            if (text.isEmpty()) continue
            lines.add(time to text)
        }
        lines.sortBy { it.first }
        val rawMode = request.optString("mode", "title")
        val mode = if (rawMode in setOf("title", "artist", "album")) rawMode else "title"
        main.post {
            lyricMode = mode
            lyricLines = lines
            currentLyric = ""
            updateLyric(position)
            emit()
        }
    }

    @LynxMethod
    fun clearLyrics() {
        main.post {
            lyricLines = emptyList()
            currentLyric = ""
            emit()
        }
    }

    @LynxMethod
    fun setNowPlayingOverride(requestJson: String) {
        // Media3 的 MediaMetadata 在 MediaItem 上;override 只更新锁屏元数据。
        val request = try {
            JSONObject(requestJson)
        } catch (_: Exception) {
            return
        }
        overrideTitle = metadataText(request.optString("title"))
        overrideArtist = metadataText(request.optString("artist"))
        overrideAlbum = metadataText(request.optString("album"))
        // lyrics override 不进 Android 锁屏(无 MPMediaItemPropertyLyrics 等价物)。
        main.post { updateNowPlaying() }
    }

    @LynxMethod
    fun clearNowPlayingOverride() {
        overrideTitle = ""
        overrideArtist = ""
        overrideAlbum = ""
        main.post { updateNowPlaying() }
    }

    private var overrideTitle = ""
    private var overrideArtist = ""
    private var overrideAlbum = ""

    @LynxMethod
    fun setRate(rate: Double) {
        if (!rate.isFinite() || rate < 0.1 || rate > 4.0) return
        main.post {
            playbackRate = rate.toFloat()
            if (stateName == "playing") {
                player?.playbackParameters =
                    androidx.media3.common.PlaybackParameters(playbackRate)
            }
            emit()
        }
    }

    @LynxMethod
    fun setVolume(volumeValue: Double) {
        if (!volumeValue.isFinite() || volumeValue < 0 || volumeValue > 1) return
        main.post {
            volume = volumeValue.toFloat()
            player?.volume = volume
            emit()
        }
    }

    @LynxMethod
    fun getCapabilities(callback: Callback) {
        val value = JSONObject()
            .put("engine", "system")
            .put("audio", true)
            .put("video", false)
            .put("rate", true)
            .put("volume", true)
            .put("background", true)
            .put("lyrics", true)
            .put("queue", true)
            .put("headers", true)
            .put("refresh", true)
            .put("events", true)
        callback.invoke(value.toString())
    }

    @LynxMethod
    fun setEngine(engine: String, callback: Callback) {
        if (engine != "system" && engine != "exoplayer") {
            callback.invoke(errorJSON("player_engine_unsupported"))
            return
        }
        callback.invoke("{\"ok\":true}")
    }

    @LynxMethod
    fun resolveRefresh(requestJson: String) {
        val request = try {
            JSONObject(requestJson)
        } catch (_: Exception) {
            return
        }
        val requestId = request.optString("requestId")
        if (requestId.isEmpty()) return
        main.post {
            val pending = pendingRefresh ?: return@post
            if (pending.requestId != requestId) return@post
            refreshTimeout?.let { main.removeCallbacks(it) }
            refreshTimeout = null
            pendingRefresh = null

            val error = request.optString("error", "").take(80)
            if (error.isNotEmpty()) {
                failRefresh(pending, error)
                return@post
            }
            val url = httpURL(request.optString("url"))
            if (url == null) {
                failRefresh(pending, "player_refresh_invalid")
                return@post
            }
            val headers = parseHeaders(request.optJSONObject("headers"))
            val artwork = httpURL(request.optString("artwork"))

            if (pending.queueIndex !in queue.indices ||
                queue[pending.queueIndex].url != pending.url
            ) {
                failRefresh(pending, "player_refresh_stale")
                return@post
            }
            queue[pending.queueIndex] = queue[pending.queueIndex].copy(
                url = url,
                headers = headers.ifEmpty { queue[pending.queueIndex].headers },
                artwork = artwork ?: queue[pending.queueIndex].artwork,
            )
            val resumeAt = pending.position
            val shouldPlay = pending.shouldPlay
            load(url, autoplay = shouldPlay, index = pending.queueIndex, headers = headers)
            // 原位续播:恢复到刷新前的位置。
            if (resumeAt > 0) {
                player?.seekTo((resumeAt * 1000).toLong())
                position = resumeAt
            }
            emitEvent("refresh_applied", mapOf("requestId" to requestId))
            emit()
        }
    }

    private fun failRefresh(pending: PendingRefresh, error: String) {
        stateName = "error"
        errorCode = error
        desiredPlaying = false
        emitEvent(
            "refresh_failed",
            mapOf("requestId" to pending.requestId, "error" to error),
        )
        emit()
    }

    @LynxMethod
    fun getState(callback: Callback) {
        main.post {
            position = player?.currentPosition?.div(1000.0)?.takeIf { it >= 0 } ?: position
            callback.invoke(stateJSON())
        }
    }

    // === 歌词(iOS updateLyric 对齐) ==================================

    private fun updateLyric(seconds: Double) {
        if (lyricLines.isEmpty()) return
        var text = ""
        for ((time, line) in lyricLines) {
            if (time <= seconds + 0.05) text = line else break
        }
        if (text == currentLyric) return
        currentLyric = text
        updateNowPlaying()
        val lynxContext = mContext as? LynxContext ?: return
        val value = JavaOnlyMap()
        value.putString("text", text)
        value.putDouble("time", position)
        val params = JavaOnlyArray()
        params.pushMap(value)
        lynxContext.sendGlobalEvent(LYRIC_EVENT, params)
    }

    /** 位置推进由 JS 的 state 事件轮询驱动;这里不做定时器(见性能注释)。 */

    // === 锁屏元数据 ====================================================

    private fun updateNowPlaying() {
        // Media3 session 的锁屏元数据依赖 MediaSessionService;MVP 先用
        // MediaItem.metadata(已含 title/artist/artwork)。override 时重建
        // 当前 MediaItem 的 metadata。
        val exo = player ?: return
        if (currentURL.isEmpty()) return
        val item = exo.currentMediaItem ?: return
        // 歌词行按 iOS 同样的 mode 语义替换锁屏字段。
        var title = overrideTitle.ifEmpty { currentTitle() }
        var artist = overrideArtist.ifEmpty { currentArtist() }
        var album = overrideAlbum.ifEmpty { currentAlbum() }
        if (currentLyric.isNotEmpty()) {
            when (lyricMode) {
                "artist" -> artist = currentLyric
                "album" -> album = currentLyric
                else -> title = currentLyric
            }
        }
        val metadata = MediaMetadata.Builder()
            .setTitle(title.ifEmpty { null })
            .setArtist(artist.ifEmpty { null })
            .setAlbumTitle(album.ifEmpty { null })
        queue.getOrNull(queueIndex)?.artwork?.takeIf { it.isNotEmpty() }?.let {
            runCatching { metadata.setArtworkUri(android.net.Uri.parse(it)) }
        }
        try {
            val replaced = item.buildUpon().setMediaMetadata(metadata.build()).build()
            val currentIndex = exo.currentMediaItemIndex
            val pos = exo.currentPosition
            exo.replaceMediaItem(currentIndex, replaced)
            exo.seekTo(currentIndex, pos)
        } catch (_: Exception) {
            /* 元数据更新失败不影响播放。 */
        }
    }

    // === 工具 ==========================================================

    private fun metadataText(raw: String?): String =
        raw?.trim()?.take(200) ?: ""

    private fun parseHeaders(raw: JSONObject?): Map<String, String> {
        if (raw == null || raw.length() > MAX_HEADERS) return emptyMap()
        val headers = mutableMapOf<String, String>()
        for (key in raw.keys()) {
            if (key.isEmpty()) continue
            val value = raw.optString(key).take(MAX_HEADER_VALUE)
            if (value.isEmpty()) continue
            headers[key] = value
        }
        return headers
    }

    private fun errorJSON(code: String): String = JSONObject().put("error", code).toString()

    companion object {
        const val STATE_EVENT = "PomeloPlayer.state"
        const val EVENT_NAME = "PomeloPlayer.event"
        const val LYRIC_EVENT = "PomeloPlayer.lyric"
        private const val MAX_QUEUE_ITEMS = 500
        private const val MAX_LYRIC_LINES = 5000
        private const val MAX_HEADERS = 16
        private const val MAX_HEADER_VALUE = 512
        private const val REFRESH_TIMEOUT_MS = 12_000L
        private const val TICK_MS = 500L
    }
}
