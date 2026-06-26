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
import com.agenticandroid.voice.TextToSpeech
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** A line in the on-phone chat with the agent. `imagePath` (a local JPEG) renders as an inline preview. */
data class ChatMsg(val role: String, val text: String, val imagePath: String? = null)

/** A slash command/skill the connected agent exposes, shown in the phone's `/` menu. */
data class SlashCommand(val invoke: String, val description: String, val hint: String?, val kind: String, val group: String)

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
    private var registry = CapabilityRegistry() // rebuilt per connection (bound to the active agent's bus)
    private val policy = ConsentPolicy()
    @Volatile var micMuted = false // hard mic mute for the always-on wake word (Q12 trust)

    private var bus: BusEndpoint? = null
    private var reconnectJob: kotlinx.coroutines.Job? = null // backoff reconnect when the link drops
    private var tts: TextToSpeech? = null // spoken replies (on-device); init lazily in onCreate

    override fun onCreate() {
        super.onCreate()
        instance = this
        SettingsStore.init(this)
        Agents.init(this)
        tts = TextToSpeech(this).also { it.init { } }
        startForeground(1, buildNotification())
        // Start/stop the always-on wake-word service to follow the setting (needs mic permission).
        scope.launch {
            SettingsStore.wakeWord.collect { on ->
                if (on && hasMicPermission()) WakeWordService.start(this@PhoneAgentService)
                else WakeWordService.stop(this@PhoneAgentService)
            }
        }
    }

    private fun hasMicPermission(): Boolean =
        androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECORD_AUDIO) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED

    override fun onDestroy() {
        if (instance === this) instance = null
        connected.value = false
        tts?.shutdown(); tts = null
        super.onDestroy()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureConnected()
        return START_STICKY
    }

    private fun ensureConnected() {
        if (!SettingsStore.connectionEnabled.value) return // user has the connection switched off
        if (bus != null) return
        connectActive()
    }

    /** Master connect/disconnect switch. Keeps the pairing — just drops or re-establishes the link, so
     *  the user can disconnect fast and reconnect instantly without re-pairing. */
    fun setConnectionEnabled(enabled: Boolean) {
        SettingsStore.setConnectionEnabled(enabled)
        if (enabled) {
            ensureConnected()
        } else {
            reconnectJob?.cancel(); reconnectJob = null
            bus?.close(); bus = null
            connected.value = false
            status.value = null
        }
    }

    /** Switch the active agent and reconnect the bus to it. */
    fun switchAgent(id: String) {
        if (Agents.activeId.value == id && bus != null) return
        Agents.setActive(this, id)
        reconnect()
    }

    /** Tear down the current connection and reconnect to whichever agent is active now. */
    fun reconnect() {
        reconnectJob?.cancel()
        bus?.close()
        bus = null
        connected.value = false
        chat.value = emptyList() // a fresh conversation for the agent we're switching to
        status.value = null
        agentName.value = Agents.active()?.name
        connectActive()
    }

    private fun connectActive() {
        if (!SettingsStore.connectionEnabled.value) return // disconnected by the user
        val active = Agents.active() ?: return // not paired yet — PairingActivity handles this
        agentName.value = active.name
        registry = CapabilityRegistry() // fresh registry bound to this agent's bus
        val b = BusEndpoint(Agents.self(this), active.peerEdPub, active.relayUrl)
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
                    if (txt.isNotEmpty()) {
                        chat.value = chat.value + ChatMsg("assistant", txt)
                        speak(txt) // reads it aloud (cleaned for listening) if the setting is on
                    }
                }
                "agent_status" -> {
                    status.value = (ev.data["label"] as? JsonPrimitive)?.content
                }
                "agent_commands" -> {
                    val list = (ev.data["commands"] as? JsonArray)?.mapNotNull { el ->
                        val o = el as? JsonObject ?: return@mapNotNull null
                        val invoke = (o["invoke"] as? JsonPrimitive)?.content ?: return@mapNotNull null
                        SlashCommand(
                            invoke = invoke,
                            description = (o["description"] as? JsonPrimitive)?.content ?: "",
                            hint = (o["hint"] as? JsonPrimitive)?.content,
                            kind = (o["kind"] as? JsonPrimitive)?.content ?: "command",
                            group = (o["group"] as? JsonPrimitive)?.content ?: "",
                        )
                    }.orEmpty()
                    commands.value = list
                    android.util.Log.i("AgentCommands", "received ${list.size} slash commands")
                }
                "agent_identity" -> {
                    val name = (ev.data["name"] as? JsonPrimitive)?.content
                    agentName.value = name
                    // Remember the agent's real name on its profile so the picker shows it.
                    if (!name.isNullOrBlank()) Agents.active()?.let { Agents.setName(this, it.id, name) }
                }
                "history" -> {
                    // The hub owns the conversation; replay it so reopening the app shows history.
                    (ev.data["messages"] as? JsonArray)?.let { arr ->
                        val msgs = arr.mapNotNull { el ->
                            val o = el as? JsonObject ?: return@mapNotNull null
                            val role = (o["role"] as? JsonPrimitive)?.content ?: return@mapNotNull null
                            ChatMsg(role, (o["text"] as? JsonPrimitive)?.content ?: "")
                        }
                        if (msgs.isNotEmpty()) chat.value = msgs
                        android.util.Log.i("AgentHistory", "replayed ${msgs.size} turns from hub")
                    }
                }
            }
        }
        b.onDisconnect = {
            if (bus === b) { connected.value = false; bus = null }
            scheduleReconnect() // an established connection dropped — retry with backoff
        }
        bus = b
        scope.launch {
            try {
                b.connect()
                connected.value = true
                b.event("whoami", JsonObject(emptyMap())) // ask the agent who it is (replays history)
            } catch (e: Exception) {
                connected.value = false
                if (bus === b) bus = null // connect failed — drop so reconnect can rebuild
            }
        }
    }

    /** Keep trying to (re)connect to the active agent with exponential backoff until we're up. */
    private fun scheduleReconnect() {
        if (!SettingsStore.connectionEnabled.value) return // user is disconnected — don't fight it
        if (reconnectJob?.isActive == true) return
        reconnectJob = scope.launch {
            var delayMs = 2000L
            while (isActive && Agents.active() != null && !connected.value && SettingsStore.connectionEnabled.value) {
                connectActive() // builds the bus + launches connect (no-op if one is already in flight)
                kotlinx.coroutines.delay(delayMs)
                if (connected.value) break
                delayMs = (delayMs * 2).coerceAtMost(30_000)
            }
        }
    }

    /** Phone-initiated message to the agent (the user typed/spoke it). */
    fun sendUserMessage(text: String) {
        tts?.stop() // barge-in: stop speaking the previous reply when the user talks again
        chat.value = chat.value + ChatMsg("user", text)
        status.value = "Sending…"
        bus?.event("user_message", JsonObject(mapOf("text" to JsonPrimitive(text))))
    }

    /** Stop any in-progress spoken reply (used for tap-to-stop / barge-in). */
    fun stopSpeaking() {
        tts?.stop()
        speaking.value = false
        WakeWordService.instance?.resume(WakeWordService.TTS) // give the mic back to the wake word
        if (status.value == "🔊 Speaking…") status.value = null
    }

    /** Mark whether the user is recording. Turning it on stops any in-progress reply (the agent
     *  must never talk over the mic); [speak] won't start a new one until it's off again. */
    fun setRecording(on: Boolean) {
        recording.value = on
        if (on) stopSpeaking()
    }

    /** Speak [raw] aloud, cleaned for listening, if the user enabled spoken replies. */
    private fun speak(raw: String) {
        if (!SettingsStore.voiceReplies.value) return
        if (recording.value) return // never start reading while the user is recording
        val say = SpeechText.forSpeech(raw)
        if (say.isBlank()) return
        android.util.Log.i("AgentTTS", "speaking: ${say.take(80)}")
        status.value = "🔊 Speaking…"
        speaking.value = true
        WakeWordService.instance?.pause(WakeWordService.TTS) // release the mic so we don't hear ourselves
        tts?.speak(say) {
            speaking.value = false
            WakeWordService.instance?.resume(WakeWordService.TTS)
            if (status.value == "🔊 Speaking…") status.value = null
        }
    }

    /** Phone-local transient status (e.g. "Transcribing…") shown in the chat. */
    fun setStatus(label: String?) { status.value = label }

    /** A photo the agent just took — show it inline in the chat (also saved to the gallery). */
    fun addPhoto(localPath: String) {
        chat.value = chat.value + ChatMsg("assistant", "", imagePath = localPath)
    }

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
        /** Slash commands/skills the connected agent exposes, for the `/` menu. */
        val commands = MutableStateFlow<List<SlashCommand>>(emptyList())
        /** True while a spoken reply is playing — the wake-word service ignores input meanwhile. */
        val speaking = MutableStateFlow(false)
        /** True while the user is recording voice (hold-to-talk or wake-word capture). The agent
         *  never starts speaking while this is set, and any in-progress speech is stopped. */
        val recording = MutableStateFlow(false)
    }

    private fun buildNotification(): Notification {
        val ch = "agent"
        (getSystemService(NotificationManager::class.java)).createNotificationChannel(
            NotificationChannel(ch, "Agent connection", NotificationManager.IMPORTANCE_LOW)
        )
        return Notification.Builder(this, ch)
            .setContentTitle("Agentic Android")
            .setContentText("Connected to your agent")
            .setSmallIcon(R.drawable.ic_agent_notification)
            .setOngoing(true)
            .build()
    }
}
