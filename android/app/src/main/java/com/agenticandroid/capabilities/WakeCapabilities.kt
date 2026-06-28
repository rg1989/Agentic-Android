package com.agenticandroid.capabilities

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.view.WindowManager
import com.agenticandroid.CapResult
import com.agenticandroid.Capability
import com.agenticandroid.Sensitivity
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Wake / unlock / keep-awake (DESIGN: "can it unlock the phone and keep it awake while using it?").
 *
 * What an unprivileged app CAN do, and what it can't:
 *   - Turn the screen on and show over the lock screen — yes (WakeActivity, setShowWhenLocked/turnScreenOn).
 *   - Dismiss an INSECURE (swipe) keyguard fully — yes (requestDismissKeyguard).
 *   - A SECURE lock (PIN/pattern/password/biometric) — NO app can enter it; requestDismissKeyguard
 *     surfaces the system unlock prompt and the user (or biometric) must complete it. Bypassing a
 *     secure lock needs device-owner/Shizuku/root. device.wake reports `secure` so the agent knows.
 *   - Keep the screen awake while driving other apps — yes, via a screen wake lock (below).
 */
class Waker(private val context: Context) {
    private var lock: PowerManager.WakeLock? = null

    /**
     * Hold the screen on for [ms] (<=0 = default). Always acquired WITH a timeout and auto-capped to
     * [MAX_AWAKE_MS] so a lock that is never explicitly released can't pin the screen bright until
     * reboot. Call [release] to end early, or device.wake again to re-arm. Returns the effective ms.
     */
    @Synchronized fun keepAwake(ms: Long): Long {
        releaseInternal()
        val hold = when { ms <= 0 -> DEFAULT_AWAKE_MS; ms > MAX_AWAKE_MS -> MAX_AWAKE_MS; else -> ms }
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        // ponytail: SCREEN_BRIGHT_WAKE_LOCK is deprecated, but it's the only non-root lever that keeps
        // the screen on for a headless agent driving *other* apps — FLAG_KEEP_SCREEN_ON needs our own
        // visible window. Upgrade path: WRITE_SETTINGS to bump SCREEN_OFF_TIMEOUT, or a kiosk/DPC build.
        @Suppress("DEPRECATION")
        lock = pm.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
            "agentic:awake",
        ).apply {
            setReferenceCounted(false)
            acquire(hold)  // always time-bounded — never an indefinite hold
        }
        return hold
    }

    @Synchronized fun release(): Boolean {
        val held = lock?.isHeld == true
        releaseInternal()
        return held
    }

    @Synchronized fun isAwake(): Boolean = lock?.isHeld == true

    private fun releaseInternal() {
        runCatching { if (lock?.isHeld == true) lock?.release() }
        lock = null
    }

    companion object {
        const val DEFAULT_AWAKE_MS = 10 * 60 * 1000L  // 10 min if caller doesn't specify
        const val MAX_AWAKE_MS = 30 * 60 * 1000L       // hard cap so a forgotten lock can't drain to reboot
    }
}

/** device.wake {dismiss?, keep_awake_ms?} — wake the screen, optionally dismiss the keyguard, hold it awake. */
class WakeCapability(private val ctx: Context, private val waker: Waker) : Capability {
    override val method = "device.wake"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Wake the screen, dismiss an insecure lock (secure locks prompt the user), keep awake. Params: {dismiss?, keep_awake_ms?} (default 10min, capped 30min; call device.release to end early)."
    override suspend fun execute(params: JsonObject): CapResult {
        val dismiss = (params["dismiss"] as? JsonPrimitive)?.content?.toBooleanStrictOrNull() ?: true
        val keepMs = (params["keep_awake_ms"] as? JsonPrimitive)?.content?.toLongOrNull() ?: 0L
        val km = ctx.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        val wasLocked = km.isKeyguardLocked
        val secure = km.isDeviceSecure

        val effectiveMs = waker.keepAwake(keepMs)
        ctx.startActivity(Intent(ctx, WakeActivity::class.java)
            .putExtra("dismiss", dismiss)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION))

        val note = when {
            !wasLocked -> "Screen woken; device was already unlocked."
            secure -> "Screen on; device has a SECURE lock — the system unlock prompt is shown for you or biometric to complete (no app can bypass it). Poll screen.state until locked=false."
            else -> "Screen on; insecure (swipe) lock dismissed automatically."
        }
        return CapResult(result = buildJsonObject {
            put("woke", true); put("was_locked", wasLocked); put("secure", secure)
            put("keeping_awake", waker.isAwake()); put("keep_awake_ms", effectiveMs)
            put("note", note)
        })
    }
}

/** device.release — release the keep-awake wake lock so the screen can time out normally. */
class WakeReleaseCapability(private val waker: Waker) : Capability {
    override val method = "device.release"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Release the keep-awake lock from device.wake; the screen can sleep again."
    override suspend fun execute(params: JsonObject): CapResult {
        val was = waker.release()
        return CapResult(result = buildJsonObject { put("released", true); put("was_awake", was) })
    }
}

/**
 * Transparent, no-content activity that turns the screen on, shows over the keyguard, and asks the
 * system to dismiss it. Finishes immediately (the Waker keeps the screen on) so it never blocks the
 * apps the agent is about to drive.
 */
class WakeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        else @Suppress("DEPRECATION") window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        )
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        if (intent.getBooleanExtra("dismiss", true) && km.isKeyguardLocked) {
            km.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() { finish() }
                override fun onDismissCancelled() { finish() }
                override fun onDismissError() { finish() }
            })
            // Safety net so we never orphan this activity. On a SECURE lock the bouncer is showing and
            // the user needs time to authenticate — finishing early would tear the prompt down — so
            // wait much longer there; an insecure swipe lock dismisses instantly so a short net is fine.
            val net = if (km.isDeviceSecure) 60_000L else 4_000L
            Handler(Looper.getMainLooper()).postDelayed({ if (!isFinishing) finish() }, net)
        } else finish()
    }
}
