package com.agenticandroid

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.agenticandroid.pairing.Pairing
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * One paired hub. `id` is the peer fingerprint (stable per hub). `name` is the hub's own name
 * (announced by the hub, default = its machine hostname); `localName` is an optional per-phone override
 * the user sets in the app. The UI shows [display].
 */
@Serializable
data class AgentProfile(
    val id: String,
    val name: String,
    val peerEdPub: String,
    val relayUrl: String,
    val localName: String? = null,
)

/** What to show for a hub: the user's local override if set, else the hub-announced name. */
fun AgentProfile.display(): String = localName?.takeIf { it.isNotBlank() } ?: name

/**
 * The phone's list of paired agents + which one is active. The phone keeps a single identity keypair
 * (owned by [Pairing]); each agent knows the phone's pubkey. The active profile is the one the
 * [PhoneAgentService] bus connects to — switching rebuilds the connection.
 *
 * A legacy single pairing is migrated into profile #1 on first init. Persisted (encrypted) so it
 * survives restarts; exposed as StateFlows so the UI reacts live.
 */
object Agents {
    private const val PREFS_FILE = "agents_store"
    private const val KEY_PROFILES = "profiles_json"
    private const val KEY_ACTIVE = "active_id"
    private val JSON = Json { ignoreUnknownKeys = true }

    val profiles = MutableStateFlow<List<AgentProfile>>(emptyList())
    val activeId = MutableStateFlow<String?>(null)

    private var prefs: android.content.SharedPreferences? = null

    private fun prefs(ctx: Context): android.content.SharedPreferences {
        prefs?.let { return it }
        val masterKey = MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        return EncryptedSharedPreferences.create(
            ctx, PREFS_FILE, masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        ).also { prefs = it }
    }

    fun init(ctx: Context) {
        val p = prefs(ctx)
        var list = runCatching {
            p.getString(KEY_PROFILES, null)?.let { JSON.decodeFromString<List<AgentProfile>>(it) }
        }.getOrNull() ?: emptyList()
        if (list.isEmpty()) {
            // Migrate a legacy single pairing into profile #1.
            Pairing.load(ctx)?.let { pd ->
                val id = Crypto.fingerprint(pd.peerEdPub)
                list = listOf(AgentProfile(id, id.take(8), pd.peerEdPub, pd.relayUrl))
                persist(ctx, list, id)
            }
        }
        profiles.value = list
        activeId.value = p.getString(KEY_ACTIVE, null)?.takeIf { id -> list.any { it.id == id } }
            ?: list.firstOrNull()?.id
    }

    /** The phone's own identity (shared across all agents). */
    fun self(ctx: Context): Identity = Pairing.selfIdentity(ctx)

    fun active(): AgentProfile? {
        val id = activeId.value
        return profiles.value.firstOrNull { it.id == id } ?: profiles.value.firstOrNull()
    }

    /** Add or update a profile (keyed by peer fingerprint) and make it active. Preserves an existing
     *  local rename across a re-pair (the user's chosen label shouldn't vanish when they re-scan). */
    fun add(ctx: Context, name: String, peerEdPub: String, relayUrl: String): AgentProfile {
        val id = Crypto.fingerprint(peerEdPub)
        val keepLocal = profiles.value.firstOrNull { it.id == id }?.localName
        val profile = AgentProfile(id, name, peerEdPub, relayUrl, localName = keepLocal)
        val list = profiles.value.filterNot { it.id == id } + profile
        profiles.value = list
        activeId.value = id
        persist(ctx, list, id)
        return profile
    }

    fun setActive(ctx: Context, id: String) {
        if (profiles.value.none { it.id == id }) return
        activeId.value = id
        prefs(ctx).edit().putString(KEY_ACTIVE, id).apply()
    }

    fun remove(ctx: Context, id: String) {
        val list = profiles.value.filterNot { it.id == id }
        val newActive = if (activeId.value == id) list.firstOrNull()?.id else activeId.value
        profiles.value = list
        activeId.value = newActive
        persist(ctx, list, newActive)
    }

    /** Update the hub's own (announced) name — driven by the hub_identity event from that hub. */
    fun setHubName(ctx: Context, id: String, name: String) {
        val list = profiles.value.map { if (it.id == id && it.name != name) it.copy(name = name) else it }
        if (list == profiles.value) return
        profiles.value = list
        persist(ctx, list, activeId.value)
    }

    /** Set (or clear, when blank) the user's local override name for a hub — the in-app rename. */
    fun setLocalName(ctx: Context, id: String, name: String) {
        val clean = name.trim().ifBlank { null }
        val list = profiles.value.map { if (it.id == id && it.localName != clean) it.copy(localName = clean) else it }
        if (list == profiles.value) return
        profiles.value = list
        persist(ctx, list, activeId.value)
    }

    private fun persist(ctx: Context, list: List<AgentProfile>, active: String?) {
        prefs(ctx).edit()
            .putString(KEY_PROFILES, JSON.encodeToString(list))
            .putString(KEY_ACTIVE, active)
            .apply()
    }
}
