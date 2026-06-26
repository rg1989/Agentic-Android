package com.agenticandroid

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat

/**
 * Restart the always-on wake word after a reboot. A foreground microphone service does not survive a
 * restart on its own, so without this the user would have to reopen the app to get hands-free back.
 * Only starts if the user has wake word enabled and the mic permission is granted.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        SettingsStore.init(context)
        val micGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        if (SettingsStore.wakeWord.value && micGranted) {
            WakeWordService.start(context)
        }
    }
}
