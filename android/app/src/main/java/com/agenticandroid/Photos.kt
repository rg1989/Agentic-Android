package com.agenticandroid

import android.content.ContentValues
import android.content.Context
import android.os.Environment
import android.provider.MediaStore
import java.io.File

/**
 * Where photos the agent takes go: the user's gallery (so they show up in Photos / Gallery) AND a
 * local copy the chat renders as an inline preview. No storage permission needed on API 29+ (scoped
 * storage via MediaStore RELATIVE_PATH).
 */
object Photos {
    /** Save a JPEG to the gallery + a local preview copy. Returns the local path for the chat, or null. */
    fun save(context: Context, jpeg: ByteArray, name: String): String? {
        saveToGallery(context, jpeg, name)
        return saveLocalPreview(context, jpeg, name)
    }

    private fun saveToGallery(context: Context, jpeg: ByteArray, name: String) {
        runCatching {
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, "$name.jpg")
                put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Agentic Android")
            }
            val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: return
            context.contentResolver.openOutputStream(uri)?.use { it.write(jpeg) }
        }
    }

    private fun saveLocalPreview(context: Context, jpeg: ByteArray, name: String): String? =
        runCatching {
            val dir = File(context.filesDir, "photos").apply { mkdirs() }
            val file = File(dir, "$name.jpg")
            file.writeBytes(jpeg)
            file.absolutePath
        }.getOrNull()
}
