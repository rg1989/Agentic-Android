// UNVERIFIED — compiles only with Android SDK + JDK 17/21 + device. See DESIGN.md § Build status.
package com.agenticandroid.capabilities

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import com.agenticandroid.CapResult
import com.agenticandroid.Capability
import com.agenticandroid.Sensitivity
import com.agenticandroid.typedError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Mirrors phone-sim.ts `sms.send`.
 *
 * Sends a plain-text SMS via SmsManager and returns {sent: true, to: <number>}.
 * Sensitivity is ASK (consequential action, same as the TS sim default).
 *
 * Required manifest permission: android.permission.SEND_SMS (already in AndroidManifest.xml).
 *
 * Params:
 *   - to   (String, required) : destination phone number in E.164 or local format.
 *   - body (String, required) : message text; long messages are auto-divided by SmsManager.
 *
 * TODO (device wiring):
 *   - Wire PendingIntent sentIntent to track delivery confirmation if needed.
 *   - On API 31+ use context.getSystemService(SmsManager::class.java) or
 *     SmsManager.createForSubscriptionId() to respect the default SIM card.
 */
class SmsCapability(private val context: Context) : Capability {
    override val method      = "sms.send"
    override val sensitivity = Sensitivity.ASK
    override val summary     = "Send an SMS."

    override suspend fun execute(params: JsonObject): CapResult {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return typedError("PERMISSION_NOT_GRANTED", "SEND_SMS permission not granted")
        }

        val to   = (params["to"]   as? JsonPrimitive)?.content
            ?: return typedError("INVALID_PARAMS", "'to' is required")
        val body = (params["body"] as? JsonPrimitive)?.content
            ?: return typedError("INVALID_PARAMS", "'body' is required")

        return withContext(Dispatchers.IO) {
            try {
                val smsManager = getSmsManager()
                // divideMessage handles >160-char bodies; sendMultipartTextMessage wraps single parts fine.
                val parts = smsManager.divideMessage(body)
                smsManager.sendMultipartTextMessage(
                    to,
                    null,       // use default SMSC
                    parts,
                    null,       // sentIntents — TODO: wire PendingIntent for delivery tracking
                    null,       // deliveryIntents
                )
                CapResult(result = buildJsonObject {
                    put("sent", true)
                    put("to",   to)
                })
            } catch (e: Exception) {
                typedError("SMS_FAILED", e.message ?: "SMS send failed")
            }
        }
    }

    /**
     * API-level-safe SmsManager accessor.
     * On API 31+ the preferred path is context.getSystemService(SmsManager::class.java).
     * getDefault() still works on 31+ but is deprecated; left as the safe fallback here.
     * TODO: use subscriptionId from TelephonyManager for multi-SIM devices.
     */
    @Suppress("DEPRECATION")
    private fun getSmsManager(): SmsManager =
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            context.getSystemService(SmsManager::class.java)
        } else {
            SmsManager.getDefault()
        }
}
