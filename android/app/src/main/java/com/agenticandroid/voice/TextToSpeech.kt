// UNVERIFIED in this environment — no Kotlin toolchain present; faithfully mirrors DESIGN.md Q12.
package com.agenticandroid.voice

import android.content.Context
import android.os.Bundle
import android.speech.tts.TextToSpeech as AndroidTTS
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * TextToSpeech — on-device-by-default TTS wrapper (Q12).
 *
 * Wraps Android's [android.speech.tts.TextToSpeech] (on-device, privacy-preserving) with the same
 * [Backend] seam pattern as [SpeechToText] so a cloud voice (ElevenLabs, etc.) can be plugged in
 * later without changing [VoiceController] or the capability layer.
 *
 * Half-duplex (v1): [speak] is fire-and-forget; [onDone] fires when the utterance finishes so
 * [VoiceController] can re-enable the wake-word detector and release the half-duplex lock.
 *
 * Lifecycle: call [init] once (asynchronous; waits for the platform engine to initialise) before
 * calling [speak].  Call [shutdown] when the owning service is destroyed.
 *
 * TODO: support SSML / voice selection for richer output.
 * TODO: add volume/pitch/rate controls configurable by the agent via params.
 */
class TextToSpeech(
    private val context: Context,
    private val backend: Backend = PlatformTtsBackend(),
) {
    /** Swap point for a cloud or ONNX TTS engine. */
    interface Backend {
        fun init(context: Context, onReady: (success: Boolean) -> Unit)
        /** Speak [text]; call [onDone] when the utterance completes or errors. */
        fun speak(text: String, onDone: () -> Unit)
        /** Stop the current utterance immediately (barge-in), keeping the engine alive. */
        fun stop()
        fun shutdown()
    }

    fun init(onReady: (Boolean) -> Unit) = backend.init(context, onReady)
    fun speak(text: String, onDone: () -> Unit = {}) = backend.speak(text, onDone)
    fun stop() = backend.stop()
    fun shutdown() = backend.shutdown()
}

/** Default backend — Android platform TTS engine (on-device). */
class PlatformTtsBackend : TextToSpeech.Backend {
    private var tts: AndroidTTS? = null
    private var ready = false

    override fun init(context: Context, onReady: (Boolean) -> Unit) {
        tts = AndroidTTS(context) { status ->
            ready = status == AndroidTTS.SUCCESS
            if (ready) {
                tts?.language = Locale.getDefault()
            }
            onReady(ready)
        }
    }

    override fun speak(text: String, onDone: () -> Unit) {
        val engine = tts ?: run { onDone(); return }
        if (!ready) { onDone(); return }

        // Apply the user's rate/pitch fresh each time, so a change in Settings takes effect immediately.
        engine.setSpeechRate(com.agenticandroid.SettingsStore.ttsRate.value)
        engine.setPitch(com.agenticandroid.SettingsStore.ttsPitch.value)

        val utteranceId = "utt_${System.currentTimeMillis()}"
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String) {}
            override fun onDone(utteranceId: String) = onDone()
            @Deprecated("Deprecated in API level 21", ReplaceWith(""))
            override fun onError(utteranceId: String) = onDone()
        })

        engine.speak(text, AndroidTTS.QUEUE_FLUSH, Bundle(), utteranceId)
    }

    override fun stop() { tts?.stop() }

    override fun shutdown() {
        tts?.stop()
        tts?.shutdown()
        tts = null
        ready = false
    }
}
