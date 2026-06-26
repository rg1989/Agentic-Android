package com.agenticandroid

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * User settings, persisted in SharedPreferences and exposed as StateFlows so the UI reacts live.
 *   theme        — "system" | "light" | "dark"
 *   disabledCaps — capability methods the user has switched OFF; the registry hides + refuses them.
 *
 * A plain object (single process, single user) — init() once from a Context before reading.
 */
object SettingsStore {
    private const val PREFS = "agent_settings"
    private const val KEY_THEME = "theme"
    private const val KEY_DISABLED = "disabled_caps"
    private const val KEY_CHIMES = "chimes"
    private const val KEY_VOICE = "voice_replies"
    private const val KEY_WAKE = "wake_word"
    private const val KEY_WAKE_PHRASE = "wake_phrase"
    private const val KEY_CONNECTION = "connection_enabled"
    private const val KEY_TTS_RATE = "tts_rate"
    private const val KEY_TTS_PITCH = "tts_pitch"
    private const val KEY_WAKE_TIMEOUT = "wake_timeout_sec"
    private const val KEY_WAKE_SENS = "wake_sensitivity"

    val theme = MutableStateFlow("system")
    val disabledCaps = MutableStateFlow<Set<String>>(emptySet())
    val chimes = MutableStateFlow(true)
    val voiceReplies = MutableStateFlow(true) // default on — the user asked for spoken replies
    val wakeWord = MutableStateFlow(false)    // default off — an always-on mic is opt-in
    val wakePhrase = MutableStateFlow("hey agent")
    val connectionEnabled = MutableStateFlow(true) // master on/off for the hub connection (pairing is kept either way)
    val ttsRate = MutableStateFlow(1.0f)  // speech speed multiplier (0.5–2.0); 1.0 = engine default
    val ttsPitch = MutableStateFlow(1.0f) // voice pitch multiplier (0.5–2.0); 1.0 = engine default
    val wakeTimeoutSec = MutableStateFlow(8)     // how long to wait for the command after a bare wake phrase
    val wakeSensitivity = MutableStateFlow(0.5f) // 0 = exact phrase only; higher tolerates Vosk mishears

    private var prefs: android.content.SharedPreferences? = null

    fun init(ctx: Context) {
        if (prefs != null) return
        val p = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs = p
        theme.value = p.getString(KEY_THEME, "system") ?: "system"
        disabledCaps.value = p.getStringSet(KEY_DISABLED, emptySet())?.toSet() ?: emptySet()
        chimes.value = p.getBoolean(KEY_CHIMES, true)
        voiceReplies.value = p.getBoolean(KEY_VOICE, true)
        wakeWord.value = p.getBoolean(KEY_WAKE, false)
        wakePhrase.value = p.getString(KEY_WAKE_PHRASE, "hey agent") ?: "hey agent"
        connectionEnabled.value = p.getBoolean(KEY_CONNECTION, true)
        ttsRate.value = p.getFloat(KEY_TTS_RATE, 1.0f)
        ttsPitch.value = p.getFloat(KEY_TTS_PITCH, 1.0f)
        wakeTimeoutSec.value = p.getInt(KEY_WAKE_TIMEOUT, 8)
        wakeSensitivity.value = p.getFloat(KEY_WAKE_SENS, 0.5f)
    }

    fun setTtsRate(v: Float) {
        ttsRate.value = v
        prefs?.edit()?.putFloat(KEY_TTS_RATE, v)?.apply()
    }

    fun setTtsPitch(v: Float) {
        ttsPitch.value = v
        prefs?.edit()?.putFloat(KEY_TTS_PITCH, v)?.apply()
    }

    fun setWakeTimeoutSec(v: Int) {
        wakeTimeoutSec.value = v
        prefs?.edit()?.putInt(KEY_WAKE_TIMEOUT, v)?.apply()
    }

    fun setWakeSensitivity(v: Float) {
        wakeSensitivity.value = v
        prefs?.edit()?.putFloat(KEY_WAKE_SENS, v)?.apply()
    }

    fun setConnectionEnabled(on: Boolean) {
        connectionEnabled.value = on
        prefs?.edit()?.putBoolean(KEY_CONNECTION, on)?.apply()
    }

    fun setVoiceReplies(on: Boolean) {
        voiceReplies.value = on
        prefs?.edit()?.putBoolean(KEY_VOICE, on)?.apply()
    }

    fun setWakeWord(on: Boolean) {
        wakeWord.value = on
        prefs?.edit()?.putBoolean(KEY_WAKE, on)?.apply()
    }

    fun setWakePhrase(phrase: String) {
        val p = phrase.lowercase() // matching trims/normalizes; don't fight typing here
        wakePhrase.value = p
        prefs?.edit()?.putString(KEY_WAKE_PHRASE, p)?.apply()
    }

    fun setTheme(v: String) {
        theme.value = v
        prefs?.edit()?.putString(KEY_THEME, v)?.apply()
    }

    fun setChimes(on: Boolean) {
        chimes.value = on
        prefs?.edit()?.putBoolean(KEY_CHIMES, on)?.apply()
    }

    fun setEnabled(method: String, enabled: Boolean) {
        val s = disabledCaps.value.toMutableSet()
        if (enabled) s.remove(method) else s.add(method)
        disabledCaps.value = s
        prefs?.edit()?.putStringSet(KEY_DISABLED, s)?.apply()
    }

    /** A capability is available unless the user has switched it off. Safe default: enabled. */
    fun isEnabled(method: String): Boolean = !disabledCaps.value.contains(method)
}
