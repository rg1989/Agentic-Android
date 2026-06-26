package com.agenticandroid

/**
 * "Do not disturb" window for the wake word, in whole hours (0–23). [isQuiet] handles the overnight
 * wrap (e.g. 23 → 7 means quiet from 11pm through 7am). End hour is exclusive. Pure → unit-tested.
 */
object WakeWindow {
    fun isQuiet(nowHour: Int, startHour: Int, endHour: Int): Boolean {
        if (startHour == endHour) return false // empty window = never quiet
        return if (startHour < endHour) nowHour in startHour until endHour
        else nowHour >= startHour || nowHour < endHour // wraps past midnight
    }
}
