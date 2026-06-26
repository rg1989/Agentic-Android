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
import androidx.compose.foundation.layout.offset
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
import androidx.compose.runtime.produceState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.core.content.ContextCompat
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.KeyboardArrowUp
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.LockOpen
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.PersonAddAlt
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.style.TextOverflow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
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
                val commands by PhoneAgentService.commands.collectAsState()
                val connectionEnabled by SettingsStore.connectionEnabled.collectAsState()
                val profiles by Agents.profiles.collectAsState()
                val activeId by Agents.activeId.collectAsState()
                val paired = profiles.isNotEmpty()
                var input by remember { mutableStateOf("") }
                val listState = rememberLazyListState()
                val context = LocalContext.current
                val clipboard = LocalClipboardManager.current
                val scope = rememberCoroutineScope()
                LaunchedEffect(messages.size) {
                    if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
                }
                val active = profiles.firstOrNull { it.id == activeId }
                val who = agentName ?: active?.name ?: if (paired) "your agent" else "no agent"

                // hold-to-talk voice → transcript fills the field live, sends on release; chimes per state
                val chimes = remember { Chimes() }
                val haptics = remember { Haptics(context) }
                val timeFmt = remember { android.text.format.DateFormat.getTimeFormat(context) }
                DisposableEffect(Unit) { onDispose { chimes.release() } }
                // Feel the agent change state without looking: a tick when it starts working, a firmer
                // confirm when a reply lands. Phone-local states (Transcribing/Sending) and the spoken
                // reply are skipped — those already had their own cue.
                var lastMsgCount by remember { mutableStateOf(0) }
                LaunchedEffect(messages.size) {
                    if (messages.size == lastMsgCount + 1 && messages.lastOrNull()?.role == "assistant") haptics.confirm()
                    lastMsgCount = messages.size
                }
                LaunchedEffect(status) {
                    val st = status ?: return@LaunchedEffect
                    if (st != "Transcribing…" && st != "Sending…" && !st.startsWith("🔊")) haptics.tick()
                }
                var recording by remember { mutableStateOf(false) }   // capturing voice (held or locked)
                var locked by remember { mutableStateOf(false) }      // hands-free: keeps recording after release
                var dragY by remember { mutableStateOf(0f) }          // upward drag toward the lock threshold
                var aboutToCancel by remember { mutableStateOf(false) } // dragged left past the cancel threshold
                var pressed by remember { mutableStateOf(false) }     // button held down (drives press-scale)
                val voice = remember {
                    VoiceInput(
                        context,
                        onPartial = { input = it },
                        onFinal = { t ->
                            recording = false; locked = false
                            PhoneAgentService.instance?.setRecording(false)
                            val s = t.trim()
                            if (s.isNotEmpty()) {
                                chimes.sent(); PhoneAgentService.instance?.sendUserMessage(s); input = ""
                            } else {
                                chimes.error(); PhoneAgentService.instance?.setStatus(null)
                            }
                        },
                        onError = { recording = false; locked = false; PhoneAgentService.instance?.setRecording(false); chimes.error(); PhoneAgentService.instance?.setStatus(null) },
                    )
                }
                DisposableEffect(Unit) { onDispose { voice.destroy() } }
                val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

                // Save a file the agent sent: tap the attachment → system "create document" picker → write the blob.
                var pendingSave by remember { mutableStateOf<MsgPart.FileRef?>(null) }
                val saveLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri ->
                    val f = pendingSave; pendingSave = null
                    if (uri != null && f != null) scope.launch(Dispatchers.IO) {
                        runCatching {
                            val bytes = PhoneAgentService.instance?.fetchBlob(f.blobId) ?: return@launch
                            context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                            android.util.Log.i("AgentFile", "saved ${f.name} (${bytes.size} bytes)")
                        }
                    }
                }
                val onSaveFile: (MsgPart.FileRef) -> Unit = { f -> pendingSave = f; saveLauncher.launch(f.name) }

                // --- combined hold-to-talk / tap-to-send button: gesture helpers ---
                fun sendText() {
                    val t = input.trim()
                    if (t.isNotEmpty()) { PhoneAgentService.instance?.sendUserMessage(t); input = "" }
                }
                fun beginRecording(): Boolean {
                    if (recording) return false
                    val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                    if (!granted) { micPermission.launch(Manifest.permission.RECORD_AUDIO); return false }
                    WakeWordService.instance?.pause() // free the mic for hold-to-talk
                    PhoneAgentService.instance?.setRecording(true) // stop any reply; don't start one
                    chimes.listening(); haptics.start()
                    recording = true; locked = false; aboutToCancel = false; dragY = 0f; input = ""
                    voice.start()
                    return true
                }
                fun finishRecording() {
                    if (!recording) return
                    recording = false; locked = false
                    PhoneAgentService.instance?.setRecording(false)
                    haptics.confirm()
                    PhoneAgentService.instance?.setStatus("Transcribing…")
                    voice.finish() // onFinal sends the full accumulated transcript
                    WakeWordService.instance?.resume()
                }
                fun cancelRecording() {
                    recording = false; locked = false; input = ""
                    PhoneAgentService.instance?.setRecording(false)
                    voice.cancel(); chimes.error(); haptics.cancel()
                    PhoneAgentService.instance?.setStatus(null)
                    WakeWordService.instance?.resume()
                }

                Box(Modifier.fillMaxSize()) {
                Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
                    // thin header: who you're connected to
                    Row(
                        Modifier.fillMaxWidth().padding(start = 14.dp, end = 4.dp, top = 7.dp, bottom = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        val dotColor = if (!paired) Color(0xFF9AA0A6) else if (connected) Color(0xFF34C759) else Color(0xFFFFB020)
                        Box(Modifier.size(9.dp).clip(CircleShape).background(dotColor))
                        Spacer(Modifier.width(8.dp))
                        Box(Modifier.weight(1f)) {
                            var menuOpen by remember { mutableStateOf(false) }
                            Row(
                                Modifier.clickable(enabled = paired) { menuOpen = true },
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(who, style = MaterialTheme.typography.titleSmall, maxLines = 1)
                                if (paired) Icon(Icons.Rounded.ArrowDropDown, contentDescription = "Switch agent", tint = Color.Gray)
                            }
                            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                                profiles.forEach { p ->
                                    DropdownMenuItem(
                                        text = { Text(p.name) },
                                        leadingIcon = {
                                            if (p.id == activeId) Icon(Icons.Rounded.Check, contentDescription = "Active", tint = MaterialTheme.colorScheme.primary)
                                        },
                                        onClick = { menuOpen = false; PhoneAgentService.instance?.switchAgent(p.id) },
                                    )
                                }
                                if (paired) HorizontalDivider()
                                DropdownMenuItem(
                                    text = { Text("Pair another agent…") },
                                    leadingIcon = { Icon(Icons.Rounded.PersonAddAlt, contentDescription = null) },
                                    onClick = { menuOpen = false; startActivity(Intent(this@MainActivity, PairingActivity::class.java)) },
                                )
                            }
                        }
                        if (!paired) {
                            TextButton(onClick = { startActivity(Intent(this@MainActivity, PairingActivity::class.java)) }) { Text("Pair") }
                        } else {
                            if (connected) {
                                Text("connected", style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                            } else if (!connectionEnabled) {
                                Row(
                                    Modifier.clickable { PhoneAgentService.instance?.setConnectionEnabled(true) }.padding(4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(Icons.Rounded.CloudOff, contentDescription = "Reconnect",
                                        tint = Color.Gray, modifier = Modifier.size(15.dp))
                                    Spacer(Modifier.width(3.dp))
                                    Text("offline", style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                                }
                            } else {
                                Row(
                                    Modifier.clickable { PhoneAgentService.instance?.reconnect() }.padding(4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(Icons.Rounded.Refresh, contentDescription = "Reconnect",
                                        tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(15.dp))
                                    Spacer(Modifier.width(3.dp))
                                    Text("connecting…", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                                }
                            }
                            IconButton(onClick = { startActivity(Intent(this@MainActivity, SettingsActivity::class.java)) }) {
                                Icon(Icons.Rounded.Settings, contentDescription = "Settings")
                            }
                        }
                    }
                    HorizontalDivider(thickness = 0.5.dp)

                    // guided "can't reach hub" banner — only after staying disconnected a few seconds
                    // (so it doesn't flash during the normal 1–2s reconnect on launch)
                    var showHelp by remember { mutableStateOf(false) }
                    LaunchedEffect(connected, connectionEnabled) {
                        if (connected || !connectionEnabled) showHelp = false
                        else { kotlinx.coroutines.delay(4000); if (!PhoneAgentService.connected.value && SettingsStore.connectionEnabled.value) showHelp = true }
                    }
                    if (paired && !connected && showHelp && connectionEnabled) {
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

                    // transcript (Box wraps it so a "scroll to latest" button can float at the bottom-center)
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
                    ) {
                        if (messages.isEmpty()) {
                            item {
                                Text(
                                    "This is $who — it can see and control this phone for you.\n\nTry:\n• \"take a photo\"\n• \"what's my battery?\"\n• \"turn on the flashlight\"\n• \"ring my phone\"\n• \"where am I?\"\n\nOr hold the mic and speak.",
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
                                Column(horizontalAlignment = if (isUser) Alignment.End else Alignment.Start) {
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
                                    } else if (m.parts.isNotEmpty()) {
                                        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                                            m.parts.forEach { PartView(it, isUser, onSaveFile) }
                                        }
                                    } else {
                                        val textColor = if (isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
                                        val mod = Modifier
                                            .pointerInput(m.text) {
                                                detectTapGestures(onLongPress = {
                                                    clipboard.setText(AnnotatedString(m.text))
                                                    android.widget.Toast.makeText(context, "Copied", android.widget.Toast.LENGTH_SHORT).show()
                                                })
                                            }
                                            .padding(horizontal = 12.dp, vertical = 8.dp)
                                        // The user's own text stays literal; the agent replies in markdown.
                                        if (isUser) Text(m.text, modifier = mod, color = textColor)
                                        else MarkdownText(m.text, textColor, mod)
                                    }
                                }
                                Text(
                                    remember(m.ts) { timeFmt.format(java.util.Date(m.ts)) },
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.55f),
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
                                )
                                }
                            }
                        }
                    }
                    // floating "scroll to latest" button, centered at the bottom of the transcript;
                    // pops in only when scrolled up (canScrollForward = there's content below).
                    val showScrollDown = listState.canScrollForward
                    val sdAlpha by animateFloatAsState(if (showScrollDown) 1f else 0f, tween(150), label = "scrollDown")
                    if (sdAlpha > 0.01f) {
                        Surface(
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            tonalElevation = 3.dp,
                            shadowElevation = 6.dp,
                            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 6.dp)
                                .size(40.dp)
                                .graphicsLayer { alpha = sdAlpha; scaleX = 0.7f + 0.3f * sdAlpha; scaleY = 0.7f + 0.3f * sdAlpha }
                                .clickable(enabled = showScrollDown) {
                                    scope.launch { listState.animateScrollToItem(messages.lastIndex.coerceAtLeast(0)) }
                                },
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(Icons.Rounded.KeyboardArrowDown, contentDescription = "Scroll to latest", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    } // end transcript Box

                    // `/` command palette: type "/" to browse the agent's skills & commands, like the TUI.
                    val slashActive = !recording && input.startsWith("/") && !input.contains(' ')
                    val slashMatches = if (slashActive) {
                        val q = input.drop(1)
                        commands.filter { it.invoke.contains(q, ignoreCase = true) || it.description.contains(q, ignoreCase = true) }.take(60)
                    } else emptyList()
                    AnimatedVisibility(
                        visible = slashMatches.isNotEmpty(),
                        enter = fadeIn(tween(140)) + expandVertically(tween(180)),
                        exit = fadeOut(tween(120)) + shrinkVertically(tween(160)),
                    ) {
                        SlashPalette(slashMatches) { c -> input = "/" + c.invoke + " " }
                    }

                    // animated "typing / transcribing / speaking" strip, pinned above the input bar
                    StatusStrip(status) { PhoneAgentService.instance?.stopSpeaking() }

                    // input bar: morphs between a text field and a live recording bar; ONE combined
                    // button — tap to send, hold to talk, slide up to lock hands-free, slide left to cancel.
                    Row(
                        Modifier.fillMaxWidth().padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.weight(1f)) {
                            if (recording) {
                                RecordingBar(
                                    locked = locked,
                                    aboutToCancel = aboutToCancel,
                                    live = input,
                                    onCancel = { cancelRecording() },
                                )
                            } else {
                                OutlinedTextField(
                                    value = input,
                                    onValueChange = { input = it },
                                    modifier = Modifier.fillMaxWidth(),
                                    placeholder = { Text(if (paired) "Message $who…" else "Pair an agent first") },
                                    maxLines = 4,
                                )
                            }
                        }
                        if (paired) {
                            Spacer(Modifier.width(8.dp))
                            val canSend = input.isNotBlank() && !recording
                            val showSend = canSend || locked || !voice.available
                            val scale by animateFloatAsState(
                                if (pressed || recording) 1.12f else 1f,
                                spring(dampingRatio = Spring.DampingRatioMediumBouncy), label = "btnScale",
                            )
                            Box(
                                Modifier.size(52.dp).scale(scale).clip(CircleShape)
                                    .background(if (recording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                                    // Stable key: we mutate recording/locked DURING the gesture, so keying on
                                    // them would restart the handler mid-gesture and kill the drag loop.
                                    .pointerInput(Unit) {
                                        val lockPx = 72.dp.toPx()
                                        val cancelPx = 110.dp.toPx()
                                        awaitEachGesture {
                                            val down = awaitFirstDown(requireUnconsumed = false)
                                            pressed = true
                                            val startX = down.position.x
                                            val startY = down.position.y
                                            // Locked (hands-free): a tap finishes and sends.
                                            if (locked) {
                                                val up = waitForUpOrCancellation()
                                                pressed = false
                                                if (up != null) finishRecording()
                                                return@awaitEachGesture
                                            }
                                            // Quick tap (released within the hold window) → send text if any.
                                            val quick = withTimeoutOrNull(180L) { waitForUpOrCancellation() }
                                            if (quick != null) {
                                                pressed = false
                                                if (input.isNotBlank()) sendText()
                                                return@awaitEachGesture
                                            }
                                            // Held past the window → start recording (on-device, no key).
                                            if (!voice.available || !beginRecording()) { pressed = false; return@awaitEachGesture }
                                            while (true) {
                                                val ev = awaitPointerEvent()
                                                val ch = ev.changes.firstOrNull { it.id == down.id } ?: ev.changes.firstOrNull() ?: break
                                                if (!locked) {
                                                    dragY = ch.position.y - startY
                                                    val nowCancel = (ch.position.x - startX) <= -cancelPx
                                                    if (nowCancel && !aboutToCancel) haptics.tick() // feel the cancel threshold
                                                    aboutToCancel = nowCancel
                                                    if (dragY <= -lockPx) { locked = true; chimes.listening(); haptics.lock() }
                                                }
                                                if (!ch.pressed) {
                                                    pressed = false
                                                    when {
                                                        locked -> { /* keep recording hands-free */ }
                                                        aboutToCancel -> cancelRecording()
                                                        else -> finishRecording()
                                                    }
                                                    break
                                                }
                                            }
                                        }
                                    },
                                contentAlignment = Alignment.Center,
                            ) {
                                Crossfade(targetState = showSend, label = "micSend") { send ->
                                    Icon(
                                        imageVector = if (send) Icons.AutoMirrored.Rounded.Send else Icons.Rounded.Mic,
                                        contentDescription = if (send) "Send" else "Hold to talk",
                                        tint = if (recording) MaterialTheme.colorScheme.onError else MaterialTheme.colorScheme.onPrimary,
                                        modifier = Modifier.size(24.dp),
                                    )
                                }
                            }
                        }
                    }
                }
                // Listening glow around the screen edges while recording or wake-listening.
                ListeningGlow(
                    active = recording || (status?.startsWith("🎙️") == true),
                    color = MaterialTheme.colorScheme.primary,
                )
                // Floating "slide up to lock" cue, hovering just above the record button while held.
                AnimatedVisibility(
                    visible = recording && !locked,
                    enter = fadeIn(tween(150)) + slideInVertically(tween(200)) { it / 2 },
                    exit = fadeOut(tween(120)),
                    modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding().imePadding()
                        .padding(end = 18.dp, bottom = 84.dp),
                ) {
                    val lockProgress = (-dragY / with(LocalDensity.current) { 72.dp.toPx() }).coerceIn(0f, 1f)
                    LockHintOverlay(lockProgress)
                }
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

/** The `/` command menu: scrollable list of the agent's skills & commands, filtered as you type. */
@Composable
private fun SlashPalette(matches: List<SlashCommand>, onPick: (SlashCommand) -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(14.dp),
        tonalElevation = 3.dp,
        shadowElevation = 8.dp,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp).heightIn(max = 300.dp),
    ) {
        LazyColumn {
            items(matches) { c ->
                Row(
                    Modifier.fillMaxWidth().clickable { onPick(c) }.padding(horizontal = 14.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        if (c.kind == "skill") Icons.Rounded.AutoAwesome else Icons.Rounded.Bolt,
                        contentDescription = c.kind,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp),
                    )
                    Spacer(Modifier.width(11.dp))
                    Column(Modifier.weight(1f)) {
                        Text("/${c.invoke}", style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (c.description.isNotBlank()) {
                            Text(
                                c.description,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Renders one typed part of a rich reply (Phase 6). Text parts show as text (markdown styling lands
 * in a later item); image / file / table show a compact stand-in until their own renderers arrive.
 */
@Composable
private fun PartView(part: MsgPart, isUser: Boolean, onSaveFile: (MsgPart.FileRef) -> Unit = {}) {
    val fg = if (isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
    when (part) {
        is MsgPart.Text -> if (part.markdown) MarkdownText(part.text, fg) else Text(part.text, color = fg, style = MaterialTheme.typography.bodyMedium)
        is MsgPart.Table -> TableView(part, fg)
        is MsgPart.ImageRef -> AgentImage(part, fg)
        is MsgPart.FileRef -> FilePart(part, fg, onSaveFile)
    }
}

/** A file the agent sent (file-ref part): name + size + type icon, tap to save it via the system picker. */
@Composable
private fun FilePart(part: MsgPart.FileRef, fg: Color, onSave: (MsgPart.FileRef) -> Unit) {
    Surface(
        color = fg.copy(alpha = 0.10f),
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.padding(vertical = 2.dp).clickable { onSave(part) },
    ) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(fileIcon(part.mime), style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.width(8.dp))
            Column {
                Text(part.name, color = fg, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    (part.size?.let { humanSize(it) + " · " } ?: "") + "tap to save",
                    color = fg.copy(alpha = 0.7f), style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

/** A structured table part rendered as a simple grid: bold header row, divider, then data rows. */
@Composable
private fun TableView(part: MsgPart.Table, fg: Color) {
    val ncols = maxOf(part.columns.size, part.rows.maxOfOrNull { it.size } ?: 0)
    if (ncols == 0) return
    Column(Modifier.padding(vertical = 2.dp)) {
        if (part.columns.isNotEmpty()) {
            Row(Modifier.fillMaxWidth()) {
                for (i in 0 until ncols) {
                    Text(
                        part.columns.getOrElse(i) { "" },
                        Modifier.weight(1f).padding(horizontal = 6.dp, vertical = 4.dp),
                        color = fg, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold,
                    )
                }
            }
            HorizontalDivider(color = fg.copy(alpha = 0.3f))
        }
        part.rows.forEach { row ->
            Row(Modifier.fillMaxWidth()) {
                for (i in 0 until ncols) {
                    Text(
                        row.getOrElse(i) { "" },
                        Modifier.weight(1f).padding(horizontal = 6.dp, vertical = 4.dp),
                        color = fg, style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

private fun fileIcon(mime: String?): String = when {
    mime == null -> "📎"
    mime.startsWith("image/") -> "🖼️"
    mime.startsWith("audio/") -> "🎵"
    mime.startsWith("video/") -> "🎬"
    mime == "application/pdf" -> "📕"
    mime.startsWith("text/") -> "📄"
    mime.contains("zip") || mime.contains("compress") -> "🗜️"
    else -> "📎"
}

private fun humanSize(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "%.0f KB".format(bytes / 1024.0)
    else -> "%.1f MB".format(bytes / (1024.0 * 1024))
}

/** Process-lived cache of decoded agent images, so scrolling a LazyColumn doesn't refetch blobs. */
private object BlobImages { val cache = mutableMapOf<String, androidx.compose.ui.graphics.ImageBitmap>() }

/** An image the agent sent (image-ref part): fetch + decrypt the blob, show inline, tap for fullscreen. */
@Composable
private fun AgentImage(part: MsgPart.ImageRef, fg: Color) {
    val bmp by produceState(BlobImages.cache[part.blobId], part.blobId) {
        if (value == null) {
            val decoded = withContext(Dispatchers.IO) {
                PhoneAgentService.instance?.fetchBlob(part.blobId)?.let { b ->
                    BitmapFactory.decodeByteArray(b, 0, b.size)?.asImageBitmap()
                }
            }
            if (decoded != null) { BlobImages.cache[part.blobId] = decoded; value = decoded }
        }
    }
    val b = bmp
    if (b == null) {
        Text("🖼️ image unavailable", color = fg.copy(alpha = 0.7f), style = MaterialTheme.typography.bodySmall)
        return
    }
    var full by remember { mutableStateOf(false) }
    Image(
        bitmap = b,
        contentDescription = part.alt ?: "image from the agent",
        contentScale = ContentScale.Crop,
        modifier = Modifier.width(240.dp).aspectRatio(b.width.toFloat() / b.height).clickable { full = true },
    )
    if (full) {
        Dialog(onDismissRequest = { full = false }) {
            Image(
                bitmap = b,
                contentDescription = part.alt ?: "image from the agent",
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxWidth().clickable { full = false },
            )
        }
    }
}

/** Renders a markdown subset (headings/bold/italic/code/bullets/links) into a styled Text. */
@Composable
private fun MarkdownText(md: String, color: Color, modifier: Modifier = Modifier) {
    val accent = MaterialTheme.colorScheme.primary
    Text(
        Markdown.toAnnotated(md, codeColor = accent, linkColor = accent),
        color = color,
        style = MaterialTheme.typography.bodyMedium,
        modifier = modifier,
    )
}

/** Pinned "agent is typing / transcribing / speaking" strip that animates IN and OUT. */
@Composable
private fun StatusStrip(status: String?, onStopSpeaking: () -> Unit) {
    var last by remember { mutableStateOf("") }
    LaunchedEffect(status) { if (status != null) last = status }
    AnimatedVisibility(
        visible = status != null,
        enter = fadeIn(tween(180)) + expandVertically(tween(200)),
        exit = fadeOut(tween(160)) + shrinkVertically(tween(180)),
    ) {
        val speaking = last.startsWith("🔊")
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 5.dp), horizontalArrangement = Arrangement.Start) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(16.dp),
                modifier = if (speaking) Modifier.clickable { onStopSpeaking() } else Modifier,
            ) {
                Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (speaking) {
                        Icon(Icons.Rounded.Stop, contentDescription = "Stop", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Speaking — tap to stop", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                    } else {
                        Text(
                            last.trimEnd('…', ' ', '.'),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontStyle = FontStyle.Italic,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Spacer(Modifier.width(7.dp))
                        TypingDots(MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

/** Three dots that breathe in sequence — the classic "typing…" indicator. */
@Composable
private fun TypingDots(color: Color) {
    val t = rememberInfiniteTransition(label = "dots")
    Row(verticalAlignment = Alignment.CenterVertically) {
        for (i in 0 until 3) {
            val a by t.animateFloat(
                0.25f, 1f,
                infiniteRepeatable(tween(500, easing = LinearEasing), RepeatMode.Reverse, initialStartOffset = StartOffset(i * 160)),
                label = "dot$i",
            )
            Box(Modifier.padding(horizontal = 2.dp).size(5.dp).clip(CircleShape).background(color.copy(alpha = a)))
        }
    }
}

/** A red dot that pulses while recording. */
@Composable
private fun PulsingDot(color: Color) {
    val t = rememberInfiniteTransition(label = "rec")
    val a by t.animateFloat(0.4f, 1f, infiniteRepeatable(tween(700, easing = LinearEasing), RepeatMode.Reverse), label = "recA")
    val s by t.animateFloat(0.85f, 1.15f, infiniteRepeatable(tween(700, easing = LinearEasing), RepeatMode.Reverse), label = "recS")
    Box(Modifier.size(12.dp).scale(s).clip(CircleShape).background(color.copy(alpha = a)))
}

/** Live recording UI that replaces the text field while capturing voice (held or locked). */
@Composable
private fun RecordingBar(locked: Boolean, aboutToCancel: Boolean, live: String, onCancel: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
        PulsingDot(MaterialTheme.colorScheme.error)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                when { aboutToCancel -> "Release to cancel"; locked -> "Recording… hands-free"; else -> "Listening…" },
                color = if (aboutToCancel) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                style = MaterialTheme.typography.titleSmall,
            )
            if (live.isNotBlank()) {
                // Full transcript, wrapping over several lines and auto-scrolling so the newest words stay visible.
                val scroll = rememberScrollState()
                LaunchedEffect(live) { scroll.animateScrollTo(scroll.maxValue) }
                Text(
                    live,
                    color = MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.heightIn(max = 108.dp).verticalScroll(scroll),
                )
            } else {
                Text(
                    if (locked) "Tap send when you're done" else "Slide up to lock · left to cancel",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (locked) TextButton(onClick = onCancel) { Text("Cancel") }
    }
}

/** Unintrusive floating cue (above the button) showing "slide up to lock", filling as you approach. */
@Composable
private fun LockHintOverlay(progress: Float) {
    val near = progress > 0.7f
    val t = rememberInfiniteTransition(label = "lockhint")
    val shimmer by t.animateFloat(0f, 1f, infiniteRepeatable(tween(1100, easing = LinearEasing), RepeatMode.Restart), label = "shimmer")
    Surface(
        shape = RoundedCornerShape(24.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.95f),
        tonalElevation = 4.dp,
        shadowElevation = 3.dp,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.width(46.dp).padding(vertical = 11.dp),
        ) {
            // The lock visibly "closes" and grows as you near the threshold.
            Icon(
                if (near) Icons.Rounded.Lock else Icons.Rounded.LockOpen,
                contentDescription = "Slide up to lock",
                tint = if (near) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(22.dp).scale(1f + 0.3f * progress),
            )
            Spacer(Modifier.height(4.dp))
            // Three up-chevrons rippling upward — reads as "swipe up". They dim as you get close.
            for (i in 0 until 3) {
                val phase = ((shimmer + i / 3f) % 1f)
                val ripple = (1f - kotlin.math.abs(phase - 0.5f) * 2f).coerceIn(0f, 1f)
                Icon(
                    Icons.Rounded.KeyboardArrowUp,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary.copy(alpha = (0.2f + 0.8f * ripple) * (1f - 0.6f * progress)),
                    modifier = Modifier.size(16.dp).offset(y = (4 - i * 6).dp),
                )
            }
        }
    }
}
