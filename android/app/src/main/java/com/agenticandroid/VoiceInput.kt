package com.agenticandroid

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Hold-to-talk speech-to-text via Android's on-device SpeechRecognizer (no API key, no cloud).
 *
 * The recognizer endpoints on silence — it fires onResults the moment you pause, NOT when you let go.
 * That made recordings cut off mid-sentence. So we run it CONTINUOUSLY: each segment's text is
 * accumulated, and on a natural pause we silently restart listening. Nothing is delivered until you
 * actually release (finish()) — then we send the whole accumulated transcript. cancel() discards it.
 *
 * Create and call on the main thread.
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
    private val main = Handler(Looper.getMainLooper())

    private var listening = false   // user is still holding / locked — keep capturing across pauses
    private var finishing = false   // release requested — deliver the accumulated transcript next
    private val acc = StringBuilder()
    private var restart: Runnable? = null

    init {
        sr?.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                append(results)
                if (listening && !finishing) scheduleRestart() else deliverFinal()
            }
            override fun onPartialResults(partial: Bundle?) {
                val seg = partial?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (seg.isNotEmpty()) onPartial(live(seg))
            }
            override fun onError(error: Int) {
                // A pause with no words just ends a segment — keep going if the user is still holding.
                if (listening && !finishing && (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT)) {
                    scheduleRestart(); return
                }
                if (finishing) { deliverFinal(); return }
                if (!listening) return
                // Real error mid-capture: don't lose what we already heard.
                if (acc.isNotEmpty()) deliverFinal()
                else { reset(); onError(errMsg(error)) }
            }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
    }

    /** Begin capturing. Keeps going through pauses until finish() or cancel(). */
    fun start() {
        acc.clear(); listening = true; finishing = false
        beginSegment()
    }

    /** User released / tapped stop: deliver the full accumulated transcript via onFinal. */
    fun finish() {
        if (!listening) return
        finishing = true
        if (restart != null) { cancelRestart(); deliverFinal(); return } // we're in the gap between segments
        runCatching { sr?.stopListening() } // yields onResults → deliverFinal
    }

    /** Swipe-to-cancel: stop and discard everything, no onFinal. */
    fun cancel() {
        val was = listening || acc.isNotEmpty()
        reset()
        runCatching { sr?.cancel() }
        if (!was) return
    }

    fun destroy() { cancelRestart(); runCatching { sr?.destroy() } }

    private fun beginSegment() {
        cancelRestart()
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            // Be generous about pauses so each segment captures full phrases (hints; some engines ignore).
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 6000L)
        }
        runCatching { sr?.startListening(intent) }
    }

    // Brief gap lets the recognizer settle before the next segment (avoids ERROR_RECOGNIZER_BUSY).
    private fun scheduleRestart() {
        cancelRestart()
        restart = Runnable {
            restart = null
            if (listening && !finishing) beginSegment() else deliverFinal()
        }.also { main.postDelayed(it, 120) }
    }

    private fun cancelRestart() { restart?.let { main.removeCallbacks(it) }; restart = null }

    private fun append(results: Bundle?) {
        val seg = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty().trim()
        if (seg.isNotEmpty()) { if (acc.isNotEmpty()) acc.append(' '); acc.append(seg) }
    }

    private fun deliverFinal() {
        if (!listening && !finishing) return // already delivered / cancelled
        val text = acc.toString().trim()
        reset()
        onFinal(text)
    }

    private fun reset() { cancelRestart(); listening = false; finishing = false; acc.clear() }

    /** Accumulated transcript plus the current in-flight partial, for live display. */
    private fun live(partial: String): String {
        val a = acc.toString().trim()
        return when {
            a.isEmpty() -> partial
            partial.isEmpty() -> a
            else -> "$a $partial"
        }
    }

    private fun errMsg(code: Int) = when (code) {
        SpeechRecognizer.ERROR_NO_MATCH -> "Didn't catch that."
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech heard."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Mic permission needed."
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network error."
        else -> "Voice error ($code)."
    }
}
