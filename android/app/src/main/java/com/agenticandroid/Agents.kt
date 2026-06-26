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

/** One paired agent. `id` is the peer fingerprint (stable per agent). `name` is what the UI shows. */
@Serializable
data class AgentProfile(
    val id: String,
    val name: String,
    val peerEdPub: String,
    val relayUrl: String,
)

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

    /** Add or update a profile (keyed by peer fingerprint) and make it active. */
    fun add(ctx: Context, name: String, peerEdPub: String, relayUrl: String): AgentProfile {
        val id = Crypto.fingerprint(peerEdPub)
        val profile = AgentProfile(id, name, peerEdPub, relayUrl)
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

    /** Update a profile's display name — e.g. once the agent announces its real name. */
    fun setName(ctx: Context, id: String, name: String) {
        val list = profiles.value.map { if (it.id == id && it.name != name) it.copy(name = name) else it }
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
