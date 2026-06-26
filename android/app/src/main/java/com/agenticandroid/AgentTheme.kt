package com.agenticandroid

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * App theme driven by SettingsStore.theme ("system" | "light" | "dark"). Wraps content in a Surface
 * so the background follows the scheme (real dark mode), and flips the status-bar icons to match.
 */
@Composable
fun AgentTheme(content: @Composable () -> Unit) {
    val pref by SettingsStore.theme.collectAsState()
    val paletteId by SettingsStore.palette.collectAsState()
    val dark = when (pref) {
        "light" -> false
        "dark" -> true
        else -> isSystemInDarkTheme()
    }
    val theme = Themes.byId(paletteId)
    val scheme = if (dark) theme.dark else theme.light
    val view = LocalView.current
    if (!view.isInEditMode) {
        LaunchedEffect(dark) {
            val window = (view.context as Activity).window
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !dark
        }
    }
    MaterialTheme(colorScheme = scheme) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { content() }
    }
}
