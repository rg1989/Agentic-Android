// UNVERIFIED in this environment (no Kotlin toolchain). Compile & run on device before shipping.
package com.agenticandroid

import android.util.Log
import com.agenticandroid.capabilities.registerTier1
import com.agenticandroid.pairing.Confirmer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * One live connection to a single hub. Owns that hub's [BusEndpoint], its capability registry (bound to
 * the bus so results route back), its connection/online state, and its agent roster.
 *
 * The phone keeps one [HubConnection] per paired hub, all connected at once (full simultaneous sessions).
 * Events drive the shared "foreground" UI flows on [PhoneAgentService] ONLY when this hub is the active
 * one ([isForeground]); a background hub just keeps its roster/online live and turns a new
 * assistant_message into a notification + unread dot. [PhoneAgentService] orchestrates the set.
 */
class HubConnection(
    @Volatile var profile: AgentProfile,
    private val service: PhoneAgentService,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var bus: BusEndpoint? = null
    private var reconnectJob: Job? = null
    private var registry = CapabilityRegistry() // rebuilt per connect, bound to this hub's bus

    /** True while this hub's relay link is established. Drives the "online hubs" list. */
    val online = MutableStateFlow(false)
    /** Agents currently connected to THIS hub (tagged with the hub so the cross-hub picker can group them). */
    val roster = MutableStateFlow<List<RosterAgent>>(emptyList())
    /** The active agent name this hub last announced — shown in the header when this hub is foreground. */
    @Volatile var lastAgentName: String? = null
        private set

    val id: String get() = profile.id
    private fun isForeground(): Boolean = Agents.activeId.value == profile.id

    fun busOrNull(): BusEndpoint? = bus

    /** Open the connection (no-op if already up or connecting). */
    fun start() { if (bus == null) connect() }

    /** Close the connection and clear this hub's state (used on unpair / global disconnect). */
    fun stop() {
        reconnectJob?.cancel(); reconnectJob = null
        bus?.close(); bus = null
        online.value = false
        roster.value = emptyList()
        service.onAggregateChanged()
    }

    private fun connect() {
        if (!SettingsStore.connectionEnabled.value) return
        val self = Agents.self(service)
        registry = CapabilityRegistry() // fresh registry bound to this bus
        val b = BusEndpoint(self, profile.peerEdPub, profile.relayUrl)
        registerTier1(registry, b, service) // camera / location / sms / notifications
        if (isForeground()) service.publishCapabilities(registry.all().map { CapInfo(it.method, it.summary) })
        b.onRequest = handler@{ req, agentFp ->
            if (req.method == "list_capabilities")
                return@handler CapResult(result = registry.catalog(agentFp, service.consentPolicy))
            val cap = registry.get(req.method) ?: return@handler typedError("UNKNOWN_METHOD", req.method)
            when (service.consentPolicy.effective(agentFp, req.method, cap.sensitivity)) {
                Sensitivity.DENY  -> typedError("CONSENT_DENIED", "${req.method} is denied")
                Sensitivity.ASK   ->
                    if (Confirmer.ask(service, req.method, agentFp)) cap.execute(req.params)
                    else typedError("CONSENT_DENIED", "user declined")
                Sensitivity.ALLOW -> cap.execute(req.params)
            }
        }
        b.onEvent = { ev -> handleEvent(ev) }
        b.onDisconnect = {
            Log.w(TAG, "dropped: ${profile.display()} [${profile.id.take(6)}]")
            if (bus === b) { online.value = false; bus = null; service.onAggregateChanged() }
            scheduleReconnect() // an established connection dropped — retry with backoff
        }
        bus = b
        scope.launch {
            try {
                b.connect()
                Log.i(TAG, "relay up: ${profile.display()} [${profile.id.take(6)}] @ ${profile.relayUrl} — waiting for hub")
                // 'online' means the HUB answered, not just that its relay accepts us — a relay can be up
                // with no hub behind it. It flips true in handleEvent on the hub's first reply to whoami.
                b.event("whoami", JsonObject(emptyMap())) // ask the hub who it is (replays history/roster)
            } catch (e: Exception) {
                Log.w(TAG, "connect FAILED: ${profile.display()} @ ${profile.relayUrl}: ${e.message}")
                online.value = false
                if (bus === b) bus = null // connect failed — drop so reconnect can rebuild
                service.onAggregateChanged()
                scheduleReconnect()
            }
        }
    }

    private companion object { const val TAG = "HubConn" }

    /** Keep trying to (re)connect with exponential backoff until this hub is up again. */
    private fun scheduleReconnect() {
        if (!SettingsStore.connectionEnabled.value) return
        if (reconnectJob?.isActive == true) return
        reconnectJob = scope.launch {
            var delayMs = 2000L
            while (isActive && !online.value && SettingsStore.connectionEnabled.value && service.hasProfile(profile.id)) {
                connect()
                delay(delayMs)
                if (online.value) break
                delayMs = (delayMs * 2).coerceAtMost(30_000)
            }
        }
    }

    /** Foregrounding this hub: replay its history + roster so the chat shows it (no reconnect). */
    fun requestReplay() { bus?.event("whoami", JsonObject(emptyMap())) }

    fun event(topic: String, data: JsonObject) = bus?.event(topic, data)

    fun putBlob(bytes: ByteArray, onProgress: ((Long, Long) -> Unit)? = null): String? =
        runCatching { bus?.putBlob(bytes, onProgress) }.getOrNull()

    /** Fetch + E2E-decrypt a blob via THIS hub's bus, caching it under the shared blob cache. */
    fun fetchBlob(blobId: String): ByteArray? {
        val f = java.io.File(java.io.File(service.cacheDir, "blobs").apply { mkdirs() }, blobId)
        if (f.exists()) return runCatching { f.readBytes() }.getOrNull()
        val bytes = runCatching { bus?.getBlob(blobId) }.getOrNull() ?: return null
        runCatching { f.writeBytes(bytes) }
        return bytes
    }

    fun prefetchBlob(blobId: String) { scope.launch(Dispatchers.IO) { fetchBlob(blobId) } }

    private fun handleEvent(ev: Inner.Event) {
        if (!online.value) { // the hub answered whoami → it's truly online (not just relay-reachable)
            online.value = true
            Log.i(TAG, "hub online: ${profile.display()} [${profile.id.take(6)}]")
            service.onAggregateChanged()
        }
        val fg = isForeground()
        when (ev.topic) {
            "hub_identity" -> {
                // The hub's own (machine) name. Always honour it — it names this hub in the list.
                val name = (ev.data["name"] as? JsonPrimitive)?.content
                if (!name.isNullOrBlank()) Agents.setHubName(service, profile.id, name)
            }
            "agents_roster" -> {
                val hubLabel = profile.display()
                val list = (ev.data["agents"] as? JsonArray)?.mapNotNull { el ->
                    val o = el as? JsonObject ?: return@mapNotNull null
                    val aid = (o["id"] as? JsonPrimitive)?.content ?: return@mapNotNull null
                    RosterAgent(
                        id = aid,
                        name = (o["name"] as? JsonPrimitive)?.content ?: "agent",
                        active = (o["active"] as? JsonPrimitive)?.content == "true",
                        external = (o["external"] as? JsonPrimitive)?.content == "true",
                        hubId = profile.id,
                        hubName = hubLabel,
                    )
                }.orEmpty()
                roster.value = list
                Log.i(TAG, "roster ${profile.display()}: ${list.size} [${list.joinToString { it.name }}] fg=$fg online=${online.value}")
                if (fg) PhoneAgentService.roster.value = list
                service.onAggregateChanged()
            }
            "agent_identity" -> {
                val name = (ev.data["name"] as? JsonPrimitive)?.content
                lastAgentName = name
                if (fg) PhoneAgentService.agentName.value = name
            }
            "assistant_message" -> {
                val txt = (ev.data["text"] as? JsonPrimitive)?.content ?: ""
                val parts = MsgPart.parse(ev.data["parts"] as? JsonArray)
                // Cache attachment blobs now, while the relay copy is still alive (beats the TTL).
                parts.forEach { p ->
                    when (p) {
                        is MsgPart.ImageRef -> prefetchBlob(p.blobId)
                        is MsgPart.FileRef -> prefetchBlob(p.blobId)
                        else -> {}
                    }
                }
                if (txt.isEmpty() && parts.isEmpty()) return
                if (fg) service.onForegroundReply(txt, parts)
                else service.onBackgroundMessage(profile, txt.ifBlank { "sent an attachment" })
            }
            "agent_status" -> {
                if (!fg) return
                val ready = (ev.data["ready"] as? JsonPrimitive)?.content == "true"
                PhoneAgentService.status.value = if (ready) null else (ev.data["label"] as? JsonPrimitive)?.content
            }
            "agent_commands" -> {
                if (!fg) return
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
                PhoneAgentService.commands.value = list
            }
            "history" -> {
                if (!fg) return
                (ev.data["messages"] as? JsonArray)?.let { arr ->
                    PhoneAgentService.chat.value = arr.mapNotNull { el ->
                        val o = el as? JsonObject ?: return@mapNotNull null
                        val role = (o["role"] as? JsonPrimitive)?.content ?: return@mapNotNull null
                        val ts = (o["ts"] as? JsonPrimitive)?.content?.toLongOrNull() ?: System.currentTimeMillis()
                        val parts = MsgPart.parse(o["parts"] as? JsonArray)
                        ChatMsg(role, (o["text"] as? JsonPrimitive)?.content ?: "", ts = ts, parts = parts)
                    }
                }
            }
            "sessions" -> {
                if (!fg) return
                PhoneAgentService.sessions.value = (ev.data["sessions"] as? JsonArray)?.mapNotNull { el ->
                    val o = el as? JsonObject ?: return@mapNotNull null
                    val sid = (o["id"] as? JsonPrimitive)?.content ?: return@mapNotNull null
                    SessionInfo(sid, (o["title"] as? JsonPrimitive)?.content ?: "New chat",
                        (o["ts"] as? JsonPrimitive)?.content?.toLongOrNull() ?: 0L)
                }.orEmpty()
                PhoneAgentService.activeSessionId.value = (ev.data["activeId"] as? JsonPrimitive)?.content
            }
        }
    }
}
