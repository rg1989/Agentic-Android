// UNVERIFIED in this environment (no Kotlin toolchain). Compile & run on device before shipping.
//
// Gradle deps (owned by the gradle build unit, do NOT add here):
//   implementation("androidx.camera:camera-camera2:1.3.x")
//   implementation("androidx.camera:camera-lifecycle:1.3.x")
//   implementation("androidx.camera:camera-view:1.3.x")
//   implementation("com.google.mlkit:barcode-scanning:17.x.x")
//   // OR: implementation("com.journeyapps:zxing-android-embedded:4.3.0")
//
// TODO: add to AndroidManifest.xml:
//   <activity android:name=".pairing.PairingActivity" ... />
//   <uses-permission android:name="android.permission.CAMERA" />
//
package com.agenticandroid.pairing

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.agenticandroid.BusEndpoint
import com.agenticandroid.PhoneAgentService
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * QR-scan pairing screen (Q5: QR + trust-on-first-use, phone is the approver).
 *
 * Flow:
 *   1. Request CAMERA permission if not already granted.
 *   2. Open CameraX preview + ML Kit barcode analyzer.
 *   3. On first QR frame: decode the bridge's pairing token via decodePairingToken().
 *   4. If not yet paired (TOFU): generate/load our own Identity, connect to the relay,
 *      and fire a pairing `event` back to the bridge so it learns the phone's edPub.
 *   5. Save PairingData via Pairing.save(); finish() and restart PhoneAgentService.
 *
 * The pairing event payload mirrors the bridge's config fields:
 *   topic = "pairing.response"
 *   data  = { edPub: <phone edPub>, fp: <phone fp> }
 *
 * This is the one-time-token + TOFU exchange described in Q5. The bridge adds the phone's
 * edPub to its config as `peerEdPub` (the operator does this manually for now; a future
 * bridge version will auto-complete via this event).
 *
 * TODO: add a "Already paired — re-pair?" confirmation dialog so the user doesn't
 *       accidentally overwrite a valid pairing.
 */
class PairingActivity : ComponentActivity() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var cameraExecutor: ExecutorService
    private val scanned = AtomicBoolean(false)

    private val requestPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) startCamera() else {
                // Surface the denial to the UI — handled by statusState below.
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cameraExecutor = Executors.newSingleThreadExecutor()

        setContent {
            var status by remember { mutableStateOf("Point camera at the bridge QR code") }
            var scanning by remember { mutableStateOf(true) }
            var showManual by remember { mutableStateOf(false) }
            var manualCode by remember { mutableStateOf("") }
            val isSuccess = status.startsWith("Paired")
            val isError = status.startsWith("Pairing failed") || status.startsWith("Couldn't")

            MaterialTheme {
                Box(Modifier.fillMaxSize()) {
                    if (scanning) {
                        AndroidView(
                            factory = { ctx ->
                                PreviewView(ctx).also { pv ->
                                    // Camera startup is deferred to permission callback.
                                    // We stash the PreviewView reference via a side-effect; see
                                    // startCamera() below which calls this after permission is granted.
                                    previewViewHolder = pv
                                    statusUpdater = { s ->
                                        status = s
                                        // Stop the camera on any terminal state (success OR failure) so the
                                        // result card — with buttons — replaces the live preview.
                                        if (s.startsWith("Paired") || s.startsWith("Pairing failed") || s.startsWith("Couldn't")) scanning = false
                                    }
                                    checkAndStartCamera()
                                }
                            },
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                    Column(
                        Modifier.align(if (scanning) Alignment.BottomCenter else Alignment.Center).padding(28.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        when {
                            isSuccess -> {
                                Icon(
                                    Icons.Rounded.CheckCircle,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(56.dp),
                                )
                                Spacer(Modifier.height(12.dp))
                                Text("Paired", style = MaterialTheme.typography.headlineSmall)
                                Spacer(Modifier.height(8.dp))
                                Text("Your phone is linked to the agent.", style = MaterialTheme.typography.bodyMedium)
                                Spacer(Modifier.height(20.dp))
                                Button(onClick = { openChat() }) { Text("Open chat") }
                            }
                            isError -> {
                                Text("Couldn't pair", style = MaterialTheme.typography.titleMedium)
                                Spacer(Modifier.height(8.dp))
                                Text(status, style = MaterialTheme.typography.bodyMedium)
                                Spacer(Modifier.height(20.dp))
                                Button(onClick = {
                                    scanned.set(false)
                                    status = "Point camera at the bridge QR code"
                                    scanning = true
                                }) { Text("Try again") }
                                Spacer(Modifier.height(4.dp))
                                TextButton(onClick = { openChat() }) { Text("Back to chat") }
                            }
                            status == "Pairing…" -> {
                                CircularProgressIndicator()
                                Spacer(Modifier.height(12.dp))
                                Text(status, style = MaterialTheme.typography.bodyLarge)
                            }
                            else -> {
                                Text(status, style = MaterialTheme.typography.bodyLarge)
                                Spacer(Modifier.height(16.dp))
                                // Manual fallback when the camera can't read the QR: type the code shown
                                // beside it in the hub web UI (format "host/CODE").
                                if (showManual) {
                                    OutlinedTextField(
                                        value = manualCode, onValueChange = { manualCode = it },
                                        singleLine = true, label = { Text("Pairing code (host/CODE)") },
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                    Spacer(Modifier.height(8.dp))
                                    Button(onClick = { if (manualCode.isNotBlank()) scope.launch { processManualCode(manualCode) } }) {
                                        Text("Pair with code")
                                    }
                                } else {
                                    TextButton(onClick = { showManual = true }) { Text("Enter code instead") }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Compose can't easily carry a stable lambda across recompositions for camera init,
    // so we use simple nullable fields on the Activity. Fine for a single-purpose screen.
    private var previewViewHolder: PreviewView? = null
    private var statusUpdater: ((String) -> Unit)? = null

    private fun checkAndStartCamera() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED
        ) {
            startCamera()
        } else {
            requestPermission.launch(Manifest.permission.CAMERA)
        }
    }

    private fun startCamera() {
        val pv = previewViewHolder ?: return
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            val provider = future.get()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(pv.surfaceProvider) }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also { ia -> ia.setAnalyzer(cameraExecutor, ::analyzeFrame) }
            val selector = CameraSelector.DEFAULT_BACK_CAMERA
            runCatching {
                provider.unbindAll()
                provider.bindToLifecycle(this, selector, preview, analysis)
            }.onFailure { statusUpdater?.invoke("Error: camera bind failed") }
        }, ContextCompat.getMainExecutor(this))
    }

    @androidx.camera.core.ExperimentalGetImage
    private fun analyzeFrame(proxy: ImageProxy) {
        val mediaImage = proxy.image
        if (mediaImage == null) { proxy.close(); return }
        if (scanned.get()) { proxy.close(); return }

        val image = InputImage.fromMediaImage(mediaImage, proxy.imageInfo.rotationDegrees)
        val options = BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .build()
        val scanner = BarcodeScanning.getClient(options)

        scanner.process(image)
            .addOnSuccessListener { barcodes ->
                val raw = barcodes.firstOrNull()?.rawValue
                if (raw != null && scanned.compareAndSet(false, true)) {
                    statusUpdater?.invoke("Pairing…")
                    scope.launch { processPairing(raw) }
                }
            }
            .addOnCompleteListener { proxy.close() }
    }

    /**
     * Decode the QR value and complete the TOFU exchange:
     *   - Parse the bridge token (edPub, fp, relayUrl, token?).
     *   - Load/generate our own Identity.
     *   - Connect to the relay as ourselves (one-shot connection, no persistent service yet).
     *   - Fire a "pairing.response" event so the bridge operator can update peerEdPub.
     *   - Persist PairingData and restart PhoneAgentService.
     */
    private suspend fun processPairing(raw: String) {
        val update = statusUpdater ?: {}
        runCatching {
            val token  = decodePairingToken(raw)
            val selfId = Pairing.selfIdentity(this)

            // One-shot relay connection to announce the phone's public key to the bridge.
            // We use the bridge's edPub as the peer so we can send an encrypted event.
            val bus = BusEndpoint(selfId, token.edPub, token.relayUrl)
            bus.connect()

            val eventData = kotlinx.serialization.json.buildJsonObject {
                put("edPub", selfId.edPub)
                put("fp",    selfId.fp)
                // Echo the one-time token so the bridge can validate it (forward-compat).
                if (token.token != null) put("token", token.token)
            }
            bus.event("pairing.response", eventData)
            bus.close()

            // Append this agent as a profile (or update it) and make it active. Supports pairing
            // several agents and switching between them; the phone keeps one identity (selfId).
            com.agenticandroid.Agents.init(this) // ensure existing profiles are loaded before appending
            // Name the hub by its announced name (default = its machine hostname); fall back to the fingerprint.
            com.agenticandroid.Agents.add(this, token.hubName?.takeIf { it.isNotBlank() } ?: token.fp.take(8), token.edPub, token.relayUrl)
            update("Paired with ${token.hubName ?: token.fp.take(12)}…")

            // Reconnect the running service to the newly-active agent (or start it if not running).
            val svc = PhoneAgentService.instance
            if (svc != null) svc.reconnect()
            else startForegroundService(Intent(this, PhoneAgentService::class.java))

        }.onFailure { e ->
            scanned.set(false) // allow retry on parse/network failure
            val reach = e.message?.contains("connect", ignoreCase = true) == true || e.message?.contains("reach", ignoreCase = true) == true
            update(
                if (reach)
                    "Couldn't reach the hub. Check it's running on your computer and your phone is on the same Wi-Fi (or USB). Then scan again."
                else
                    "Pairing failed: ${e.message}. Scan again to retry.",
            )
        }
    }

    /**
     * Manual-code pairing: the user typed the "host/CODE" shown beside the QR in the hub web UI.
     * Fetch the (same) pairing payload the relay is holding under that code, then run the normal
     * [processPairing] path. Only needed when the camera can't read the QR.
     */
    private suspend fun processManualCode(raw: String) {
        val update = statusUpdater ?: {}
        if (!scanned.compareAndSet(false, true)) return
        update("Pairing…")
        runCatching {
            val s = raw.trim()
            val idx = s.lastIndexOf('/')
            require(idx in 1 until s.length - 1) { "Code should look like host/CODE" }
            val host = s.substring(0, idx).let { if (it.startsWith("http")) it else "http://$it" }
            val code = s.substring(idx + 1).trim()
            val req = okhttp3.Request.Builder().url("$host/pair-code/$code").get().build()
            okhttp3.OkHttpClient().newCall(req).execute().use {
                if (!it.isSuccessful) error("Code not found (${it.code}). Check it and that the hub is running.")
                it.body!!.string()
            }
        }.onSuccess { payload ->
            processPairing(payload) // keep the scan guard held so a stray camera frame can't double-fire
        }.onFailure { e ->
            scanned.set(false)
            update("Pairing failed: ${e.message}. Try again.")
        }
    }

    /** Leave the pairing screen and land on the chat (don't strand the user on a static page). */
    private fun openChat() {
        startActivity(
            Intent(this, com.agenticandroid.MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
    }
}
