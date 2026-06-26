package com.agenticandroid

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WakeWindowTest {
    @Test fun overnightWindowWraps() {
        // Quiet 23:00 → 07:00 (the common "while I sleep" case).
        assertTrue(WakeWindow.isQuiet(23, 23, 7))  // at start
        assertTrue(WakeWindow.isQuiet(2, 23, 7))   // middle of the night
        assertTrue(WakeWindow.isQuiet(6, 23, 7))   // just before end
        assertFalse(WakeWindow.isQuiet(7, 23, 7))  // at end (exclusive)
        assertFalse(WakeWindow.isQuiet(12, 23, 7)) // midday
    }

    @Test fun sameDayWindow() {
        // Quiet 09:00 → 17:00 (e.g. work hours).
        assertTrue(WakeWindow.isQuiet(9, 9, 17))
        assertTrue(WakeWindow.isQuiet(13, 9, 17))
        assertFalse(WakeWindow.isQuiet(17, 9, 17))
        assertFalse(WakeWindow.isQuiet(8, 9, 17))
        assertFalse(WakeWindow.isQuiet(20, 9, 17))
    }

    @Test fun equalStartEndNeverQuiet() {
        assertFalse(WakeWindow.isQuiet(5, 6, 6))
    }
}
