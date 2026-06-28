package com.agenticandroid.capabilities

import android.app.KeyguardManager
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.LocationManager
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.WindowManager
import com.agenticandroid.CapResult
import com.agenticandroid.Capability
import com.agenticandroid.Sensitivity
import com.agenticandroid.typedError
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Read-only situational-awareness capabilities (DESIGN "free batch" + cheap network/sensors).
 * All but network.state need no permission; network.state needs ACCESS_NETWORK_STATE (normal).
 * These give the agent the context to reason before acting — power, screen/lock state, the real
 * display size (the coordinate space for ui.tap), connectivity, sensors, and settings.
 */
private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.content

/** battery.status — level, charging, temperature, health, power-save (superset of device.info). */
class BatteryStatusCapability(private val ctx: Context) : Capability {
    override val method = "battery.status"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Battery level, charging state, temperature, health, power-save mode."
    override suspend fun execute(params: JsonObject): CapResult {
        val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        val sticky = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val tempC = (sticky?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1) ?: -1).let { if (it < 0) null else it / 10.0 }
        val volt = sticky?.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1)?.takeIf { it >= 0 }
        val health = sticky?.getIntExtra(BatteryManager.EXTRA_HEALTH, -1)
        return CapResult(result = buildJsonObject {
            put("percent", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
            put("charging", bm.isCharging)
            tempC?.let { put("temperature_c", it) }
            volt?.let { put("voltage_mv", it) }
            put("health", batteryHealth(health))
            put("power_save", pm.isPowerSaveMode)
        })
    }
    private fun batteryHealth(h: Int?) = when (h) {
        BatteryManager.BATTERY_HEALTH_GOOD -> "good"
        BatteryManager.BATTERY_HEALTH_OVERHEAT -> "overheat"
        BatteryManager.BATTERY_HEALTH_DEAD -> "dead"
        BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "over_voltage"
        BatteryManager.BATTERY_HEALTH_COLD -> "cold"
        else -> "unknown"
    }
}

/** screen.state — interactive (on), locked, secure-lock, brightness, screen-off timeout. */
class ScreenStateCapability(private val ctx: Context) : Capability {
    override val method = "screen.state"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Whether the screen is on, locked, and whether a secure lock is set."
    override suspend fun execute(params: JsonObject): CapResult {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        val km = ctx.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        val brightness = runCatching { Settings.System.getInt(ctx.contentResolver, Settings.System.SCREEN_BRIGHTNESS) }.getOrNull()
        val timeout = runCatching { Settings.System.getInt(ctx.contentResolver, Settings.System.SCREEN_OFF_TIMEOUT) }.getOrNull()
        return CapResult(result = buildJsonObject {
            put("interactive", pm.isInteractive)
            put("locked", km.isKeyguardLocked)
            put("secure_lock", km.isDeviceSecure)
            brightness?.let { put("brightness", it) }       // 0-255
            timeout?.let { put("screen_off_timeout_ms", it) }
        })
    }
}

/** display.state — real display size/density/rotation/refresh: the coordinate space for ui.tap/ui.swipe. */
class DisplayStateCapability(private val ctx: Context) : Capability {
    override val method = "display.state"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Real screen width/height/density/rotation — the tap coordinate space."
    override suspend fun execute(params: JsonObject): CapResult {
        val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val dm = DisplayMetrics()
        @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(dm)
        @Suppress("DEPRECATION") val rotation = wm.defaultDisplay.rotation
        @Suppress("DEPRECATION") val refresh = wm.defaultDisplay.refreshRate
        return CapResult(result = buildJsonObject {
            put("width", dm.widthPixels); put("height", dm.heightPixels)
            put("density", dm.density); put("dpi", dm.densityDpi)
            put("rotation", rotation * 90); put("refresh_hz", refresh)
        })
    }
}

/** volume.state — every stream's volume percent + ringer mode (read-only superset of volume.get). */
class VolumeStateCapability(private val ctx: Context) : Capability {
    override val method = "volume.state"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Volume percent for each audio stream plus ringer mode."
    override suspend fun execute(params: JsonObject): CapResult {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        fun pct(stream: Int): Int {
            val max = am.getStreamMaxVolume(stream)
            return if (max == 0) 0 else am.getStreamVolume(stream) * 100 / max
        }
        return CapResult(result = buildJsonObject {
            put("music", pct(AudioManager.STREAM_MUSIC)); put("ring", pct(AudioManager.STREAM_RING))
            put("alarm", pct(AudioManager.STREAM_ALARM)); put("notification", pct(AudioManager.STREAM_NOTIFICATION))
            put("call", pct(AudioManager.STREAM_VOICE_CALL))
            put("ringer_mode", when (am.ringerMode) {
                AudioManager.RINGER_MODE_SILENT -> "silent"
                AudioManager.RINGER_MODE_VIBRATE -> "vibrate"
                else -> "normal"
            })
        })
    }
}

/** storage.stat — internal storage free/total bytes. */
class StorageStatCapability(@Suppress("UNUSED_PARAMETER") ctx: Context) : Capability {
    override val method = "storage.stat"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Internal storage free and total bytes."
    override suspend fun execute(params: JsonObject): CapResult {
        val stat = StatFs(Environment.getDataDirectory().path)
        val free = stat.availableBytes; val total = stat.totalBytes
        return CapResult(result = buildJsonObject {
            put("free_bytes", free); put("total_bytes", total)
            put("free_pct", if (total == 0L) 0 else (free * 100 / total).toInt())
        })
    }
}

/** location.mode — whether location services are on, and which providers. No permission to read this. */
class LocationModeCapability(private val ctx: Context) : Capability {
    override val method = "location.mode"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Whether location services are enabled and which providers are active."
    override suspend fun execute(params: JsonObject): CapResult {
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return CapResult(result = buildJsonObject {
            put("enabled", lm.isLocationEnabled)
            put("gps", runCatching { lm.isProviderEnabled(LocationManager.GPS_PROVIDER) }.getOrDefault(false))
            put("network", runCatching { lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) }.getOrDefault(false))
        })
    }
}

/** settings.read {namespace, key} — read a System/Global/Secure setting. World-readable keys only. */
class SettingsReadCapability(private val ctx: Context) : Capability {
    override val method = "settings.read"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Read a setting. Params: {namespace: system|global|secure, key}. Some keys are restricted."
    override suspend fun execute(params: JsonObject): CapResult {
        val key = params.str("key") ?: return typedError("INVALID_PARAMS", "'key' required")
        val ns = (params.str("namespace") ?: "system").lowercase()
        val cr = ctx.contentResolver
        val value = runCatching {
            when (ns) {
                "global" -> Settings.Global.getString(cr, key)
                "secure" -> Settings.Secure.getString(cr, key)
                else -> Settings.System.getString(cr, key)
            }
        }.getOrNull()
        return CapResult(result = buildJsonObject {
            put("namespace", ns); put("key", key)
            if (value != null) put("value", value) else put("value_null", true)
        })
    }
}

/** clipboard.get — read the clipboard. Android 10+ only returns it while the app is foregrounded. */
class ClipboardGetCapability(private val ctx: Context) : Capability {
    override val method = "clipboard.get"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Read the clipboard text. Note: Android 10+ blocks reads unless the app is in the foreground."
    override suspend fun execute(params: JsonObject): CapResult {
        val cb = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = cb.primaryClip
        val text = if (clip != null && clip.itemCount > 0) clip.getItemAt(0).coerceToText(ctx).toString() else null
        return CapResult(result = buildJsonObject {
            put("has_text", text != null)
            if (text != null) put("text", text)
            else put("note", "empty, or blocked because the app is not in the foreground (Android 10+)")
        })
    }
}

/** network.state — active transport (wifi/cellular/none), validated, metered, VPN. Needs ACCESS_NETWORK_STATE. */
class NetworkStateCapability(private val ctx: Context) : Capability {
    override val method = "network.state"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Active network transport (wifi/cellular/none), internet-validated, metered, VPN."
    override suspend fun execute(params: JsonObject): CapResult {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
        val transport = when {
            caps == null -> "none"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "other"
        }
        return CapResult(result = buildJsonObject {
            put("transport", transport)
            put("online", caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) ?: false)
            put("metered", caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)?.not() ?: false)
            put("vpn", caps?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) ?: false)
        })
    }
}

/** sensors.read {type} — single-shot read of a hardware sensor (light/accelerometer/proximity/pressure/steps). */
class SensorsReadCapability(private val ctx: Context) : Capability {
    override val method = "sensors.read"; override val sensitivity = Sensitivity.ALLOW
    override val summary = "Single-shot sensor read. Params: {type: light|accelerometer|proximity|pressure|steps}."
    override suspend fun execute(params: JsonObject): CapResult {
        val typeName = (params.str("type") ?: "light").lowercase()
        val sensorType = when (typeName) {
            "light" -> Sensor.TYPE_LIGHT
            "accelerometer", "accel" -> Sensor.TYPE_ACCELEROMETER
            "proximity" -> Sensor.TYPE_PROXIMITY
            "pressure" -> Sensor.TYPE_PRESSURE
            "gyroscope", "gyro" -> Sensor.TYPE_GYROSCOPE
            "steps", "step_counter" -> Sensor.TYPE_STEP_COUNTER  // may need ACTIVITY_RECOGNITION on some OEMs
            else -> return typedError("INVALID_PARAMS", "unknown sensor type '$typeName'")
        }
        val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val sensor = sm.getDefaultSensor(sensorType) ?: return typedError("NO_SENSOR", "no '$typeName' sensor on this device")
        val done = CompletableDeferred<FloatArray>()
        val listener = object : SensorEventListener {
            override fun onSensorChanged(e: SensorEvent) { if (!done.isCompleted) done.complete(e.values.copyOf()) }
            override fun onAccuracyChanged(s: Sensor?, a: Int) {}
        }
        sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)
        // finally so the listener is unregistered on success, timeout, AND coroutine cancellation.
        val values = try { withTimeoutOrNull(3000) { done.await() } } finally { sm.unregisterListener(listener) }
        return if (values == null) typedError("SENSOR_TIMEOUT", "no reading from '$typeName' within 3s", retriable = true)
        else CapResult(result = buildJsonObject {
            put("type", typeName)
            put("values", buildJsonArray { values.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } })
        })
    }
}
