// UNVERIFIED in this environment — no Kotlin toolchain present; faithfully mirrors DESIGN.md Q12.
package com.agenticandroid.voice

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.agenticandroid.Inner
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * VoiceController — orchestrates the on-device voice pipeline (Q12).
 *
 * Flow:
 *   wake word detected
 *     → WakeWordDetector fires onWakeWord
 *     → half-duplex lock acquired (ignore further wake words until done)
 *     → SpeechToText.start()
 *     → on transcript: emitEvent("user_message", {text}) — identical to phone-sim.ts emitUserMessage()
 *     → half-duplex released; wake word re-armed
 *
 * Inbound speak action:
 *   onEvent("speak") received from the bus
 *     → TextToSpeech.speak(params["text"])
 *     → half-duplex lock held for the utterance duration
 *     → half-duplex released; wake word re-armed
 *
 * Bus seam: the controller takes [emitEvent] and [onEventSubscribe] lambdas instead of a direct
 * BusEndpoint reference so it compiles and is testable independently of the bus, and so it does NOT
 * register into PhoneAgentService (per the contract).  Wire it in the service or Activity:
 *
 *   val vc = VoiceController(
 *       context = this,
 *       emitEvent = { topic, data -> bus.event(topic, data) },
 *       onEventSubscribe = { handler -> bus.onEvent = handler },
 *       isMuted = { micMuted },
 *   )
 *
 * Thread model: SpeechRecognizer requires the main thread; all STT calls are dispatched there via
 * [mainHandler].  TTS and wake-word callbacks happen on their own threads but are safe to touch
 * internal [halfDuplexLocked] (volatile) from any thread.
 */
class VoiceController(
    private val context: Context,
    /**
     * Emit a bus event — wire to BusEndpoint.event().
     * Mirrors phone-sim.ts: bus.event("user_message", { text }) — topic + JsonObject payload.
     */
    private val emitEvent: (topic: String, data: JsonObject) -> Unit,
    /**
     * Subscribe to inbound bus events — wire to (bus.onEvent = handler).
     * VoiceController installs itself to handle "speak" actions delivered as events.
     */
    private val onEventSubscribe: ((Inner.Event) -> Unit) -> Unit,
    /** Returns the current hard-mute flag (read from PhoneAgentService.micMuted or equivalent). */
    private val isMuted: () -> Boolean = { false },
    wakeWordEngine: WakeWordDetector.Engine = NoOpEngine(),
    sttBackend: SpeechToText.Backend = PlatformBackend(),
    ttsBackend: TextToSpeech.Backend = PlatformTtsBackend(),
) {
    @Volatile private var halfDuplexLocked = false
    private val mainHandler = Handler(Looper.getMainLooper())

    private val tts = TextToSpeech(context, ttsBackend)

    private val stt = SpeechToText(
        context = context,
        onResult = { text -> onTranscript(text) },
        onError = { _ -> releaseLock() }, // on error, re-arm without emitting
        backend = sttBackend,
    )

    private val wakeWord = WakeWordDetector(
        context = context,
        onWakeWord = { onWakeWord() },
        isMuted = isMuted,
        engine = wakeWordEngine,
    )

    /** Start the voice layer: initialise TTS, arm the wake-word detector, subscribe to speak events. */
    fun start() {
        tts.init { /* TTS ready; nothing to do — it's used lazily */ }
        wakeWord.start()
        onEventSubscribe { event -> if (event.topic == "speak") onSpeakEvent(event) }
    }

    fun stop() {
        wakeWord.stop()
        mainHandler.post { stt.cancel() }
        tts.shutdown()
    }

    // ---- inbound: wake word → STT → user_message event --------------------------------

    private fun onWakeWord() {
        if (halfDuplexLocked) return // ignore while speaking or already transcribing
        halfDuplexLocked = true
        mainHandler.post { stt.start() } // SpeechRecognizer must run on the main thread
    }

    private fun onTranscript(text: String) {
        if (text.isNotBlank()) {
            // Mirrors phone-sim.ts PhoneSim.emitUserMessage():
            //   this.bus.event("user_message", { text });
            emitEvent("user_message", buildJsonObject { put("text", text) })
        }
        releaseLock()
    }

    // ---- inbound: speak event → TTS ---------------------------------------------------

    /**
     * Handle a "speak" event delivered by the bus.  The agent sends this as an Event (not a
     * Request) on the path: agent reply → bridge → relay → phone bus → VoiceController.
     * The SpeakCapability below handles the Request→TTS path for round-trip action requests.
     */
    private fun onSpeakEvent(event: Inner.Event) {
        val text = (event.data["text"] as? JsonPrimitive)?.content ?: return
        acquireLockAndSpeak(text)
    }

    private fun acquireLockAndSpeak(text: String) {
        halfDuplexLocked = true
        wakeWord.stop() // suppress wake-word detection while speaking
        tts.speak(text) {
            // onDone: re-arm the detector
            wakeWord.start()
            releaseLock()
        }
    }

    private fun releaseLock() {
        halfDuplexLocked = false
    }
}
