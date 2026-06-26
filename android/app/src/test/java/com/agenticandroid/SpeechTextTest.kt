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

    // --- W3: collapse machine-junk tokens that make no sense read aloud ---

    @Test fun collapsesUuid() {
        val out = SpeechText.forSpeech("Created session 550e8400-e29b-41d4-a716-446655440000 ok.")
        assertFalse("kept uuid: $out", out.contains("550e8400"))
        assertTrue(out, out.contains("a UUID"))
        assertTrue(out, out.contains("Created session"))
        assertTrue(out, out.contains("ok"))
    }

    @Test fun collapsesLongHexHash() {
        val out = SpeechText.forSpeech("Commit da39a3ee5e6b4b0d3255bfef95601890afd80709 landed.")
        assertFalse("kept hash: $out", out.contains("da39a3ee"))
        assertTrue(out, out.contains("a hash"))
        assertTrue(out, out.contains("landed"))
    }

    @Test fun collapsesLongOpaqueId() {
        val out = SpeechText.forSpeech("Token sk-ant-oat01-PPu9RXROabc123DEF456ghiJKL is set.")
        assertFalse("kept token: $out", out.contains("PPu9RXRO"))
        assertTrue(out, out.contains("an ID"))
        assertTrue(out, out.contains("is set"))
    }

    @Test fun collapsesFilePaths() {
        val out = SpeechText.forSpeech("Saved to /Users/me/Documents/agent/photo.jpg now.")
        assertFalse("kept path: $out", out.contains("Documents"))
        assertTrue(out, out.contains("a file path"))
        assertTrue(out, out.contains("Saved to"))
        assertTrue(out, out.contains("now"))
    }

    @Test fun summarizesLongDigitRuns() {
        val out = SpeechText.forSpeech("Call 5551234567 back.")
        assertFalse("read full number: $out", out.contains("5551234567"))
        assertTrue(out, out.contains("4567"))
        assertTrue(out, out.contains("Call"))
    }

    @Test fun keepsOrdinaryNumbersAndWords() {
        // Regression: short numbers, years, single-slash words and short decimals stay intact.
        val out = SpeechText.forSpeech("Android 16, 100% done in 2024; speed 3.5 and/or more.")
        assertTrue(out, out.contains("Android 16"))
        assertTrue(out, out.contains("2024"))
        assertTrue(out, out.contains("100 percent"))
        assertTrue(out, out.contains("3.5"))
        assertTrue(out, out.contains("and/or"))
        assertFalse(out, out.contains("a file path"))
        assertFalse(out, out.contains("an ID"))
    }
}
