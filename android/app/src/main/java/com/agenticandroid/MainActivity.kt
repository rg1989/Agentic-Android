package com.agenticandroid

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
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

/**
 * Minimal Compose UI (Q4 swap point). Status + pair + mic mute + (later) per-capability consent toggles.
 * Intentionally thin: the UI is a swappable consumer of the same bus. UNVERIFIED here.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startForegroundService(Intent(this, PhoneAgentService::class.java))
        setContent {
            MaterialTheme {
                var muted by remember { mutableStateOf(false) }
                Column(androidx.compose.ui.Modifier.padding(24.dp)) {
                    Text("Agentic Android", style = MaterialTheme.typography.headlineSmall)
                    Text("Status: connected (stub)")
                    Button(onClick = { /* TODO: launch QR pairing (Q5) */ }) { Text("Pair agent") }
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
