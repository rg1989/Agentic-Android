package com.agenticandroid

import android.media.AudioManager
import android.media.ToneGenerator

/**
 * Short UI chimes for the voice flow, using system tones (no audio assets). Each state gets a
 * distinct tone. Muted when SettingsStore.chimes is off. Create once; release() when done.
 */
class Chimes {
    private val tg = runCatching { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80) }.getOrNull()

    private fun soft() = SettingsStore.chimeStyle.value == "soft"

    /** Mic opened — start speaking. */
    fun listening() = play(if (soft()) ToneGenerator.TONE_CDMA_PIP else ToneGenerator.TONE_PROP_BEEP)
    /** Got your speech / message sent. */
    fun sent() = play(if (soft()) ToneGenerator.TONE_CDMA_CONFIRM else ToneGenerator.TONE_PROP_ACK)
    /** Nothing heard / error. */
    fun error() = play(if (soft()) ToneGenerator.TONE_CDMA_SOFT_ERROR_LITE else ToneGenerator.TONE_PROP_NACK)
    /** Wake phrase recognized — "I heard you, go ahead." A double beep, distinct from button listening. */
    fun wakeHeard() = play(if (soft()) ToneGenerator.TONE_CDMA_ABBR_ALERT else ToneGenerator.TONE_PROP_BEEP2, 180)
    /** Wake capture finished / command sent — a distinct end-of-capture tone (not the generic sent ack). */
    fun wakeDone() = play(if (soft()) ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD else ToneGenerator.TONE_PROP_PROMPT, 200)

    private fun play(tone: Int, durationMs: Int = 150) {
        if (!SettingsStore.chimes.value) return
        runCatching { tg?.startTone(tone, durationMs) }
    }

    fun release() { runCatching { tg?.release() } }
}
