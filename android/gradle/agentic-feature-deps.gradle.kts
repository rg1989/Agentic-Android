// UNVERIFIED — no Kotlin/Gradle toolchain in this environment; coordinates are current-stable as of 2026-06.
//
// Standalone Gradle script: centralized extra dependencies for the Agentic-Android feature units.
// Apply in app/build.gradle.kts with:
//     apply(from = "../gradle/agentic-feature-deps.gradle.kts")
// (or copy the coordinates into the dependencies { } block directly).
// That wiring edit is intentionally deferred to the build-file owner to keep this plan file-disjoint.
//
// The lazysodium / okhttp / kotlinx-serialization deps that already live in app/build.gradle.kts
// are NOT repeated here — they stay there untouched.

dependencies {

    // -------------------------------------------------------------------------
    // kt-tier1-providers  (FusedLocationProviderClient → play-services-location)
    // -------------------------------------------------------------------------

    // Fused Location API — used by LocationProvider in kt-tier1-providers to
    // obtain lat/lon with minimal battery drain.
    "implementation"("com.google.android.gms:play-services-location:21.3.0")

    // -------------------------------------------------------------------------
    // kt-tier1-providers + kt-pairing-confirmer-storage
    // (camera2 frame capture; QR-code decode for pairing handshake)
    // -------------------------------------------------------------------------

    // CameraX core runtime — lifecycle-aware camera session management.
    "implementation"("androidx.camera:camera-core:1.4.2")

    // CameraX Camera2 backend — actual camera2 HAL binding.
    "implementation"("androidx.camera:camera-camera2:1.4.2")

    // CameraX lifecycle extension — ties camera session to Activity/Fragment lifecycle.
    "implementation"("androidx.camera:camera-lifecycle:1.4.2")

    // ZXing Android Embedded — QR-code scanning used during pairing handshake
    // (kt-pairing-confirmer-storage: decodes the bridge QR payload
    // {bridge_pubkey, relay_url, token}).
    // Alternative: ML Kit barcode-scanning ("com.google.mlkit:barcode-scanning:17.3.0")
    // but ZXing avoids the Play Services dependency and works fully offline.
    "implementation"("com.journeyapps:zxing-android-embedded:4.3.0")

    // -------------------------------------------------------------------------
    // kt-pairing-confirmer-storage
    // (EncryptedSharedPreferences for persistent keypair + trusted-fingerprint store)
    // -------------------------------------------------------------------------

    // Jetpack Security-Crypto — EncryptedSharedPreferences backed by Android Keystore.
    // Stores the device ed25519 keypair seed and the set of trusted bridge fingerprints
    // between app restarts.
    "implementation"("androidx.security:security-crypto:1.1.0-alpha06")

    // -------------------------------------------------------------------------
    // kt-pairing-confirmer-storage
    // (BiometricPrompt — user must approve pairing on the phone screen)
    // -------------------------------------------------------------------------

    // Biometric — shows the "Approve pairing?" BiometricPrompt dialog that gates
    // the TOFU (trust-on-first-use) fingerprint acceptance step in kt-pairing.
    "implementation"("androidx.biometric:biometric:1.2.0-alpha05")

    // -------------------------------------------------------------------------
    // kt-voice  (wake-word detection)
    // -------------------------------------------------------------------------

    // Porcupine Wake Word SDK (Picovoice) — on-device, low-power keyword spotting.
    // Triggers the phone→agent voice channel without requiring a persistent mic stream.
    // Add your Picovoice access key in local.properties: picovoice.access_key=<key>
    // TODO(device-wiring): copy the .ppn keyword model file into app/src/main/assets/
    //   and initialise PorcupineManager in VoiceModule with that asset path.
    "implementation"("ai.picovoice:porcupine-android:3.0.2")

    // TextToSpeech + SpeechRecognizer (speak / stt actions for kt-voice):
    //   These are platform APIs (android.speech.tts.TextToSpeech,
    //   android.speech.SpeechRecognizer) — no Maven dependency needed.
    //   They are available on every Android device and require only the
    //   RECORD_AUDIO permission (already declared in the manifest).
}
