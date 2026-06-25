package com.agenticandroid

/**
 * Cleans an assistant message for *listening*. The chat bubble keeps the full rich text; this is a
 * separate pass applied only to what we hand the TTS engine, so it doesn't read out things that make
 * no sense aloud: JSON/braces/brackets, code blocks, URLs, emoji, markdown noise, and over-precise
 * numbers (e.g. 5-decimal GPS coordinates).
 *
 * Pure + deterministic → unit-tested in SpeechTextTest.
 */
object SpeechText {
    fun forSpeech(raw: String): String {
        var s = raw
        // Fenced code blocks: don't read code — just say there was some.
        s = s.replace(Regex("```[\\s\\S]*?```"), " code block ")
        s = s.replace("`", "")
        // URLs are unreadable aloud.
        s = s.replace(Regex("https?://\\S+"), "a link")
        s = s.replace(Regex("\\bwww\\.\\S+"), "a link")
        // Astral-plane emoji (📷 📱 🔦 …) arrive as UTF-16 surrogate pairs.
        s = s.replace(Regex("[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]"), " ")
        // BMP symbols / dingbats / arrows / status glyphs (✅ ❌ ⚪ → …) + variation selectors / ZWJ.
        s = s.replace(Regex("[\\p{So}\\p{Sk}\\u2190-\\u21FF\\u2600-\\u27BF\\uFE0F\\u200D\\u20E3]"), " ")
        // Over-precise numbers: 37.42123 -> "37 point 4". Keeps short decimals (e.g. 3.5) readable.
        s = s.replace(Regex("(-?\\d+)\\.(\\d{2,})")) { m -> "${m.groupValues[1]} point ${m.groupValues[2].take(1)}" }
        s = s.replace("%", " percent ")
        // JSON / markup punctuation noise (NOT . , : ; ! ? ' ( ) — those help phrasing).
        s = s.replace(Regex("[{}\\[\\]<>|*_#~\"]"), " ")
        s = s.replace(Regex("(?m)^\\s*[-•]\\s+"), " ") // markdown bullets
        // Newlines become sentence breaks so TTS pauses sensibly.
        s = s.replace(Regex("[\\r\\n]+"), ". ")
        // Tidy whitespace + repeated punctuation left behind.
        s = s.replace(Regex("\\s+"), " ")
        s = s.replace(Regex("\\s+([.,:;!?])"), "$1")
        s = s.replace(Regex("([.,!?]){2,}"), "$1")
        s = s.replace(Regex("(\\.\\s*){2,}"), ". ")
        s = s.trim()
        // Nothing worth saying (e.g. an image-only or all-emoji message) → speak nothing.
        return if (s.none { it.isLetterOrDigit() }) "" else s
    }
}
