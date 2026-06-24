package com.agenticandroid

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.dp
import com.agenticandroid.pairing.Pairing
import com.agenticandroid.pairing.PairingActivity

/**
 * Minimal Compose UI (Q4 swap point). Status + pair + mic mute + (later) per-capability consent toggles.
 * Intentionally thin: the UI is a swappable consumer of the same bus.
 */
class MainActivity : ComponentActivity() {
    private val requestPerms =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { /* best-effort */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Ask up front for the notification (foreground-service visibility on Android 13+) and
        // location permissions so the first capability round-trip can succeed. JIT per-capability
        // prompting is the longer-term plan (DESIGN Q-permissions); this is enough to test.
        val perms = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) perms += Manifest.permission.POST_NOTIFICATIONS
        requestPerms.launch(perms.toTypedArray())

        startForegroundService(Intent(this, PhoneAgentService::class.java))

        // Generate-or-load the phone's own identity so we can show its edPub: the operator pastes
        // this into the bridge's agent.json as `peerEdPub` to finish pairing (DESIGN Q5).
        val self = Pairing.selfIdentity(this)
        val paired = Pairing.load(this) != null

        setContent {
            MaterialTheme {
                var muted by remember { mutableStateOf(false) }
                Column(androidx.compose.ui.Modifier.padding(24.dp)) {
                    Text("Agentic Android", style = MaterialTheme.typography.headlineSmall)
                    Spacer(androidx.compose.ui.Modifier.height(8.dp))
                    Text(if (paired) "Status: paired ✓" else "Status: not paired — tap Pair agent")
                    Spacer(androidx.compose.ui.Modifier.height(12.dp))
                    Text("This phone's fingerprint:", style = MaterialTheme.typography.labelMedium)
                    Text(self.fp.take(16) + "…")
                    Spacer(androidx.compose.ui.Modifier.height(8.dp))
                    Text("This phone's edPub (paste into bridge agent.json as peerEdPub):",
                        style = MaterialTheme.typography.labelMedium)
                    Text(self.edPub, style = MaterialTheme.typography.bodySmall)
                    Spacer(androidx.compose.ui.Modifier.height(16.dp))
                    Button(onClick = {
                        startActivity(Intent(this@MainActivity, PairingActivity::class.java))
                    }) { Text("Pair agent") }
                    Spacer(androidx.compose.ui.Modifier.height(16.dp))
                    Column {
                        Text("Mute microphone (wake word)")
                        Switch(checked = muted, onCheckedChange = { muted = it /* TODO: bind to service.micMuted */ })
                    }
                    // TODO: list capabilities with per-agent allow/ask/deny toggles (Q8).
                }
            }
        }
    }
}
