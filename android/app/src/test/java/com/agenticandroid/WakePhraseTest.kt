package com.agenticandroid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WakePhraseTest {
    @Test fun commandInSameUtterance() {
        assertEquals("turn on the flashlight", WakePhrase.extract("hey agent turn on the flashlight", "hey agent"))
    }

    @Test fun wakeOnlyReturnsEmpty() {
        assertEquals("", WakePhrase.extract("hey agent", "hey agent"))
    }

    @Test fun noWakePhraseReturnsNull() {
        assertNull(WakePhrase.extract("what's the weather", "hey agent"))
    }

    @Test fun caseAndFillerInsensitive() {
        assertEquals("battery", WakePhrase.extract("Hey Agent, battery", "hey agent"))
    }

    @Test fun phraseMidSentence() {
        assertEquals("ring my phone", WakePhrase.extract("okay so hey agent ring my phone", "hey agent"))
    }

    // --- W7: sensitivity = fuzzy tolerance for Vosk mishears ---

    @Test fun strictRejectsMishear() {
        // At sensitivity 0 a near-miss ("agents") is not the wake phrase.
        assertNull(WakePhrase.extract("hey agents battery", "hey agent", 0f))
    }

    @Test fun lenientAcceptsOneCharMishear() {
        // Vosk often hears "agent" as "agents" — at medium sensitivity that should still wake.
        assertEquals("battery", WakePhrase.extract("hey agents battery", "hey agent", 0.6f))
    }

    @Test fun lenientStillRejectsUnrelated() {
        assertNull(WakePhrase.extract("play some music", "hey agent", 0.6f))
    }

    @Test fun exactStillWinsAtAnySensitivity() {
        assertEquals("battery", WakePhrase.extract("hey agent battery", "hey agent", 0.6f))
    }
}
