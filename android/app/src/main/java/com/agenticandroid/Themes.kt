package com.agenticandroid

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

/**
 * App color themes. Each theme is a cohesive palette with BOTH a light and a dark scheme, so the
 * "appearance" setting (system/light/dark) is orthogonal to the chosen theme. Pick one in Settings.
 *
 * Each theme genuinely uses THREE colors, mapped to the three surfaces the chat actually paints:
 *   • primary            → the user's own bubbles + the send/mic button   (color #1)
 *   • secondaryContainer → the agent's reply bubbles                       (color #2)
 *   • tertiary           → links, inline code, accents inside replies      (color #3)
 * The swatch dots preview exactly those three. Backgrounds are tinted (not plain white) where the
 * theme calls for it. `mk` seeds a Material default scheme then overrides only the slots we use.
 */
data class AppTheme(val id: String, val label: String, val swatch: List<Color>, val light: ColorScheme, val dark: ColorScheme)

private fun mk(
    dark: Boolean,
    primary: Color, onPrimary: Color, primaryContainer: Color, onPrimaryContainer: Color,
    agent: Color, onAgent: Color, accent: Color,
    bg: Color, onBg: Color, surface: Color, surfaceVar: Color, onSurfaceVar: Color, outline: Color,
): ColorScheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
    primary = primary, onPrimary = onPrimary,
    primaryContainer = primaryContainer, onPrimaryContainer = onPrimaryContainer,
    secondary = accent, onSecondary = onPrimary,
    secondaryContainer = agent, onSecondaryContainer = onAgent,   // agent reply bubbles
    tertiary = accent, onTertiary = onPrimary,                    // links / code / accents
    background = bg, onBackground = onBg,
    surface = surface, onSurface = onBg,
    surfaceVariant = surfaceVar, onSurfaceVariant = onSurfaceVar, outline = outline,
)

object Themes {
    val all: List<AppTheme> = listOf(
        violet(), ocean(), sunset(), forest(), matrix(), vampire(), vibrant(), sakura(),
    )
    val default = "violet"
    fun byId(id: String): AppTheme = all.firstOrNull { it.id == id } ?: all.first()

    // ---- Violet: refined purple, rose accent ----
    private fun violet() = AppTheme(
        "violet", "Violet", listOf(Color(0xFF6B4FB0), Color(0xFF8B4A63), Color(0xFFE5DCF5)),
        light = mk(false,
            Color(0xFF6B4FB0), Color.White, Color(0xFFE9DDFF), Color(0xFF23005C),
            Color(0xFFE7DCF7), Color(0xFF2A2440), Color(0xFFB0436A),
            Color(0xFFFCF8FF), Color(0xFF1C1B1F), Color(0xFFFFFFFF), Color(0xFFECE3F5), Color(0xFF4A4458), Color(0xFF7A7589)),
        dark = mk(true,
            Color(0xFFC9B6FF), Color(0xFF2A1A4A), Color(0xFF4A357A), Color(0xFFE9DDFF),
            Color(0xFF3A2F55), Color(0xFFE6DCFF), Color(0xFFF0B7C9),
            Color(0xFF121016), Color(0xFFECE6F2), Color(0xFF1A1620), Color(0xFF2A2433), Color(0xFFC9C0D6), Color(0xFF8E84A0)),
    )

    // ---- Ocean: azure blue, amber accent ----
    private fun ocean() = AppTheme(
        "ocean", "Ocean", listOf(Color(0xFF0A6CA8), Color(0xFFB5651D), Color(0xFFD2E7F7)),
        light = mk(false,
            Color(0xFF0A6CA8), Color.White, Color(0xFFCDE6FF), Color(0xFF001E30),
            Color(0xFFD2E7F7), Color(0xFF0A2A3F), Color(0xFFB5651D),
            Color(0xFFF1F8FF), Color(0xFF101418), Color(0xFFFFFFFF), Color(0xFFDCE7F0), Color(0xFF41484F), Color(0xFF71787E)),
        dark = mk(true,
            Color(0xFF7FC4FF), Color(0xFF00344F), Color(0xFF1C4A6B), Color(0xFFCDE6FF),
            Color(0xFF1E3A50), Color(0xFFCDE6FF), Color(0xFFFFB870),
            Color(0xFF0E1419), Color(0xFFE2EAF2), Color(0xFF141C24), Color(0xFF233039), Color(0xFFB9C6D2), Color(0xFF7F8C99)),
    )

    // ---- Sunset: coral primary, violet bubbles, gold accent ----
    private fun sunset() = AppTheme(
        "sunset", "Sunset", listOf(Color(0xFFC8431A), Color(0xFFB07900), Color(0xFFE7DFF7)),
        light = mk(false,
            Color(0xFFC8431A), Color.White, Color(0xFFFFDBCC), Color(0xFF3A0B00),
            Color(0xFFE7DFF7), Color(0xFF2A2440), Color(0xFFB07900),
            Color(0xFFFFF6F0), Color(0xFF201A17), Color(0xFFFFFFFF), Color(0xFFF2DFD5), Color(0xFF53433B), Color(0xFF85736A)),
        dark = mk(true,
            Color(0xFFFF9E80), Color(0xFF5A1A00), Color(0xFF7A2E14), Color(0xFFFFDBCC),
            Color(0xFF3A2F55), Color(0xFFE6DCFF), Color(0xFFFFD18A),
            Color(0xFF17120F), Color(0xFFF2E6DF), Color(0xFF211915), Color(0xFF34281F), Color(0xFFD6C4B8), Color(0xFF9E8B7E)),
    )

    // ---- Forest: emerald primary, mint bubbles, gold accent ----
    private fun forest() = AppTheme(
        "forest", "Forest", listOf(Color(0xFF1A6E45), Color(0xFF8A6A00), Color(0xFFCDEAD7)),
        light = mk(false,
            Color(0xFF1A6E45), Color.White, Color(0xFF9CF4B7), Color(0xFF00210F),
            Color(0xFFCDEAD7), Color(0xFF06281A), Color(0xFF8A6A00),
            Color(0xFFF3FBF5), Color(0xFF111511), Color(0xFFFFFFFF), Color(0xFFDBE6DC), Color(0xFF424942), Color(0xFF727970)),
        dark = mk(true,
            Color(0xFF7FD79C), Color(0xFF00391E), Color(0xFF1E5436), Color(0xFF9CF4B7),
            Color(0xFF1E4233), Color(0xFFB8F0CB), Color(0xFFE6C770),
            Color(0xFF0E140F), Color(0xFFE1EAE2), Color(0xFF141C16), Color(0xFF243029), Color(0xFFBAC9BD), Color(0xFF7E8C82)),
    )

    // ---- Matrix: neon green on black (dark) / pale-green terminal (light) ----
    private fun matrix() = AppTheme(
        "matrix", "Matrix", listOf(Color(0xFF00E676), Color(0xFF00BFA5), Color(0xFF0C2A16)),
        light = mk(false,
            Color(0xFF1B7A3D), Color.White, Color(0xFFB9F5C9), Color(0xFF002912),
            Color(0xFFD6F5DE), Color(0xFF052915), Color(0xFF00897B),
            Color(0xFFECFBF0), Color(0xFF08120B), Color(0xFFF6FFF8), Color(0xFFD2EEDA), Color(0xFF2E4636), Color(0xFF5E8C6E)),
        dark = mk(true,
            Color(0xFF00E676), Color(0xFF00210E), Color(0xFF0F4023), Color(0xFF76FF9C),
            Color(0xFF0C2A16), Color(0xFF76FF9C), Color(0xFF69F0AE),
            Color(0xFF000000), Color(0xFF8BFFB0), Color(0xFF0A140D), Color(0xFF14241A), Color(0xFF8FC9A3), Color(0xFF2E6B45)),
    )

    // ---- Vampire: blood crimson + dark maroon bubbles + tarnished gold ----
    private fun vampire() = AppTheme(
        "vampire", "Vampire", listOf(Color(0xFFB0151D), Color(0xFFE0B450), Color(0xFF2A1418)),
        light = mk(false,
            Color(0xFFB0151D), Color.White, Color(0xFFFFDAD6), Color(0xFF410002),
            Color(0xFFF0DAD2), Color(0xFF3A1212), Color(0xFF8A6D00),
            Color(0xFFFBF2F0), Color(0xFF1A1011), Color(0xFFFFFFFF), Color(0xFFECD9D6), Color(0xFF524240), Color(0xFF8A6F6C)),
        dark = mk(true,
            Color(0xFFFF5366), Color(0xFF5A0010), Color(0xFF7A1520), Color(0xFFFFDAD6),
            Color(0xFF2A1418), Color(0xFFFFD9D0), Color(0xFFE0B450),
            Color(0xFF0E0608), Color(0xFFF0DADA), Color(0xFF1A0E10), Color(0xFF2E1A1C), Color(0xFFD6B8B6), Color(0xFF7A4A4E)),
    )

    // ---- Vibrant: hot magenta + cyan bubbles + golden yellow ----
    private fun vibrant() = AppTheme(
        "vibrant", "Vibrant", listOf(Color(0xFFD6008C), Color(0xFF00BFA5), Color(0xFFFFD54F)),
        light = mk(false,
            Color(0xFFD6008C), Color.White, Color(0xFFFFD8EC), Color(0xFF3A0027),
            Color(0xFFCFF5F2), Color(0xFF003733), Color(0xFFB58A00),
            Color(0xFFFFF4FB), Color(0xFF1A1018), Color(0xFFFFFFFF), Color(0xFFF2DDEC), Color(0xFF534350), Color(0xFF8A6F86)),
        dark = mk(true,
            Color(0xFFFF5FC4), Color(0xFF5A0040), Color(0xFF7A1A5E), Color(0xFFFFD8EC),
            Color(0xFF0E3D3A), Color(0xFF7FF0E8), Color(0xFFFFD54F),
            Color(0xFF14101A), Color(0xFFF2E2EE), Color(0xFF1E1424), Color(0xFF2E2333), Color(0xFFD6C0D0), Color(0xFF8A6F96)),
    )

    // ---- Sakura: soft rose + mint bubbles + lavender accent (tinted light) ----
    private fun sakura() = AppTheme(
        "sakura", "Sakura", listOf(Color(0xFFD6457A), Color(0xFF7C4DBF), Color(0xFFD6F2E2)),
        light = mk(false,
            Color(0xFFD6457A), Color.White, Color(0xFFFFD9E3), Color(0xFF3E001D),
            Color(0xFFD6F2E2), Color(0xFF0A2E1E), Color(0xFF7C4DBF),
            Color(0xFFFFF3F7), Color(0xFF1F141A), Color(0xFFFFFFFF), Color(0xFFF2DEE6), Color(0xFF534349), Color(0xFF8A6F7C)),
        dark = mk(true,
            Color(0xFFFFA8C8), Color(0xFF5A0A2A), Color(0xFF7A2848), Color(0xFFFFD9E3),
            Color(0xFF1E3D30), Color(0xFFA8F0CC), Color(0xFFC9A8F0),
            Color(0xFF1A1016), Color(0xFFF2E2EA), Color(0xFF241620), Color(0xFF33232B), Color(0xFFD6C0CA), Color(0xFF9A7F8C)),
    )
}
