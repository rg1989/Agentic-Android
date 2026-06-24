// UNVERIFIED — compiles only with Android SDK + JDK 17/21 + device. See DESIGN.md § Build status.
package com.agenticandroid.capabilities

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.agenticandroid.BusEndpoint
import com.agenticandroid.CapResult
import com.agenticandroid.Capability
import com.agenticandroid.Sensitivity
import com.agenticandroid.typedError
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Exposes posted notifications to the agent via the `notification.posted` event topic.
 *
 * Two pieces:
 *   1. [NotificationListenerCapability] — a [Capability] registered in the CapabilityRegistry that
 *      lets the agent query whether the listener is active and request the last-seen notification
 *      (method "notification.listen", sensitivity ASK).
 *
 *   2. [AgentNotificationListenerService] — a [NotificationListenerService] subclass. When a new
 *      notification is posted the service calls bus.event("notification.posted", {...}) so the
 *      agent learns about it in real time (capability B direction, Q1).
 *
 * Manifest requirement (follow-up — do NOT edit AndroidManifest.xml here):
 *   The service must be declared with:
 *     <service android:name=".capabilities.AgentNotificationListenerService"
 *              android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"
 *              android:exported="true">
 *       <intent-filter>
 *         <action android:name="android.service.notification.NotificationListenerService"/>
 *       </intent-filter>
 *     </service>
 *   The user must also grant the app access in Settings > Notification access.
 *   This is owned elsewhere — do not add it here.
 *
 * Sensitivity is ASK (notification content is personal, same rationale as sms.send).
 *
 * TODO (device wiring):
 *   - Wire bus reference into AgentNotificationListenerService.  The cleanest pattern on Android is
 *     a singleton / static reference set by PhoneAgentService after the service connects, or a
 *     Binder-based ServiceConnection.  See companion object below.
 *   - Filter out self-notifications (packageName == context.packageName) to avoid loops.
 *   - Respect the user's per-(agent×capability) policy before emitting events.
 */
class NotificationListenerCapability(private val context: Context) : Capability {
    override val method      = "notification.listen"
    override val sensitivity = Sensitivity.ASK
    override val summary     = "Subscribe to posted notifications (returns listener status and last notification if any)."

    override suspend fun execute(params: JsonObject): CapResult {
        val enabled = isNotificationListenerEnabled()
        if (!enabled) {
            return typedError(
                "PERMISSION_NOT_GRANTED",
                "Notification listener access not granted; direct user to Settings > Notification access",
            )
        }
        // Return listener status and the last observed notification snapshot (may be null).
        val last = AgentNotificationListenerService.lastPosted
        return CapResult(result = buildJsonObject {
            put("listening", true)
            if (last != null) {
                put("last", buildJsonObject {
                    put("package_name", last.packageName)
                    put("title",        last.title ?: "")
                    put("text",         last.text  ?: "")
                    put("posted_at_ms", last.postedAt)
                })
            }
        })
    }

    /** Check if this app appears in the system's notification listener allow-list. */
    private fun isNotificationListenerEnabled(): Boolean {
        val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
            ?: return false
        val component = ComponentName(context, AgentNotificationListenerService::class.java)
        return flat.split(":").any { ComponentName.unflattenFromString(it) == component }
    }
}

/** Snapshot of the most recently observed notification; shared from the service singleton. */
data class NotificationSnapshot(
    val packageName: String,
    val title: String?,
    val text: String?,
    val postedAt: Long,
)

/**
 * NotificationListenerService that forwards posted notifications to the agent bus as events.
 *
 * Lifecycle: Android binds this service when the user grants notification listener permission.
 * onNotificationPosted fires for every new notification across all apps.
 *
 * TODO: set [bus] via companion before forwarding; filter duplicates / rate-limit if needed.
 */
class AgentNotificationListenerService : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val extras = sbn.notification.extras
        val title  = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val text   = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()

        val snapshot = NotificationSnapshot(
            packageName = sbn.packageName,
            title       = title,
            text        = text,
            postedAt    = sbn.postTime,
        )
        lastPosted = snapshot

        // Emit event on the agent bus if it is wired (set by PhoneAgentService after connect).
        bus?.event("notification.posted", buildJsonObject {
            put("package_name", sbn.packageName)
            put("title",        title ?: "")
            put("text",         text  ?: "")
            put("posted_at_ms", sbn.postTime)
        })
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        // No event emitted for removal in v1; extend here if needed.
    }

    companion object {
        /**
         * Set by PhoneAgentService (or any orchestrator) once the BusEndpoint is connected.
         * Volatile so the assignment from the service thread is visible here.
         * TODO: use a thread-safe ServiceConnection / Binder if stricter lifecycle is required.
         */
        @Volatile var bus: BusEndpoint? = null

        /** Last-seen notification snapshot; exposed to NotificationListenerCapability.execute(). */
        @Volatile var lastPosted: NotificationSnapshot? = null
    }
}
