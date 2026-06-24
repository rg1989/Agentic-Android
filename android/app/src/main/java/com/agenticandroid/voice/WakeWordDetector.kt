// UNVERIFIED in this environment — no Kotlin toolchain present; faithfully mirrors DESIGN.md Q12.
package com.agenticandroid.voice

import android.content.Context
import android.content.Intent

/**
 * WakeWordDetector — on-device wake-word interface (Q12).
 *
 * Abstracts over Porcupine (ai.picovoice:porcupine-android) or openWakeWord (ONNX runner), both of
 * which run fully on-device and never send audio off the phone.  The concrete engine is swapped by
 * supplying a different [Engine] implementation; [PorcupineEngine] below is the stub that shows how
 * real wiring would look.
 *
 * Hard-mute: [micMuted] mirrors PhoneAgentService.micMuted (the flag lives in the service so it
 * survives config changes; we read it via a lambda to avoid a service reference here).  When muted
 * the detector audio loop still runs but [onWakeWord] is never fired — the mic indicator MUST remain
 * visible (per Q12 "visible mic indicator + hard mute") so the user always knows the mic is live.
 *
 * Mic-indicator hook: [onMicActive] is called whenever the listening state changes so the foreground
 * service notification (or any observer) can update the indicator.  The service is notified via the
 * ACTION_MIC_STATE broadcast (same action the service already watches; we emit it here, not edit the
 * service).
 *
 * TODO: wire a real Porcupine/openWakeWord engine; see [PorcupineEngine] stub below.
 * TODO: request RECORD_AUDIO permission before calling [start] (permission already declared in the
 *       manifest per the contract; just-in-time prompt lives in MainActivity/PhoneAgentService).
 */
class WakeWordDetector(
    private val context: Context,
    /** Called on the engine's internal thread when a wake word is detected (and not muted). */
    private val onWakeWord: () -> Unit,
    /** Called whenever listening state changes (true = mic open, false = stopped). */
    private val onMicActive: (active: Boolean) -> Unit = {},
    /** Returns the current hard-mute state (read from PhoneAgentService or equivalent). */
    private val isMuted: () -> Boolean = { false },
    private val engine: Engine = NoOpEngine(),
) {
    /** Swap point: implement this to wire Porcupine or openWakeWord. */
    interface Engine {
        /** Start listening; call [wakeCallback] each time a keyword fires. Must be non-blocking. */
        fun start(wakeCallback: () -> Unit)
        fun stop()
    }

    private var running = false

    fun start() {
        if (running) return
        running = true
        broadcastMicState(active = true)
        onMicActive(true)
        engine.start {
            // Engine fires on its own thread; check mute before propagating.
            if (!isMuted()) {
                onWakeWord()
            }
            // Even when muted the mic is technically open — indicator stays on (Q12).
        }
    }

    fun stop() {
        if (!running) return
        running = false
        engine.stop()
        onMicActive(false)
        broadcastMicState(active = false)
    }

    /** Broadcast mirrors the PhoneAgentService mic-indicator contract without editing the service. */
    private fun broadcastMicState(active: Boolean) {
        val intent = Intent(ACTION_MIC_STATE).putExtra(EXTRA_MIC_ACTIVE, active)
        context.sendBroadcast(intent)
    }

    companion object {
        /** Same action the service watches for mic-indicator updates. */
        const val ACTION_MIC_STATE = "com.agenticandroid.MIC_STATE"
        const val EXTRA_MIC_ACTIVE = "mic_active"
    }
}

/**
 * No-op engine — used in tests and scaffolding; never fires the wake callback.
 * TODO: replace with [PorcupineEngine] (or an openWakeWord ONNX runner) before shipping.
 */
class NoOpEngine : WakeWordDetector.Engine {
    override fun start(wakeCallback: () -> Unit) { /* no-op */ }
    override fun stop() { /* no-op */ }
}

/**
 * Porcupine engine stub — shows the real wiring shape.
 *
 * Dependency (add to app/build.gradle.kts):
 *   implementation("ai.picovoice:porcupine-android:3.0.1")
 *
 * TODO: supply a real accessKey from https://console.picovoice.ai/ (free tier available).
 * TODO: bundle a .ppn keyword file in assets/ or use the built-in "hey siri"-class keywords.
 *
 *   class PorcupineEngine(
 *       private val context: Context,
 *       private val accessKey: String,
 *       private val keywordPath: String = "hey_android.ppn",
 *   ) : WakeWordDetector.Engine {
 *       private var porcupine: Porcupine? = null
 *       private var recorder: AudioRecord? = null
 *       private var listenerThread: Thread? = null
 *
 *       override fun start(wakeCallback: () -> Unit) {
 *           porcupine = Porcupine.Builder()
 *               .setAccessKey(accessKey)
 *               .setKeywordPath("$keywordPath")
 *               .build(context)
 *           // create AudioRecord, spin a thread, feed frames to porcupine.process(), call wakeCallback
 *           // on match — standard Porcupine Android integration pattern.
 *       }
 *       override fun stop() { porcupine?.delete(); recorder?.stop() }
 *   }
 */
