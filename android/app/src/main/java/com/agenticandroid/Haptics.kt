package com.agenticandroid

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Tiny haptic cues for the voice flow — distinct feels for start / lock / send / cancel so you can
 * sense state changes without looking. No-op on devices without a vibrator. Create once with the Activity.
 */
class Haptics(context: Context) {
    private val vib: Vibrator? = runCatching {
        if (Build.VERSION.SDK_INT >= 31) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION") context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
    }.getOrNull()?.takeIf { it.hasVibrator() }

    /** Recording started — a light tick. */
    fun start() = effect(VibrationEffect.EFFECT_TICK, 18, 130)
    /** Locked hands-free — a firm confirm you can clearly feel. */
    fun lock() = effect(VibrationEffect.EFFECT_HEAVY_CLICK, 38, 255)
    /** Sent / accepted. */
    fun confirm() = effect(VibrationEffect.EFFECT_CLICK, 22, 190)
    /** Crossing into the cancel zone — a subtle nudge. */
    fun tick() = effect(VibrationEffect.EFFECT_TICK, 12, 90)

    /** Cancelled / discarded — a double tap. */
    fun cancel() {
        val v = vib ?: return
        runCatching {
            if (Build.VERSION.SDK_INT >= 29) v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_DOUBLE_CLICK))
            else oneShot(40, 200)
        }
    }

    private fun effect(predefined: Int, ms: Long, amplitude: Int) {
        val v = vib ?: return
        runCatching {
            if (Build.VERSION.SDK_INT >= 29) v.vibrate(VibrationEffect.createPredefined(predefined))
            else oneShot(ms, amplitude)
        }
    }

    private fun oneShot(ms: Long, amplitude: Int) {
        val v = vib ?: return
        if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(ms, amplitude))
        else @Suppress("DEPRECATION") v.vibrate(ms)
    }
}
