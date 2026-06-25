package com.agenticandroid

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.agenticandroid.pairing.PairingActivity

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
                val disabled by SettingsStore.disabledCaps.collectAsState()
                val chimes by SettingsStore.chimes.collectAsState()
                val voiceReplies by SettingsStore.voiceReplies.collectAsState()
                val wakeWord by SettingsStore.wakeWord.collectAsState()
                val wakePhrase by SettingsStore.wakePhrase.collectAsState()
                val caps by PhoneAgentService.capabilities.collectAsState()
                val profiles by Agents.profiles.collectAsState()
                val activeId by Agents.activeId.collectAsState()

                Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
                    Row(
                        Modifier.fillMaxWidth().padding(start = 4.dp, end = 14.dp, top = 4.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TextButton(onClick = { finish() }) { Text("‹ Back") }
                        Text("Settings", style = MaterialTheme.typography.titleMedium)
                    }
                    HorizontalDivider()

                    LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                        item {
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
                                        Text(
                                            p.relayUrl,
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
                                Text("＋  Pair another agent", color = MaterialTheme.colorScheme.primary)
                            }
                            HorizontalDivider()
                            SectionLabel("Theme")
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
                            HorizontalDivider()
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
                                OutlinedTextField(
                                    value = wakePhrase,
                                    onValueChange = { SettingsStore.setWakePhrase(it) },
                                    label = { Text("Wake phrase") },
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                                )
                            }
                            HorizontalDivider()
                            SectionLabel("Actions the agent can use")
                            if (caps.isEmpty()) {
                                Text(
                                    "Connect to your agent to load its actions.",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(16.dp),
                                )
                            }
                        }
                        items(caps) { c ->
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(c.method, style = MaterialTheme.typography.titleSmall)
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

@Composable
private fun SectionLabel(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp),
    )
}
