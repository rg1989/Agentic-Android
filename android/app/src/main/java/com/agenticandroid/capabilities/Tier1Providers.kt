// UNVERIFIED — compiles only with Android SDK + JDK 17/21 + device. See DESIGN.md § Build status.
package com.agenticandroid.capabilities

import android.content.Context
import com.agenticandroid.BusEndpoint
import com.agenticandroid.CapabilityRegistry

/**
 * Single registration point for all Tier-1 capability providers.
 *
 * Call [registerTier1] from PhoneAgentService (or any orchestrator) after the BusEndpoint is
 * connected.  This unit deliberately does NOT edit PhoneAgentService.kt — wiring is the caller's
 * responsibility (Q4 swap-point discipline).
 *
 * Usage example (in PhoneAgentService.ensureConnected):
 *
 *   registerTier1(registry, bus)
 *   AgentNotificationListenerService.bus = bus  // wire event emitter
 *
 * Registered capabilities and their default sensitivities:
 *   camera.capture   ALLOW   — still capture via camera2; returns encrypted blob
 *   camera.state     ALLOW   — observe cameraHeld (observe/recover chain, Q10)
 *   camera.release   ALLOW   — release the camera lock
 *   location.get     ALLOW   — FusedLocationProviderClient single fix
 *   sms.send         ASK     — SmsManager; consequential, requires user confirmation
 *   notification.listen ASK  — notification listener status + last-posted snapshot
 */
fun registerTier1(registry: CapabilityRegistry, bus: BusEndpoint, context: Context) {
    // Camera cluster — share one CameraCaptureCapability instance so cameraHeld is coherent.
    val cameraCapture = CameraCaptureCapability(context, bus)
    registry.register(cameraCapture)
    registry.register(CameraStateCapability(cameraCapture))
    registry.register(CameraReleaseCapability(cameraCapture))

    // Location
    registry.register(LocationCapability(context))

    // SMS
    registry.register(SmsCapability(context))

    // Notifications
    registry.register(NotificationListenerCapability(context))

    // Wire bus into the listener service singleton so it can forward events (capability B).
    // The service is bound by Android separately; this just sets the shared reference.
    AgentNotificationListenerService.bus = bus
}
