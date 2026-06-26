package com.agenticandroid

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * A typed part of a rich assistant reply (Phase 6). Mirrors the backbone wire shape in parts.ts.
 * A message always has plain `text` (spoken / fallback); `parts` is the optional rich render.
 */
sealed class MsgPart {
    data class Text(val text: String, val markdown: Boolean) : MsgPart()
    data class ImageRef(val blobId: String, val mime: String?, val alt: String?) : MsgPart()
    data class FileRef(val blobId: String, val name: String, val mime: String?, val size: Long?) : MsgPart()
    data class Table(val columns: List<String>, val rows: List<List<String>>) : MsgPart()

    companion object {
        private fun str(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.content

        fun parse(arr: JsonArray?): List<MsgPart> = arr.orEmpty().mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            when (str(o, "kind")) {
                "text" -> Text(str(o, "text") ?: "", markdown = false)
                "markdown" -> Text(str(o, "text") ?: "", markdown = true)
                "image" -> str(o, "blobId")?.let { ImageRef(it, str(o, "mime"), str(o, "alt")) }
                "file" -> {
                    val id = str(o, "blobId") ?: return@mapNotNull null
                    FileRef(id, str(o, "name") ?: "file", str(o, "mime"), str(o, "size")?.toLongOrNull())
                }
                "table" -> {
                    val cols = (o["columns"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
                    val rows = (o["rows"] as? JsonArray)?.map { row ->
                        (row as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
                    } ?: emptyList()
                    Table(cols, rows)
                }
                else -> null
            }
        }

        /** What TTS should speak: text/markdown read out; non-text parts get a short spoken stand-in. */
        fun spoken(parts: List<MsgPart>, fallback: String): String {
            if (parts.isEmpty()) return fallback
            val s = parts.joinToString(" ") { p ->
                when (p) {
                    is Text -> p.text
                    is ImageRef -> "(an image)"
                    is FileRef -> "(a file: ${p.name})"
                    is Table -> "(a table with ${p.rows.size} rows)"
                }
            }.trim()
            return s.ifBlank { fallback }
        }
    }
}
