package com.agenticandroid

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Handler
import android.os.Looper
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

/**
 * Shared ring state so `phone.ring` and `phone.stop_ring` act on the same Ringtone.
 * Plays the default alarm on the ALARM stream at max volume (audible through silent/vibrate),
 * looped until stopped (or until an optional auto-stop ms elapses).
 */
class Ringer(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private var ringtone: Ringtone? = null
    private var autoStop: Runnable? = null

    @Synchronized fun start(ms: Long) {
        stopInternal()
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
        val uri = RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_RINGTONE)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        ringtone = RingtoneManager.getRingtone(context, uri).apply {
            audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            isLooping = true
            play()
        }
        if (ms > 0) main.postDelayed(Runnable { stop() }.also { autoStop = it }, ms)
    }

    @Synchronized fun stop(): Boolean {
        val was = ringtone?.isPlaying == true
        stopInternal()
        return was
    }

    @Synchronized fun isRinging(): Boolean = ringtone?.isPlaying == true

    private fun stopInternal() {
        autoStop?.let { main.removeCallbacks(it) }; autoStop = null
        runCatching { ringtone?.stop() }
        ringtone = null
    }
}

/** Ring the phone to locate it. ms<=0 rings until phone.stop_ring; ms>0 auto-stops after the delay. */
class RingCapability(private val ringer: Ringer) : Capability {
    override val method = "phone.ring"
    override val sensitivity = Sensitivity.ALLOW
    override val summary = "Ring the phone at full alarm volume. ms=0 rings until phone.stop_ring."
    override suspend fun execute(params: JsonObject): CapResult {
        val ms = (params["ms"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull() ?: 0L
        ringer.start(ms)
        return CapResult(result = buildJsonObject { put("ringing", true); put("ms", ms) })
    }
}

/** Stop a ring started by phone.ring. */
class StopRingCapability(private val ringer: Ringer) : Capability {
    override val method = "phone.stop_ring"
    override val sensitivity = Sensitivity.ALLOW
    override val summary = "Stop ringing the phone."
    override suspend fun execute(params: JsonObject): CapResult {
        val was = ringer.stop()
        return CapResult(result = buildJsonObject { put("stopped", true); put("was_ringing", was) })
    }
}

fun typedError(code: String, message: String, retriable: Boolean = false) =
    CapResult(error = TypedError(code, message, retriable))
