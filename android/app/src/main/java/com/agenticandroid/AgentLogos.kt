package com.agenticandroid

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Cloud
import androidx.compose.material.icons.rounded.SmartToy
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Matches the hub's web picker: a uniform dark app-icon badge with a brand mark. Real logos for Claude
// (drawable) and Cursor (drawable); π / H monograms for omp / Hermes, which have no canonical logo.
private val LogoBg = Color(0xFF1B1D24)

/** Brand mark inferred from the harness display name — the phone roster carries no `kind`, and the
 *  managed presets are named Claude/omp/Cursor while Hermes is the common external. Anything else
 *  (user-named "other" CLIs, unknown externals) falls back to a neutral local/cloud glyph. */
private fun agentLogoKind(name: String): String {
    val n = name.lowercase()
    return when {
        n.contains("claude") -> "claude"
        n.contains("cursor") -> "cursor"
        n.contains("omp") || n.contains("oh my pi") -> "omp"
        n.contains("hermes") -> "hermes"
        else -> "other"
    }
}

/** Small harness logo for the in-app picker. `fallbackTint` carries the hub's verdict colour (red/amber)
 *  for the neutral glyph used when the brand isn't recognised. */
@Composable
fun AgentLogo(name: String, external: Boolean, fallbackTint: Color, modifier: Modifier = Modifier) {
    Box(
        modifier.size(22.dp).clip(RoundedCornerShape(5.dp)).background(LogoBg),
        contentAlignment = Alignment.Center,
    ) {
        when (agentLogoKind(name)) {
            "claude" -> Image(painterResource(R.drawable.ic_agent_claude), contentDescription = null, modifier = Modifier.size(14.dp))
            "cursor" -> Image(painterResource(R.drawable.ic_agent_cursor), contentDescription = null, modifier = Modifier.size(13.dp))
            "omp" -> Text("π", color = Color(0xFF2DD4BF), fontSize = 13.sp, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold)
            "hermes" -> Text("H", color = Color(0xFF818CF8), fontSize = 12.sp, fontWeight = FontWeight.Bold)
            else -> Icon(
                if (external) Icons.Rounded.Cloud else Icons.Rounded.SmartToy,
                contentDescription = null, tint = fallbackTint, modifier = Modifier.size(14.dp),
            )
        }
    }
}
