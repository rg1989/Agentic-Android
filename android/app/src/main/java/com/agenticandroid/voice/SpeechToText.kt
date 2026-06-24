// UNVERIFIED in this environment — no Kotlin toolchain present; faithfully mirrors DESIGN.md Q12.
package com.agenticandroid.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * SpeechToText — on-device-by-default STT wrapper (Q12).
 *
 * Uses Android's built-in [SpeechRecognizer], which routes to the on-device model when network
 * is unavailable and (on Pixel / supported OEMs) can be forced on-device via
 * EXTRA_PREFER_OFFLINE = true.  The [Backend] interface is the cloud-pluggable seam (Q12:
 * "pluggable to cloud STT").
 *
 * Half-duplex (v1): caller must call [stop] or [cancel] before calling [start] again.  The
 * controller ([VoiceController]) enforces this sequencing.
 *
 * Thread safety: all SpeechRecognizer calls MUST happen on the main thread (Android constraint).
 * [VoiceController] dispatches accordingly.  Callbacks are delivered on the main thread.
 *
 * TODO: add a real on-device-only fallback using the Whisper.cpp Android JNI binding if the
 *       platform recognizer is unavailable or forced-cloud by the OEM.
 */
class SpeechToText(
    private val context: Context,
    /** Called with the transcribed text when recognition completes. */
    private val onResult: (text: String) -> Unit,
    /** Called when recognition fails; the caller (VoiceController) decides whether to retry. */
    private val onError: (code: Int) -> Unit = {},
    private val backend: Backend = PlatformBackend(),
) {
    /** Swap point: replace with a cloud or local Whisper runner. */
    interface Backend {
        /** Start a single-utterance recognition pass. Call [onResult]/[onError] exactly once. */
        fun start(context: Context, onResult: (String) -> Unit, onError: (Int) -> Unit)
        fun stop()
        fun cancel()
    }

    fun start() = backend.start(context, onResult, onError)
    fun stop()  = backend.stop()
    fun cancel() = backend.cancel()
}

/**
 * Default backend — Android platform SpeechRecognizer, on-device model preferred.
 *
 * Must be created and used on the main thread.
 */
class PlatformBackend : SpeechToText.Backend {
    private var recognizer: SpeechRecognizer? = null

    override fun start(
        context: Context,
        onResult: (String) -> Unit,
        onError: (Int) -> Unit,
    ) {
        val sr = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = sr
        sr.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle) {
                val matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val text = matches?.firstOrNull().orEmpty()
                onResult(text)
                sr.destroy()
                recognizer = null
            }

            override fun onError(error: Int) {
                onError(error)
                sr.destroy()
                recognizer = null
            }

            // Unused RecognitionListener lifecycle callbacks — required by the interface.
            override fun onReadyForSpeech(params: Bundle) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle) {}
            override fun onEvent(eventType: Int, params: Bundle) {}
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            // Request on-device recognition when available (Android 13+; silently ignored before).
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        sr.startListening(intent)
    }

    override fun stop()   { recognizer?.stopListening() }
    override fun cancel() { recognizer?.cancel(); recognizer?.destroy(); recognizer = null }
}
