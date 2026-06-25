plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.gms.google-services")
}

android {
    namespace = "com.agenticandroid"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.agenticandroid"
        minSdk = 29 // Android 10 — covers the foreground-service + camera2 + accessibility APIs we use
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation(platform("androidx.compose:compose-bom:2024.09.02"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.lifecycle:lifecycle-service:2.8.6")

    // transport + serialization + crypto (mirror of the TS backbone)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.goterl:lazysodium-android:5.1.0@aar")
    implementation("net.java.dev.jna:jna:5.14.0@aar")

    // FCM doorbell (wake a backgrounded app)
    implementation(platform("com.google.firebase:firebase-bom:33.3.0"))
    implementation("com.google.firebase:firebase-messaging-ktx")

    // Pairing: QR camera preview + ML Kit barcode scanning
    implementation("androidx.camera:camera-core:1.4.2")
    implementation("androidx.camera:camera-camera2:1.4.2")
    implementation("androidx.camera:camera-lifecycle:1.4.2")
    implementation("androidx.camera:camera-view:1.4.2")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")

    // Pairing: encrypted key store
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Consent: biometric prompt
    implementation("androidx.biometric:biometric:1.2.0-alpha05")

    // Location capability
    implementation("com.google.android.gms:play-services-location:21.3.0")

    // Wake word — offline, on-device speech recognition (Vosk)
    implementation("com.alphacephei:vosk-android:0.3.47")

    testImplementation("junit:junit:4.13.2")
}

// Fetch the Vosk wake-word model into assets if absent (kept out of git; ~40MB). Runs before build.
val voskModelName = "vosk-model-small-en-us-0.15"
val voskModelDir = file("src/main/assets/$voskModelName")
val ensureVoskModel = tasks.register("ensureVoskModel") {
    onlyIf { !voskModelDir.exists() }
    doLast {
        val zip = layout.buildDirectory.file("$voskModelName.zip").get().asFile
        zip.parentFile.mkdirs()
        val assets = file("src/main/assets").apply { mkdirs() }
        ant.withGroovyBuilder {
            "get"("src" to "https://alphacephei.com/vosk/models/$voskModelName.zip", "dest" to zip.absolutePath)
            "unzip"("src" to zip.absolutePath, "dest" to assets.absolutePath)
        }
        // Vosk's StorageService.sync() needs a `uuid` marker the public model zip omits.
        voskModelDir.resolve("uuid").writeText(voskModelName)
    }
}
tasks.named("preBuild") { dependsOn(ensureVoskModel) }
