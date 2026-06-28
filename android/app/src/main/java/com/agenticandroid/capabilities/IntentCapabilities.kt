package com.agenticandroid.capabilities

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.AlarmClock
import android.provider.Settings
import com.agenticandroid.CapResult
import com.agenticandroid.Capability
import com.agenticandroid.Sensitivity
import com.agenticandroid.typedError
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Cheap-batch intent hand-offs (DESIGN "cheap batch"). Zero restricted permissions: each fires a
 * standard Intent the OS routes to the right app, widening the agent's everyday reach (call, share,
 * email, navigate, set alarms/timers, open Settings panels, uninstall) without touching the
 * restricted SMS/Call-Log/contacts groups. alarm.set/timer.set use the normal SET_ALARM permission.
 */
private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.content
private fun JsonObject.int(k: String): Int? = (this[k] as? JsonPrimitive)?.content?.toIntOrNull()
private fun Intent.newTask() = addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

private fun Context.fire(intent: Intent, ok: JsonObject): CapResult =
    try { startActivity(intent.newTask()); CapResult(result = ok) }
    catch (e: Exception) { typedError("NO_HANDLER", e.message ?: "no app to handle this action") }

/** phone.dial {number} — open the dialer pre-filled (user taps call). No permission. */
class DialCapability(private val ctx: Context) : Capability {
    override val method = "phone.dial"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Open the dialer pre-filled with a number (user taps to call). Params: {number}."
    override suspend fun execute(params: JsonObject): CapResult {
        val number = params.str("number") ?: return typedError("INVALID_PARAMS", "'number' required")
        return ctx.fire(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$number")),
            buildJsonObject { put("dialing", number) })
    }
}

/** share.send {text, package?} — push text/a link out via the share sheet (or a named target app). */
class ShareCapability(private val ctx: Context) : Capability {
    override val method = "share.send"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Share text via the share sheet. Params: {text, subject?, package?}."
    override suspend fun execute(params: JsonObject): CapResult {
        val text = params.str("text") ?: return typedError("INVALID_PARAMS", "'text' required")
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
        params.str("subject")?.let { send.putExtra(Intent.EXTRA_SUBJECT, it) }
        val target = params.str("package")
        val intent = if (target != null) send.setPackage(target) else Intent.createChooser(send, "Share")
        return ctx.fire(intent, buildJsonObject { put("shared", true); put("len", text.length) })
    }
}

/** email.compose {to?, subject?, body?} — open the email composer pre-filled. No permission. */
class EmailComposeCapability(private val ctx: Context) : Capability {
    override val method = "email.compose"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Open the email composer pre-filled. Params: {to?, subject?, body?}."
    override suspend fun execute(params: JsonObject): CapResult {
        val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:${params.str("to") ?: ""}"))
        params.str("subject")?.let { intent.putExtra(Intent.EXTRA_SUBJECT, it) }
        params.str("body")?.let { intent.putExtra(Intent.EXTRA_TEXT, it) }
        return ctx.fire(intent, buildJsonObject { put("composing", true) })
    }
}

/** navigation.start {query?|lat,lng?} — launch turn-by-turn navigation. No permission. */
class NavigationCapability(private val ctx: Context) : Capability {
    override val method = "navigation.start"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Start navigation. Params: {query: \"address\"} or {lat, lng}."
    override suspend fun execute(params: JsonObject): CapResult {
        val query = params.str("query")
        val lat = params.str("lat"); val lng = params.str("lng")
        val uri = when {
            query != null -> Uri.parse("google.navigation:q=${Uri.encode(query)}")
            lat != null && lng != null -> Uri.parse("google.navigation:q=$lat,$lng")
            else -> return typedError("INVALID_PARAMS", "'query' or 'lat'+'lng' required")
        }
        return ctx.fire(Intent(Intent.ACTION_VIEW, uri), buildJsonObject { put("navigating", true) })
    }
}

/** alarm.set {hour, minute, label?} — create an alarm. Needs SET_ALARM (normal, auto-granted). */
class AlarmSetCapability(private val ctx: Context) : Capability {
    override val method = "alarm.set"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Set an alarm. Params: {hour: 0-23, minute: 0-59, label?}. EXTRA_SKIP_UI is advisory — some clock apps still show their UI."
    override suspend fun execute(params: JsonObject): CapResult {
        val hour = params.int("hour") ?: return typedError("INVALID_PARAMS", "'hour' required")
        val minute = params.int("minute") ?: 0
        val intent = Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, hour.coerceIn(0, 23))
            .putExtra(AlarmClock.EXTRA_MINUTES, minute.coerceIn(0, 59))
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
        params.str("label")?.let { intent.putExtra(AlarmClock.EXTRA_MESSAGE, it) }
        return ctx.fire(intent, buildJsonObject { put("alarm_set", "%02d:%02d".format(hour, minute)) })
    }
}

/** timer.set {seconds, label?} — start a countdown timer. Needs SET_ALARM (normal). */
class TimerSetCapability(private val ctx: Context) : Capability {
    override val method = "timer.set"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Start a countdown timer. Params: {seconds, label?}. EXTRA_SKIP_UI is advisory — some clock apps still show their UI."
    override suspend fun execute(params: JsonObject): CapResult {
        val seconds = params.int("seconds") ?: return typedError("INVALID_PARAMS", "'seconds' required")
        val intent = Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, seconds.coerceAtLeast(1))
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
        params.str("label")?.let { intent.putExtra(AlarmClock.EXTRA_MESSAGE, it) }
        return ctx.fire(intent, buildJsonObject { put("timer_seconds", seconds) })
    }
}

/**
 * settings.panel {panel} — open an inline Settings panel or deep-link a Settings screen.
 * This is the sanctioned answer to "an app can't toggle Wi-Fi": it hands the user the one tap.
 */
class SettingsPanelCapability(private val ctx: Context) : Capability {
    override val method = "settings.panel"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Open a Settings panel/screen. Params: {panel: internet|wifi|nfc|volume|location|bluetooth|airplane|app}."
    override suspend fun execute(params: JsonObject): CapResult {
        val panel = (params.str("panel") ?: "internet").lowercase()
        val action = when (panel) {
            "internet" -> Settings.Panel.ACTION_INTERNET_CONNECTIVITY
            "wifi" -> Settings.Panel.ACTION_WIFI
            "nfc" -> Settings.Panel.ACTION_NFC
            "volume" -> Settings.Panel.ACTION_VOLUME
            "location" -> Settings.ACTION_LOCATION_SOURCE_SETTINGS
            "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
            "airplane" -> Settings.ACTION_AIRPLANE_MODE_SETTINGS
            "app" -> Settings.ACTION_APPLICATION_DETAILS_SETTINGS
            else -> return typedError("INVALID_PARAMS", "unknown panel '$panel'")
        }
        val intent = Intent(action)
        if (panel == "app") intent.data = Uri.parse("package:${params.str("package") ?: ctx.packageName}")
        return ctx.fire(intent, buildJsonObject { put("opened", panel) })
    }
}

/** app.uninstall {package} — open the OS uninstall confirmation for a package. No permission. */
class AppUninstallCapability(private val ctx: Context) : Capability {
    override val method = "app.uninstall"; override val sensitivity = Sensitivity.ASK
    override val summary = "Open the uninstall confirmation for an app. Params: {package}."
    override suspend fun execute(params: JsonObject): CapResult {
        val pkg = params.str("package") ?: return typedError("INVALID_PARAMS", "'package' required")
        @Suppress("DEPRECATION")
        val intent = Intent(Intent.ACTION_DELETE, Uri.parse("package:$pkg"))
        return ctx.fire(intent, buildJsonObject { put("uninstall_prompt", pkg) })
    }
}
