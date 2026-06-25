package com.agenticandroid

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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

/** Proper settings page: theme (system/light/dark) and which actions the agent is allowed to use. */
class SettingsActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        SettingsStore.init(this)
        setContent {
            AgentTheme {
                val theme by SettingsStore.theme.collectAsState()
                val disabled by SettingsStore.disabledCaps.collectAsState()
                val chimes by SettingsStore.chimes.collectAsState()
                val voiceReplies by SettingsStore.voiceReplies.collectAsState()
                val caps by PhoneAgentService.capabilities.collectAsState()

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
