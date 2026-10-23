import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.jetbrains.kotlin.android)
}

// package.json version feeds versionName so JS bundle and APK stay in lockstep.
val packageVersion =
    (JsonSlurper().parse(rootProject.file("../../package.json")) as Map<*, *>)["version"].toString()

// versionCode must increase monotonically across releases; derive it from the
// same semver so bumping package.json (pnpm release:patch/minor/major) is the
// only manual step. 1.2.3 → 10203.
val packageVersionCode =
    packageVersion
        .split(".")
        .map { it.takeWhile { ch -> ch.isDigit() }.toIntOrNull() ?: 0 }
        .let { (it + listOf(0, 0, 0)).take(3) }
        .let { (major, minor, patch) -> major * 10000 + minor * 100 + patch }

android {
    namespace = "org.pomelo.lynx"
    compileSdk = 34

    defaultConfig {
        applicationId = "org.pomelo.lynx"
        minSdk = 21
        targetSdk = 34
        versionCode = packageVersionCode
        versionName = packageVersion
    }

    // BuildConfig.DEBUG gates the DevTool service registration (debug builds
    // only) — AGP 8 no longer generates BuildConfig by default.
    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        debug {
            // 本地调试包与 CI 发版包共存:org.pomelo.lynx.debug vs org.pomelo.lynx
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
            // CI 没有正式 keystore;用 debug keystore 签名,产物可直接侧载。
            // 这只用于内部测试,不能用于应用商店发布。
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    packaging {
        jniLibs {
            // Android 5/6 need native libraries extracted before loading them.
            // Keep the legacy mode explicit while minSdk remains below 23.
            useLegacyPackaging = true
        }
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)

    // ---- Lynx SDK (coordinates copied from songloft-player-lynx, itself from
    // the official integrating-lynx-demo-projects KotlinEmptyProject) ----
    implementation("org.lynxsdk.lynx:lynx:4.0.0")
    implementation("org.lynxsdk.lynx:lynx-jssdk:4.0.0")
    implementation("org.lynxsdk.lynx:lynx-trace:4.0.0")
    implementation("org.lynxsdk.lynx:primjs:4.0.0")

    // image-service (backs `<image>`); Fresco backs the image-service.
    implementation("org.lynxsdk.lynx:lynx-service-image:4.0.0")
    implementation("com.facebook.fresco:fresco:2.3.0")
    implementation("com.facebook.fresco:animated-gif:2.3.0")
    implementation("com.facebook.fresco:animated-webp:2.3.0")
    implementation("com.facebook.fresco:webpsupport:2.3.0")
    implementation("com.facebook.fresco:animated-base:2.3.0")

    // log-service
    implementation("org.lynxsdk.lynx:lynx-service-log:4.0.0")

    // http-service (backs the bare global `fetch`)
    implementation("org.lynxsdk.lynx:lynx-service-http:4.0.0")
    implementation("com.squareup.okhttp3:okhttp:4.9.0")

    // devtool-service: Lynx Inspector Protocol (WebSocket) — what makes this
    // host usable with `agent-lynx` and the e2e/alignment tooling, exactly like
    // LynxExplorer. debug-router is its transport.
    implementation("org.lynxsdk.lynx:lynx-service-devtool:4.0.0")
    implementation("org.lynxsdk.lynx:debug-router:0.0.20")

    // JVM unit tests for the updater state machine (BundleUpdateStoreTest).
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20180813")

    // XElement family. The probe page uses plain view/text/image/scroller, but
    // `<svg>`/`<input>` are cheap to include so the app page can grow without
    // an APK change.
    implementation("org.lynxsdk.lynx:xelement:4.0.0")
    implementation("org.lynxsdk.lynx:xelement-input:4.0.0")
    implementation("org.lynxsdk.lynx:xelement-svg:4.0.0")
    // 0.1.1 omits x86_64: SVG elements stay blank on that ABI.
    implementation("org.lynxsdk.lynx:servalsvg:0.2.4")

    // okhttp is also the transport for the (stage 4c) update downloader.
    // Declared explicitly so HostUpdateClient can be written against it.
    // (Already pulled transitively by lynx-service-http; pinning the version
    // here keeps that fact visible.)
    // implementation("com.squareup.okhttp3:okhttp:4.9.0") — declared above.
}
