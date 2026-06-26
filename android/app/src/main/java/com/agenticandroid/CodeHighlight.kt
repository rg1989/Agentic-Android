package com.agenticandroid

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle

/** How a file should be previewed. */
enum class PreviewKind { IMAGE, MARKDOWN, JSON, XML, CODE, TEXT, NONE }

private val IMAGE_EXT = setOf("jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif", "ico")
private val CODE_EXT = setOf(
    "js", "mjs", "cjs", "ts", "tsx", "jsx", "kt", "kts", "java", "py", "sh", "bash", "zsh", "c", "h",
    "cpp", "cc", "hpp", "cs", "go", "rs", "rb", "php", "swift", "scala", "sql", "gradle", "groovy",
    "dart", "lua", "r", "pl", "ps1", "vue",
)
private val TEXT_EXT = setOf(
    "txt", "log", "csv", "tsv", "ini", "conf", "cfg", "properties", "env", "toml", "yml", "yaml", "lock",
)

/** Pick the preview mode from mime + filename (filename wins; mime is the fallback). */
fun previewKind(mime: String?, name: String): PreviewKind {
    val ext = name.substringAfterLast('.', "").lowercase()
    return when {
        mime?.startsWith("image/") == true || ext in IMAGE_EXT -> PreviewKind.IMAGE
        ext == "md" || ext == "markdown" -> PreviewKind.MARKDOWN
        ext == "json" || ext == "jsonl" || mime == "application/json" -> PreviewKind.JSON
        ext in setOf("xml", "html", "htm", "svg", "plist", "xhtml") || mime?.contains("xml") == true || mime == "text/html" -> PreviewKind.XML
        ext in CODE_EXT -> PreviewKind.CODE
        ext in TEXT_EXT || mime?.startsWith("text/") == true -> PreviewKind.TEXT
        mime == null && ext.isEmpty() -> PreviewKind.TEXT // unknown blob: try as text
        else -> PreviewKind.NONE
    }
}

/** Token classes the highlighter emits. */
enum class Tok { BASE, KEYWORD, STRING, NUMBER, COMMENT, LITERAL, KEY, TAG, ATTR, PUNCT }

/** A contiguous run of [start, end) coloured as [tok]. The full list covers the whole text, no gaps. */
data class Span(val start: Int, val end: Int, val tok: Tok)

// A broad, multi-language keyword set — enough to read like a colored editor across the common
// languages. ponytail: a shared superset, not per-grammar; swap in a real grammar lib if a language
// needs precise keywords. Strings/comments/numbers are tokenized structurally, so only word-coloring
// is approximate.
private val KEYWORDS = setOf(
    "abstract", "and", "as", "assert", "async", "await", "begin", "bool", "boolean", "break", "byte",
    "case", "catch", "char", "class", "companion", "const", "constructor", "continue", "data", "def",
    "default", "del", "do", "double", "elif", "else", "end", "enum", "export", "extends", "final",
    "finally", "float", "fn", "for", "from", "fun", "func", "function", "global", "goto", "if", "impl",
    "implements", "import", "in", "init", "int", "interface", "internal", "is", "lambda", "lateinit",
    "let", "local", "long", "module", "mut", "namespace", "new", "not", "object", "open", "operator",
    "or", "override", "package", "pass", "print", "private", "protected", "public", "raise", "return",
    "sealed", "self", "short", "signed", "sizeof", "static", "struct", "super", "suspend", "switch",
    "template", "then", "this", "throw", "throws", "trait", "try", "type", "typedef", "typeof", "union",
    "unsigned", "use", "using", "val", "var", "virtual", "void", "volatile", "when", "where", "while",
    "with", "yield",
)

private val LITERALS = setOf("true", "false", "null", "nil", "none", "undefined", "nan", "inf")

object Code {
    /** Tokenize [text] for [kind] into full-coverage spans. Pure (no Android/Compose) so it's testable. */
    fun tokenize(text: String, kind: PreviewKind): List<Span> = when (kind) {
        PreviewKind.XML -> tokenizeXml(text)
        PreviewKind.JSON -> tokenizeCode(text, json = true)
        PreviewKind.CODE -> tokenizeCode(text, json = false)
        else -> if (text.isEmpty()) emptyList() else listOf(Span(0, text.length, Tok.BASE))
    }

    private fun tokenizeCode(text: String, json: Boolean): List<Span> {
        val out = ArrayList<Span>()
        val n = text.length
        var i = 0
        var baseStart = 0
        fun flushBase(upto: Int) { if (upto > baseStart) out.add(Span(baseStart, upto, Tok.BASE)) }
        fun emit(s: Int, e: Int, t: Tok) { flushBase(s); out.add(Span(s, e, t)); baseStart = e }
        while (i < n) {
            val ch = text[i]
            when {
                ch == '/' && i + 1 < n && text[i + 1] == '/' -> { val s = i; i += 2; while (i < n && text[i] != '\n') i++; emit(s, i, Tok.COMMENT) }
                !json && ch == '#' -> { val s = i; while (i < n && text[i] != '\n') i++; emit(s, i, Tok.COMMENT) }
                ch == '/' && i + 1 < n && text[i + 1] == '*' -> {
                    val s = i; i += 2
                    while (i < n && !(text[i] == '*' && i + 1 < n && text[i + 1] == '/')) i++
                    i = minOf(i + 2, n); emit(s, i, Tok.COMMENT)
                }
                ch == '"' || ch == '\'' || ch == '`' -> {
                    val q = ch; val s = i; i++
                    while (i < n) { val x = text[i]; if (x == '\\') { i = minOf(i + 2, n); continue }; i++; if (x == q) break }
                    var j = i; while (j < n && text[j].isWhitespace()) j++
                    emit(s, i, if (json && j < n && text[j] == ':') Tok.KEY else Tok.STRING)
                }
                ch.isDigit() -> { val s = i; while (i < n && (text[i].isLetterOrDigit() || text[i] == '.' || text[i] == '_')) i++; emit(s, i, Tok.NUMBER) }
                ch.isLetter() || ch == '_' || ch == '$' -> {
                    val s = i; while (i < n && (text[i].isLetterOrDigit() || text[i] == '_' || text[i] == '$')) i++
                    val w = text.substring(s, i)
                    when { w.lowercase() in LITERALS -> emit(s, i, Tok.LITERAL); w in KEYWORDS -> emit(s, i, Tok.KEYWORD) /* else: leave in base run */ }
                }
                ch == '{' || ch == '}' || ch == '[' || ch == ']' || ch == '(' || ch == ')' || ch == ',' || ch == ':' || ch == ';' -> { emit(i, i + 1, Tok.PUNCT); i++ }
                else -> i++
            }
        }
        flushBase(n)
        return out
    }

    private fun tokenizeXml(text: String): List<Span> {
        val out = ArrayList<Span>()
        val n = text.length
        var i = 0
        var baseStart = 0
        fun flushBase(upto: Int) { if (upto > baseStart) out.add(Span(baseStart, upto, Tok.BASE)) }
        fun emit(s: Int, e: Int, t: Tok) { flushBase(s); out.add(Span(s, e, t)); baseStart = e }
        while (i < n) {
            val ch = text[i]
            if (ch == '<' && text.startsWith("<!--", i)) {
                val s = i; i += 4; while (i < n && !text.startsWith("-->", i)) i++; i = minOf(i + 3, n); emit(s, i, Tok.COMMENT)
            } else if (ch == '<') {
                emit(i, i + 1, Tok.PUNCT); i++
                if (i < n && (text[i] == '/' || text[i] == '?' || text[i] == '!')) { emit(i, i + 1, Tok.PUNCT); i++ }
                val s = i; while (i < n && (text[i].isLetterOrDigit() || text[i] == ':' || text[i] == '-' || text[i] == '_' || text[i] == '.')) i++
                if (i > s) emit(s, i, Tok.TAG)
                while (i < n && text[i] != '>') {
                    val x = text[i]
                    when {
                        x == '"' || x == '\'' -> { val q = x; val a = i; i++; while (i < n && text[i] != q) i++; i = minOf(i + 1, n); emit(a, i, Tok.STRING) }
                        x.isLetter() || x == '_' -> { val a = i; while (i < n && (text[i].isLetterOrDigit() || text[i] == ':' || text[i] == '-' || text[i] == '_')) i++; emit(a, i, Tok.ATTR) }
                        x == '/' || x == '?' || x == '=' -> { emit(i, i + 1, Tok.PUNCT); i++ }
                        else -> i++
                    }
                }
                if (i < n && text[i] == '>') { emit(i, i + 1, Tok.PUNCT); i++ }
            } else i++
        }
        flushBase(n)
        return out
    }
}

/** Editor token palette, light or dark to match the preview surface. */
data class TokenColors(
    val base: Color, val keyword: Color, val string: Color, val number: Color, val comment: Color,
    val literal: Color, val key: Color, val tag: Color, val attr: Color, val punct: Color,
)

@Composable
fun rememberTokenColors(): TokenColors {
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    return remember(dark) {
        if (dark) TokenColors( // VS Code "Dark+"
            base = Color(0xFFD4D4D4), keyword = Color(0xFFC586C0), string = Color(0xFFCE9178),
            number = Color(0xFFB5CEA8), comment = Color(0xFF6A9955), literal = Color(0xFF569CD6),
            key = Color(0xFF9CDCFE), tag = Color(0xFF569CD6), attr = Color(0xFF9CDCFE), punct = Color(0xFF808080),
        ) else TokenColors( // GitHub light
            base = Color(0xFF24292E), keyword = Color(0xFFCF222E), string = Color(0xFF0A3069),
            number = Color(0xFF0550AE), comment = Color(0xFF6E7781), literal = Color(0xFF0550AE),
            key = Color(0xFF0550AE), tag = Color(0xFF116329), attr = Color(0xFF6F42C1), punct = Color(0xFF6E7781),
        )
    }
}

/** Build a colored AnnotatedString for [text]. Falls back to plain for very large files (keeps it smooth). */
@Composable
fun highlighted(text: String, kind: PreviewKind, colors: TokenColors): AnnotatedString =
    remember(text, kind, colors) {
        if (text.length > 60_000) return@remember AnnotatedString(text)
        buildAnnotatedString {
            for (sp in Code.tokenize(text, kind)) {
                val col = when (sp.tok) {
                    Tok.BASE -> colors.base; Tok.KEYWORD -> colors.keyword; Tok.STRING -> colors.string
                    Tok.NUMBER -> colors.number; Tok.COMMENT -> colors.comment; Tok.LITERAL -> colors.literal
                    Tok.KEY -> colors.key; Tok.TAG -> colors.tag; Tok.ATTR -> colors.attr; Tok.PUNCT -> colors.punct
                }
                withStyle(SpanStyle(color = col)) { append(text.substring(sp.start, sp.end)) }
            }
        }
    }
