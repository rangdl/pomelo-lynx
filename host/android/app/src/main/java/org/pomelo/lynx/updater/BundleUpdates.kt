package org.pomelo.lynx.updater

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * One store per process, shared by template loading and (future) the
 * PomeloUpdate native module. Reads `native-host.json` from assets — the
 * snapshot `scripts/gen-native-host.mjs` produces at build time.
 *
 * Stage 4a scope (this file): the **selection** half of the hot-update pipeline.
 * A downloaded update lives in `filesDir/bundle_updates/bundles/<key>` where
 * `<key>` is `<channel>-<build_number>-<git_commit>`; `state.json` tracks
 * active / pending / trial keys exactly like songloft-player-lynx's
 * BundleUpdateStore. Signature verification (stage 4b) and network download
 * (stage 4c) are NOT implemented here yet — `install()` is the single seam
 * they will plug into, and until then no state.json ever contains a candidate
 * the assets provider did not put there.
 */
object BundleUpdates {
    private var initialized = false
    private var store: BundleUpdateStore? = null

    @Synchronized
    fun get(context: Context): BundleUpdateStore? {
        if (!initialized) {
            initialized = true
            store = try {
                val app = context.applicationContext
                val host = app.assets.open("native-host.json").bufferedReader().use {
                    JSONObject(it.readText())
                }.put("platform", "android")
                BundleUpdateStore(File(app.filesDir, "bundle_updates"), host)
            } catch (_: Exception) {
                // Missing native-host.json means a dev APK built without
                // `pnpm build:host` — updates stay disabled, assets still load.
                null
            }
        }
        return store
    }
}

class BundleUpdateStore(private val root: File, private val host: JSONObject) {
    private val bundlesDir = File(root, "bundles")
    private val stateFile = File(root, "state.json")

    init {
        check(root.mkdirs() || root.isDirectory) { "update_storage_unavailable" }
        check(bundlesDir.mkdirs() || bundlesDir.isDirectory) { "update_storage_unavailable" }
        // Part directories are never candidates after an interrupted process.
        root.listFiles()?.filter { it.name.startsWith("download-") }?.forEach { it.deleteRecursively() }
    }

    /**
     * Once per launch: pick the bundle to run.
     *
     * - A `trial` from the previous process that was never confirmed means the
     *   process died before the page could confirm — roll back and never retry
     *   in this process.
     * - Otherwise a `pending` update is promoted to `trial` and returned.
     * - `null` → caller falls back to the embedded assets bundle.
     */
    @Synchronized
    fun beginLaunch(): ByteArray? {
        val state = readState()
        if (state.has("trial")) {
            writeState(
                JSONObject()
                    .put("active", state.opt("active") ?: JSONObject.NULL)
                    .put("last_error", "rollback_unconfirmed"),
            )
            return null
        }
        val pendingKey = state.optString("pending").takeIf { it.isNotEmpty() } ?: return null
        val file = File(bundlesDir, pendingKey)
        val bytes = runCatching { file.takeIf { it.isFile }?.readBytes() }.getOrNull() ?: run {
            removeKey(state, "pending")
            writeState(state)
            return null
        }
        state.put("trial", pendingKey)
        writeState(state)
        return bytes
    }

    /** A trial that reached a working first screen promotes to active. */
    @Synchronized
    fun confirmLaunch() {
        val state = readState()
        val trial = state.optString("trial")
        if (trial.isEmpty()) return
        state.put("active", trial)
        state.remove("trial")
        state.remove("last_error")
        writeState(state)
        prune(state)
    }

    /**
     * Fatal load error during a trial (or any launch): the next process rolls
     * back. Called from `LynxViewClient.onLoadFailed` / fatal `onReceivedError`.
     */
    @Synchronized
    fun failStartup() {
        val state = readState()
        if (!state.has("trial")) return
        state.put("last_error", "startup_failed")
        writeState(state)
    }

    /**
     * The seam stage 4b/4c will call after verifying a downloaded manifest:
     * stage the bytes under the manifest key and mark it pending. Until those
     * stages land, nothing in this codebase calls it — kept package-visible
     * with a unit-testable shape (JVM-testable: org.json + java.io only).
     */
    @Synchronized
    fun install(key: String, bytes: ByteArray) {
        require(key.matches(Regex("^[A-Za-z0-9._-]{1,160}$"))) { "invalid_key" }
        require(bytes.isNotEmpty() && bytes.size <= MAX_BUNDLE_BYTES) { "invalid_bundle" }
        val dir = File(bundlesDir, key)
        check(dir.mkdirs() || dir.isDirectory) { "update_storage_unavailable" }
        File(dir, "bundle.bin").writeBytes(bytes)
        val state = readState()
        state.put("pending", key)
        writeState(state)
    }

    private fun readState(): JSONObject = try {
        require(stateFile.length() in 1..16_384)
        JSONObject(stateFile.readText())
    } catch (_: Exception) {
        JSONObject()
    }

    private fun writeState(state: JSONObject) {
        val temp = File(root, "state.json.part")
        temp.writeText(state.toString())
        if (!temp.renameTo(stateFile)) {
            stateFile.writeText(state.toString())
            temp.delete()
        }
    }

    private fun removeKey(state: JSONObject, key: String) {
        state.remove(key)
    }

    /** Keep active + pending + trial only; everything else on disk is garbage. */
    private fun prune(state: JSONObject) {
        val keep = buildSet {
            listOf("active", "pending", "trial").forEach { add(state.optString(it)) }
        }.filter { it.isNotEmpty() }.toSet()
        bundlesDir.listFiles()?.forEach { if (it.name !in keep) it.deleteRecursively() }
    }

    companion object {
        const val MAX_BUNDLE_BYTES = 32L * 1024 * 1024
    }
}
