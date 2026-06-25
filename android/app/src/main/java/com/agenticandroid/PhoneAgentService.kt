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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** A line in the on-phone chat with the agent. */
data class ChatMsg(val role: String, val text: String)

/** One registered capability, surfaced to the settings screen (method + human summary). */
data class CapInfo(val method: String, val summary: String)

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
        instance = this
        SettingsStore.init(this)
        startForeground(1, buildNotification())
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        connected.value = false
        super.onDestroy()
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
        capabilities.value = registry.all().map { CapInfo(it.method, it.summary) } // for the settings screen
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
        b.onEvent = { ev ->
            when (ev.topic) {
                "assistant_message" -> {
                    status.value = null // the reply landed — clear the "thinking…" indicator
                    val txt = (ev.data["text"] as? JsonPrimitive)?.content ?: ""
                    if (txt.isNotEmpty()) chat.value = chat.value + ChatMsg("assistant", txt)
                }
                "agent_status" -> {
                    status.value = (ev.data["label"] as? JsonPrimitive)?.content
                }
                "agent_identity" -> {
                    agentName.value = (ev.data["name"] as? JsonPrimitive)?.content
                }
            }
        }
        bus = b
        scope.launch {
            runCatching {
                b.connect()
                connected.value = true
                b.event("whoami", JsonObject(emptyMap())) // ask the agent who it is
            }
        }
    }

    /** Phone-initiated message to the agent (the user typed/spoke it). */
    fun sendUserMessage(text: String) {
        chat.value = chat.value + ChatMsg("user", text)
        status.value = "Sending…"
        bus?.event("user_message", JsonObject(mapOf("text" to JsonPrimitive(text))))
    }

    /** Phone-local transient status (e.g. "Transcribing…") shown in the chat. */
    fun setStatus(label: String?) { status.value = label }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        /** Set while the service is alive, so the UI can call sendUserMessage. */
        @Volatile var instance: PhoneAgentService? = null
        /** The chat transcript, observed by MainActivity. */
        val chat = MutableStateFlow<List<ChatMsg>>(emptyList())
        /** True once the relay connection is established. */
        val connected = MutableStateFlow(false)
        /** Human-readable name of the paired agent, announced over the connection. */
        val agentName = MutableStateFlow<String?>(null)
        /** All registered capabilities, for the settings screen's on/off list. */
        val capabilities = MutableStateFlow<List<CapInfo>>(emptyList())
        /** Transient "what's happening now" label (Transcribing…/Sending…/Thinking…/running an action). */
        val status = MutableStateFlow<String?>(null)
    }

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
