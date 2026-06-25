package com.agenticandroid

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Hold-to-talk speech-to-text via Android's on-device SpeechRecognizer (no API key, no cloud).
 * Press → start(); release → stop(). onPartial streams interim text live; onFinal delivers the
 * transcript to send. Must be created and called on the main thread.
 */
class VoiceInput(
    context: Context,
    private val onPartial: (String) -> Unit,
    private val onFinal: (String) -> Unit,
    private val onError: (String) -> Unit,
) {
    val available: Boolean = SpeechRecognizer.isRecognitionAvailable(context)
    private val sr: SpeechRecognizer? =
        if (available) SpeechRecognizer.createSpeechRecognizer(context) else null

    init {
        sr?.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                onFinal(results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty())
            }
            override fun onPartialResults(partial: Bundle?) {
                val text = partial?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (text.isNotEmpty()) onPartial(text)
            }
            override fun onError(error: Int) { onError(errMsg(error)) }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
    }

    fun start() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        }
        runCatching { sr?.startListening(intent) }
    }

    fun stop() { runCatching { sr?.stopListening() } }
    fun destroy() { runCatching { sr?.destroy() } }

    private fun errMsg(code: Int) = when (code) {
        SpeechRecognizer.ERROR_NO_MATCH -> "Didn't catch that."
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech heard."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Mic permission needed."
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network error."
        else -> "Voice error ($code)."
    }
}
