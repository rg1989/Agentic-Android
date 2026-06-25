package com.agenticandroid

/**
 * Pure wake-phrase matching for the Vosk wake-word service. Given a recognized transcript and the
 * configured wake phrase, returns the command spoken *after* the phrase:
 *   - "hey agent turn on the flashlight" / "hey agent" -> "turn on the flashlight"
 *   - "hey agent"                        / "hey agent" -> "" (wake heard, command will follow)
 *   - "what's the weather"               / "hey agent" -> null (no wake phrase)
 *
 * Matching is lowercase and whitespace-insensitive; a leading filler comma is trimmed.
 */
object WakePhrase {
    fun extract(text: String, phrase: String): String? {
        val t = text.lowercase().trim()
        val p = phrase.lowercase().trim()
        if (p.isEmpty()) return null
        val idx = t.indexOf(p)
        if (idx < 0) return null
        return t.substring(idx + p.length).trimStart(' ', ',', '.', ':').trim()
    }
}
