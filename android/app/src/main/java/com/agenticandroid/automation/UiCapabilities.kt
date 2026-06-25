package com.agenticandroid.automation

import android.content.Context
import android.graphics.Bitmap
import com.agenticandroid.BusEndpoint
import com.agenticandroid.CapResult
import com.agenticandroid.Capability
import com.agenticandroid.Sensitivity
import com.agenticandroid.typedError
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.ByteArrayOutputStream

private fun JsonObject.f(k: String): Float? = (this[k] as? JsonPrimitive)?.content?.toFloatOrNull()
private fun JsonObject.s(k: String): String? = (this[k] as? JsonPrimitive)?.content
private fun svc() = AgentAccessibilityService.instance
private fun notEnabled() = typedError(
    "ACCESSIBILITY_OFF",
    "Enable 'Agentic Android' under Settings > Accessibility (computer-use service).",
)

/** ui.tap {x,y} — tap a screen coordinate. */
class UiTapCapability : Capability {
    override val method = "ui.tap"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Tap a screen coordinate. Params: {x, y} (pixels)."
    override suspend fun execute(params: JsonObject): CapResult {
        val s = svc() ?: return notEnabled()
        val x = params.f("x") ?: return typedError("INVALID_PARAMS", "'x' required")
        val y = params.f("y") ?: return typedError("INVALID_PARAMS", "'y' required")
        return CapResult(result = buildJsonObject { put("tapped", s.tap(x, y)); put("x", x); put("y", y) })
    }
}

/** ui.swipe {x1,y1,x2,y2,ms?} — swipe/drag between two points. */
class UiSwipeCapability : Capability {
    override val method = "ui.swipe"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Swipe between two points. Params: {x1,y1,x2,y2,ms?}."
    override suspend fun execute(params: JsonObject): CapResult {
        val s = svc() ?: return notEnabled()
        val x1 = params.f("x1") ?: return typedError("INVALID_PARAMS", "coords required")
        val y1 = params.f("y1") ?: return typedError("INVALID_PARAMS", "coords required")
        val x2 = params.f("x2") ?: return typedError("INVALID_PARAMS", "coords required")
        val y2 = params.f("y2") ?: return typedError("INVALID_PARAMS", "coords required")
        val ms = params.s("ms")?.toLongOrNull() ?: 300L
        return CapResult(result = buildJsonObject { put("swiped", s.swipe(x1, y1, x2, y2, ms)) })
    }
}

/** ui.text {text} — type into the focused field. */
class UiTextCapability : Capability {
    override val method = "ui.text"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Type text into the focused field. Params: {text}."
    override suspend fun execute(params: JsonObject): CapResult {
        val s = svc() ?: return notEnabled()
        val text = params.s("text") ?: return typedError("INVALID_PARAMS", "'text' required")
        val ok = s.inputText(text)
        return if (ok) CapResult(result = buildJsonObject { put("typed", text) })
        else typedError("NO_FOCUSED_FIELD", "no focused editable field to type into")
    }
}

/** ui.global {action} — back/home/recents/notifications/quicksettings. */
class UiGlobalCapability : Capability {
    override val method = "ui.global"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Global action. Params: {action: back|home|recents|notifications|quicksettings}."
    override suspend fun execute(params: JsonObject): CapResult {
        val s = svc() ?: return notEnabled()
        val action = params.s("action") ?: return typedError("INVALID_PARAMS", "'action' required")
        return CapResult(result = buildJsonObject { put("ok", s.global(action)); put("action", action) })
    }
}

/** ui.read — read visible on-screen elements (text + tap coordinates). */
class UiReadCapability : Capability {
    override val method = "ui.read"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Read visible screen elements (text, clickable, center coords)."
    override suspend fun execute(params: JsonObject): CapResult {
        val s = svc() ?: return notEnabled()
        val nodes = s.readScreen()
        return CapResult(result = buildJsonObject {
            put("count", nodes.size)
            put("elements", buildJsonArray {
                nodes.forEach { n ->
                    add(buildJsonObject {
                        put("text", n["text"].toString()); put("desc", n["desc"].toString())
                        put("class", n["class"].toString()); put("clickable", n["clickable"] as Boolean)
                        put("cx", n["cx"] as Int); put("cy", n["cy"] as Int)
                    })
                }
            })
        })
    }
}

/** ui.screenshot — capture the screen and return it as an E2E blob. */
class UiScreenshotCapability(private val bus: BusEndpoint) : Capability {
    override val method = "ui.screenshot"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Screenshot the current screen and return it as an E2E blob."
    override suspend fun execute(params: JsonObject): CapResult {
        val s = svc() ?: return notEnabled()
        return try {
            val bmp: Bitmap = s.screenshotBitmap()
            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, 85, out)
            val bytes = out.toByteArray()
            val blobId = bus.putBlob(bytes)
            CapResult(result = buildJsonObject {
                put("blob_id", blobId); put("size", bytes.size)
                put("content_type", "image/jpeg"); put("width", bmp.width); put("height", bmp.height)
            })
        } catch (e: Exception) { typedError("SCREENSHOT_FAILED", e.message ?: "screenshot failed") }
    }
}

/** Register all Tier-2 ui.* capabilities. Call from registerTier1. */
fun registerTier2(registry: com.agenticandroid.CapabilityRegistry, bus: BusEndpoint, @Suppress("UNUSED_PARAMETER") context: Context) {
    registry.register(UiTapCapability())
    registry.register(UiSwipeCapability())
    registry.register(UiTextCapability())
    registry.register(UiGlobalCapability())
    registry.register(UiReadCapability())
    registry.register(UiScreenshotCapability(bus))
}
