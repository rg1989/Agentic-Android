package com.agenticandroid.capabilities

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.agenticandroid.CapResult
import com.agenticandroid.Capability
import com.agenticandroid.Sensitivity
import com.agenticandroid.typedError
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Helpers for reading params. */
private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.content
private fun JsonObject.int(k: String): Int? = (this[k] as? JsonPrimitive)?.content?.toIntOrNull()
private fun JsonObject.bool(k: String): Boolean? = (this[k] as? JsonPrimitive)?.content?.toBooleanStrictOrNull()

/** device.info — model, manufacturer, Android version, battery, charging. No permission. */
class DeviceInfoCapability(private val ctx: Context) : Capability {
    override val method = "device.info"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Get device model, Android version, and battery level."
    override suspend fun execute(params: JsonObject): CapResult {
        val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        return CapResult(result = buildJsonObject {
            put("manufacturer", Build.MANUFACTURER); put("model", Build.MODEL)
            put("android", Build.VERSION.RELEASE); put("sdk", Build.VERSION.SDK_INT)
            put("battery_pct", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
            put("charging", bm.isCharging)
        })
    }
}

/** torch.set {on:Boolean} — toggle the flashlight. No permission needed for setTorchMode. */
class TorchCapability(private val ctx: Context) : Capability {
    override val method = "torch.set"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Turn the flashlight on or off. Params: {on: true|false}."
    override suspend fun execute(params: JsonObject): CapResult {
        val on = params.bool("on") ?: true
        val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val id = cm.cameraIdList.firstOrNull {
            cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
        } ?: return typedError("NO_FLASH", "no flash unit on this device")
        return try { cm.setTorchMode(id, on); CapResult(result = buildJsonObject { put("torch", on) }) }
        catch (e: Exception) { typedError("TORCH_FAILED", e.message ?: "torch failed") }
    }
}

/** vibrate {ms:Long} — vibrate the device. Needs VIBRATE (normal perm, auto-granted). */
class VibrateCapability(private val ctx: Context) : Capability {
    override val method = "vibrate"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Vibrate the phone. Params: {ms: 500}."
    override suspend fun execute(params: JsonObject): CapResult {
        val ms = (params.str("ms")?.toLongOrNull()) ?: 500L
        val vib: Vibrator = if (Build.VERSION.SDK_INT >= 31)
            (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        else @Suppress("DEPRECATION") (ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator)
        vib.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
        return CapResult(result = buildJsonObject { put("vibrated_ms", ms) })
    }
}

/** volume.get — current media volume as a percentage. */
class VolumeGetCapability(private val ctx: Context) : Capability {
    override val method = "volume.get"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Get the media volume (0-100)."
    override suspend fun execute(params: JsonObject): CapResult {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val cur = am.getStreamVolume(AudioManager.STREAM_MUSIC)
        return CapResult(result = buildJsonObject { put("percent", if (max == 0) 0 else cur * 100 / max) })
    }
}

/** volume.set {percent:Int} — set media volume 0-100. */
class VolumeSetCapability(private val ctx: Context) : Capability {
    override val method = "volume.set"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Set the media volume. Params: {percent: 0-100}."
    override suspend fun execute(params: JsonObject): CapResult {
        val pct = (params.int("percent") ?: return typedError("INVALID_PARAMS", "'percent' required")).coerceIn(0, 100)
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        am.setStreamVolume(AudioManager.STREAM_MUSIC, pct * max / 100, 0)
        return CapResult(result = buildJsonObject { put("percent", pct) })
    }
}

/** app.launch {package:String} — open an installed app by package name. */
class AppLaunchCapability(private val ctx: Context) : Capability {
    override val method = "app.launch"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Open an app by package name. Params: {package: \"com.android.chrome\"}."
    override suspend fun execute(params: JsonObject): CapResult {
        val pkg = params.str("package") ?: return typedError("INVALID_PARAMS", "'package' required")
        val intent = ctx.packageManager.getLaunchIntentForPackage(pkg)
            ?: return typedError("APP_NOT_FOUND", "no launchable app: $pkg")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
        return CapResult(result = buildJsonObject { put("launched", pkg) })
    }
}

/** apps.list — list installed launchable apps (label + package). */
class AppsListCapability(private val ctx: Context) : Capability {
    override val method = "apps.list"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "List installed launchable apps (label + package)."
    override suspend fun execute(params: JsonObject): CapResult {
        val pm = ctx.packageManager
        val main = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val apps = pm.queryIntentActivities(main, 0)
            .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
            .distinctBy { it.first }.sortedBy { it.second }
        return CapResult(result = buildJsonObject {
            put("count", apps.size)
            put("apps", buildJsonArray { apps.take(200).forEach { (p, l) -> add(buildJsonObject { put("package", p); put("label", l) }) } })
        })
    }
}

/** url.open {url:String} — open a URL in the default browser/handler. */
class OpenUrlCapability(private val ctx: Context) : Capability {
    override val method = "url.open"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Open a URL. Params: {url: \"https://...\"}."
    override suspend fun execute(params: JsonObject): CapResult {
        val url = params.str("url") ?: return typedError("INVALID_PARAMS", "'url' required")
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try { ctx.startActivity(intent); CapResult(result = buildJsonObject { put("opened", url) }) }
        catch (e: Exception) { typedError("NO_HANDLER", e.message ?: "no app to open url") }
    }
}

/** notify.post {title, text} — show a local notification on the phone. */
class PostNotificationCapability(private val ctx: Context) : Capability {
    override val method = "notify.post"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Post a notification on the phone. Params: {title, text}."
    private val ch = "agent_posted"
    override suspend fun execute(params: JsonObject): CapResult {
        val title = params.str("title") ?: "Agent"
        val text = params.str("text") ?: ""
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(ch) == null)
            nm.createNotificationChannel(NotificationChannel(ch, "Agent messages", NotificationManager.IMPORTANCE_DEFAULT))
        val n = android.app.Notification.Builder(ctx, ch)
            .setContentTitle(title).setContentText(text)
            .setSmallIcon(android.R.drawable.ic_dialog_info).setAutoCancel(true).build()
        nm.notify((System.currentTimeMillis() and 0xffffff).toInt(), n)
        return CapResult(result = buildJsonObject { put("posted", true); put("title", title) })
    }
}

/** clipboard.set {text} — set the phone clipboard. */
class ClipboardSetCapability(private val ctx: Context) : Capability {
    override val method = "clipboard.set"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Set the phone clipboard. Params: {text}."
    override suspend fun execute(params: JsonObject): CapResult {
        val text = params.str("text") ?: return typedError("INVALID_PARAMS", "'text' required")
        val cb = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cb.setPrimaryClip(ClipData.newPlainText("agent", text))
        return CapResult(result = buildJsonObject { put("set", true); put("len", text.length) })
    }
}
