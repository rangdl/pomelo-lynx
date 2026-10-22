package org.pomelo.lynx

import android.content.Context
import com.lynx.tasm.provider.AbsTemplateProvider
import java.io.ByteArrayOutputStream
import java.io.IOException
import org.pomelo.lynx.updater.BundleUpdates

/**
 * Reads a Lynx template bundle from the APK's assets — copied from the
 * official KotlinEmptyProject demo (via songloft-player-lynx) with one
 * addition: the hot-update selection hook. `uri` is the asset path, e.g.
 * "main.lynx.bundle" or "probe.lynx.bundle".
 *
 * Load order per launch:
 *   1. `BundleUpdates.beginLaunch()` — a downloaded update that is pending
 *      trial (or an active one) if the disk state says so.
 *   2. Fall back to the embedded assets bundle — always available, the
 *      rollback floor.
 *
 * The launch-failure wiring (onLoadFailed / fatal LynxError in MainActivity)
 * calls `failStartup()`, so a bad update is skipped on the next process.
 */
class HostTemplateProvider(context: Context) : AbsTemplateProvider() {

    private val appContext: Context = context.applicationContext

    override fun loadTemplate(uri: String, callback: Callback) {
        Thread {
            try {
                if (uri == MAIN_BUNDLE) {
                    val update = BundleUpdates.get(appContext)
                    val candidate = try {
                        update?.beginLaunch()
                    } catch (_: Exception) {
                        runCatching { update?.failStartup() }
                        null
                    }
                    if (candidate != null) {
                        callback.onSuccess(candidate)
                        return@Thread
                    }
                }
                appContext.assets.open(uri).use { inputStream ->
                    ByteArrayOutputStream().use { out ->
                        val buffer = ByteArray(1024)
                        var length: Int
                        while (inputStream.read(buffer).also { length = it } != -1) {
                            out.write(buffer, 0, length)
                        }
                        callback.onSuccess(out.toByteArray())
                    }
                }
            } catch (e: IOException) {
                callback.onFailed(e.message)
            }
        }.start()
    }

    companion object {
        const val MAIN_BUNDLE = "main.lynx.bundle"
        const val PROBE_BUNDLE = "probe.lynx.bundle"
    }
}
