// UNVERIFIED in this environment (no Kotlin toolchain). Compile & run on device before shipping.
//
// Gradle deps (owned by the gradle build unit, do NOT add here):
//   implementation("androidx.biometric:biometric:1.2.0-alpha05")
//
package com.agenticandroid.pairing

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Real `ask` confirmer — replaces the default-deny stub in PhoneAgentService.kt (Q8).
 *
 * Flow:
 *   1. Post a high-priority notification with Approve / Deny actions.
 *   2. If the user taps Approve, we raise a BiometricPrompt (fingerprint / face / PIN fallback)
 *      to ensure the person holding the phone is the owner.
 *   3. Return true only if both steps succeed within a 90-second window.
 *
 * The biometric step requires a FragmentActivity. Because PhoneAgentService is a Service (not an
 * Activity), it cannot host a FragmentActivity directly. Two implementation paths:
 *   A. ConfirmerActivity: a transparent, single-purpose Activity launched by the notification's
 *      Approve PendingIntent; it presents the BiometricPrompt and reports back via a coroutine
 *      channel. This is the correct Android-idiomatic approach.
 *   B. Notification-only: if biometrics are unavailable or the device has no enrolled credentials,
 *      fall back to notification-only approval (tap Approve = grant).
 *
 * This file implements path A. The service calls `Confirmer.ask(ctx, method, agentFp)` and awaits.
 *
 * TODO (device wiring):
 *   - Register ConfirmerActivity in AndroidManifest.xml:
 *       <activity android:name=".pairing.ConfirmerActivity"
 *                 android:theme="@android:style/Theme.Translucent.NoTitleBar"
 *                 android:excludeFromRecents="true"
 *                 android:taskAffinity=""
 *                 android:launchMode="singleTask" />
 *   - Register CONFIRMER_APPROVE_ACTION and CONFIRMER_DENY_ACTION as exported=false receivers
 *     (or inline via Context.registerReceiver with RECEIVER_NOT_EXPORTED flag on API 33+).
 *   - Ensure POST_NOTIFICATIONS permission is declared and granted (Android 13+).
 */

private const val CHANNEL_ID  = "confirmer_ask"
private const val NOTIF_ID    = 1001

const val CONFIRMER_APPROVE_ACTION = "com.agenticandroid.CONFIRMER_APPROVE"
const val CONFIRMER_DENY_ACTION    = "com.agenticandroid.CONFIRMER_DENY"
const val EXTRA_REQUEST_ID         = "request_id"
const val EXTRA_METHOD             = "method"
const val EXTRA_AGENT_FP           = "agent_fp"

/**
 * Registry of pending confirmations. ConfirmerActivity looks up and resolves the deferred
 * after a successful biometric, or rejects it on denial/timeout.
 */
object ConfirmerRegistry {
    private val pending = java.util.concurrent.ConcurrentHashMap<String, CompletableDeferred<Boolean>>()

    fun register(id: String): CompletableDeferred<Boolean> {
        val d = CompletableDeferred<Boolean>()
        pending[id] = d
        return d
    }

    fun resolve(id: String, granted: Boolean) {
        pending.remove(id)?.complete(granted)
    }

    fun cancel(id: String) {
        pending.remove(id)?.complete(false)
    }
}

/**
 * Main entry point — called from the service's request handler for `ask`-sensitivity capabilities.
 * Suspends until the user approves (biometric) or denies/times out.
 */
object Confirmer {
    private val idCounter = java.util.concurrent.atomic.AtomicInteger(0)

    /**
     * Post a high-priority notification asking the user to approve [method] invocation by
     * agent [agentFp]. Awaits biometric confirmation via ConfirmerActivity.
     * Returns false on denial or if no answer arrives within 90 seconds.
     */
    suspend fun ask(ctx: Context, method: String, agentFp: String): Boolean {
        ensureChannel(ctx)
        val requestId = "confirm_${System.currentTimeMillis()}_${idCounter.incrementAndGet()}"
        val deferred  = ConfirmerRegistry.register(requestId)

        postNotification(ctx, requestId, method, agentFp)

        // Wait up to 90 s; cancel the deferred on timeout so ConfirmerActivity doesn't leak.
        val result = withTimeoutOrNull(90_000) { deferred.await() } ?: false

        // Dismiss the notification regardless of outcome.
        (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .cancel(NOTIF_ID)
        if (!deferred.isCompleted) ConfirmerRegistry.cancel(requestId)

        return result
    }

    private fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val ch = NotificationChannel(
            CHANNEL_ID, "Agent approval required",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Tap to allow or deny a sensitive agent action"
            enableVibration(true)
        }
        nm.createNotificationChannel(ch)
    }

    private fun postNotification(ctx: Context, requestId: String, method: String, agentFp: String) {
        val flags = if (Build.VERSION.SDK_INT >= 31)
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        else
            PendingIntent.FLAG_UPDATE_CURRENT

        // Approve → launch ConfirmerActivity which will show BiometricPrompt.
        val approveIntent = Intent(ctx, ConfirmerActivity::class.java).apply {
            putExtra(EXTRA_REQUEST_ID, requestId)
            putExtra(EXTRA_METHOD,    method)
            putExtra(EXTRA_AGENT_FP,  agentFp)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val approvePi = PendingIntent.getActivity(ctx, idCounter.get(), approveIntent, flags)

        // Deny → broadcast that the service's deferred should complete(false).
        val denyIntent = Intent(CONFIRMER_DENY_ACTION).apply {
            `package` = ctx.packageName
            putExtra(EXTRA_REQUEST_ID, requestId)
        }
        val denyPi = PendingIntent.getBroadcast(ctx, idCounter.get() + 1000, denyIntent, flags)

        val shortFp = agentFp.take(12)
        val notif = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Agent action: $method")
            .setContentText("Agent $shortFp… is requesting permission.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(false)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Deny",    denyPi)
            .addAction(android.R.drawable.ic_menu_send,                "Approve", approvePi)
            .build()

        (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIF_ID, notif)
    }
}

/**
 * Transparent Activity that presents the BiometricPrompt after the user taps "Approve".
 * Reports outcome to ConfirmerRegistry and finishes immediately.
 *
 * TODO: add to AndroidManifest.xml as described above.
 */
class ConfirmerActivity : FragmentActivity() {

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)

        val requestId = intent.getStringExtra(EXTRA_REQUEST_ID) ?: run {
            finish(); return
        }
        val method   = intent.getStringExtra(EXTRA_METHOD)   ?: "unknown"
        val agentFp  = intent.getStringExtra(EXTRA_AGENT_FP) ?: "unknown"

        val biometricManager = BiometricManager.from(this)
        val canAuthenticate = biometricManager.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL
        )

        if (canAuthenticate != BiometricManager.BIOMETRIC_SUCCESS) {
            // No biometrics or screen lock enrolled — fall back to notification-only approval.
            // The user already tapped Approve so we grant.
            ConfirmerRegistry.resolve(requestId, true)
            finish()
            return
        }

        val executor = ContextCompat.getMainExecutor(this)
        val prompt = BiometricPrompt(this, executor, object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                ConfirmerRegistry.resolve(requestId, true)
                finish()
            }
            override fun onAuthenticationFailed() {
                // Single failed attempt — let the prompt retry (don't cancel yet).
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                // User cancelled or too many failures.
                ConfirmerRegistry.resolve(requestId, false)
                finish()
            }
        })

        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Approve: $method")
            .setSubtitle("Agent ${agentFp.take(12)}… is requesting this action.")
            .setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_STRONG or
                BiometricManager.Authenticators.DEVICE_CREDENTIAL
            )
            .build()

        prompt.authenticate(info)
    }

    override fun onDestroy() {
        super.onDestroy()
        // If the activity is destroyed before the prompt resolves (e.g. user swipes away),
        // resolve as denied so the service's coroutine doesn't hang until timeout.
        val requestId = intent.getStringExtra(EXTRA_REQUEST_ID) ?: return
        ConfirmerRegistry.cancel(requestId)
    }
}

/**
 * BroadcastReceiver for the Deny action on the notification.
 * TODO: register in AndroidManifest.xml as exported=false:
 *   <receiver android:name=".pairing.ConfirmerDenyReceiver" android:exported="false" />
 */
class ConfirmerDenyReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val requestId = intent.getStringExtra(EXTRA_REQUEST_ID) ?: return
        ConfirmerRegistry.resolve(requestId, false)
    }
}
