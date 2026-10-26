package org.pomelo.lynx.log

import android.content.Context
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.tasm.behavior.LynxContext

/**
 * Lynx native module `NativeModules.PomeloLog` — the Android twin of
 * `PomeloLogModule.swift`: JS-facing store methods plus the
 * `PomeloLog.append` push event (150 ms batches from `LogStore`).
 *
 * The module instance that is created last installs the sink, matching the iOS
 * "newest context owns delivery" rule (a reloaded page must not be fed by a
 * stale `LynxContext`).
 */
class PomeloLogModule(context: Context) : LynxModule(context) {
    init {
        LogStore.setSink { json ->
            val params = JavaOnlyArray()
            params.pushString(json)
            (mContext as? LynxContext)?.sendGlobalEvent("PomeloLog.append", params)
        }
    }

    @LynxMethod
    fun append(entriesJson: String) {
        LogStore.appendFromJS(entriesJson)
    }

    @LynxMethod
    fun getRecent(limit: Int, callback: Callback) {
        LogStore.recent(limit) { callback.invoke(it) }
    }

    @LynxMethod
    fun setPushEnabled(enabled: Boolean) {
        LogStore.setPushEnabled(enabled)
    }

    @LynxMethod
    fun setLevel(level: String, callback: Callback) {
        LogStore.setLevel(level)
        callback.invoke(LogStore.levelName)
    }

    @LynxMethod
    fun getLevel(callback: Callback) {
        callback.invoke(LogStore.levelName)
    }

    @LynxMethod
    fun setRetentionDays(days: Int, callback: Callback) {
        LogStore.setRetention(days)
        callback.invoke(LogStore.retention)
    }

    @LynxMethod
    fun getRetentionDays(callback: Callback) {
        callback.invoke(LogStore.retention)
    }

    @LynxMethod
    fun shareRecent(limit: Int, callback: Callback) {
        LogStore.shareRecent(limit) { callback.invoke(it) }
    }
}
