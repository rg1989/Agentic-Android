// UNVERIFIED in this environment (no Kotlin toolchain). Compile & run on device before shipping.
package com.agenticandroid

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import com.agenticandroid.capabilities.registerTier1
import com.agenticandroid.pairing.Confirmer
import com.agenticandroid.pairing.Pairing
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/**
 * Foreground service (Q2) — holds the persistent relay connection so the phone is reachable from
 * anywhere. When Doze kills the socket, FCM (WakeMessagingService) restarts/reconnects this.
 *
 * Wires the registry + on-phone consent (Q8) into the inbound request handler.
 * Pairing and confirmation are now backed by real implementations in com.agenticandroid.pairing.
 *
 * TODO: just-in-time OS permission prompts for Tier-1 capabilities (camera, location, sms).
 */
class PhoneAgentService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val registry = CapabilityRegistry() // populated by registerTier1() once the bus is up
    private val policy = ConsentPolicy()
    @Volatile var micMuted = false // hard mic mute for the always-on wake word (Q12 trust)

    private var bus: BusEndpoint? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(1, buildNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureConnected()
        return START_STICKY
    }

    private fun ensureConnected() {
        if (bus != null) return
        val pairing = Pairing.load(this) ?: return // not paired yet — PairingActivity handles this
        val b = BusEndpoint(pairing.self, pairing.peerEdPub, pairing.relayUrl)
        registerTier1(registry, b, this) // camera / location / sms / notifications (Q4 swap point)
        b.onRequest = handler@{ req, agentFp ->
            if (req.method == "list_capabilities")
                return@handler CapResult(result = registry.catalog(agentFp, policy))
            val cap = registry.get(req.method)
                ?: return@handler typedError("UNKNOWN_METHOD", req.method)
            when (policy.effective(agentFp, req.method, cap.sensitivity)) {
                Sensitivity.DENY  -> typedError("CONSENT_DENIED", "${req.method} is denied")
                Sensitivity.ASK   ->
                    if (Confirmer.ask(this, req.method, agentFp)) cap.execute(req.params)
                    else typedError("CONSENT_DENIED", "user declined")
                Sensitivity.ALLOW -> cap.execute(req.params)
            }
        }
        b.onEvent = { /* phone is the requester for events; none expected inbound in v1 */ }
        bus = b
        scope.launch { runCatching { b.connect() } }
    }

    /** Phone-initiated event path (capability B) — e.g. a transcribed wake-word utterance. */
    fun sendUserMessage(text: String) =
        bus?.event("user_message", JsonObject(mapOf("text" to kotlinx.serialization.json.JsonPrimitive(text))))

    override fun onBind(intent: Intent?): IBinder? = null

    private fun buildNotification(): Notification {
        val ch = "agent"
        (getSystemService(NotificationManager::class.java)).createNotificationChannel(
            NotificationChannel(ch, "Agent connection", NotificationManager.IMPORTANCE_LOW)
        )
        return Notification.Builder(this, ch)
            .setContentTitle("Agentic Android")
            .setContentText("Connected to your agent")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .build()
    }
}
