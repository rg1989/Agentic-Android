// UNVERIFIED in this environment — no Kotlin toolchain present; faithfully mirrors DESIGN.md Q12.
package com.agenticandroid.voice

import com.agenticandroid.CapResult
import com.agenticandroid.Capability
import com.agenticandroid.CapabilityRegistry
import com.agenticandroid.Sensitivity
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.coroutines.resume

/**
 * SpeakCapability — Capability implementation for the "speak" action (Q12).
 *
 * Method: "speak"
 * Sensitivity: ALLOW (the agent directing the phone to speak its own reply is unconditional)
 * Summary: "Speak text aloud via on-device TTS"
 *
 * The result shape {spoken: true} mirrors the phone-sim.ts convention: handlers return
 * `{ result: { spoke: true } }` (a plain object, never a bare boolean).  Using "spoken" (past
 * tense) to be unambiguous about completion.
 *
 * Round-trip: agent sends request("speak", {text: "..."}) → phone receives → SpeakCapability
 * → TextToSpeech.speak() → onDone → CapResult({spoken:true}) → response back to agent.
 *
 * To register without touching Capabilities.kt or PhoneAgentService:
 *
 *   val tts = TextToSpeech(context)
 *   tts.init { }
 *   registerVoice(registry, tts)
 *
 * where [registerVoice] is the tier-1-style helper at the bottom of this file.
 */
class SpeakCapability(private val tts: TextToSpeech) : Capability {
    override val method = "speak"
    override val sensitivity = Sensitivity.ALLOW
    override val summary = "Speak text aloud via on-device TTS."

    override suspend fun execute(params: JsonObject): CapResult {
        val text = (params["text"] as? JsonPrimitive)?.content
            ?: return CapResult(error = com.agenticandroid.TypedError(
                code = "MISSING_PARAM",
                message = "speak requires a 'text' string parameter",
                retriable = false,
            ))

        // Suspend until TTS finishes — keeps the response honest (the text WAS spoken, past tense).
        suspendCancellableCoroutine<Unit> { cont ->
            tts.speak(text) { if (cont.isActive) cont.resume(Unit) }
        }

        // Result shape mirrors the sim's convention: a plain object with a boolean flag.
        return CapResult(result = buildJsonObject { put("spoken", true) })
    }
}

/**
 * Register the voice capability tier.  Call this from the site that owns the registry
 * (e.g. PhoneAgentService.onCreate or a VoiceModule initialiser) without editing Capabilities.kt.
 *
 * Mirrors the Tier-1 helper pattern (RingCapability is registered inline in PhoneAgentService;
 * this follows the same style but is extracted so voice stays in its own package):
 *
 *   registerVoice(registry, tts)  // one line at the wiring site
 */
fun registerVoice(registry: CapabilityRegistry, tts: TextToSpeech) {
    registry.register(SpeakCapability(tts))
}
