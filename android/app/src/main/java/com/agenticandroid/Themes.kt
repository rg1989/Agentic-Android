package com.agenticandroid

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

/**
 * App color themes. Each theme is a curated 3-color palette with BOTH a light and a dark scheme, so
 * the "appearance" setting (system/light/dark) is orthogonal to the chosen theme.
 *
 * The three palette colors map to the three surfaces the chat always paints — so all three are
 * genuinely in use and the swatch dots preview exactly what you'll see:
 *   • color 1 → primary             → your message bubbles
 *   • color 2 → secondaryContainer  → the agent's reply bubbles
 *   • color 3 → tertiary            → the send/mic button + links/code accents
 * `mk` seeds a Material default scheme then overrides only the slots the UI uses. `onAccent` lets a
 * light-colored button (gold, butter, …) get a dark icon instead of an unreadable white one.
 */
data class AppTheme(val id: String, val label: String, val swatch: List<Color>, val light: ColorScheme, val dark: ColorScheme)

private fun mk(
    dark: Boolean,
    primary: Color, onPrimary: Color,
    agent: Color, onAgent: Color,
    accent: Color, onAccent: Color,
    bg: Color, onBg: Color, surface: Color, surfaceVar: Color, onSurfaceVar: Color, outline: Color,
): ColorScheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
    primary = primary, onPrimary = onPrimary,
    primaryContainer = primary, onPrimaryContainer = onPrimary,
    secondary = accent, onSecondary = onAccent,
    secondaryContainer = agent, onSecondaryContainer = onAgent,   // agent reply bubbles
    tertiary = accent, onTertiary = onAccent,                     // send button + links/code
    background = bg, onBackground = onBg,
    surface = surface, onSurface = onBg,
    surfaceVariant = surfaceVar, onSurfaceVariant = onSurfaceVar, outline = outline,
)

object Themes {
    val all: List<AppTheme> = listOf(
        editorial(), coral(), linen(), lagoon(), terra(),   // row 1
        slate(), noir(), pop(), grove(), harbor(),           // row 2
    )
    val default = "editorial"
    fun byId(id: String): AppTheme = all.firstOrNull { it.id == id } ?: all.first()

    // 1. Navy × Cream × Gold — classic editorial
    private fun editorial() = AppTheme(
        "editorial", "Editorial", listOf(Color(0xFF0D3B66), Color(0xFFFAF0CA), Color(0xFFF4D35E)),
        light = mk(false, Color(0xFF0D3B66), Color(0xFFFFFFFF), Color(0xFFFAF0CA), Color(0xFF4A3F12), Color(0xFFF4D35E), Color(0xFF3D3000),
            Color(0xFFFFFDF6), Color(0xFF1A2430), Color(0xFFFFFFFF), Color(0xFFEBE7D7), Color(0xFF595444), Color(0xFFB8B095)),
        dark = mk(true, Color(0xFF9CC2E8), Color(0xFF062136), Color(0xFF20303F), Color(0xFFE7EEF5), Color(0xFFF4D35E), Color(0xFF3D3000),
            Color(0xFF0D141C), Color(0xFFE6ECF2), Color(0xFF141C26), Color(0xFF243240), Color(0xFFAAB7C5), Color(0xFF45576A)),
    )

    // 2. Ivory × Coral × Charcoal — bold contrast
    private fun coral() = AppTheme(
        "coral", "Coral", listOf(Color(0xFFE94F37), Color(0xFFF6F7EB), Color(0xFF393E41)),
        light = mk(false, Color(0xFFE94F37), Color(0xFFFFFFFF), Color(0xFFF6F7EB), Color(0xFF393E41), Color(0xFF393E41), Color(0xFFFFFFFF),
            Color(0xFFFCFCF6), Color(0xFF2A2E30), Color(0xFFFFFFFF), Color(0xFFE7E8DD), Color(0xFF565A5C), Color(0xFFB1B3A8)),
        dark = mk(true, Color(0xFFFF8E79), Color(0xFF5A1404), Color(0xFF2C2F31), Color(0xFFECEDE4), Color(0xFFAEB4BA), Color(0xFF20242A),
            Color(0xFF181A1B), Color(0xFFECEDE6), Color(0xFF202223), Color(0xFF2E3133), Color(0xFFB4B7B3), Color(0xFF53575A)),
    )

    // 3. Sage × Vanilla × Sand — minimalist warmth (all soft, low-contrast by design)
    private fun linen() = AppTheme(
        "linen", "Linen", listOf(Color(0xFFDCE0D9), Color(0xFFFBF6EF), Color(0xFFEAD7C3)),
        light = mk(false, Color(0xFFDCE0D9), Color(0xFF353A33), Color(0xFFFBF6EF), Color(0xFF44392E), Color(0xFFEAD7C3), Color(0xFF4A3A28),
            Color(0xFFFFFFFB), Color(0xFF3A3F38), Color(0xFFFFFFFF), Color(0xFFEAE9E1), Color(0xFF5A584F), Color(0xFFBCBAAE)),
        dark = mk(true, Color(0xFFBFC7BC), Color(0xFF2A2F28), Color(0xFF2A2C28), Color(0xFFE6E8E0), Color(0xFFD8C4AE), Color(0xFF3A2C1C),
            Color(0xFF131410), Color(0xFFE8E8E0), Color(0xFF1B1C17), Color(0xFF2A2B25), Color(0xFFB6B6AC), Color(0xFF565848)),
    )

    // 4. Teal × Mint × Ice — fresh & clean
    private fun lagoon() = AppTheme(
        "lagoon", "Lagoon", listOf(Color(0xFF006D77), Color(0xFFEDF6F9), Color(0xFF83C5BE)),
        light = mk(false, Color(0xFF006D77), Color(0xFFFFFFFF), Color(0xFFEDF6F9), Color(0xFF0A3034), Color(0xFF83C5BE), Color(0xFF06302C),
            Color(0xFFF5FBFC), Color(0xFF10282B), Color(0xFFFFFFFF), Color(0xFFDCE9EA), Color(0xFF46575A), Color(0xFF7C9296)),
        dark = mk(true, Color(0xFF5BD0DA), Color(0xFF00363B), Color(0xFF142A2D), Color(0xFFDCEEF0), Color(0xFF83C5BE), Color(0xFF06302C),
            Color(0xFF0B1416), Color(0xFFE0EEF0), Color(0xFF121E20), Color(0xFF1F3033), Color(0xFFA8BFC2), Color(0xFF3E5A5E)),
    )

    // 5. Terracotta × Butter × Seafoam — retro soft
    private fun terra() = AppTheme(
        "terra", "Terra", listOf(Color(0xFFED6A5A), Color(0xFFF4F1BB), Color(0xFF9BC1BC)),
        light = mk(false, Color(0xFFED6A5A), Color(0xFFFFFFFF), Color(0xFFF4F1BB), Color(0xFF4A4516), Color(0xFF9BC1BC), Color(0xFF0E3531),
            Color(0xFFFFFBF5), Color(0xFF3A2420), Color(0xFFFFFFFF), Color(0xFFEFE7DC), Color(0xFF5C5147), Color(0xFFBBAEA0)),
        dark = mk(true, Color(0xFFFF9183), Color(0xFF5A1A10), Color(0xFF2E2C1C), Color(0xFFEFEDC8), Color(0xFF9BC1BC), Color(0xFF0E3531),
            Color(0xFF18120F), Color(0xFFF0E6DE), Color(0xFF211915), Color(0xFF322820), Color(0xFFD2C4B6), Color(0xFF5A4A3E)),
    )

    // 6. Dark Slate × Blue Gray × Snow — corporate cool
    private fun slate() = AppTheme(
        "slate", "Slate", listOf(Color(0xFF2B2D42), Color(0xFFEDF2F4), Color(0xFF8D99AE)),
        light = mk(false, Color(0xFF2B2D42), Color(0xFFFFFFFF), Color(0xFFEDF2F4), Color(0xFF2B2D42), Color(0xFF8D99AE), Color(0xFF15203A),
            Color(0xFFFAFBFC), Color(0xFF23252E), Color(0xFFFFFFFF), Color(0xFFE2E6EA), Color(0xFF4F545E), Color(0xFFAEB4BE)),
        dark = mk(true, Color(0xFFAEB7CC), Color(0xFF1B1D2E), Color(0xFF25283A), Color(0xFFE4E8F0), Color(0xFF8D99AE), Color(0xFF15203A),
            Color(0xFF131420), Color(0xFFE4E7EE), Color(0xFF1B1D2B), Color(0xFF2A2D3E), Color(0xFFAAB0BE), Color(0xFF474C5E)),
    )

    // 7. Espresso × Crimson × Porcelain — dramatic
    private fun noir() = AppTheme(
        "noir", "Noir", listOf(Color(0xFF92140C), Color(0xFFFFF8F0), Color(0xFF1E1E24)),
        light = mk(false, Color(0xFF92140C), Color(0xFFFFFFFF), Color(0xFFFFF8F0), Color(0xFF2A1410), Color(0xFF1E1E24), Color(0xFFFFFFFF),
            Color(0xFFFFFCF8), Color(0xFF241410), Color(0xFFFFFFFF), Color(0xFFEFE3DC), Color(0xFF5C4A44), Color(0xFFBCA8A0)),
        dark = mk(true, Color(0xFFFF5A4E), Color(0xFF5A0500), Color(0xFF241416), Color(0xFFF4DAD6), Color(0xFFC9C5CE), Color(0xFF1E1E24),
            Color(0xFF141014), Color(0xFFF0E2DE), Color(0xFF1C161A), Color(0xFF2C2228), Color(0xFFC6B2AE), Color(0xFF5A4A4E)),
    )

    // 8. Magenta × Gold × Sky — vibrant pop
    private fun pop() = AppTheme(
        "pop", "Pop", listOf(Color(0xFFFE218B), Color(0xFF21B0FE), Color(0xFFFED700)),
        light = mk(false, Color(0xFFFE218B), Color(0xFFFFFFFF), Color(0xFF21B0FE), Color(0xFF062A40), Color(0xFFFED700), Color(0xFF3D3100),
            Color(0xFFFFF7FB), Color(0xFF2A1020), Color(0xFFFFFFFF), Color(0xFFF1E0EA), Color(0xFF5E4654), Color(0xFFC79FB4)),
        dark = mk(true, Color(0xFFFF5FAE), Color(0xFF5A0030), Color(0xFF0E3A52), Color(0xFFBFE6FF), Color(0xFFFED700), Color(0xFF3D3100),
            Color(0xFF16101A), Color(0xFFF2E2EC), Color(0xFF1E1622), Color(0xFF2E2233), Color(0xFFD6C0D0), Color(0xFF6A4A60)),
    )

    // 9. Olive × Forest × Cream — earthy & natural
    private fun grove() = AppTheme(
        "grove", "Grove", listOf(Color(0xFF606C38), Color(0xFFFEFAE0), Color(0xFF283618)),
        light = mk(false, Color(0xFF606C38), Color(0xFFFFFFFF), Color(0xFFFEFAE0), Color(0xFF2C3416), Color(0xFF283618), Color(0xFFFFFFFF),
            Color(0xFFFFFEF6), Color(0xFF2A2E1C), Color(0xFFFFFFFF), Color(0xFFE8E8D4), Color(0xFF555844), Color(0xFFB6B79E)),
        dark = mk(true, Color(0xFFAEBE7E), Color(0xFF2A3210), Color(0xFF232818), Color(0xFFE8EAD2), Color(0xFF8FA85E), Color(0xFF18220E),
            Color(0xFF12140C), Color(0xFFE8EAD6), Color(0xFF1A1C12), Color(0xFF282B1C), Color(0xFFB8BBA2), Color(0xFF565940)),
    )

    // 10. Ocean × Steel × Frost — tech / professional
    private fun harbor() = AppTheme(
        "harbor", "Harbor", listOf(Color(0xFF064789), Color(0xFFEBF2FA), Color(0xFF427AA1)),
        light = mk(false, Color(0xFF064789), Color(0xFFFFFFFF), Color(0xFFEBF2FA), Color(0xFF0A2A45), Color(0xFF427AA1), Color(0xFFFFFFFF),
            Color(0xFFF7FAFD), Color(0xFF14283C), Color(0xFFFFFFFF), Color(0xFFDEE7F0), Color(0xFF46535F), Color(0xFF9FB1C4)),
        dark = mk(true, Color(0xFF7FB2E4), Color(0xFF06243F), Color(0xFF16293A), Color(0xFFDCEAF6), Color(0xFF6CA3C9), Color(0xFF06243A),
            Color(0xFF0C141C), Color(0xFFE2ECF5), Color(0xFF131D27), Color(0xFF213140), Color(0xFFA8B9C8), Color(0xFF3E5870)),
    )
}
