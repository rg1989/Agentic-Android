package com.agenticandroid

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle

/**
 * A deliberately small markdown → styled-text renderer for chat bubbles: headings, **bold**,
 * *italic* / _italic_, `inline code`, fenced ``` code blocks, - bullets, and [links](url). Not a full
 * CommonMark implementation — just the subset agents actually emit, with no new dependency. The TTS
 * pass still strips all of this (it speaks the raw text). Pure → unit-tested on its plain output.
 */
object Markdown {
    private val inline = Regex("`([^`]+)`|\\*\\*([^*]+)\\*\\*|\\*([^*]+)\\*|_([^_]+)_|\\[([^\\]]+)\\]\\(([^)]+)\\)")

    fun toAnnotated(md: String, codeColor: Color = Color.Unspecified, linkColor: Color = Color.Unspecified): AnnotatedString =
        buildAnnotatedString {
            val lines = md.replace("\r\n", "\n").split("\n")
            var inFence = false
            var first = true
            for (line in lines) {
                if (line.trimStart().startsWith("```")) { inFence = !inFence; continue }
                if (!first) append("\n")
                first = false
                if (inFence) {
                    withStyle(SpanStyle(fontFamily = FontFamily.Monospace, color = codeColor)) { append(line) }
                    continue
                }
                val heading = Regex("^(#{1,6})\\s+(.*)$").find(line.trimStart())
                if (heading != null) {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { appendInline(heading.groupValues[2], codeColor, linkColor) }
                    continue
                }
                val bullet = Regex("^\\s*[-*]\\s+(.*)$").find(line)
                if (bullet != null) {
                    append("•  ")
                    appendInline(bullet.groupValues[1], codeColor, linkColor)
                    continue
                }
                appendInline(line, codeColor, linkColor)
            }
        }

    private fun AnnotatedString.Builder.appendInline(text: String, codeColor: Color, linkColor: Color) {
        var i = 0
        for (m in inline.findAll(text)) {
            if (m.range.first > i) append(text.substring(i, m.range.first))
            val (code, bold, ital1, ital2, link) = m.destructured // groups 1..5 (url is group 6)
            when {
                code.isNotEmpty() -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, color = codeColor)) { append(code) }
                bold.isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(bold) }
                ital1.isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(ital1) }
                ital2.isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(ital2) }
                link.isNotEmpty() -> withStyle(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline)) { append(link) }
            }
            i = m.range.last + 1
        }
        if (i < text.length) append(text.substring(i))
    }
}
