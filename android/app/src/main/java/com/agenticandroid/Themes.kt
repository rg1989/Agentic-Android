package com.agenticandroid

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

/**
 * App color themes. Each theme is a cohesive palette with BOTH a light and a dark scheme, so the
 * "appearance" setting (system/light/dark) is orthogonal to the chosen theme. Pick one in Settings.
 *
 * Only the slots the app actually uses are tuned (primary + containers, secondary/tertiary accents,
 * and the neutral background/surface family); Material3 fills the rest with sensible defaults.
 */
data class AppTheme(val id: String, val label: String, val swatch: List<Color>, val light: ColorScheme, val dark: ColorScheme)

object Themes {
    val all: List<AppTheme> = listOf(violet(), ocean(), sunset(), forest())
    val default = "violet"
    fun byId(id: String): AppTheme = all.firstOrNull { it.id == id } ?: all.first()

    // ---- Violet (default): refined purple ----
    private fun violet() = AppTheme(
        "violet", "Violet", listOf(Color(0xFF6B4FB0), Color(0xFF8B4A63), Color(0xFFCFC2E8)),
        light = lightColorScheme(
            primary = Color(0xFF6B4FB0), onPrimary = Color.White,
            primaryContainer = Color(0xFFE9DDFF), onPrimaryContainer = Color(0xFF23005C),
            secondary = Color(0xFF5E5570), tertiary = Color(0xFF8B4A63),
            background = Color(0xFFFCF8FF), onBackground = Color(0xFF1C1B1F),
            surface = Color(0xFFFFFFFF), onSurface = Color(0xFF1C1B1F),
            surfaceVariant = Color(0xFFE9E0F0), onSurfaceVariant = Color(0xFF4A4458), outline = Color(0xFF7A7589),
        ),
        dark = darkColorScheme(
            primary = Color(0xFFC9B6FF), onPrimary = Color(0xFF2A1A4A),
            primaryContainer = Color(0xFF4A357A), onPrimaryContainer = Color(0xFFE9DDFF),
            secondary = Color(0xFFCFC2E8), tertiary = Color(0xFFF0B7C9),
            background = Color(0xFF121016), onBackground = Color(0xFFECE6F2),
            surface = Color(0xFF1A1620), onSurface = Color(0xFFECE6F2),
            surfaceVariant = Color(0xFF2A2433), onSurfaceVariant = Color(0xFFC9C0D6), outline = Color(0xFF8E84A0),
        ),
    )

    // ---- Ocean & Amber: azure blue with a warm amber accent ----
    private fun ocean() = AppTheme(
        "ocean", "Ocean", listOf(Color(0xFF0A6CA8), Color(0xFFB5651D), Color(0xFF7FC4FF)),
        light = lightColorScheme(
            primary = Color(0xFF0A6CA8), onPrimary = Color.White,
            primaryContainer = Color(0xFFCDE6FF), onPrimaryContainer = Color(0xFF001E30),
            secondary = Color(0xFFB5651D), tertiary = Color(0xFF8A5A00),
            background = Color(0xFFF7FBFF), onBackground = Color(0xFF101418),
            surface = Color(0xFFFFFFFF), onSurface = Color(0xFF101418),
            surfaceVariant = Color(0xFFDCE7F0), onSurfaceVariant = Color(0xFF41484F), outline = Color(0xFF71787E),
        ),
        dark = darkColorScheme(
            primary = Color(0xFF7FC4FF), onPrimary = Color(0xFF00344F),
            primaryContainer = Color(0xFF1C4A6B), onPrimaryContainer = Color(0xFFCDE6FF),
            secondary = Color(0xFFFFB870), tertiary = Color(0xFFFFD18A),
            background = Color(0xFF0E1419), onBackground = Color(0xFFE2EAF2),
            surface = Color(0xFF141C24), onSurface = Color(0xFFE2EAF2),
            surfaceVariant = Color(0xFF233039), onSurfaceVariant = Color(0xFFB9C6D2), outline = Color(0xFF7F8C99),
        ),
    )

    // ---- Sunset: coral primary, violet + amber accents (three colors) ----
    private fun sunset() = AppTheme(
        "sunset", "Sunset", listOf(Color(0xFFC8431A), Color(0xFF6750A4), Color(0xFFFFB870)),
        light = lightColorScheme(
            primary = Color(0xFFC8431A), onPrimary = Color.White,
            primaryContainer = Color(0xFFFFDBCC), onPrimaryContainer = Color(0xFF3A0B00),
            secondary = Color(0xFF6750A4), tertiary = Color(0xFF8A5A00),
            background = Color(0xFFFFF8F5), onBackground = Color(0xFF201A17),
            surface = Color(0xFFFFFFFF), onSurface = Color(0xFF201A17),
            surfaceVariant = Color(0xFFF2DFD5), onSurfaceVariant = Color(0xFF53433B), outline = Color(0xFF85736A),
        ),
        dark = darkColorScheme(
            primary = Color(0xFFFF9E80), onPrimary = Color(0xFF5A1A00),
            primaryContainer = Color(0xFF7A2E14), onPrimaryContainer = Color(0xFFFFDBCC),
            secondary = Color(0xFFD0BCFF), tertiary = Color(0xFFFFD18A),
            background = Color(0xFF17120F), onBackground = Color(0xFFF2E6DF),
            surface = Color(0xFF211915), onSurface = Color(0xFFF2E6DF),
            surfaceVariant = Color(0xFF34281F), onSurfaceVariant = Color(0xFFD6C4B8), outline = Color(0xFF9E8B7E),
        ),
    )

    // ---- Forest: emerald green with a gold accent ----
    private fun forest() = AppTheme(
        "forest", "Forest", listOf(Color(0xFF1A6E45), Color(0xFF7A5B00), Color(0xFF7FD79C)),
        light = lightColorScheme(
            primary = Color(0xFF1A6E45), onPrimary = Color.White,
            primaryContainer = Color(0xFF9CF4B7), onPrimaryContainer = Color(0xFF00210F),
            secondary = Color(0xFF7A5B00), tertiary = Color(0xFF006A60),
            background = Color(0xFFF6FBF5), onBackground = Color(0xFF111511),
            surface = Color(0xFFFFFFFF), onSurface = Color(0xFF111511),
            surfaceVariant = Color(0xFFDBE6DC), onSurfaceVariant = Color(0xFF424942), outline = Color(0xFF727970),
        ),
        dark = darkColorScheme(
            primary = Color(0xFF7FD79C), onPrimary = Color(0xFF00391E),
            primaryContainer = Color(0xFF1E5436), onPrimaryContainer = Color(0xFF9CF4B7),
            secondary = Color(0xFFE6C770), tertiary = Color(0xFF8FD0C8),
            background = Color(0xFF0E140F), onBackground = Color(0xFFE1EAE2),
            surface = Color(0xFF141C16), onSurface = Color(0xFFE1EAE2),
            surfaceVariant = Color(0xFF243029), onSurfaceVariant = Color(0xFFBAC9BD), outline = Color(0xFF7E8C82),
        ),
    )
}
