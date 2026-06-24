package com.agenticandroid

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Pure-JVM unit test of the consent policy (Q8). No Android framework deps -> runs with `./gradlew test`.
 * Mirrors the consent assertions in backbone/test/e2e.test.ts.
 */
class ConsentTest {
    private val agent = "agentfp"
    private val other = "otherfp"

    @Test fun fallsBackToCapabilityDefault() {
        val p = ConsentPolicy()
        assertEquals(Sensitivity.ALLOW, p.effective(agent, "phone.ring", Sensitivity.ALLOW))
        assertEquals(Sensitivity.ASK, p.effective(agent, "sms.send", Sensitivity.ASK))
    }

    @Test fun perAgentOverrideWins() {
        val p = ConsentPolicy()
        p.set(agent, "phone.ring", Sensitivity.DENY)
        assertEquals(Sensitivity.DENY, p.effective(agent, "phone.ring", Sensitivity.ALLOW))
        // override is scoped to the agent — a different agent still gets the default
        assertEquals(Sensitivity.ALLOW, p.effective(other, "phone.ring", Sensitivity.ALLOW))
    }

    @Test fun profilesSetSaneDefaults() {
        val p = ConsentPolicy()
        val methods = listOf("phone.ring", "sms.send", "camera.capture")
        p.applyProfile(agent, ConsentPolicy.Profile.LIMITED, methods)
        methods.forEach { assertEquals(Sensitivity.ASK, p.effective(agent, it, Sensitivity.ALLOW)) }
        p.applyProfile(other, ConsentPolicy.Profile.TRUSTED, methods)
        methods.forEach { assertEquals(Sensitivity.ALLOW, p.effective(other, it, Sensitivity.DENY)) }
    }
}
