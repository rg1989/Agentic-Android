// UNVERIFIED in this environment (no Kotlin toolchain). Compile & run on device before shipping.
package com.agenticandroid

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import com.agenticandroid.voice.TextToSpeech
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** A line in the on-phone chat with the harness. `imagePath` (a local JPEG) renders as an inline preview. */
data class ChatMsg(val role: String, val text: String, val imagePath: String? = null, val ts: Long = System.currentTimeMillis(), val parts: List<MsgPart> = emptyList())

/** A harness connected to a hub. `active` = active within its hub; `hubId`/`hubName` tag which hub it's
 *  on, so the header picker can list harnesses across all online hubs and group them. */
data class RosterAgent(
    val id: String,
    val name: String,
    val active: Boolean,
    val external: Boolean = false,
    val hubId: String = "",
    val hubName: String = "",
    // Hub's verdict on whether this harness really answers: "verifying" | "verified" | "failed" | "stale".
    // Defaults to "verified" so older hubs that don't send it don't show a false alarm.
    val verified: String = "verified",
)

/** A chat session with the harness (Phase: multi-session). */
data class SessionInfo(val id: String, val title: String, val ts: Long)

/** A file being uploaded to the harness right now — shown as a pending chip with progress until sent. */
data class PendingUpload(val id: String, val name: String, val mime: String?, val size: Int, val sent: Long)

/** A slash command/skill the connected harness exposes, shown in the phone's `/` menu. */
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
    /** Consent is the phone's, shared across every hub's bus (keyed by the calling harness's fingerprint). */
    val consentPolicy = ConsentPolicy()
    @Volatile var micMuted = false // hard mic mute for the always-on wake word (Q12 trust)

    /** One live connection per paired hub — all connected at once (full simultaneous sessions). */
    private val connections = java.util.concurrent.ConcurrentHashMap<String, HubConnection>()
    private var tts: TextToSpeech? = null // spoken replies (on-device); init lazily in onCreate

    /** The hub whose chat/sessions are currently shown (the active one). */
    private fun foreground(): HubConnection? = Agents.activeId.value?.let { connections[it] }
    fun hasProfile(id: String): Boolean = Agents.profiles.value.any { it.id == id }

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
        connections.values.forEach { it.stop() }
        connections.clear()
        connected.value = false
        tts?.shutdown(); tts = null
        super.onDestroy()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureConnections()
        return START_STICKY
    }

    /** Reconcile the live connections with the paired-hub list: open any new hub, drop any removed one,
     *  and (re)start the rest. Idempotent — safe to call on start, on pair, and on reconnect. */
    fun ensureConnections() {
        if (!SettingsStore.connectionEnabled.value) return // user has the connection switched off
        val ids = Agents.profiles.value.associateBy { it.id }
        // Drop connections whose hub was unpaired.
        for (id in connections.keys.toList()) if (id !in ids) connections.remove(id)?.stop()
        // Open/refresh a connection for every paired hub.
        for ((id, profile) in ids) {
            val c = connections.getOrPut(id) { HubConnection(profile, this) }
            c.profile = profile // pick up any rename/relay change
            c.start()
        }
        refreshForeground()
        onAggregateChanged()
    }

    /** Master connect/disconnect switch. Keeps the pairings — just drops or re-establishes every link. */
    fun setConnectionEnabled(enabled: Boolean) {
        SettingsStore.setConnectionEnabled(enabled)
        if (enabled) {
            ensureConnections()
        } else {
            connections.values.forEach { it.stop() }
            connections.clear()
            connected.value = false
            status.value = null
        }
    }

    /** Make [id] the foreground hub (the one whose chat is shown). No reconnect — every hub stays live;
     *  we just re-point the UI and ask the now-foreground hub to replay its history + roster. */
    fun switchHub(id: String) {
        if (Agents.activeId.value == id && foreground() != null) return
        Agents.setActive(this, id)
        unreadHubs.value = unreadHubs.value - id
        chat.value = emptyList() // cleared until the foreground hub replays its history
        status.value = null
        commands.value = emptyList()
        refreshForeground()
        foreground()?.let { it.requestReplay(); it.start() } // start() is a no-op if it's already up
        onAggregateChanged()
    }

    /** Backward-compatible alias used by older call sites (switching hub == switching the active "harness" tab). */
    fun switchAgent(id: String) = switchHub(id)

    /** Drop a hub entirely: close its connection and forget the pairing, repicking a foreground hub. */
    fun forgetHub(id: String) {
        connections.remove(id)?.stop()
        Agents.remove(this, id) // also repoints activeId to a remaining hub (or null)
        unreadHubs.value = unreadHubs.value - id
        refreshForeground()
        foreground()?.requestReplay()
        onAggregateChanged()
    }

    /** Re-sync connections and kick any offline hub to reconnect (the manual "Retry"). */
    fun reconnect() = ensureConnections()

    /** Push the foreground hub's name/harness into the shared header flows after a switch. */
    private fun refreshForeground() {
        val fg = foreground()
        agentName.value = fg?.lastAgentName ?: Agents.active()?.let { it.display() }
        roster.value = fg?.roster?.value ?: emptyList()
        connected.value = fg?.online?.value == true
    }

    /** Recompute the cross-hub aggregates (online set, all-harnesses union, foreground connected flag).
     *  Called by every [HubConnection] whenever its online/roster state changes. */
    fun onAggregateChanged() {
        val live = connections.values.filter { it.online.value }
        onlineHubs.value = live.map { it.id }.toSet()
        allAgents.value = live.flatMap { it.roster.value }
        connected.value = foreground()?.online?.value == true
        android.util.Log.i("HubAgg", "connections=${connections.size} online=${live.size} ${live.map { it.profile.display() }} allAgents=${allAgents.value.size} [${allAgents.value.joinToString { it.name + "@" + it.hubName }}]")
    }

    /** A [HubConnection] for the foreground hub publishes the phone's capability list (same for all hubs). */
    fun publishCapabilities(caps: List<CapInfo>) { capabilities.value = caps }

    /** Foreground hub delivered a reply: show it in the chat + speak it. */
    fun onForegroundReply(text: String, parts: List<MsgPart>) {
        status.value = null
        chat.value = chat.value + ChatMsg("assistant", text, parts = parts)
        speak(MsgPart.spoken(parts, text))
    }

    /** A non-foreground hub delivered a reply: mark it unread + post a notification (don't touch the chat). */
    fun onBackgroundMessage(profile: AgentProfile, text: String) {
        unreadHubs.value = unreadHubs.value + profile.id
        notifyHubMessage(profile, text)
    }

    /**
     * Phone-initiated message to the harness (the user typed/spoke it), optionally with attached parts.
     * [viaWake] marks a hands-free wake-word turn — its reply is always spoken even if replies are
     * muted, since the user can't see the screen.
     */
    fun sendUserMessage(text: String, parts: JsonArray? = null, viaWake: Boolean = false) {
        lastTurnViaWake = viaWake
        tts?.stop() // barge-in: stop speaking the previous reply when the user talks again
        chat.value = chat.value + ChatMsg("user", text, parts = MsgPart.parse(parts))
        status.value = "Sending…"
        val data = buildMap<String, kotlinx.serialization.json.JsonElement> {
            put("text", JsonPrimitive(text))
            if (parts != null) put("parts", parts)
        }
        foreground()?.event("user_message", JsonObject(data))
    }

    /** Upload bytes as an E2E blob sealed for the foreground hub's harness; returns its id. Blocking. */
    fun putBlob(bytes: ByteArray, onProgress: ((Long, Long) -> Unit)? = null): String? =
        foreground()?.putBlob(bytes, onProgress)

    /** Pick a connected harness WITHIN the foreground hub (Settings roster). */
    fun selectAgent(id: String) {
        foreground()?.event("select_agent", JsonObject(mapOf("id" to JsonPrimitive(id))))
    }

    /** Pick a harness on ANY online hub (the header picker): foreground its hub first, then route to it. */
    fun selectAgentOnHub(hubId: String, agentId: String) {
        if (Agents.activeId.value != hubId) switchHub(hubId)
        connections[hubId]?.event("select_agent", JsonObject(mapOf("id" to JsonPrimitive(agentId))))
    }

    // ---- chat sessions (multi-session) — always target the foreground hub ----
    fun newSession() { foreground()?.event("new_session", JsonObject(emptyMap())) }
    fun selectSession(id: String) { foreground()?.event("select_session", JsonObject(mapOf("id" to JsonPrimitive(id)))) }
    fun deleteSession(id: String) { foreground()?.event("delete_session", JsonObject(mapOf("id" to JsonPrimitive(id)))) }

    /** Stop any in-progress spoken reply (used for tap-to-stop / barge-in). */
    fun stopSpeaking() {
        tts?.stop()
        speaking.value = false
        WakeWordService.instance?.resume(WakeWordService.TTS) // give the mic back to the wake word
        if (status.value == "🔊 Speaking…") status.value = null
    }

    /** Mark whether the user is recording. Turning it on stops any in-progress reply (the harness
     *  must never talk over the mic); [speak] won't start a new one until it's off again. */
    fun setRecording(on: Boolean) {
        recording.value = on
        if (on) stopSpeaking()
    }

    /** True when the in-flight turn came from the wake word — its reply speaks even if replies are muted. */
    @Volatile private var lastTurnViaWake = false

    /** Speak [raw] aloud, cleaned for listening, if replies are on (or it's a hands-free wake-word turn). */
    private fun speak(raw: String) {
        if (!SettingsStore.voiceReplies.value && !lastTurnViaWake) return
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

    /** Fetch + E2E-decrypt an out-of-band blob (e.g. an image/file the harness sent). Blocking — call off-main. */
    /**
     * Fetch + E2E-decrypt a blob, caching it locally so it survives the relay's short TTL — the harness's
     * files/images stay openable/shareable/downloadable long after the relay would have dropped them.
     * Blocking — call off-main.
     */
    fun fetchBlob(blobId: String): ByteArray? {
        // Disk cache is shared (keyed by blob id); on a miss, fetch via the foreground hub's bus.
        val f = java.io.File(java.io.File(cacheDir, "blobs").apply { mkdirs() }, blobId)
        if (f.exists()) return runCatching { f.readBytes() }.getOrNull()
        return foreground()?.fetchBlob(blobId)
    }

    /** Grab a blob into the local cache now (while the relay copy is still alive), off the main thread. */
    fun prefetchBlob(blobId: String) { foreground()?.prefetchBlob(blobId) }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        /** Set while the service is alive, so the UI can call sendUserMessage. */
        @Volatile var instance: PhoneAgentService? = null
        /** The chat transcript, observed by MainActivity. */
        val chat = MutableStateFlow<List<ChatMsg>>(emptyList())
        /** True once the relay connection is established. */
        val connected = MutableStateFlow(false)
        /** Human-readable name of the paired harness, announced over the connection. */
        val agentName = MutableStateFlow<String?>(null)
        /** All registered capabilities, for the settings screen's on/off list. */
        val capabilities = MutableStateFlow<List<CapInfo>>(emptyList())
        /** Transient "what's happening now" label (Transcribing…/Sending…/Thinking…/running an action). */
        val status = MutableStateFlow<String?>(null)
        /** Slash commands/skills the connected harness exposes, for the `/` menu. */
        val commands = MutableStateFlow<List<SlashCommand>>(emptyList())
        /** Harnesses on the FOREGROUND hub — for the Settings in-hub roster. */
        val roster = MutableStateFlow<List<RosterAgent>>(emptyList())
        /** Hub ids with a live connection right now — drives the "online hubs" list in the drawer. */
        val onlineHubs = MutableStateFlow<Set<String>>(emptySet())
        /** Every harness across all ONLINE hubs (tagged with its hub) — for the cross-hub header picker. */
        val allAgents = MutableStateFlow<List<RosterAgent>>(emptyList())
        /** Hubs with an unread background message (cleared when you switch to them) — for a drawer dot. */
        val unreadHubs = MutableStateFlow<Set<String>>(emptySet())
        /** Chat sessions for the active harness + which one is open. */
        val sessions = MutableStateFlow<List<SessionInfo>>(emptyList())
        val activeSessionId = MutableStateFlow<String?>(null)
        /** Blob ids currently being saved to the phone (drives the per-file download spinner). */
        val downloading = MutableStateFlow<Set<String>>(emptySet())
        /** Files being uploaded to the harness right now (drives the pending-upload chips + progress). */
        val uploads = MutableStateFlow<List<PendingUpload>>(emptyList())
        /** True while a spoken reply is playing — the wake-word service ignores input meanwhile. */
        val speaking = MutableStateFlow(false)
        /** True while the user is recording voice (hold-to-talk or wake-word capture). The harness
         *  never starts speaking while this is set, and any in-progress speech is stopped. */
        val recording = MutableStateFlow(false)
    }

    /** Post a heads-up notification for a reply that arrived on a non-foreground hub; tapping switches to it. */
    private fun notifyHubMessage(profile: AgentProfile, text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        val ch = "hub_messages"
        nm.createNotificationChannel(NotificationChannel(ch, "Messages from other hubs", NotificationManager.IMPORTANCE_HIGH))
        val tap = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("open_hub", profile.id)
        val pi = android.app.PendingIntent.getActivity(
            this, profile.id.hashCode(), tap,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
        )
        nm.notify(("hub:" + profile.id).hashCode(), Notification.Builder(this, ch)
            .setContentTitle(profile.display())
            .setContentText(text.take(140))
            .setSmallIcon(R.drawable.ic_agent_notification)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build())
    }

    private fun buildNotification(): Notification {
        val ch = "agent"
        (getSystemService(NotificationManager::class.java)).createNotificationChannel(
            NotificationChannel(ch, "Agent connection", NotificationManager.IMPORTANCE_LOW)
        )
        return Notification.Builder(this, ch)
            .setContentTitle("Agentic Android")
            .setContentText("Connected to your harness")
            .setSmallIcon(R.drawable.ic_agent_notification)
            .setOngoing(true)
            .build()
    }
}
