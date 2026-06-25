package com.agenticandroid

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import com.agenticandroid.pairing.PairingActivity

/**
 * Chat with your agent. You talk to the agent (a self-hosted/cloud brain); it sees and operates this
 * phone on your behalf. Text or hold-to-talk voice input; the gear opens Settings (theme + actions).
 */
class MainActivity : ComponentActivity() {
    private val requestPerms =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        SettingsStore.init(this)
        Agents.init(this)
        val perms = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) perms += Manifest.permission.POST_NOTIFICATIONS
        requestPerms.launch(perms.toTypedArray())
        startForegroundService(Intent(this, PhoneAgentService::class.java))

        setContent {
            AgentTheme {
                val messages by PhoneAgentService.chat.collectAsState()
                val connected by PhoneAgentService.connected.collectAsState()
                val agentName by PhoneAgentService.agentName.collectAsState()
                val status by PhoneAgentService.status.collectAsState()
                val profiles by Agents.profiles.collectAsState()
                val activeId by Agents.activeId.collectAsState()
                val paired = profiles.isNotEmpty()
                var input by remember { mutableStateOf("") }
                val listState = rememberLazyListState()
                val context = LocalContext.current
                val clipboard = LocalClipboardManager.current
                LaunchedEffect(messages.size, status) {
                    val target = if (status != null) messages.size else messages.size - 1
                    if (target >= 0) listState.animateScrollToItem(target)
                }
                val active = profiles.firstOrNull { it.id == activeId }
                val who = agentName ?: active?.name ?: if (paired) "your agent" else "no agent"

                // hold-to-talk voice → transcript fills the field live, sends on release; chimes per state
                val chimes = remember { Chimes() }
                DisposableEffect(Unit) { onDispose { chimes.release() } }
                var recording by remember { mutableStateOf(false) }
                val voice = remember {
                    VoiceInput(
                        context,
                        onPartial = { input = it },
                        onFinal = { t ->
                            recording = false
                            val s = t.trim()
                            if (s.isNotEmpty()) {
                                chimes.sent(); PhoneAgentService.instance?.sendUserMessage(s); input = ""
                            } else {
                                chimes.error(); PhoneAgentService.instance?.setStatus(null)
                            }
                        },
                        onError = { recording = false; chimes.error(); PhoneAgentService.instance?.setStatus(null) },
                    )
                }
                DisposableEffect(Unit) { onDispose { voice.destroy() } }
                val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

                Box(Modifier.fillMaxSize()) {
                Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
                    // thin header: who you're connected to
                    Row(
                        Modifier.fillMaxWidth().padding(start = 14.dp, end = 4.dp, top = 7.dp, bottom = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(if (!paired) "⚪" else if (connected) "🟢" else "🟡", style = MaterialTheme.typography.labelSmall)
                        Spacer(Modifier.width(7.dp))
                        Box(Modifier.weight(1f)) {
                            var menuOpen by remember { mutableStateOf(false) }
                            Row(
                                Modifier.clickable(enabled = paired) { menuOpen = true },
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(who, style = MaterialTheme.typography.titleSmall, maxLines = 1)
                                if (paired) Text(" ▾", style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                            }
                            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                                profiles.forEach { p ->
                                    DropdownMenuItem(
                                        text = { Text((if (p.id == activeId) "● " else "○ ") + p.name) },
                                        onClick = { menuOpen = false; PhoneAgentService.instance?.switchAgent(p.id) },
                                    )
                                }
                                if (paired) HorizontalDivider()
                                DropdownMenuItem(
                                    text = { Text("Pair another agent…") },
                                    onClick = { menuOpen = false; startActivity(Intent(this@MainActivity, PairingActivity::class.java)) },
                                )
                            }
                        }
                        if (!paired) {
                            TextButton(onClick = { startActivity(Intent(this@MainActivity, PairingActivity::class.java)) }) { Text("Pair") }
                        } else {
                            if (connected) {
                                Text("connected", style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                            } else {
                                Text(
                                    "connecting… ⟳",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.clickable { PhoneAgentService.instance?.reconnect() }.padding(4.dp),
                                )
                            }
                            IconButton(onClick = { startActivity(Intent(this@MainActivity, SettingsActivity::class.java)) }) {
                                Text("⚙", style = MaterialTheme.typography.titleMedium)
                            }
                        }
                    }
                    HorizontalDivider(thickness = 0.5.dp)

                    // guided "can't reach hub" banner — only after staying disconnected a few seconds
                    // (so it doesn't flash during the normal 1–2s reconnect on launch)
                    var showHelp by remember { mutableStateOf(false) }
                    LaunchedEffect(connected) {
                        if (connected) showHelp = false
                        else { kotlinx.coroutines.delay(4000); if (!PhoneAgentService.connected.value) showHelp = true }
                    }
                    if (paired && !connected && showHelp) {
                        Surface(color = MaterialTheme.colorScheme.errorContainer, modifier = Modifier.fillMaxWidth()) {
                            Row(
                                Modifier.padding(start = 14.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    "Can't reach your hub. Check it's running on your computer, and your phone is on the same Wi-Fi (or USB).",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onErrorContainer,
                                    modifier = Modifier.weight(1f),
                                )
                                TextButton(onClick = { PhoneAgentService.instance?.reconnect() }) { Text("Retry") }
                            }
                        }
                    }

                    // transcript
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp),
                    ) {
                        if (messages.isEmpty()) {
                            item {
                                Text(
                                    "This is $who — it can see and control this phone for you.\n\nTry:\n• \"take a photo\"\n• \"what's my battery?\"\n• \"turn on the flashlight\"\n• \"ring my phone\"\n• \"where am I?\"\n\nOr hold 🎤 and speak.",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(16.dp),
                                )
                            }
                        }
                        items(messages) { m ->
                            val isUser = m.role == "user"
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
                            ) {
                                Surface(
                                    modifier = Modifier.widthIn(max = 300.dp),
                                    color = if (isUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                                    shape = RoundedCornerShape(16.dp),
                                ) {
                                    if (m.imagePath != null) {
                                        val bmp = remember(m.imagePath) {
                                            val o = BitmapFactory.Options().apply { inSampleSize = 4 }
                                            BitmapFactory.decodeFile(m.imagePath, o)?.asImageBitmap()
                                        }
                                        if (bmp != null) {
                                            Image(
                                                bitmap = bmp,
                                                contentDescription = "Photo the agent took",
                                                contentScale = ContentScale.Crop,
                                                modifier = Modifier.width(240.dp).aspectRatio(bmp.width.toFloat() / bmp.height),
                                            )
                                        } else {
                                            Text("📷 photo unavailable", modifier = Modifier.padding(12.dp))
                                        }
                                    } else {
                                        Text(
                                            m.text,
                                            modifier = Modifier
                                                .pointerInput(m.text) {
                                                    detectTapGestures(onLongPress = {
                                                        clipboard.setText(AnnotatedString(m.text))
                                                        android.widget.Toast.makeText(context, "Copied", android.widget.Toast.LENGTH_SHORT).show()
                                                    })
                                                }
                                                .padding(horizontal = 12.dp, vertical = 8.dp),
                                            color = if (isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            }
                        }
                        // live status: Transcribing… / Sending… / Thinking… / running an action
                        status?.let { label ->
                            val speaking = label.startsWith("🔊")
                            item {
                                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.Start) {
                                    Surface(
                                        modifier = if (speaking) Modifier.clickable { PhoneAgentService.instance?.stopSpeaking() } else Modifier,
                                        color = MaterialTheme.colorScheme.surfaceVariant,
                                        shape = RoundedCornerShape(16.dp),
                                    ) {
                                        Text(
                                            if (speaking) "$label · tap to stop" else label,
                                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            fontStyle = FontStyle.Italic,
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // input bar: text field + hold-to-talk mic + send
                    Row(
                        Modifier.fillMaxWidth().padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedTextField(
                            value = input,
                            onValueChange = { input = it },
                            modifier = Modifier.weight(1f),
                            placeholder = { Text(if (recording) "Listening…" else if (paired) "Message $who…" else "Pair an agent first") },
                            maxLines = 4,
                        )
                        if (voice.available && paired) {
                            Spacer(Modifier.width(8.dp))
                            Box(
                                Modifier.size(48.dp).clip(CircleShape)
                                    .background(if (recording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                                    .pointerInput(Unit) {
                                        detectTapGestures(onPress = {
                                            val granted = ContextCompat.checkSelfPermission(
                                                context, Manifest.permission.RECORD_AUDIO,
                                            ) == PackageManager.PERMISSION_GRANTED
                                            if (granted) {
                                                WakeWordService.instance?.pause() // free the mic for hold-to-talk
                                                chimes.listening()
                                                recording = true
                                                voice.start()
                                                tryAwaitRelease()
                                                voice.stop() // onFinal/onError clears `recording`
                                                PhoneAgentService.instance?.setStatus("Transcribing…")
                                                WakeWordService.instance?.resume()
                                            } else {
                                                micPermission.launch(Manifest.permission.RECORD_AUDIO)
                                            }
                                        })
                                    },
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(
                                    painter = painterResource(R.drawable.ic_mic),
                                    contentDescription = "Hold to talk",
                                    tint = if (recording) MaterialTheme.colorScheme.onError else MaterialTheme.colorScheme.onPrimary,
                                    modifier = Modifier.size(24.dp),
                                )
                            }
                        }
                        Spacer(Modifier.width(8.dp))
                        Button(onClick = {
                            val t = input.trim()
                            if (t.isNotEmpty()) {
                                PhoneAgentService.instance?.sendUserMessage(t)
                                input = ""
                            }
                        }) { Text("Send") }
                    }
                }
                // Listening glow around the screen edges while recording or wake-listening.
                ListeningGlow(
                    active = recording || (status?.startsWith("🎙️") == true),
                    color = MaterialTheme.colorScheme.primary,
                )
                }
            }
        }
    }
}

/** A soft animated glow hugging the screen edges, shown while the app is listening. */
@Composable
private fun ListeningGlow(active: Boolean, color: Color) {
    val fade by animateFloatAsState(if (active) 1f else 0f, tween(350), label = "glowFade")
    if (fade == 0f) return
    val t = rememberInfiniteTransition(label = "glow")
    val pulse by t.animateFloat(
        0.5f, 1f,
        infiniteRepeatable(tween(950, easing = LinearEasing), RepeatMode.Reverse),
        label = "pulse",
    )
    Canvas(Modifier.fillMaxSize()) {
        val layers = 6
        val maxW = 26.dp.toPx()
        for (i in 0 until layers) {
            val frac = i / (layers - 1f)              // 0 at the very edge → 1 inward
            val strokeW = 3.dp.toPx() + frac * maxW
            val a = fade * pulse * (1f - frac) * 0.5f
            drawRect(
                color = color.copy(alpha = a),
                topLeft = Offset(strokeW / 2f, strokeW / 2f),
                size = Size(size.width - strokeW, size.height - strokeW),
                style = Stroke(width = strokeW),
            )
        }
    }
}
