package org.pomelo.lynx

import android.app.Application
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.imagepipeline.core.ImagePipelineConfig
import com.facebook.imagepipeline.memory.PoolConfig
import com.facebook.imagepipeline.memory.PoolFactory
import com.lynx.service.devtool.LynxDevToolService
import com.lynx.service.image.LynxImageService
import com.lynx.service.log.LynxLogService
import com.lynx.tasm.LynxEnv
import com.lynx.tasm.service.LynxServiceCenter
import org.pomelo.lynx.log.LogStore
import org.pomelo.lynx.log.PomeloLog
import org.pomelo.lynx.log.PomeloLogModule
import org.pomelo.lynx.storage.PomeloStorageModule
import org.pomelo.lynx.updater.PomeloUpdateModule

/**
 * Application entry: initialises the Lynx runtime once, before any LynxView is
 * created. Registration mirrors songloft-player-lynx's SongloftApplication,
 * trimmed to the services this host actually needs:
 * - image → `<image>` (backed by Fresco)
 * - log → engine logging
 * - http → SDK's LynxHttpService backs the bare global `fetch`
 * - devtool (debug builds only) → Lynx Inspector Protocol over WebSocket, so
 *   `agent-lynx` and the e2e/alignment tooling can drive this app exactly like
 *   LynxExplorer.
 */
class HostApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Logging must come up first so the launch chain itself is recorded.
        LogStore.init(this)
        PomeloLog.info("boot", banner())
        initLynxService()
        initLynxEnv()
        PomeloLog.info("boot", "LynxEnv initialised")
    }

    private fun banner(): String =
        "PomeloLynx android ${BuildConfig.VERSION_NAME} Android ${android.os.Build.VERSION.RELEASE}" +
            " (${android.os.Build.MODEL})"

    private fun initLynxService() {
        // Fresco backs LynxImageService; initialise it first.
        val factory = PoolFactory(PoolConfig.newBuilder().build())
        val builder = ImagePipelineConfig.newBuilder(applicationContext).setPoolFactory(factory)
        Fresco.initialize(applicationContext, builder.build())

        LynxServiceCenter.inst().registerService(LynxImageService.getInstance())
        LynxServiceCenter.inst().registerService(LynxLogService)
        if (BuildConfig.DEBUG) {
            LynxServiceCenter.inst().registerService(LynxDevToolService.INSTANCE)
            LynxDevToolService.INSTANCE.devtoolEnvInit(this)
            LynxDevToolService.INSTANCE.lynxDebugPresetValue = true
        }
    }

    private fun initLynxEnv() {
        LynxEnv.inst().init(this, null, null, null)
        LynxEnv.inst().enableDevtool(BuildConfig.DEBUG)
        LynxEnv.inst().enableLynxDebug(BuildConfig.DEBUG)
        // Hot-update module: JS calls `NativeModules.PomeloUpdate.*` and listens
        // for `PomeloUpdate.progress` global events (see src/core/updater/).
        LynxEnv.inst().registerModule("PomeloUpdate", PomeloUpdateModule::class.java)
        // Persistent key/value storage (SharedPreferences), exposed as
        // `NativeModules.PomeloStorage`; the update on/off preference survives
        // process restarts (see src/core/storage/).
        LynxEnv.inst().registerModule("PomeloStorage", PomeloStorageModule::class.java)
        // Log store: `NativeModules.PomeloLog.*` + `PomeloLog.append` global
        // events (see src/core/log/ and src/features/settings/LogsPage).
        LynxEnv.inst().registerModule("PomeloLog", PomeloLogModule::class.java)
    }
}
