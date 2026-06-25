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

    val theme = MutableStateFlow("system")
    val disabledCaps = MutableStateFlow<Set<String>>(emptySet())
    val chimes = MutableStateFlow(true)
    val voiceReplies = MutableStateFlow(true) // default on — the user asked for spoken replies

    private var prefs: android.content.SharedPreferences? = null

    fun init(ctx: Context) {
        if (prefs != null) return
        val p = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs = p
        theme.value = p.getString(KEY_THEME, "system") ?: "system"
        disabledCaps.value = p.getStringSet(KEY_DISABLED, emptySet())?.toSet() ?: emptySet()
        chimes.value = p.getBoolean(KEY_CHIMES, true)
        voiceReplies.value = p.getBoolean(KEY_VOICE, true)
    }

    fun setVoiceReplies(on: Boolean) {
        voiceReplies.value = on
        prefs?.edit()?.putBoolean(KEY_VOICE, on)?.apply()
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
