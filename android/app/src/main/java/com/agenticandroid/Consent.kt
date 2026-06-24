package com.agenticandroid

/**
 * On-phone consent (Q8) — the trust boundary. The agent can REQUEST anything; the phone decides.
 * Policy is keyed by (agent fingerprint x capability method), defaulting to the capability's own
 * sensitivity. Pure logic, JVM-unit-tested in ConsentTest.
 */
enum class Sensitivity { ALLOW, ASK, DENY }

class ConsentPolicy {
    // agentFp -> (method -> override)
    private val overrides = HashMap<String, HashMap<String, Sensitivity>>()

    fun effective(agentFp: String, method: String, default: Sensitivity): Sensitivity =
        overrides[agentFp]?.get(method) ?: default

    fun set(agentFp: String, method: String, s: Sensitivity) {
        overrides.getOrPut(agentFp) { HashMap() }[method] = s
    }

    /** Apply a default profile when a new agent pairs (Q8: Trusted vs Limited). */
    fun applyProfile(agentFp: String, profile: Profile, methods: Collection<String>) {
        when (profile) {
            Profile.TRUSTED -> methods.forEach { set(agentFp, it, Sensitivity.ALLOW) }
            Profile.LIMITED -> methods.forEach { set(agentFp, it, Sensitivity.ASK) }
        }
    }

    enum class Profile { TRUSTED, LIMITED }
}
