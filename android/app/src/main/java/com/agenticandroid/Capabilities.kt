package com.agenticandroid

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Capability registry (Q4 swap point / Q8 / Q10). Each ability is a self-describing provider that
 * declares its default sensitivity and a summary; the phone advertises the catalog to the agent.
 * High-level atomic capabilities by default (Q10): handlers do the obvious internal sequence and
 * return rich results or typed errors so the agent can observe & recover.
 *
 * Tier-1 providers below are stubs/examples; wire them to camera2 / FusedLocationProvider / SmsManager.
 * Tier-2 (computer-use via AccessibilityService) registers additional providers here next milestone —
 * additive, no protocol change.
 */
data class CapResult(val result: JsonElement? = null, val error: TypedError? = null)

interface Capability {
    val method: String
    val sensitivity: Sensitivity
    val summary: String
    suspend fun execute(params: JsonObject): CapResult
}

class CapabilityRegistry {
    private val caps = LinkedHashMap<String, Capability>()
    fun register(c: Capability) { caps[c.method] = c }
    fun get(method: String): Capability? = caps[method]
    fun methods(): Collection<String> = caps.keys

    /** Catalog advertised to the agent, with sensitivity resolved per requesting agent. */
    fun catalog(agentFp: String, policy: ConsentPolicy): JsonObject = buildJsonObject {
        put("capabilities", kotlinx.serialization.json.buildJsonArray {
            for (c in caps.values) add(buildJsonObject {
                put("method", c.method)
                put("sensitivity", policy.effective(agentFp, c.method, c.sensitivity).name.lowercase())
                put("summary", c.summary)
            })
        })
    }
}

/** Example Tier-1 capability — ring the phone. Real impl: AudioManager + a max-volume tone/ringtone. */
class RingCapability : Capability {
    override val method = "phone.ring"
    override val sensitivity = Sensitivity.ALLOW
    override val summary = "Ring the phone at full volume to locate it."
    override suspend fun execute(params: JsonObject): CapResult {
        // TODO: AudioManager.setStreamVolume(...) + play ringtone for `ms`.
        val ms = (params["ms"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull() ?: 3000
        return CapResult(result = buildJsonObject { put("rang", true); put("ms", ms) })
    }
}

fun typedError(code: String, message: String, retriable: Boolean = false) =
    CapResult(error = TypedError(code, message, retriable))
