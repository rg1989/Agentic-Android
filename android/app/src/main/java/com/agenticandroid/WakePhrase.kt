package com.agenticandroid

/**
 * Pure wake-phrase matching for the Vosk wake-word service. Given a recognized transcript and the
 * configured wake phrase, returns the command spoken *after* the phrase:
 *   - "hey agent turn on the flashlight" / "hey agent" -> "turn on the flashlight"
 *   - "hey agent"                        / "hey agent" -> "" (wake heard, command will follow)
 *   - "what's the weather"               / "hey agent" -> null (no wake phrase)
 *
 * Matching is lowercase and whitespace-insensitive; a leading filler comma is trimmed.
 *
 * [sensitivity] 0..1 tolerates Vosk mishears: 0 = exact substring only; ≥0.5 also matches when each
 * phrase word is within a small edit distance of consecutive transcript words (so "hey agents" still
 * wakes for "hey agent"); ≥0.8 widens that tolerance. Vosk has no native sensitivity dial — this is it.
 */
object WakePhrase {
    fun extract(text: String, phrase: String, sensitivity: Float = 0f): String? {
        val pw = phrase.lowercase().trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (pw.isEmpty()) return null
        val raw = text.lowercase().trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (raw.size < pw.size) return null
        // Match whole words (not substrings, so "hey agent" doesn't fire inside "hey agents" at strict).
        // tol = allowed per-word edit distance: 0 strict, 1 tolerant, 2 loose — driven by sensitivity.
        val norm = raw.map { it.trim('.', ',', '!', '?', ':', ';', '\'', '"') }
        val tol = when { sensitivity >= 0.8f -> 2; sensitivity >= 0.5f -> 1; else -> 0 }
        for (start in 0..(norm.size - pw.size)) {
            val matches = pw.indices.all {
                val a = pw[it]; val b = norm[start + it]
                if (tol == 0) a == b else levenshtein(a, b) <= tol
            }
            if (matches) return raw.drop(start + pw.size).joinToString(" ").trimStart(' ', ',', '.', ':').trim()
        }
        return null
    }

    /** Classic edit distance — inputs are single words, so the simple O(n·m) table is fine. */
    private fun levenshtein(a: String, b: String): Int {
        val prev = IntArray(b.length + 1) { it }
        val cur = IntArray(b.length + 1)
        for (i in 1..a.length) {
            cur[0] = i
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                cur[j] = minOf(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            }
            for (k in prev.indices) prev[k] = cur[k]
        }
        return prev[b.length]
    }
}
