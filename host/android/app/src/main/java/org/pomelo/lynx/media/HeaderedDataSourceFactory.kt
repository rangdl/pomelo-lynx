package org.pomelo.lynx.media

import android.content.Context
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * 为带鉴权头(Songloft/Navidrome)的音频源构造 DataSource 工厂。
 *
 * 项目已依赖 OkHttp(lynx-service-http 用它背 `fetch`),这里复用同一栈,
 * 避免混用两个 HTTP 客户端。普通源(无头)由调用方直接用 ExoPlayer 默认
 * 工厂,不经过这里。
 */
class HeaderedDataSourceFactory(
    context: Context,
    headers: Map<String, String>,
) : androidx.media3.datasource.DataSource.Factory {

    private val httpDataSourceFactory: OkHttpDataSource.Factory =
        OkHttpDataSource.Factory(
            OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(20, TimeUnit.SECONDS)
                .build(),
        ).setDefaultRequestProperties(headers)

    private val baseFactory = DefaultDataSource.Factory(
        context,
        httpDataSourceFactory,
    )

    override fun createDataSource(): androidx.media3.datasource.DataSource =
        baseFactory.createDataSource()
}
