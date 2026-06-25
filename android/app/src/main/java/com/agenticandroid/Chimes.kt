package com.agenticandroid

import android.media.AudioManager
import android.media.ToneGenerator

/**
 * Short UI chimes for the voice flow, using system tones (no audio assets). Each state gets a
 * distinct tone. Muted when SettingsStore.chimes is off. Create once; release() when done.
 */
class Chimes {
    private val tg = runCatching { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80) }.getOrNull()

    /** Mic opened — start speaking. */
    fun listening() = play(ToneGenerator.TONE_PROP_BEEP)
    /** Got your speech / message sent. */
    fun sent() = play(ToneGenerator.TONE_PROP_ACK)
    /** Nothing heard / error. */
    fun error() = play(ToneGenerator.TONE_PROP_NACK)

    private fun play(tone: Int) {
        if (!SettingsStore.chimes.value) return
        runCatching { tg?.startTone(tone, 150) }
    }

    fun release() { runCatching { tg?.release() } }
}
