// UNVERIFIED — compiles only with Android SDK + JDK 17/21 + device. See DESIGN.md § Build status.
package com.agenticandroid.capabilities

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import androidx.core.content.ContextCompat
import com.agenticandroid.BusEndpoint
import com.agenticandroid.CapResult
import com.agenticandroid.Capability
import com.agenticandroid.Sensitivity
import com.agenticandroid.typedError
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Mirrors phone-sim.ts `camera.capture`, `camera.state`, and `camera.release`.
 *
 * Semantics (Q10 observe/recover chain):
 *   - camera.capture  : opens camera2, fires a still capture, closes camera, uploads encrypted blob,
 *                       returns {blob_id, size, content_type, width, height}.
 *                       If cameraHeld → CAMERA_IN_USE (retriable=true).
 *   - camera.state    : returns {held: Boolean} — lets the agent observe before capture.
 *   - camera.release  : clears cameraHeld so a subsequent capture can proceed.
 *
 * Blob bytes are encrypted by BusEndpoint.putBlob (which calls Crypto.sealFor) before the PUT to the
 * relay. The URL-safe/no-pad base64 contract is centralised in Crypto.kt — this file never re-encodes.
 *
 * Required manifest permission: android.permission.CAMERA (already in AndroidManifest.xml).
 *
 * TODO (device wiring):
 *   - Replace JPEG_FALLBACK_BYTES with a real camera2 still capture (see captureFrame below).
 *   - Camera thread/looper already scaffolded; wire ImageReader.acquireLatestImage().planes[0].buffer.
 *   - Handle SecurityException if the OS revokes CAMERA at runtime.
 */
class CameraCaptureCapability(
    private val context: Context,
    private val bus: BusEndpoint,
) : Capability {
    override val method = "camera.capture"
    override val sensitivity = Sensitivity.ALLOW
    override val summary = "Capture a photo (opens the camera internally) and return it as an E2E blob."

    // Shared mutable state — mirrors PhoneSim.cameraHeld in the TS sim.
    // Volatile so camera.state / camera.release see the same value across coroutine dispatchers.
    @Volatile internal var cameraHeld: Boolean = false

    override suspend fun execute(params: JsonObject): CapResult {
        if (cameraHeld) {
            return typedError("CAMERA_IN_USE", "camera is held by another app", retriable = true)
        }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return typedError("PERMISSION_NOT_GRANTED", "CAMERA permission not granted")
        }

        val width  = params["width"]?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull() }  ?: 1920
        val height = params["height"]?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull() } ?: 1080

        return withContext(Dispatchers.IO) {
            try {
                cameraHeld = true
                val jpegBytes = captureFrame(width, height)
                val blobId = bus.putBlob(jpegBytes)
                CapResult(result = buildJsonObject {
                    put("blob_id",      blobId)
                    put("size",         jpegBytes.size)
                    put("content_type", "image/jpeg")
                    put("width",        width)
                    put("height",       height)
                })
            } catch (e: Exception) {
                typedError("CAMERA_IN_USE", e.message ?: "capture failed", retriable = true)
            } finally {
                cameraHeld = false
            }
        }
    }

    /**
     * TODO: replace stub with real camera2 still capture.
     * Pattern:
     *   1. cameraManager.openCamera(cameraId, stateCallback, bgHandler)
     *   2. device.createCaptureSession([imageReader.surface], sessionCallback, bgHandler)
     *   3. session.capture(request, captureCallback, bgHandler)
     *   4. imageReader.acquireLatestImage() -> planes[0].buffer -> ByteArray
     *   5. close session + device
     */
    private suspend fun captureFrame(width: Int, height: Int): ByteArray {
        // Stub: synthetic JPEG-shaped payload so the bus/crypto path is exercised on a real device
        // before camera2 wiring is complete.  Replace this entire function body with real camera2.
        val size = width * height * 3 / 8 // rough JPEG estimate
        return ByteArray(size) { i -> ((i * 13 + 7) and 0xff).toByte() }
    }
}

/** Mirrors phone-sim.ts `camera.state` — observe whether the camera is currently held. */
class CameraStateCapability(
    private val captureProvider: CameraCaptureCapability,
) : Capability {
    override val method      = "camera.state"
    override val sensitivity = Sensitivity.ALLOW
    override val summary     = "Observe whether the camera is currently held."

    override suspend fun execute(params: JsonObject): CapResult =
        CapResult(result = buildJsonObject { put("held", captureProvider.cameraHeld) })
}

/** Mirrors phone-sim.ts `camera.release` — clears cameraHeld so the agent can retry capture. */
class CameraReleaseCapability(
    private val captureProvider: CameraCaptureCapability,
) : Capability {
    override val method      = "camera.release"
    override val sensitivity = Sensitivity.ALLOW
    override val summary     = "Release the camera if held by this app."

    override suspend fun execute(params: JsonObject): CapResult {
        captureProvider.cameraHeld = false
        return CapResult(result = buildJsonObject { put("released", true) })
    }
}
