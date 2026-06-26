package com.agenticandroid

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.CloudQueue
import androidx.compose.material.icons.rounded.ContentPaste
import androidx.compose.material.icons.rounded.Extension
import androidx.compose.material.icons.rounded.FlashlightOn
import androidx.compose.material.icons.rounded.Keyboard
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.LocationOn
import androidx.compose.material.icons.rounded.Navigation
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.NotificationsOff
import androidx.compose.material.icons.rounded.PhoneAndroid
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.Screenshot
import androidx.compose.material.icons.rounded.Sms
import androidx.compose.material.icons.rounded.Swipe
import androidx.compose.material.icons.rounded.TouchApp
import androidx.compose.material.icons.rounded.Vibration
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.agenticandroid.pairing.PairingActivity
import kotlin.math.roundToInt

/** Proper settings page: agents, theme (system/light/dark), voice, and which actions are allowed. */
class SettingsActivity : ComponentActivity() {
    private val micPerm =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted && SettingsStore.wakeWord.value) WakeWordService.start(this)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        SettingsStore.init(this)
        Agents.init(this)
        setContent {
            AgentTheme {
                val theme by SettingsStore.theme.collectAsState()
                val palette by SettingsStore.palette.collectAsState()
                val disabled by SettingsStore.disabledCaps.collectAsState()
                val chimes by SettingsStore.chimes.collectAsState()
                val voiceReplies by SettingsStore.voiceReplies.collectAsState()
                val wakeWord by SettingsStore.wakeWord.collectAsState()
                val wakePhrase by SettingsStore.wakePhrase.collectAsState()
                val ttsRate by SettingsStore.ttsRate.collectAsState()
                val ttsPitch by SettingsStore.ttsPitch.collectAsState()
                val wakeTimeoutSec by SettingsStore.wakeTimeoutSec.collectAsState()
                val wakeSensitivity by SettingsStore.wakeSensitivity.collectAsState()
                val chimeStyle by SettingsStore.chimeStyle.collectAsState()
                val wakeDnd by SettingsStore.wakeDnd.collectAsState()
                val wakeDndStart by SettingsStore.wakeDndStart.collectAsState()
                val wakeDndEnd by SettingsStore.wakeDndEnd.collectAsState()
                val caps by PhoneAgentService.capabilities.collectAsState()
                val roster by PhoneAgentService.roster.collectAsState()
                val profiles by Agents.profiles.collectAsState()
                val activeId by Agents.activeId.collectAsState()

                Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
                    Row(
                        Modifier.fillMaxWidth().padding(start = 4.dp, end = 14.dp, top = 4.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(onClick = { finish() }) {
                            Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back")
                        }
                        Text("Settings", style = MaterialTheme.typography.titleMedium)
                    }
                    HorizontalDivider()

                    // Quick connect / disconnect, pinned at the very top. Keeps your pairings — just drops
                    // or restores the live link so you can go offline fast and reconnect instantly.
                    val connectionEnabled by SettingsStore.connectionEnabled.collectAsState()
                    val connected by PhoneAgentService.connected.collectAsState()
                    Row(
                        Modifier.fillMaxWidth()
                            .clickable {
                                val on = !connectionEnabled
                                PhoneAgentService.instance?.setConnectionEnabled(on) ?: SettingsStore.setConnectionEnabled(on)
                            }
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        val (icon, tint) = when {
                            !connectionEnabled -> Icons.Rounded.CloudOff to MaterialTheme.colorScheme.onSurfaceVariant
                            connected -> Icons.Rounded.CloudDone to MaterialTheme.colorScheme.primary
                            else -> Icons.Rounded.CloudQueue to MaterialTheme.colorScheme.onSurfaceVariant
                        }
                        Icon(icon, contentDescription = null, tint = tint)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                when { !connectionEnabled -> "Disconnected"; connected -> "Connected"; else -> "Connecting…" },
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Text(
                                when {
                                    !connectionEnabled -> "Off for now — your agents are kept. Tap to reconnect."
                                    connected -> "Linked to your agent. Tap to disconnect quickly."
                                    else -> "Reaching your hub…"
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = connectionEnabled,
                            onCheckedChange = { on -> PhoneAgentService.instance?.setConnectionEnabled(on) ?: SettingsStore.setConnectionEnabled(on) },
                        )
                    }
                    HorizontalDivider()

                    var tab by remember { mutableStateOf(0) }
                    val tabTitles = listOf("General", "Theme", "Voice", "Actions")
                    TabRow(selectedTabIndex = tab) {
                        tabTitles.forEachIndexed { i, title ->
                            Tab(selected = tab == i, onClick = { tab = i }, text = { Text(title) })
                        }
                    }

                    LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                        item {
                            if (tab == 0) {
                            SectionLabel("Agents")
                            if (profiles.isEmpty()) {
                                Text(
                                    "No agents paired yet.",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                )
                            }
                            profiles.forEach { p ->
                                Row(
                                    Modifier.fillMaxWidth()
                                        .clickable { PhoneAgentService.instance?.switchAgent(p.id) }
                                        .padding(horizontal = 16.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    RadioButton(
                                        selected = p.id == activeId,
                                        onClick = { PhoneAgentService.instance?.switchAgent(p.id) },
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(p.name, style = MaterialTheme.typography.titleSmall)
                                        // Friendly status instead of the raw relay URL/IP.
                                        Text(
                                            if (p.id == activeId) (if (connected) "Connected" else "Connecting…") else "Paired",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            maxLines = 1,
                                        )
                                    }
                                    TextButton(onClick = {
                                        val wasActive = p.id == activeId
                                        Agents.remove(this@SettingsActivity, p.id)
                                        if (wasActive) PhoneAgentService.instance?.reconnect()
                                    }) { Text("Forget") }
                                }
                            }
                            Row(
                                Modifier.fillMaxWidth()
                                    .clickable { startActivity(Intent(this@SettingsActivity, PairingActivity::class.java)) }
                                    .padding(horizontal = 16.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.Rounded.Add, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                                Spacer(Modifier.width(8.dp))
                                Text("Pair another agent", color = MaterialTheme.colorScheme.primary)
                            }
                            if (roster.size > 1) {
                                HorizontalDivider()
                                SectionLabel("Connected to this hub")
                                roster.forEach { a ->
                                    Row(
                                        Modifier.fillMaxWidth()
                                            .clickable { PhoneAgentService.instance?.selectAgent(a.id) }
                                            .padding(horizontal = 16.dp, vertical = 10.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        RadioButton(selected = a.active, onClick = { PhoneAgentService.instance?.selectAgent(a.id) })
                                        Spacer(Modifier.width(8.dp))
                                        Text(a.name, Modifier.weight(1f))
                                        Text(
                                            if (a.active) "active" else "online",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            }
                            }
                            if (tab == 1) {
                            SectionLabel("Theme")
                            Row(
                                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
                                    .padding(horizontal = 16.dp, vertical = 4.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Themes.all.forEach { t -> ThemeSwatch(t, selected = palette == t.id) { SettingsStore.setPalette(t.id) } }
                            }
                            SectionLabel("Appearance")
                            listOf("system" to "System default", "light" to "Light", "dark" to "Dark").forEach { (key, label) ->
                                Row(
                                    Modifier.fillMaxWidth().clickable { SettingsStore.setTheme(key) }
                                        .padding(horizontal = 16.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    RadioButton(selected = theme == key, onClick = { SettingsStore.setTheme(key) })
                                    Spacer(Modifier.width(8.dp))
                                    Text(label)
                                }
                            }
                            }
                            if (tab == 2) {
                            SectionLabel("Voice & sounds")
                            Row(
                                Modifier.fillMaxWidth().clickable { SettingsStore.setVoiceReplies(!voiceReplies) }
                                    .padding(horizontal = 16.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text("Speak replies")
                                    Text(
                                        "Reads the agent's replies aloud, cleaned up for listening.",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Switch(checked = voiceReplies, onCheckedChange = { SettingsStore.setVoiceReplies(it) })
                            }
                            if (voiceReplies) {
                                SliderRow("Speech rate", ttsRate, 0.5f..2.0f) { SettingsStore.setTtsRate(it) }
                                SliderRow("Voice pitch", ttsPitch, 0.5f..2.0f) { SettingsStore.setTtsPitch(it) }
                            }
                            Row(
                                Modifier.fillMaxWidth().clickable { SettingsStore.setChimes(!chimes) }
                                    .padding(horizontal = 16.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text("Chimes")
                                    Text(
                                        "Sounds when listening, sending, and on errors.",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Switch(checked = chimes, onCheckedChange = { SettingsStore.setChimes(it) })
                            }
                            if (chimes) {
                                Row(
                                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text("Chime sound", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                                    listOf("classic" to "Classic", "soft" to "Soft").forEach { (key, label) ->
                                        FilterChip(
                                            selected = chimeStyle == key,
                                            onClick = { SettingsStore.setChimeStyle(key) },
                                            label = { Text(label) },
                                        )
                                    }
                                }
                            }
                            Row(
                                Modifier.fillMaxWidth()
                                    .clickable {
                                        val on = !wakeWord
                                        SettingsStore.setWakeWord(on)
                                        if (on && ContextCompat.checkSelfPermission(this@SettingsActivity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                                            micPerm.launch(Manifest.permission.RECORD_AUDIO)
                                        }
                                    }
                                    .padding(horizontal = 16.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text("Wake word")
                                    Text(
                                        "Listen all the time and respond to a spoken phrase, hands-free (uses the mic and more battery).",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Switch(checked = wakeWord, onCheckedChange = { on ->
                                    SettingsStore.setWakeWord(on)
                                    if (on && ContextCompat.checkSelfPermission(this@SettingsActivity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                                        micPerm.launch(Manifest.permission.RECORD_AUDIO)
                                    }
                                })
                            }
                            if (wakeWord) {
                                Text(
                                    "Wake phrase",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(start = 16.dp, top = 4.dp),
                                )
                                Row(
                                    Modifier.fillMaxWidth()
                                        .horizontalScroll(rememberScrollState())
                                        .padding(horizontal = 16.dp, vertical = 6.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    listOf("hey agent", "okay agent", "computer", "jarvis", "hey phone").forEach { p ->
                                        FilterChip(
                                            selected = wakePhrase == p,
                                            onClick = { SettingsStore.setWakePhrase(p) },
                                            label = { Text(p) },
                                        )
                                    }
                                }
                                OutlinedTextField(
                                    value = wakePhrase,
                                    onValueChange = { SettingsStore.setWakePhrase(it) },
                                    label = { Text("Or type your own") },
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                                )
                                SliderRow(
                                    "Wake sensitivity", wakeSensitivity, 0f..1f, steps = 4,
                                    format = { when { it < 0.5f -> "Exact"; it < 0.8f -> "Tolerant"; else -> "Loose" } },
                                ) { SettingsStore.setWakeSensitivity(it) }
                                SliderRow(
                                    "Listen timeout", wakeTimeoutSec.toFloat(), 3f..15f, steps = 11,
                                    format = { "${it.roundToInt()}s" },
                                ) { SettingsStore.setWakeTimeoutSec(it.roundToInt()) }
                                Row(
                                    Modifier.fillMaxWidth().clickable { SettingsStore.setWakeDnd(!wakeDnd) }
                                        .padding(horizontal = 16.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text("Do not disturb")
                                        Text(
                                            "Ignore the wake word during quiet hours.",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    Switch(checked = wakeDnd, onCheckedChange = { SettingsStore.setWakeDnd(it) })
                                }
                                if (wakeDnd) {
                                    SliderRow("Quiet from", wakeDndStart.toFloat(), 0f..23f, steps = 22,
                                        format = { "%02d:00".format(it.roundToInt()) }) { SettingsStore.setWakeDndStart(it.roundToInt()) }
                                    SliderRow("Quiet until", wakeDndEnd.toFloat(), 0f..23f, steps = 22,
                                        format = { "%02d:00".format(it.roundToInt()) }) { SettingsStore.setWakeDndEnd(it.roundToInt()) }
                                }
                            }
                            }
                            if (tab == 3) {
                            SectionLabel("Actions the agent can use")
                            if (caps.isEmpty()) {
                                Text(
                                    "Connect to your agent to load its actions.",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(16.dp),
                                )
                            }
                            }
                        }
                        if (tab == 3) items(caps) { c ->
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(capIcon(c.method), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(24.dp))
                                Spacer(Modifier.width(14.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(capLabel(c.method), style = MaterialTheme.typography.titleSmall)
                                    Text(
                                        c.summary,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 2,
                                    )
                                }
                                Spacer(Modifier.width(12.dp))
                                Switch(
                                    checked = !disabled.contains(c.method),
                                    onCheckedChange = { SettingsStore.setEnabled(c.method, it) },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** A labelled slider showing its current value (e.g. "Speech rate  1.2×", "Listen timeout  8s"). */
@Composable
private fun SliderRow(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    steps: Int = 14,
    format: (Float) -> String = { String.format(java.util.Locale.US, "%.1f×", it) },
    onChange: (Float) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            Text(format(value), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Slider(value = value, onValueChange = onChange, valueRange = range, steps = steps)
    }
}

/** Human-friendly name for a capability method id (raw ids never shown to the user). */
private fun capLabel(method: String): String = when (method) {
    "phone.ring" -> "Ring the phone"
    "phone.stop_ring" -> "Stop ringing"
    "camera.capture" -> "Take a photo"
    "camera.state" -> "Camera status"
    "camera.release" -> "Release camera"
    "location.get" -> "Location"
    "sms.send" -> "Send SMS"
    "notification.listen" -> "Read notifications"
    "device.info" -> "Device info"
    "torch.set" -> "Flashlight"
    "vibrate" -> "Vibrate"
    "volume.get" -> "Get volume"
    "volume.set" -> "Set volume"
    "app.launch" -> "Open an app"
    "apps.list" -> "List apps"
    "url.open" -> "Open a link"
    "notify.post" -> "Post a notification"
    "clipboard.set" -> "Set clipboard"
    "ui.tap" -> "Tap the screen"
    "ui.swipe" -> "Swipe the screen"
    "ui.text" -> "Type text"
    "ui.global" -> "Navigation"
    "ui.read" -> "Read the screen"
    "ui.screenshot" -> "Screenshot"
    else -> method.substringAfterLast('.').replace('_', ' ').replaceFirstChar { it.uppercase() }
}

/** A Material icon per capability (category-mapped); unknown -> a generic extension icon. */
private fun capIcon(method: String): ImageVector = when {
    method == "phone.ring" -> Icons.Rounded.NotificationsActive
    method == "phone.stop_ring" -> Icons.Rounded.NotificationsOff
    method.startsWith("camera") -> Icons.Rounded.PhotoCamera
    method.startsWith("location") -> Icons.Rounded.LocationOn
    method == "sms.send" -> Icons.Rounded.Sms
    method.startsWith("notif") -> Icons.Rounded.Notifications
    method == "device.info" -> Icons.Rounded.PhoneAndroid
    method.startsWith("torch") -> Icons.Rounded.FlashlightOn
    method == "vibrate" -> Icons.Rounded.Vibration
    method.startsWith("volume") -> Icons.AutoMirrored.Rounded.VolumeUp
    method.startsWith("app") -> Icons.Rounded.Apps
    method == "url.open" -> Icons.Rounded.Link
    method == "clipboard.set" -> Icons.Rounded.ContentPaste
    method == "ui.tap" -> Icons.Rounded.TouchApp
    method == "ui.swipe" -> Icons.Rounded.Swipe
    method == "ui.text" -> Icons.Rounded.Keyboard
    method == "ui.global" -> Icons.Rounded.Navigation
    method == "ui.read" -> Icons.Rounded.Visibility
    method == "ui.screenshot" -> Icons.Rounded.Screenshot
    else -> Icons.Rounded.Extension
}

/** A round multi-color swatch + label for picking a color theme; a ring marks the selected one. */
@Composable
private fun ThemeSwatch(theme: AppTheme, selected: Boolean, onClick: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.clickable(onClick = onClick).padding(vertical = 4.dp),
    ) {
        Box(
            Modifier.size(56.dp).clip(CircleShape)
                .border(
                    width = if (selected) 3.dp else 1.dp,
                    color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline.copy(alpha = 0.4f),
                    shape = CircleShape,
                ),
        ) {
            Row(Modifier.fillMaxSize()) {
                theme.swatch.forEach { c -> Box(Modifier.weight(1f).fillMaxHeight().background(c)) }
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(
            theme.label,
            style = MaterialTheme.typography.labelMedium,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp),
    )
}
