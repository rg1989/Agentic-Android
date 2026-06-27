// UNVERIFIED in this environment (no Kotlin toolchain). Compile & run on device before shipping.
//
// Gradle deps (owned by the gradle build unit, do NOT add here):
//   implementation("androidx.security:security-crypto:1.1.0-alpha06")
//
// This file is the SOLE owner of PairingData / Pairing / decodePairingToken.
package com.agenticandroid.pairing

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.agenticandroid.Crypto
import com.agenticandroid.Identity
import org.json.JSONObject
import java.util.Base64

/**
 * Mirrors the Q5 pairing identity model. All three fields are required to talk to the relay:
 *   self      — our own ed25519 keypair (loaded or generated once on first launch)
 *   peerEdPub — the bridge's public key (obtained via QR + TOFU exchange)
 *   relayUrl  — the self-hosted relay address
 *
 * Shape mirrors the TS bridge config: { self: Identity, peerEdPub, relayUrl }.
 */
data class PairingData(
    val self: Identity,
    val peerEdPub: String,
    val relayUrl: String,
)

/**
 * QR token payload — matches ts-pairing's decodePairingToken output exactly.
 * The bridge encodes: JSON.stringify({ edPub, fp, relayUrl, token? }) then base64url-no-pad.
 * `token` is a one-time secret used for the TOFU handshake; may be null for legacy tokens.
 */
data class PairingToken(
    val edPub: String,
    val fp: String,
    val relayUrl: String,
    val token: String?,   // one-time TOFU token; null if the bridge sent a legacy payload
    val hubName: String?, // the hub's own name (default = its machine hostname); null for legacy payloads
)

/**
 * Decode a QR code value into a PairingToken.
 * The QR string is optionally prefixed by "PAIR:" (see bridge.ts line ~186).
 * Encoding: URL-safe, no-padding base64 (Crypto.kt interop rule) then UTF-8 JSON.
 * Also accepts standard (non-URL-safe) base64 — Base64.getUrlDecoder() handles both.
 */
fun decodePairingToken(raw: String): PairingToken {
    val b64 = if (raw.startsWith("PAIR:")) raw.removePrefix("PAIR:") else raw
    // Crypto.kt uses Base64.getUrlDecoder() which handles URL-safe (no-pad) AND standard base64.
    val decoder = Base64.getUrlDecoder()
    val json = decoder.decode(b64).toString(Charsets.UTF_8)
    val obj = JSONObject(json)
    return PairingToken(
        edPub    = obj.getString("edPub"),
        fp       = obj.getString("fp"),
        relayUrl = obj.getString("relayUrl"),
        token    = if (obj.has("token")) obj.getString("token") else null,
        hubName  = if (obj.has("hubName")) obj.getString("hubName") else null,
    )
}

/**
 * Persistent pairing store backed by EncryptedSharedPreferences (AES256-GCM master key).
 * One entry per key: the whole PairingData is stored as three string prefs.
 *
 * TOFU semantics (Q5): the first successful QR scan wins and is persisted.
 * Subsequent scans are ignored unless the user explicitly clears and re-pairs
 * (call clear() then save() with the new data).
 */
object Pairing {
    private const val PREFS_FILE = "pairing_store"
    private const val KEY_ED_PUB     = "self_ed_pub"
    private const val KEY_ED_SEC     = "self_ed_sec"
    private const val KEY_FP         = "self_fp"
    private const val KEY_PEER_ED_PUB = "peer_ed_pub"
    private const val KEY_RELAY_URL  = "relay_url"

    private fun prefs(ctx: Context): android.content.SharedPreferences {
        val masterKey = MasterKey.Builder(ctx)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            ctx,
            PREFS_FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /**
     * Load stored pairing data, or null if the phone has not been paired yet.
     * Called by PhoneAgentService.ensureConnected() on every start.
     */
    fun load(ctx: Context): PairingData? {
        val p = prefs(ctx)
        val edPub     = p.getString(KEY_ED_PUB,      null) ?: return null
        val edSec     = p.getString(KEY_ED_SEC,      null) ?: return null
        val fp        = p.getString(KEY_FP,          null) ?: return null
        val peerEdPub = p.getString(KEY_PEER_ED_PUB, null) ?: return null
        val relayUrl  = p.getString(KEY_RELAY_URL,   null) ?: return null
        return PairingData(Identity(edPub, edSec, fp), peerEdPub, relayUrl)
    }

    /**
     * Persist pairing data into EncryptedSharedPreferences.
     * Called once by PairingActivity after the TOFU exchange succeeds.
     */
    fun save(ctx: Context, data: PairingData) {
        prefs(ctx).edit()
            .putString(KEY_ED_PUB,      data.self.edPub)
            .putString(KEY_ED_SEC,      data.self.edSec)
            .putString(KEY_FP,          data.self.fp)
            .putString(KEY_PEER_ED_PUB, data.peerEdPub)
            .putString(KEY_RELAY_URL,   data.relayUrl)
            .apply()
    }

    /** Erase all pairing state so the user can re-pair with a new agent. */
    fun clear(ctx: Context) {
        prefs(ctx).edit().clear().apply()
    }

    /**
     * Return the phone's own Identity, generating and persisting a fresh ed25519 keypair on
     * first call (lazy keygen, only once per device lifetime).
     * TODO: call this from PairingActivity before showing the "waiting for QR" UI so the
     *       phone has its own keypair ready to exchange with the bridge.
     */
    fun selfIdentity(ctx: Context): Identity {
        val p = prefs(ctx)
        val existing = p.getString(KEY_ED_PUB, null)
        if (existing != null) {
            val edSec = p.getString(KEY_ED_SEC, null) ?: error("corrupt pairing store: edSec missing")
            val fp    = p.getString(KEY_FP,     null) ?: error("corrupt pairing store: fp missing")
            return Identity(existing, edSec, fp)
        }
        val id = Crypto.generateIdentity()
        p.edit()
            .putString(KEY_ED_PUB, id.edPub)
            .putString(KEY_ED_SEC, id.edSec)
            .putString(KEY_FP,     id.fp)
            .apply()
        return id
    }
}
