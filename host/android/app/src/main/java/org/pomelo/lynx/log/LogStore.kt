package org.pomelo.lynx.log

import android.content.Context
import android.content.Intent
import android.util.Log as AndroidLog
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

/**
 * Log levels — the numeric contract with `iOS LogStore.swift` and
 * `src/core/log/levels.ts` (verbose=0 … error=4).
 */
enum class LogLevel(val value: Int, val letter: Char, val levelName: String) {
    VERBOSE(0, 'V', "verbose"),
    DEBUG(1, 'D', "debug"),
    INFO(2, 'I', "info"),
    WARN(3, 'W', "warn"),
    ERROR(4, 'E', "error");

    companion object {
        fun fromName(name: String?): LogLevel? = entries.firstOrNull { it.levelName == name }
        fun fromValue(value: Int): LogLevel? = entries.firstOrNull { it.value == value }
    }
}

/** One record; `entryId` is the cross-bridge dedupe key (see `LoggerCore.ingest`). */
data class LogEntry(
    val entryId: String,
    val ts: Long,
    val level: LogLevel,
    val tag: String,
    val msg: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("entryId", entryId)
        .put("ts", ts)
        .put("level", level.value)
        .put("tag", tag)
        .put("msg", msg)
}

/**
 * Native-side logging facade, the Android twin of iOS `Log` (named `PomeloLog`
 * here because `android.util.Log` already owns the short name). Every call
 * writes three places: logcat (the Android equivalent of `NSLog`), the memory
 * ring and the daily file.
 */
object PomeloLog {
    fun verbose(tag: String, msg: String) = LogStore.write(LogLevel.VERBOSE, tag, msg)
    fun debug(tag: String, msg: String) = LogStore.write(LogLevel.DEBUG, tag, msg)
    fun info(tag: String, msg: String) = LogStore.write(LogLevel.INFO, tag, msg)
    fun warn(tag: String, msg: String) = LogStore.write(LogLevel.WARN, tag, msg)
    fun error(tag: String, msg: String) = LogStore.write(LogLevel.ERROR, tag, msg)
}

/**
 * File + memory log store with a batched push channel — structurally identical
 * to iOS `LogStore.swift` (same file format, same JSON contract, same
 * `PomeloLog.append` event), so the JS side needs no platform branches.
 *
 * Files live in `getExternalFilesDir("logs")` (falling back to internal
 * `filesDir/logs`), exportable through the share sheet. Settings persist in
 * `SharedPreferences("pomelo_log")` to mirror the UserDefaults keys.
 */
object LogStore {
    private const val RING_CAPACITY = 500
    private const val MAX_RECENT = 500
    private const val FLUSH_WINDOW_MS = 150L
    private const val MAX_FILE_BYTES = 5L * 1024 * 1024
    private const val PREFS = "pomelo_log"
    private const val KEY_LEVEL = "level"
    private const val KEY_RETENTION = "retentionDays"
    private const val DEFAULT_RETENTION = 7
    private const val FILE_PREFIX = "app-"

    private val scheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private var appContext: Context? = null
    private var dir: File? = null

    // All fields below are only touched on the scheduler thread.
    private val ring = ArrayDeque<LogEntry>()
    private val pending = ArrayList<LogEntry>()
    private var flushScheduled = false
    private var pushEnabled = false
    private var output: FileOutputStream? = null
    private var outputName: String = ""
    private var outputBytes: Long = 0
    private var retentionDays = DEFAULT_RETENTION

    /** Registered by the live `PomeloLogModule` (newest instance owns delivery). */
    @Volatile
    private var sink: ((String) -> Unit)? = null

    @Volatile
    private var level: LogLevel = LogLevel.DEBUG

    private val lineFmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
    private val dayFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    private val lineRegex =
        Regex("""^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[([VDIWE])/([^]]*)\] (.*)$""")

    /** Called once from `HostApplication.onCreate`, before any LynxView. */
    fun init(context: Context) {
        synchronized(this) {
            if (appContext != null) return
            val app = context.applicationContext
            val base = app.getExternalFilesDir("logs") ?: File(app.filesDir, "logs")
            base.mkdirs()
            dir = base
            val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            level = LogLevel.fromName(prefs.getString(KEY_LEVEL, null)) ?: LogLevel.DEBUG
            retentionDays = prefs.getInt(KEY_RETENTION, DEFAULT_RETENTION)
            appContext = app
            scheduler.execute { cleanExpired() }
        }
    }

    // MARK: - Write path

    fun write(level: LogLevel, tag: String, msg: String) {
        if (level.value < this.level.value) return
        val entry = LogEntry(
            entryId = UUID.randomUUID().toString(),
            ts = System.currentTimeMillis(),
            level = level,
            tag = tag,
            msg = msg,
        )
        // Keep logcat in the loop, same rationale as iOS's NSLog mirror.
        AndroidLog.println(
            when (level) {
                LogLevel.VERBOSE -> AndroidLog.VERBOSE
                LogLevel.DEBUG -> AndroidLog.DEBUG
                LogLevel.INFO -> AndroidLog.INFO
                LogLevel.WARN -> AndroidLog.WARN
                LogLevel.ERROR -> AndroidLog.ERROR
            },
            "PomeloLynx",
            "[${level.letter}/$tag] $msg",
        )
        scheduler.execute { store(entry) }
    }

    /** Bulk import of JS-side entries (`NativeModules.PomeloLog.append`). */
    fun appendFromJS(json: String) {
        scheduler.execute {
            val array = try {
                JSONArray(json)
            } catch (_: Exception) {
                return@execute
            }
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                if (!item.has("msg")) continue
                val msg = item.optString("msg")
                val entryLevel = LogLevel.fromValue(item.optInt("level", 1)) ?: LogLevel.DEBUG
                if (entryLevel.value < level.value) continue
                val entry = LogEntry(
                    entryId = item.optString("entryId").ifEmpty { UUID.randomUUID().toString() },
                    ts = item.optLong("ts", System.currentTimeMillis()),
                    level = entryLevel,
                    tag = item.optString("tag", "js"),
                    msg = msg,
                )
                store(entry)
            }
        }
    }

    private fun store(entry: LogEntry) {
        ring.addLast(entry)
        while (ring.size > RING_CAPACITY) ring.removeFirst()
        appendToFile(entry)
        if (!pushEnabled) return
        pending.add(entry)
        if (flushScheduled) return
        flushScheduled = true
        scheduler.schedule({ flushPending() }, FLUSH_WINDOW_MS, TimeUnit.MILLISECONDS)
    }

    private fun flushPending() {
        flushScheduled = false
        if (pending.isEmpty()) return
        val batch = ArrayList(pending)
        pending.clear()
        runCatching { sink?.invoke(encode(batch)) }
    }

    // MARK: - Push channel (native → JS)

    fun setSink(listener: ((String) -> Unit)?) {
        sink = listener
    }

    fun setPushEnabled(enabled: Boolean) {
        scheduler.execute {
            pushEnabled = enabled
            if (!enabled) pending.clear()
        }
    }

    // MARK: - Reads

    fun recent(limit: Int, callback: (String) -> Unit) {
        val capped = limit.coerceIn(1, MAX_RECENT)
        scheduler.execute {
            callback(encode(recentEntries(capped)))
        }
    }

    fun recentText(limit: Int, callback: (String) -> Unit) {
        val capped = limit.coerceIn(1, MAX_RECENT)
        scheduler.execute {
            callback(recentEntries(capped).joinToString("\n") { formatLine(it) })
        }
    }

    private fun recentEntries(capped: Int): List<LogEntry> {
        val tail = ring.toList().takeLast(capped)
        if (tail.size >= capped) return tail
        val before = tail.firstOrNull()?.ts ?: Long.MAX_VALUE
        return readFilesBackward(capped - tail.size, before) + tail
    }

    private fun encode(entries: List<LogEntry>): String {
        val array = JSONArray()
        entries.forEach { array.put(it.toJson()) }
        return array.toString()
    }

    // MARK: - Level / retention

    val levelName: String
        get() = level.levelName

    fun setLevel(name: String) {
        val parsed = LogLevel.fromName(name) ?: return
        level = parsed
        appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            ?.edit()?.putString(KEY_LEVEL, parsed.levelName)?.apply()
    }

    val retention: Int
        get() = retentionDays

    fun setRetention(days: Int) {
        val clamped = days.coerceAtLeast(1)
        scheduler.execute {
            retentionDays = clamped
            appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                ?.edit()?.putInt(KEY_RETENTION, clamped)?.apply()
            cleanExpired()
        }
    }

    // MARK: - Share

    fun shareRecent(limit: Int, callback: (String) -> Unit) {
        recentText(limit) { text ->
            val context = appContext
            if (context == null) {
                callback("{\"error\":\"no_context\"}")
                return@recentText
            }
            try {
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, text)
                }
                context.startActivity(
                    Intent.createChooser(send, "导出日志")
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
                callback("{}")
            } catch (_: Exception) {
                callback("{\"error\":\"share_failed\"}")
            }
        }
    }

    // MARK: - File IO (scheduler thread)

    private fun appendToFile(entry: LogEntry) {
        val root = dir ?: return
        val name = FILE_PREFIX + dayFmt.format(Date(entry.ts))
        if (name != outputName || output == null) openFile(root, name)
        if (outputBytes >= MAX_FILE_BYTES) rotate(root, name)
        val line = (formatLine(entry) + "\n").toByteArray(Charsets.UTF_8)
        try {
            output?.write(line)
            outputBytes += line.size
        } catch (_: IOException) {
            output = null
        }
    }

    private fun openFile(root: File, name: String) {
        runCatching { output?.close() }
        output = null
        val file = File(root, "$name.log")
        output = try {
            FileOutputStream(file, true)
        } catch (_: Exception) {
            null
        }
        outputName = name
        outputBytes = file.length()
    }

    private fun rotate(root: File, name: String) {
        runCatching { output?.close() }
        output = null
        val current = File(root, "$name.log")
        val previous = File(root, "$name.log.1")
        runCatching { previous.delete() }
        runCatching { current.renameTo(previous) }
        openFile(root, name)
    }

    private fun cleanExpired() {
        val root = dir ?: return
        val cutoff = Calendar.getInstance().apply {
            add(Calendar.DAY_OF_YEAR, -retentionDays)
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        for (file in root.listFiles() ?: emptyArray()) {
            val day = extractDay(file.name) ?: continue
            val date = runCatching { dayFmt.parse(day) }.getOrNull() ?: continue
            if (date.time < cutoff) runCatching { file.delete() }
        }
    }

    private fun extractDay(name: String): String? {
        val base = when {
            name.endsWith(".log.1") -> name.removeSuffix(".log.1")
            name.endsWith(".log") -> name.removeSuffix(".log")
            else -> return null
        }
        if (!base.startsWith(FILE_PREFIX)) return null
        val day = base.removePrefix(FILE_PREFIX)
        if (day.length != 10) return null
        return day.takeIf { runCatching { dayFmt.parse(it) }.getOrNull() != null }
    }

    private fun readFilesBackward(need: Int, beforeTs: Long): List<LogEntry> {
        if (need <= 0) return emptyList()
        val root = dir ?: return emptyList()
        // Newest first: later day first; same day, the live `.log` before its
        // rotated-out `.log.1` twin.
        val files = (root.listFiles() ?: emptyArray())
            .filter { extractDay(it.name) != null }
            .sortedWith(
                compareByDescending<File> { extractDay(it.name) }
                    .thenBy { if (it.name.endsWith(".log.1")) 1 else 0 },
            )
        val collected = ArrayList<LogEntry>()
        for (file in files) {
            val lines = runCatching { file.readLines() }.getOrNull() ?: continue
            for (line in lines.asReversed()) {
                val entry = parseLine(line) ?: continue
                if (entry.ts >= beforeTs) continue
                collected.add(entry)
                if (collected.size >= need) return collected.asReversed()
            }
        }
        return collected.asReversed()
    }

    private fun parseLine(line: String): LogEntry? {
        val match = lineRegex.matchEntire(line) ?: return null
        val (stamp, letter, tag, msg) = match.destructured
        val date = runCatching { lineFmt.parse(stamp) }.getOrNull() ?: return null
        val entryLevel = LogLevel.entries.firstOrNull { it.letter == letter[0] } ?: return null
        return LogEntry(
            entryId = "file-" + UUID.randomUUID().toString(),
            ts = date.time,
            level = entryLevel,
            tag = tag,
            msg = unescape(msg),
        )
    }

    private fun formatLine(entry: LogEntry): String =
        "${lineFmt.format(Date(entry.ts))} [${entry.level.letter}/${entry.tag}] ${escape(entry.msg)}"

    // MARK: - File-format escaping (contract with JS + iOS)

    fun escape(raw: String): String =
        raw.replace("\\", "\\\\").replace("\r", "\\r").replace("\n", "\\n")

    fun unescape(raw: String): String {
        val out = StringBuilder(raw.length)
        var index = 0
        while (index < raw.length) {
            val char = raw[index]
            if (char == '\\' && index + 1 < raw.length) {
                when (raw[index + 1]) {
                    'n' -> {
                        out.append('\n')
                        index += 2
                        continue
                    }
                    'r' -> {
                        out.append('\r')
                        index += 2
                        continue
                    }
                    '\\' -> {
                        out.append('\\')
                        index += 2
                        continue
                    }
                }
            }
            out.append(char)
            index++
        }
        return out.toString()
    }
}
