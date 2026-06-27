package com.agenticandroid

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
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
import androidx.compose.material.icons.automirrored.rounded.InsertDriveFile
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.automirrored.rounded.VolumeOff
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AttachFile
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.AudioFile
import androidx.compose.material.icons.rounded.ChatBubbleOutline
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Menu
import androidx.compose.material.icons.rounded.SmartToy
import androidx.compose.material.icons.rounded.Hub
import androidx.compose.material.icons.rounded.Cloud
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.BrokenImage
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.DownloadDone
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.FlashlightOn
import androidx.compose.material.icons.rounded.PhoneAndroid
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.Screenshot
import androidx.compose.material.icons.rounded.FolderZip
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.PictureAsPdf
import androidx.compose.ui.graphics.vector.ImageVector
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
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.put
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
        intent?.getStringExtra("open_hub")?.let { PhoneAgentService.instance?.switchHub(it) }

        setContent {
            AgentTheme {
                val messages by PhoneAgentService.chat.collectAsState()
                val uploads by PhoneAgentService.uploads.collectAsState()
                val connected by PhoneAgentService.connected.collectAsState()
                val agentName by PhoneAgentService.agentName.collectAsState()
                val voiceReplies by SettingsStore.voiceReplies.collectAsState()
                val status by PhoneAgentService.status.collectAsState()
                val speaking by PhoneAgentService.speaking.collectAsState()
                val commands by PhoneAgentService.commands.collectAsState()
                val connectionEnabled by SettingsStore.connectionEnabled.collectAsState()
                val profiles by Agents.profiles.collectAsState()
                val activeId by Agents.activeId.collectAsState()
                val roster by PhoneAgentService.roster.collectAsState() // agents on the active hub (switch w/o reconnect)
                val allAgents by PhoneAgentService.allAgents.collectAsState() // agents across ALL online hubs (header picker)
                val onlineHubs by PhoneAgentService.onlineHubs.collectAsState()
                val unreadHubs by PhoneAgentService.unreadHubs.collectAsState()
                val sessionList by PhoneAgentService.sessions.collectAsState()
                val activeSessionId by PhoneAgentService.activeSessionId.collectAsState()
                val paired = profiles.isNotEmpty()
                var input by remember { mutableStateOf("") }
                val listState = rememberLazyListState()
                val context = LocalContext.current
                val clipboard = LocalClipboardManager.current
                val scope = rememberCoroutineScope()
                LaunchedEffect(messages.size) {
                    // big scrollOffset overshoots → clamps to the true bottom (past the last bubble + bottom padding)
                    if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex, scrollOffset = 100_000)
                }
                val active = profiles.firstOrNull { it.id == activeId }
                val who = agentName ?: active?.display() ?: if (paired) "your agent" else "no agent"
                // Compact name for the header + placeholder: drop a "(your subscription)"-style qualifier
                // (the agent names itself in agent-cli.ts; the full name still shows in Settings → Agents).
                val shortWho = who.substringBefore(" (").trim().ifBlank { who }
                var attachOpen by remember { mutableStateOf(false) }  // `+` attach panel open?
                // Typing anything (incl. "/") collapses the attach panel, so the two palettes never stack.
                LaunchedEffect(input) { if (input.isNotEmpty()) attachOpen = false }

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
                    val clean = cleanStatus(st)
                    if (clean != "Transcribing…" && clean != "Sending…" && !clean.startsWith("Speaking")) haptics.tick()
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


                // Attach files and send them to the agent: pick (gallery / docs / downloads / any) → upload
                // each blob with a progress chip → one user_message carrying all the file parts.
                fun uploadUris(uris: List<Uri>) {
                    if (uris.isEmpty()) return
                    scope.launch(Dispatchers.IO) {
                        val cr = context.contentResolver
                        val done = mutableListOf<UploadedFile>()
                        for (uri in uris) runCatching {
                            val mime = cr.getType(uri)
                            var name = "file"
                            cr.query(uri, null, null, null, null)?.use { c ->
                                val ni = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                                if (c.moveToFirst() && ni >= 0) c.getString(ni)?.let { name = it }
                            }
                            val bytes = cr.openInputStream(uri)?.use { it.readBytes() } ?: return@runCatching
                            val uid = java.util.UUID.randomUUID().toString()
                            PhoneAgentService.uploads.value = PhoneAgentService.uploads.value +
                                PendingUpload(uid, name, mime, bytes.size, 0)
                            val id = PhoneAgentService.instance?.putBlob(bytes) { sent, _ ->
                                PhoneAgentService.uploads.value = PhoneAgentService.uploads.value.map {
                                    if (it.id == uid) it.copy(sent = sent) else it
                                }
                            }
                            PhoneAgentService.uploads.value = PhoneAgentService.uploads.value.filterNot { it.id == uid }
                            if (id != null) done.add(UploadedFile(id, name, mime, bytes.size))
                        }
                        if (done.isEmpty()) {
                            withContext(Dispatchers.Main) {
                                android.widget.Toast.makeText(context, "Couldn't send file", android.widget.Toast.LENGTH_SHORT).show()
                            }
                            return@launch
                        }
                        val partsJson = buildJsonArray {
                            for (f in done) addJsonObject {
                                put("kind", "file"); put("blobId", f.blobId); put("name", f.name)
                                f.mime?.let { put("mime", it) }; put("size", f.size)
                            }
                        }
                        withContext(Dispatchers.Main) { PhoneAgentService.instance?.sendUserMessage("", partsJson) }
                    }
                }
                val pickImages = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { uploadUris(it) }
                val pickDocs = rememberLauncherForActivityResult(OpenDocsFrom(DOCUMENTS_URI)) { uploadUris(it) }
                val pickDownloads = rememberLauncherForActivityResult(OpenDocsFrom(DOWNLOADS_URI)) { uploadUris(it) }
                val pickFiles = rememberLauncherForActivityResult(OpenDocsFrom(null)) { uploadUris(it) }

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

                val drawerState = rememberDrawerState(DrawerValue.Closed)
                ModalNavigationDrawer(
                    drawerState = drawerState,
                    drawerContent = {
                        ChatDrawer(
                            hubs = profiles,
                            onlineHubs = onlineHubs, unreadHubs = unreadHubs,
                            sessions = sessionList, activeSessionId = activeSessionId,
                            onNewChat = { PhoneAgentService.instance?.newSession() },
                            onSelectSession = { PhoneAgentService.instance?.selectSession(it) },
                            onDeleteSession = { PhoneAgentService.instance?.deleteSession(it) },
                            onClose = { scope.launch { drawerState.close() } },
                        )
                    },
                ) {
                Box(Modifier.fillMaxSize()) {
                Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
                    // header: ☰ menu (left) · agent name + status (centered) · mute + settings (right)
                    Box(Modifier.fillMaxWidth().padding(horizontal = 2.dp, vertical = 3.dp)) {
                        IconButton(
                            onClick = { scope.launch { drawerState.open() } },
                            modifier = Modifier.align(Alignment.CenterStart),
                        ) { Icon(Icons.Rounded.Menu, contentDescription = "Chats & agents") }

                        // Agent name = a tab. Chevron + dropdown to switch agents on this hub (only if >1).
                        Box(Modifier.align(Alignment.Center).padding(horizontal = 100.dp)) {
                            var agentMenu by remember { mutableStateOf(false) }
                            val canSwitch = allAgents.size > 1 // agents across every online hub
                            Column(
                                Modifier
                                    .clip(RoundedCornerShape(10.dp))
                                    .then(if (canSwitch) Modifier.clickable { agentMenu = true } else Modifier)
                                    .padding(horizontal = 8.dp, vertical = 2.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(shortWho, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    if (canSwitch) Icon(
                                        Icons.Rounded.ArrowDropDown, contentDescription = "Switch agent",
                                        modifier = Modifier.size(20.dp),
                                    )
                                }
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    val dotColor = if (!paired) Color(0xFF9AA0A6) else if (connected) Color(0xFF34C759) else Color(0xFFFFB020)
                                    Box(Modifier.size(7.dp).clip(CircleShape).background(dotColor))
                                    Spacer(Modifier.width(5.dp))
                                    Text(
                                        when {
                                            !paired -> "not paired"
                                            connected -> "connected"
                                            !connectionEnabled -> "offline"
                                            else -> "connecting…"
                                        },
                                        style = MaterialTheme.typography.labelSmall, color = Color.Gray,
                                    )
                                }
                            }
                            DropdownMenu(expanded = agentMenu, onDismissRequest = { agentMenu = false }) {
                                // Every agent across every online hub, grouped under its hub when there's more than one.
                                val byHub = allAgents.groupBy { it.hubId }
                                val multiHub = byHub.size > 1
                                byHub.forEach { (_, agentsOnHub) ->
                                    if (multiHub) Text(
                                        agentsOnHub.firstOrNull()?.hubName?.ifBlank { "Hub" } ?: "Hub",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.padding(start = 16.dp, top = 8.dp, bottom = 2.dp),
                                    )
                                    agentsOnHub.forEach { a ->
                                        val globallyActive = a.hubId == activeId && a.active
                                        DropdownMenuItem(
                                            text = { Text(a.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                            leadingIcon = {
                                                Icon(
                                                    if (a.external) Icons.Rounded.Cloud else Icons.Rounded.SmartToy,
                                                    contentDescription = if (a.external) "Cloud agent — connects from elsewhere" else "Local agent",
                                                )
                                            },
                                            trailingIcon = { if (globallyActive) Icon(Icons.Rounded.Check, contentDescription = "active") },
                                            onClick = { PhoneAgentService.instance?.selectAgentOnHub(a.hubId, a.id); agentMenu = false },
                                        )
                                    }
                                }
                            }
                        }

                        Row(Modifier.align(Alignment.CenterEnd), verticalAlignment = Alignment.CenterVertically) {
                            if (!paired) {
                                TextButton(onClick = { startActivity(Intent(this@MainActivity, PairingActivity::class.java)) }) { Text("Pair") }
                            } else {
                                IconButton(onClick = { SettingsStore.setVoiceReplies(!voiceReplies) }) {
                                    Icon(
                                        if (voiceReplies) Icons.AutoMirrored.Rounded.VolumeUp else Icons.AutoMirrored.Rounded.VolumeOff,
                                        contentDescription = if (voiceReplies) "Mute spoken replies" else "Unmute spoken replies",
                                        tint = if (voiceReplies) MaterialTheme.colorScheme.primary else Color.Gray,
                                    )
                                }
                                IconButton(onClick = { startActivity(Intent(this@MainActivity, SettingsActivity::class.java)) }) {
                                    Icon(Icons.Rounded.Settings, contentDescription = "Settings")
                                }
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
                        contentPadding = PaddingValues(top = 4.dp, bottom = 10.dp),
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
                                    color = if (isUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondaryContainer,
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
                                            UnavailableMedia("Photo unavailable", MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                    } else if (m.parts.isNotEmpty()) {
                                        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                                            m.parts.forEach { PartView(it, isUser) }
                                        }
                                    } else {
                                        val textColor = if (isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSecondaryContainer
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
                        items(uploads, key = { it.id }) { up ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.End) {
                                Surface(
                                    modifier = Modifier.widthIn(max = 300.dp),
                                    color = MaterialTheme.colorScheme.primary,
                                    shape = RoundedCornerShape(16.dp),
                                ) { UploadChip(up, MaterialTheme.colorScheme.onPrimary) }
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
                                    scope.launch {
                                        val last = (listState.layoutInfo.totalItemsCount - 1).coerceAtLeast(0)
                                        listState.animateScrollToItem(last, scrollOffset = 100_000)
                                    }
                                },
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(Icons.Rounded.KeyboardArrowDown, contentDescription = "Scroll to latest", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    // tap anywhere over the transcript to dismiss the attach panel (click-away)
                    if (attachOpen) {
                        Box(Modifier.matchParentSize().pointerInput(Unit) {
                            detectTapGestures { attachOpen = false }
                        })
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
                    StatusStrip(status, speaking) { PhoneAgentService.instance?.stopSpeaking() }

                    // input bar: morphs between a text field and a live recording bar; ONE combined
                    // button — tap to send, hold to talk, slide up to lock hands-free, slide left to cancel.
                    // composer: one rounded pill — [+ attach] · [text / live recording] · [send/mic].
                    // `+` opens a floating attach panel (like the `/` palette); the button taps to send,
                    // holds to talk, slides up to lock hands-free, slides left to cancel.
                    AnimatedVisibility(
                        visible = attachOpen && paired && !recording,
                        enter = fadeIn(tween(140)) + expandVertically(tween(180)),
                        exit = fadeOut(tween(120)) + shrinkVertically(tween(160)),
                    ) {
                        AttachPalette(
                            onPhotos = { attachOpen = false; pickImages.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                            onDocuments = { attachOpen = false; pickDocs.launch(arrayOf("*/*")) },
                            onDownloads = { attachOpen = false; pickDownloads.launch(arrayOf("*/*")) },
                            onFiles = { attachOpen = false; pickFiles.launch(arrayOf("*/*")) },
                        )
                    }
                    Surface(
                        shape = RoundedCornerShape(26.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        tonalElevation = 2.dp,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
                    ) {
                      Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (paired && !recording) {
                            val plusRot by animateFloatAsState(if (attachOpen) 45f else 0f, label = "plusRot")
                            IconButton(onClick = { attachOpen = !attachOpen }) {
                                Icon(
                                    Icons.Rounded.Add, contentDescription = "Add attachment",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.rotate(plusRot),
                                )
                            }
                        }
                        Box(Modifier.weight(1f).padding(horizontal = 4.dp), contentAlignment = Alignment.CenterStart) {
                            if (recording) {
                                RecordingBar(
                                    locked = locked,
                                    aboutToCancel = aboutToCancel,
                                    live = input,
                                    onCancel = { cancelRecording() },
                                )
                            } else {
                                BasicTextField(
                                    value = input,
                                    onValueChange = { input = it },
                                    enabled = paired,
                                    // focusing the field (tapping it) collapses the attach panel
                                    modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)
                                        .onFocusChanged { if (it.isFocused) attachOpen = false },
                                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                                    maxLines = 5,
                                    decorationBox = { inner ->
                                        if (input.isEmpty()) Text(
                                            if (paired) "Message $shortWho…" else "Pair an agent first",
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            style = MaterialTheme.typography.bodyLarge,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                        inner()
                                    },
                                )
                            }
                        }
                        if (paired) {
                            val canSend = input.isNotBlank() && !recording
                            val showSend = canSend || locked || !voice.available
                            val scale by animateFloatAsState(
                                if (pressed || recording) 1.12f else 1f,
                                spring(dampingRatio = Spring.DampingRatioMediumBouncy), label = "btnScale",
                            )
                            Box(
                                Modifier.size(44.dp).scale(scale).clip(CircleShape)
                                    // tertiary = the theme's 3rd (middle-swatch) color; the always-on send/mic
                                    // button is its home, so every theme shows all three colors at once.
                                    .background(if (recording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.tertiary)
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
                                        tint = if (recording) MaterialTheme.colorScheme.onError else MaterialTheme.colorScheme.onTertiary,
                                        modifier = Modifier.size(22.dp),
                                    )
                                }
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

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getStringExtra("open_hub")?.let { PhoneAgentService.instance?.switchHub(it) }
    }
}

/** Left drawer: switch between your online hubs, start a new chat, and open / delete past chats.
 *  (Agents switch in the header; hubs are paired/renamed/forgotten in Settings.) */
@Composable
private fun ChatDrawer(
    hubs: List<AgentProfile>,
    onlineHubs: Set<String>,
    unreadHubs: Set<String>,
    sessions: List<SessionInfo>,
    activeSessionId: String?,
    onNewChat: () -> Unit,
    onSelectSession: (String) -> Unit,
    onDeleteSession: (String) -> Unit,
    onClose: () -> Unit,
) {
    ModalDrawerSheet(Modifier.fillMaxWidth(0.84f)) {
        Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 6.dp)) {
            // Hubs — info only: which paired computers are reachable right now (all stay live at once).
            // You don't pick a hub here; pick an agent in the header and its hub comes along.
            Text("Hubs", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp))
            if (hubs.isEmpty()) {
                Text("No hubs yet — pair one in Settings.", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 16.dp, top = 2.dp, bottom = 6.dp))
            }
            // Compact, non-interactive rows — just a status dot + name, so they read as info, not buttons.
            hubs.sortedByDescending { it.id in onlineHubs }.forEach { h ->
                val online = h.id in onlineHubs
                val dot = when {
                    h.id in unreadHubs -> MaterialTheme.colorScheme.primary
                    online -> Color(0xFF34C759)
                    else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
                }
                Row(
                    Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 3.dp, bottom = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(7.dp).clip(CircleShape).background(dot))
                    Spacer(Modifier.width(10.dp))
                    Text(h.display(), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (online) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            NavigationDrawerItem(
                label = { Text("New chat") },
                selected = false,
                icon = { Icon(Icons.Rounded.Add, contentDescription = null) },
                onClick = { onNewChat(); onClose() },
            )
            Text("Chats", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp))
            LazyColumn(Modifier.weight(1f)) {
                items(sessions) { s ->
                    NavigationDrawerItem(
                        label = { Text(s.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        selected = s.id == activeSessionId,
                        icon = { Icon(Icons.Rounded.ChatBubbleOutline, contentDescription = null) },
                        badge = {
                            IconButton(onClick = { onDeleteSession(s.id) }) {
                                Icon(Icons.Rounded.Delete, contentDescription = "Delete chat", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        },
                        onClick = { onSelectSession(s.id); onClose() },
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

/** The `/` command menu: scrollable list of the agent's skills & commands, filtered as you type. */
@Composable
private fun SlashPalette(matches: List<SlashCommand>, onPick: (SlashCommand) -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(16.dp),
        tonalElevation = 3.dp,
        shadowElevation = 10.dp,
        // Floating card: inset from both sides + a gap above the input bar, capped to ~4 rows (scrolls).
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 12.dp, end = 12.dp, top = 2.dp, bottom = 8.dp)
            .heightIn(max = 232.dp)
            .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.35f), RoundedCornerShape(16.dp)),
    ) {
        LazyColumn {
            itemsIndexed(matches) { i, c ->
                if (i > 0) PaletteDivider()
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

/** The `+` attach menu: a floating card (same style as the `/` palette) with the four sources. */
@Composable
private fun AttachPalette(onPhotos: () -> Unit, onDocuments: () -> Unit, onDownloads: () -> Unit, onFiles: () -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(16.dp),
        tonalElevation = 3.dp,
        shadowElevation = 10.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 12.dp, end = 12.dp, top = 2.dp, bottom = 8.dp)
            .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.35f), RoundedCornerShape(16.dp)),
    ) {
        Column {
            AttachRow(Icons.Rounded.Image, "Photos", "Pick from your gallery", onPhotos)
            PaletteDivider()
            AttachRow(Icons.Rounded.Folder, "Documents", "Browse your documents", onDocuments)
            PaletteDivider()
            AttachRow(Icons.Rounded.Download, "Downloads", "Browse your downloads", onDownloads)
            PaletteDivider()
            AttachRow(Icons.AutoMirrored.Rounded.InsertDriveFile, "Files", "Any file type", onFiles)
        }
    }
}

/** A subtle inset divider between palette rows — visible but light, premium. */
@Composable
private fun PaletteDivider() = HorizontalDivider(
    Modifier.padding(horizontal = 12.dp),
    thickness = 1.dp,
    color = MaterialTheme.colorScheme.outline.copy(alpha = 0.18f),
)

@Composable
private fun AttachRow(icon: ImageVector, label: String, hint: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onClick() }.padding(horizontal = 14.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(13.dp))
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/**
 * Renders one typed part of a rich reply (Phase 6). Text parts show as text (markdown styling lands
 * in a later item); image / file / table show a compact stand-in until their own renderers arrive.
 */
@Composable
private fun PartView(part: MsgPart, isUser: Boolean) {
    val fg = if (isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSecondaryContainer
    when (part) {
        is MsgPart.Text -> if (part.markdown) MarkdownText(part.text, fg) else Text(part.text, color = fg, style = MaterialTheme.typography.bodyMedium)
        is MsgPart.Table -> TableView(part, fg)
        is MsgPart.ImageRef -> AgentImage(part, fg)
        is MsgPart.FileRef -> FilePart(part, fg)
    }
}

/** Save an agent-sent blob straight to the phone's Downloads (no picker), with a spinner + a saved mark. */
private fun downloadBlob(context: android.content.Context, scope: kotlinx.coroutines.CoroutineScope, ref: BlobRef) {
    if (ref.blobId in PhoneAgentService.downloading.value) return
    PhoneAgentService.downloading.value = PhoneAgentService.downloading.value + ref.blobId
    scope.launch(Dispatchers.IO) {
        val uri = runCatching {
            val bytes = PhoneAgentService.instance?.fetchBlob(ref.blobId) ?: return@runCatching null
            val resolver = context.contentResolver
            val values = android.content.ContentValues().apply {
                put(android.provider.MediaStore.Downloads.DISPLAY_NAME, ref.name.ifBlank { "file" })
                put(android.provider.MediaStore.Downloads.MIME_TYPE, ref.mime ?: "application/octet-stream")
                put(android.provider.MediaStore.Downloads.IS_PENDING, 1)
            }
            val u = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return@runCatching null
            resolver.openOutputStream(u)?.use { it.write(bytes) }
            values.clear(); values.put(android.provider.MediaStore.Downloads.IS_PENDING, 0); resolver.update(u, values, null, null)
            u
        }.getOrNull()
        PhoneAgentService.downloading.value = PhoneAgentService.downloading.value - ref.blobId
        withContext(Dispatchers.Main) {
            if (uri != null) {
                SettingsStore.setDownloaded(ref.blobId, uri.toString())
                android.widget.Toast.makeText(context, "Saved to Downloads", android.widget.Toast.LENGTH_SHORT).show()
            } else {
                android.widget.Toast.makeText(context, "Couldn't download — the file may have expired", android.widget.Toast.LENGTH_SHORT).show()
            }
        }
    }
}

/** Open a previously-downloaded blob via its saved content URI. */
private fun openDownloaded(context: android.content.Context, uri: String) {
    runCatching {
        val u = android.net.Uri.parse(uri)
        val view = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
            setDataAndType(u, context.contentResolver.getType(u) ?: "*/*")
            addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(android.content.Intent.createChooser(view, "Open"))
    }
}

/** A blob the agent sent that we can download/share (file or image). */
data class BlobRef(val blobId: String, val name: String, val mime: String?)

/** A file the user just uploaded to the agent, ready to ride as a file-ref part. */
private data class UploadedFile(val blobId: String, val name: String, val mime: String?, val size: Int)

/** SAF "open documents" (multi-select) that opens in a given folder (Documents / Downloads) when supported. */
private class OpenDocsFrom(private val initial: Uri?) : ActivityResultContracts.OpenMultipleDocuments() {
    override fun createIntent(context: android.content.Context, input: Array<String>): Intent {
        val i = super.createIntent(context, input)
        if (initial != null) i.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initial)
        return i
    }
}
// Start-folder hints for the docs/downloads pickers (EXTRA_INITIAL_URI is advisory — falls back if unknown).
private val DOCUMENTS_URI: Uri = Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADocuments")
private val DOWNLOADS_URI: Uri = Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADownload")

/** Share an agent-sent blob via the system share sheet (writes a temp copy under cache/shared). */
private fun shareBlob(context: android.content.Context, scope: kotlinx.coroutines.CoroutineScope, ref: BlobRef) {
    scope.launch(Dispatchers.IO) {
        runCatching {
            val bytes = PhoneAgentService.instance?.fetchBlob(ref.blobId) ?: return@launch
            val dir = java.io.File(context.cacheDir, "shared").apply { mkdirs() }
            val file = java.io.File(dir, ref.name.ifBlank { "file" })
            file.writeBytes(bytes)
            val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                type = ref.mime ?: "application/octet-stream"
                putExtra(android.content.Intent.EXTRA_STREAM, uri)
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            withContext(Dispatchers.Main) { context.startActivity(android.content.Intent.createChooser(send, "Share")) }
        }
    }
}

/** A file being uploaded to the agent: type icon + name + a determinate progress bar. Replaced by a
 *  normal sent bubble once the upload completes. */
@Composable
private fun UploadChip(up: PendingUpload, fg: Color) {
    val frac = if (up.size > 0) (up.sent.toFloat() / up.size).coerceIn(0f, 1f) else 0f
    Row(Modifier.width(260.dp).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(fileIcon(up.mime), contentDescription = null, tint = fg, modifier = Modifier.size(28.dp))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(up.name, color = fg, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(5.dp))
            LinearProgressIndicator(
                progress = { frac },
                modifier = Modifier.fillMaxWidth().height(3.dp),
                color = fg, trackColor = fg.copy(alpha = 0.25f),
            )
            Spacer(Modifier.height(3.dp))
            Text("uploading… ${(frac * 100).toInt()}%", color = fg.copy(alpha = 0.8f), style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** A file the agent sent: type icon (or thumbnail for images) + name + size. Tap to preview; the ⋮ menu
 *  has Preview/Open or Download/Share. Shows a spinner while saving and a "Saved" mark once on the phone. */
@Composable
private fun FilePart(part: MsgPart.FileRef, fg: Color) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val ref = BlobRef(part.blobId, part.name, part.mime)
    val downloading by PhoneAgentService.downloading.collectAsState()
    val downloaded by SettingsStore.downloadedBlobs.collectAsState()
    val isDownloading = part.blobId in downloading
    val savedUri = downloaded[part.blobId]
    var menu by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf(false) }
    // images get a real thumbnail (decoded once, cached) instead of the generic file icon
    val isImage = part.mime?.startsWith("image/") == true
    val thumb by produceState(BlobImages.cache[part.blobId], part.blobId, isImage) {
        if (isImage && value == null) {
            val decoded = withContext(Dispatchers.IO) {
                PhoneAgentService.instance?.fetchBlob(part.blobId)?.let { b ->
                    BitmapFactory.decodeByteArray(b, 0, b.size)?.asImageBitmap()
                }
            }
            if (decoded != null) { BlobImages.cache[part.blobId] = decoded; value = decoded }
        }
    }
    Surface(
        color = fg.copy(alpha = 0.10f),
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.padding(vertical = 2.dp).clickable { preview = true },
    ) {
        Row(Modifier.padding(start = 10.dp, end = 2.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            val t = thumb
            if (isImage && t != null) {
                Image(bitmap = t, contentDescription = part.name, contentScale = ContentScale.Crop,
                    modifier = Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)))
            } else {
                Icon(fileIcon(part.mime), contentDescription = null, tint = fg, modifier = Modifier.size(28.dp))
            }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f, fill = false)) {
                Text(part.name, color = fg, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (savedUri != null) {
                        Icon(Icons.Rounded.DownloadDone, contentDescription = null, tint = fg.copy(alpha = 0.7f), modifier = Modifier.size(13.dp))
                        Spacer(Modifier.width(3.dp))
                    }
                    Text(
                        (part.size?.let { humanSize(it) + " · " } ?: "") +
                            when { isDownloading -> "downloading…"; savedUri != null -> "saved"; else -> "tap to preview" },
                        color = fg.copy(alpha = 0.7f), style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            if (isDownloading) {
                CircularProgressIndicator(modifier = Modifier.size(22.dp).padding(end = 6.dp), strokeWidth = 2.dp, color = fg)
            } else {
                Box {
                    IconButton(onClick = { menu = true }) {
                        Icon(Icons.Rounded.MoreVert, contentDescription = "More", tint = fg)
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text("Preview") }, onClick = { menu = false; preview = true })
                        if (savedUri != null) {
                            DropdownMenuItem(text = { Text("Open") }, onClick = { menu = false; openDownloaded(context, savedUri) })
                        } else {
                            DropdownMenuItem(text = { Text("Download") }, onClick = { menu = false; downloadBlob(context, scope, ref) })
                        }
                        DropdownMenuItem(text = { Text("Share") }, onClick = { menu = false; shareBlob(context, scope, ref) })
                    }
                }
            }
        }
    }
    if (preview) {
        FilePreviewDialog(
            part,
            downloaded = savedUri != null,
            onClose = { preview = false },
            onDownload = { downloadBlob(context, scope, ref) },
            onOpen = { savedUri?.let { openDownloaded(context, it) } },
            onShare = { shareBlob(context, scope, ref) },
        )
    }
}

/** A pop-up preview: images render inline; markdown is styled; JSON/XML/code are syntax-highlighted;
 *  plain text is monospace; unknown types say so. Footer has Open/Download + Share. */
@Composable
private fun FilePreviewDialog(part: MsgPart.FileRef, downloaded: Boolean, onClose: () -> Unit, onDownload: () -> Unit, onOpen: () -> Unit, onShare: () -> Unit) {
    val kind = remember(part.blobId) { previewKind(part.mime, part.name) }
    Dialog(onDismissRequest = onClose) {
        Surface(shape = RoundedCornerShape(16.dp), tonalElevation = 4.dp, modifier = Modifier.fillMaxWidth().heightIn(max = 560.dp)) {
            Column {
                Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(fileIcon(part.mime), contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(10.dp))
                    Text(part.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, contentDescription = "Close") }
                }
                HorizontalDivider()
                // The body sizes to its content between a sensible min and the dialog max: short files
                // get a short dialog, long ones cap out and scroll inside. Images center in any leftover.
                val scroll = rememberScrollState()
                Box(
                    Modifier.weight(1f, fill = false).fillMaxWidth().heightIn(min = 180.dp).verticalScroll(scroll),
                    contentAlignment = if (kind == PreviewKind.IMAGE) Alignment.Center else Alignment.TopStart,
                ) {
                    when (kind) {
                        PreviewKind.IMAGE -> ImagePreview(part)
                        PreviewKind.NONE -> Text("No preview available for this file type.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
                        else -> TextPreview(part, kind)
                    }
                }
                HorizontalDivider()
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onShare) { Text("Share") }
                    if (downloaded) {
                        TextButton(onClick = { onOpen(); onClose() }) { Text("Open") }
                    } else {
                        TextButton(onClick = onDownload) { Text("Download") }
                    }
                }
            }
        }
    }
}

/** Decode + show an image blob, fitted to width and scrollable if tall. */
@Composable
private fun ImagePreview(part: MsgPart.FileRef) {
    var done by remember(part.blobId) { mutableStateOf(BlobImages.cache[part.blobId] != null) }
    val bmp by produceState(BlobImages.cache[part.blobId], part.blobId) {
        if (value == null) {
            value = withContext(Dispatchers.IO) {
                PhoneAgentService.instance?.fetchBlob(part.blobId)?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }
            }?.also { BlobImages.cache[part.blobId] = it }
            done = true
        }
    }
    val b = bmp
    // No fillMaxSize/scroll here — the parent box wraps to this height (so a short image → short dialog)
    // and centers it; the parent's scroll handles a very tall image.
    when {
        b != null -> Image(bitmap = b, contentDescription = part.name, contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxWidth().aspectRatio(b.width.toFloat() / b.height).padding(8.dp))
        !done -> Text("Loading…", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
        else -> UnavailableMedia("Image unavailable", MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Load + render a text-ish blob: markdown styled, JSON/XML/code highlighted, plain text monospace. */
@Composable
private fun TextPreview(part: MsgPart.FileRef, kind: PreviewKind) {
    val content by produceState<String?>(null, part.blobId) {
        value = withContext(Dispatchers.IO) {
            PhoneAgentService.instance?.fetchBlob(part.blobId)?.let { String(it.copyOf(minOf(it.size, 256 * 1024)), Charsets.UTF_8) }
                ?: "(couldn't load this file)"
        }
    }
    val c = content
    // No fillMaxSize/scroll here — the parent box provides the min height + scroll.
    when {
        c == null -> Text("Loading…", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
        kind == PreviewKind.MARKDOWN -> MarkdownText(c, MaterialTheme.colorScheme.onSurface, Modifier.padding(16.dp))
        kind == PreviewKind.TEXT -> Text(c, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(16.dp))
        else -> {
            val colors = rememberTokenColors()
            Text(highlighted(c, kind, colors), style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, color = colors.base, modifier = Modifier.padding(16.dp))
        }
    }
}

/** Compact placeholder when an image/photo can't be shown (e.g. its blob expired). */
@Composable
private fun UnavailableMedia(label: String, color: Color) {
    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Rounded.BrokenImage, contentDescription = null, tint = color.copy(alpha = 0.7f), modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(6.dp))
        Text(label, color = color.copy(alpha = 0.7f), style = MaterialTheme.typography.bodySmall)
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

private fun fileIcon(mime: String?): ImageVector = when {
    mime == null -> Icons.AutoMirrored.Rounded.InsertDriveFile
    mime.startsWith("image/") -> Icons.Rounded.Image
    mime.startsWith("audio/") -> Icons.Rounded.AudioFile
    mime.startsWith("video/") -> Icons.Rounded.Movie
    mime == "application/pdf" -> Icons.Rounded.PictureAsPdf
    mime.startsWith("text/") -> Icons.Rounded.Description
    mime.contains("zip") || mime.contains("compress") -> Icons.Rounded.FolderZip
    else -> Icons.AutoMirrored.Rounded.InsertDriveFile
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
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val ref = BlobRef(part.blobId, part.alt?.ifBlank { null } ?: "image.jpg", part.mime ?: "image/jpeg")
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
        UnavailableMedia("Image unavailable", fg)
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
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Image(
                    bitmap = b,
                    contentDescription = part.alt ?: "image from the agent",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxWidth().clickable { full = false },
                )
                Spacer(Modifier.height(8.dp))
                val downloaded by SettingsStore.downloadedBlobs.collectAsState()
                val savedUri = downloaded[part.blobId]
                Row {
                    if (savedUri != null) TextButton(onClick = { openDownloaded(context, savedUri) }) { Text("Open") }
                    else TextButton(onClick = { downloadBlob(context, scope, ref) }) { Text("Download") }
                    TextButton(onClick = { shareBlob(context, scope, ref) }) { Text("Share") }
                }
            }
        }
    }
}

/** Renders a markdown subset (headings/bold/italic/code/bullets/links) into a styled Text. */
@Composable
private fun MarkdownText(md: String, color: Color, modifier: Modifier = Modifier) {
    // tertiary = the theme's 3rd color; this is what surfaces it (code + links inside agent replies)
    val accent = MaterialTheme.colorScheme.tertiary
    Text(
        Markdown.toAnnotated(md, codeColor = accent, linkColor = accent),
        color = color,
        style = MaterialTheme.typography.bodyMedium,
        modifier = modifier,
    )
}

/** Strip any leading emoji/symbols from a status label so the strip shows clean text + a Material icon. */
private fun cleanStatus(raw: String): String = raw.trimStart().dropWhile { !it.isLetterOrDigit() }.trim()

/** A Material icon for a status label (keyword-mapped); null → just the typing dots. */
private fun statusIcon(text: String): ImageVector? {
    val t = text.lowercase()
    return when {
        "listening" in t || "transcrib" in t -> Icons.Rounded.Mic
        "sending" in t -> Icons.AutoMirrored.Rounded.Send
        "photo" in t -> Icons.Rounded.PhotoCamera
        "screen" in t -> Icons.Rounded.Screenshot
        "device" in t || "battery" in t -> Icons.Rounded.PhoneAndroid
        "flashlight" in t || "torch" in t -> Icons.Rounded.FlashlightOn
        "thinking" in t -> Icons.Rounded.AutoAwesome
        "running" in t -> Icons.Rounded.Bolt
        else -> null
    }
}

/** Pinned "agent is typing / transcribing / speaking" strip that animates IN and OUT. */
@Composable
private fun StatusStrip(status: String?, speaking: Boolean, onStopSpeaking: () -> Unit) {
    var last by remember { mutableStateOf("") }
    LaunchedEffect(status) { if (status != null) last = status }
    AnimatedVisibility(
        visible = status != null,
        enter = fadeIn(tween(180)) + expandVertically(tween(200)),
        exit = fadeOut(tween(160)) + shrinkVertically(tween(180)),
    ) {
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
                        val clean = cleanStatus(last)
                        statusIcon(clean)?.let {
                            Icon(it, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                        }
                        Text(
                            clean.trimEnd('…', ' ', '.'),
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
