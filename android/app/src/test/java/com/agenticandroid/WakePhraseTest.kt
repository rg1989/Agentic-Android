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
}
