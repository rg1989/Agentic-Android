package com.agenticandroid.automation

import com.agenticandroid.CapResult
import com.agenticandroid.Capability
import com.agenticandroid.Sensitivity
import com.agenticandroid.typedError
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Tier-2 query/act primitives on top of [AgentAccessibilityService] (DESIGN "free batch").
 *
 * These let the agent locate UI elements semantically (by text / view id) and act on the *node*
 * instead of guessing pixels from a screenshot — the foundation for reliable computer-use. They
 * reuse the already-granted BIND_ACCESSIBILITY_SERVICE access, so there is no new permission.
 */
private fun JsonObject.s(k: String): String? = (this[k] as? JsonPrimitive)?.content
private fun JsonObject.f(k: String): Float? = (this[k] as? JsonPrimitive)?.content?.toFloatOrNull()
private fun JsonObject.l(k: String): Long? = (this[k] as? JsonPrimitive)?.content?.toLongOrNull()
private fun JsonObject.b(k: String): Boolean? = (this[k] as? JsonPrimitive)?.content?.toBooleanStrictOrNull()
private fun svc() = AgentAccessibilityService.instance
private fun off() = typedError(
    "ACCESSIBILITY_OFF",
    "Enable 'Agentic Android' under Settings > Accessibility (computer-use service).",
)

/** ui.find {text?|id?} — locate matching nodes; returns text/class/id/flags/bounds + center coords. */
class UiFindCapability : Capability {
    override val method = "ui.find"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Find UI nodes by text or view id. Params: {text?|id?, max?}. Returns bounds + tap coords."
    override suspend fun execute(params: JsonObject): CapResult {
        val s = svc() ?: return off()
        val text = params.s("text"); val id = params.s("id")
        if (text.isNullOrBlank() && id.isNullOrBlank()) return typedError("INVALID_PARAMS", "'text' or 'id' required")
        val nodes = s.findNodes(text, id, (params.s("max")?.toIntOrNull() ?: 50))
        return CapResult(result = buildJsonObject {
            put("count", nodes.size)
            put("nodes", buildJsonArray {
                nodes.forEach { n ->
                    val d = s.describe(n)
                    add(buildJsonObject {
                        put("text", d["text"].toString()); put("desc", d["desc"].toString())
                        put("class", d["class"].toString()); put("id", d["id"].toString())
                        put("clickable", d["clickable"] as Boolean); put("editable", d["editable"] as Boolean)
                        put("scrollable", d["scrollable"] as Boolean)
                        put("cx", d["cx"] as Int); put("cy", d["cy"] as Int)
                        put("l", d["l"] as Int); put("t", d["t"] as Int); put("r", d["r"] as Int); put("b", d["b"] as Int)
                    })
                }
            })
        })
    }
}

/** ui.node_action {text?|id?, action} — semantic act on the first match (click/long_click/set_text/expand/...). */
class UiNodeActionCapability : Capability {
    override val method = "ui.node_action"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Act on a node found by text/id. Params: {text?|id?, action: click|long_click|set_text|focus|expand|collapse|dismiss, value?}."
    override suspend fun execute(params: JsonObject): CapResult {
        val s = svc() ?: return off()
        val action = params.s("action") ?: return typedError("INVALID_PARAMS", "'action' required")
        val text = params.s("text"); val id = params.s("id")
        if (text.isNullOrBlank() && id.isNullOrBlank()) return typedError("INVALID_PARAMS", "'text' or 'id' required")
        val ok = s.nodeAction(text, id, action, params.s("value"))
        return if (ok) CapResult(result = buildJsonObject { put("ok", true); put("action", action) })
        else typedError("NODE_NOT_ACTIONED", "no matching node, or action '$action' not supported on it")
    }
}

/** ui.set_text {text, into_text?|into_id?} — set text on a targeted editable (no prior focus needed). */
class UiSetTextCapability : Capability {
    override val method = "ui.set_text"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Set text on an editable found by text/id. Params: {text, into_text?|into_id?}."
    override suspend fun execute(params: JsonObject): CapResult {
        val s = svc() ?: return off()
        val text = params.s("text") ?: return typedError("INVALID_PARAMS", "'text' required")
        val ok = s.nodeAction(params.s("into_text"), params.s("into_id"), "set_text", text)
        return if (ok) CapResult(result = buildJsonObject { put("set", text) })
        else typedError("NO_TARGET_FIELD", "no editable field matched into_text/into_id")
    }
}

/** ui.long_press {x,y,ms?} — long-press a coordinate. */
class UiLongPressCapability : Capability {
    override val method = "ui.long_press"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Long-press a coordinate. Params: {x, y, ms?}."
    override suspend fun execute(params: JsonObject): CapResult {
        val s = svc() ?: return off()
        val x = params.f("x") ?: return typedError("INVALID_PARAMS", "'x' required")
        val y = params.f("y") ?: return typedError("INVALID_PARAMS", "'y' required")
        return CapResult(result = buildJsonObject { put("ok", s.longPress(x, y, params.l("ms") ?: 600)) })
    }
}

/** ui.scroll {direction?} — scroll the first scrollable container (default forward/down). */
class UiScrollCapability : Capability {
    override val method = "ui.scroll"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Scroll the scrollable list. Params: {direction: forward|backward}."
    override suspend fun execute(params: JsonObject): CapResult {
        val s = svc() ?: return off()
        val fwd = (params.s("direction") ?: "forward").lowercase() != "backward"
        val ok = s.scroll(fwd)
        return if (ok) CapResult(result = buildJsonObject { put("scrolled", true); put("forward", fwd) })
        else typedError("NOT_SCROLLABLE", "no scrollable container, or already at the end")
    }
}

/** ui.scroll_to {text, max?} — scroll forward until text appears. */
class UiScrollToCapability : Capability {
    override val method = "ui.scroll_to"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Scroll until text is visible. Params: {text, max?}."
    override suspend fun execute(params: JsonObject): CapResult {
        val s = svc() ?: return off()
        val text = params.s("text") ?: return typedError("INVALID_PARAMS", "'text' required")
        val found = s.scrollUntil(text, params.s("max")?.toIntOrNull() ?: 15)
        return CapResult(result = buildJsonObject { put("found", found); put("text", text) })
    }
}

/** ui.wait {text?, gone?, ms?} — block until text appears (or disappears if gone=true). Kills fixed sleeps. */
class UiWaitCapability : Capability {
    override val method = "ui.wait"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Wait until text appears (or disappears). Params: {text, gone?, ms?}. Returns {matched}."
    override suspend fun execute(params: JsonObject): CapResult {
        val s = svc() ?: return off()
        val text = params.s("text") ?: return typedError("INVALID_PARAMS", "'text' required")
        val gone = params.b("gone") ?: false
        val ms = (params.l("ms") ?: 8000).coerceIn(100, 60000)
        val matched = s.waitFor(ms) {
            val present = s.findNodes(text, null, 1).isNotEmpty()
            if (gone) !present else present
        }
        return CapResult(result = buildJsonObject { put("matched", matched); put("text", text); put("gone", gone) })
    }
}

/** ui.dump — full structured dump of visible nodes (text/desc/class/id/flags/bounds). */
class UiDumpCapability : Capability {
    override val method = "ui.dump"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Dump all visible UI nodes with ids and bounds (richer than ui.read)."
    override suspend fun execute(params: JsonObject): CapResult {
        val s = svc() ?: return off()
        val nodes = s.readScreen(200)
        return CapResult(result = buildJsonObject {
            put("count", nodes.size)
            put("foreground", s.foregroundPackage ?: "")
            put("nodes", buildJsonArray {
                nodes.forEach { n ->
                    add(buildJsonObject {
                        put("text", n["text"].toString()); put("desc", n["desc"].toString())
                        put("class", n["class"].toString())
                        put("clickable", n["clickable"] as Boolean); put("editable", n["editable"] as Boolean)
                        put("cx", n["cx"] as Int); put("cy", n["cy"] as Int)
                    })
                }
            })
        })
    }
}

/** ui.system_action {action} — extended global actions: power_dialog/lock_screen/screenshot/split_screen/dismiss_notifications. */
class UiSystemActionCapability : Capability {
    override val method = "ui.system_action"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Extended system action. Params: {action: power_dialog|lock_screen|screenshot|split_screen|dismiss_notifications}."
    override suspend fun execute(params: JsonObject): CapResult {
        val s = svc() ?: return off()
        val action = params.s("action") ?: return typedError("INVALID_PARAMS", "'action' required")
        val ok = s.systemAction(action)
        return if (ok) CapResult(result = buildJsonObject { put("ok", true); put("action", action) })
        else typedError("UNSUPPORTED_ACTION", "'$action' unknown or not available on this Android version")
    }
}

/** foreground.app — which app is currently on screen (held accessibility access; avoids PACKAGE_USAGE_STATS). */
class ForegroundAppCapability : Capability {
    override val method = "foreground.app"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Get the package name of the app currently in the foreground."
    override suspend fun execute(params: JsonObject): CapResult {
        val s = svc() ?: return off()
        val pkg = s.foregroundPackage ?: s.rootInActiveWindow?.packageName?.toString()
        return CapResult(result = buildJsonObject { put("package", pkg ?: ""); put("known", pkg != null) })
    }
}
