package com.agenticandroid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeechTextTest {
    @Test fun stripsEmojiAndSpeaksPercent() {
        val out = SpeechText.forSpeech("📱 OnePlus running Android 16. Battery is at 100%.")
        assertFalse(out.contains("📱"))
        assertTrue(out, out.contains("100 percent"))
        assertTrue(out, out.startsWith("OnePlus"))
    }

    @Test fun stripsJsonBracesQuotesUnderscores() {
        val out = SpeechText.forSpeech("Result: {\"battery_pct\": 100, \"charging\": true}")
        for (c in listOf("{", "}", "\"", "_", "[", "]")) assertFalse("had $c: $out", out.contains(c))
    }

    @Test fun replacesUrlsWithALink() {
        val out = SpeechText.forSpeech("You're here: https://maps.google.com/?q=1,2 — open it.")
        assertFalse(out.contains("http"))
        assertTrue(out, out.contains("a link"))
    }

    @Test fun shortensLongDecimals() {
        val out = SpeechText.forSpeech("You're at 37.42123, -122.08400 now.")
        assertFalse("kept long decimal: $out", out.contains("42123"))
        assertTrue(out, out.contains("point"))
    }

    @Test fun emptyStaysEmpty() {
        assertEquals("", SpeechText.forSpeech(""))
        assertEquals("", SpeechText.forSpeech("   \n  "))
    }

    @Test fun dropsCodeFences() {
        val out = SpeechText.forSpeech("Run this:\n```\nval x = {a:1}\n```\nDone.")
        assertFalse(out.contains("val x"))
        assertTrue(out, out.contains("code block"))
        assertTrue(out, out.contains("Done"))
    }
}
