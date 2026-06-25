// UNVERIFIED — compiles only with Android SDK + JDK 17/21 + device. See DESIGN.md § Build status.
package com.agenticandroid.capabilities

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
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
                // Save to the user's gallery + show an inline preview in the chat.
                val name = "AgenticAndroid_" + System.currentTimeMillis()
                com.agenticandroid.Photos.save(context, jpegBytes, name)
                    ?.let { com.agenticandroid.PhoneAgentService.instance?.addPhoto(it) }
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
    /** Real camera2 still capture: open back camera -> JPEG ImageReader -> one STILL_CAPTURE -> bytes. */
    @SuppressLint("MissingPermission") // permission checked in execute()
    private suspend fun captureFrame(width: Int, height: Int): ByteArray {
        val cm = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val cameraId = cm.cameraIdList.firstOrNull {
            cm.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
        } ?: cm.cameraIdList.firstOrNull() ?: error("no camera available")
        val chars = cm.getCameraCharacteristics(cameraId)
        val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
        val sizes = map?.getOutputSizes(ImageFormat.JPEG)
        // pick the JPEG size closest to the requested area (cap at ~8MP to keep blobs reasonable)
        val want = width.toLong() * height
        val size = sizes?.filter { it.width.toLong() * it.height <= 8_300_000L }
            ?.minByOrNull { kotlin.math.abs(it.width.toLong() * it.height - want) }
            ?: sizes?.firstOrNull()
            ?: android.util.Size(width, height)
        val orientation = chars.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90

        val reader = ImageReader.newInstance(size.width, size.height, ImageFormat.JPEG, 2)
        // Detached preview surface: the camera streams to it so auto-exposure/focus converge BEFORE the
        // still capture. Without this warm-up the first JPEG comes back black/unexposed.
        val previewTexture = SurfaceTexture(false).apply { setDefaultBufferSize(1280, 720) }
        val previewSurface = Surface(previewTexture)
        val thread = HandlerThread("cam-capture").apply { start() }
        val handler = Handler(thread.looper)
        var device: CameraDevice? = null
        try {
            return suspendCancellableCoroutine { cont ->
                reader.setOnImageAvailableListener({ r ->
                    val img = r.acquireLatestImage() ?: return@setOnImageAvailableListener
                    try {
                        val buf = img.planes[0].buffer
                        val arr = ByteArray(buf.remaining()); buf.get(arr)
                        if (cont.isActive) cont.resume(arr)
                    } finally { img.close() }
                }, handler)

                cm.openCamera(cameraId, object : CameraDevice.StateCallback() {
                    override fun onOpened(d: CameraDevice) {
                        device = d
                        d.createCaptureSession(listOf(previewSurface, reader.surface), object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(session: CameraCaptureSession) {
                                var stillFired = false
                                val fireStill = fire@{
                                    if (stillFired) return@fire
                                    stillFired = true
                                    runCatching { session.stopRepeating() }
                                    val still = d.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply {
                                        addTarget(reader.surface)
                                        set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                                        set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
                                        set(CaptureRequest.JPEG_ORIENTATION, orientation)
                                    }.build()
                                    runCatching { session.capture(still, null, handler) }
                                        .onFailure { if (cont.isActive) cont.resumeWithException(it) }
                                }

                                // Stream a preview; capture once auto-exposure has settled (or a fallback).
                                val preview = d.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                                    addTarget(previewSurface)
                                    set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                                    set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
                                }.build()
                                var frames = 0
                                val previewCb = object : CameraCaptureSession.CaptureCallback() {
                                    override fun onCaptureCompleted(s: CameraCaptureSession, request: CaptureRequest, result: TotalCaptureResult) {
                                        if (stillFired) return
                                        frames++
                                        val ae = result.get(CaptureResult.CONTROL_AE_STATE)
                                        val ready = ae == null ||
                                            ae == CameraMetadata.CONTROL_AE_STATE_CONVERGED ||
                                            ae == CameraMetadata.CONTROL_AE_STATE_FLASH_REQUIRED ||
                                            ae == CameraMetadata.CONTROL_AE_STATE_LOCKED
                                        if ((ready && frames >= 4) || frames >= 30) fireStill()
                                    }
                                }
                                runCatching { session.setRepeatingRequest(preview, previewCb, handler) }
                                    .onFailure { fireStill() }
                                handler.postDelayed({ fireStill() }, 2000) // hard fallback if 3A stalls
                            }
                            override fun onConfigureFailed(session: CameraCaptureSession) {
                                if (cont.isActive) cont.resumeWithException(IllegalStateException("capture session config failed"))
                            }
                        }, handler)
                    }
                    override fun onDisconnected(d: CameraDevice) { d.close() }
                    override fun onError(d: CameraDevice, error: Int) {
                        d.close()
                        if (cont.isActive) cont.resumeWithException(IllegalStateException("camera error $error"))
                    }
                }, handler)

                cont.invokeOnCancellation { runCatching { device?.close() } }
            }
        } finally {
            runCatching { device?.close() }
            reader.close()
            runCatching { previewSurface.release() }
            runCatching { previewTexture.release() }
            thread.quitSafely()
        }
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
