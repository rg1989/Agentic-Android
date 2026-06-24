# Android app — scaffold

> **Status: UNVERIFIED in this environment.** Built without an Android toolchain (no `kotlinc`, no
> Gradle, no SDK, no device). The code faithfully mirrors the **tested** TypeScript backbone, but it
> has **not been compiled or run**. Treat it as a precise starting point, not a finished app.

## What's here

A native Kotlin/Compose project mirroring the backbone spine 1:1:

| File | Mirrors | Notes |
|---|---|---|
| `Protocol.kt` | `backbone/src/protocol.ts` | Envelope + 4 inner kinds, kotlinx.serialization |
| `Crypto.kt` | `backbone/src/crypto.ts` | ed25519 identity → curve25519 box, via Lazysodium |
| `BusEndpoint.kt` | `backbone/src/peer.ts` | OkHttp WebSocket + correlation + blobs |
| `Consent.kt` | consent logic in `phone-sim.ts` | **JVM-unit-tested** in `ConsentTest.kt` |
| `Capabilities.kt` | capability registry in `phone-sim.ts` | Tier-1 providers (stubs to wire to camera2/location/SMS) |
| `PhoneAgentService.kt` | the phone half | Foreground service holding the connection |
| `WakeMessagingService.kt` | FCM doorbell | wakes the service on a push |
| `MainActivity.kt` | UI swap point | minimal Compose status/pair/mute |

## To build (needs a real toolchain)

1. **JDK 17 or 21** (NOT the JDK 25 on this machine — AGP doesn't support 25 yet).
2. **Android Studio** (Ladybug+) or `sdkmanager` SDK with **platform 35** + build-tools.
3. Add `google-services.json` (Firebase) for FCM, or stub out `WakeMessagingService` to build without it.
4. `cd android && ./gradlew :app:assembleDebug` (generate the Gradle wrapper from Android Studio first).
5. Sideload: `adb install app/build/outputs/apk/debug/app-debug.apk` — **not** Play Store (Tier-2
   Accessibility automation violates Play policy; sideload is the intended channel, Q11).

Run the one verifiable test now: `./gradlew :app:testDebugUnitTest` → `ConsentTest`.

## CRITICAL interop note

All base64 on the wire MUST be **URL-safe, no padding** to match libsodium-wrappers' default on the
TS side. `Crypto.kt` uses `Base64.getUrlEncoder().withoutPadding()`. If you change it, the phone and
agent can't decrypt each other. Verify with a round-trip test against the backbone before anything else.

## TODO checklist (to a working app)

- [ ] Verify Lazysodium 5.1 method signatures (`Crypto.kt` is written against its stable API but unverified).
- [ ] Pairing (Q5): QR scan → store `Identity` + peer key in `EncryptedSharedPreferences` (`Pairing` stub).
- [ ] `Confirmer` (Q8): high-priority notification + `BiometricPrompt` for `ask` capabilities.
- [ ] Just-in-time OS permission requests on first capability use.
- [ ] Tier-1 providers: camera2 capture → `putBlob`, FusedLocation, SmsManager, notifications.
- [ ] Voice (Q12): on-device wake word (Porcupine/openWakeWord) + STT/TTS at the edge → `user_message` event / `speak` action.
- [ ] Tier-2 (next milestone): `AccessibilityService` + `MediaProjection` computer-use providers.
