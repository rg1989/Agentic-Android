// UNVERIFIED — compiles only with Android SDK + JDK 17/21 + device. See DESIGN.md § Build status.
package com.agenticandroid.capabilities

import android.content.Context
import com.agenticandroid.BusEndpoint
import com.agenticandroid.CapabilityRegistry
import com.agenticandroid.RingCapability
import com.agenticandroid.Ringer
import com.agenticandroid.StopRingCapability

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
    // Ring cluster — share one Ringer so ring/stop_ring act on the same playback.
    val ringer = Ringer(context)
    registry.register(RingCapability(ringer))
    registry.register(StopRingCapability(ringer))

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

    // Device actions (real, no special grants) — gives an agent real control of the phone.
    registry.register(DeviceInfoCapability(context))
    registry.register(TorchCapability(context))
    registry.register(VibrateCapability(context))
    registry.register(VolumeGetCapability(context))
    registry.register(VolumeSetCapability(context))
    registry.register(AppLaunchCapability(context))
    registry.register(AppsListCapability(context))
    registry.register(OpenUrlCapability(context))
    registry.register(PostNotificationCapability(context))
    registry.register(ClipboardSetCapability(context))

    // Wire bus into the listener service singleton so it can forward events (capability B).
    // The service is bound by Android separately; this just sets the shared reference.
    AgentNotificationListenerService.bus = bus

    // Tier-2 computer-use (active only once the user enables Accessibility for this app).
    com.agenticandroid.automation.registerTier2(registry, bus, context)
}
