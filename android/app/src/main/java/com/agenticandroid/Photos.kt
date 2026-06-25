package com.agenticandroid

import android.content.ContentValues
import android.content.Context
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import java.io.File

/**
 * Where photos the agent takes go on the phone: the user's gallery (DCIM/Agentic Android, so they show
 * up in Photos / Gallery) AND a local copy the chat renders as an inline preview. No storage permission
 * needed on API 29+ (scoped storage). The gallery write uses the IS_PENDING flow OEM galleries expect.
 */
object Photos {
    private const val TAG = "Photos"
    private const val ALBUM = "Agentic Android"

    /** Save a JPEG to the gallery + a local preview copy. Returns the local path for the chat, or null. */
    fun save(context: Context, jpeg: ByteArray, name: String): String? {
        saveToGallery(context, jpeg, name)
        return saveLocalPreview(context, jpeg, name)
    }

    private fun saveToGallery(context: Context, jpeg: ByteArray, name: String): Boolean = try {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "$name.jpg")
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_DCIM + "/" + ALBUM)
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            ?: error("MediaStore insert returned null")
        resolver.openOutputStream(uri)?.use { it.write(jpeg); it.flush() }
            ?: error("openOutputStream returned null")
        // mark complete so the gallery indexes + shows it
        values.clear()
        values.put(MediaStore.Images.Media.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
        Log.i(TAG, "saved to gallery: $uri")
        true
    } catch (e: Exception) {
        Log.e(TAG, "gallery save failed", e)
        false
    }

    private fun saveLocalPreview(context: Context, jpeg: ByteArray, name: String): String? =
        runCatching {
            val dir = File(context.filesDir, "photos").apply { mkdirs() }
            val file = File(dir, "$name.jpg")
            file.writeBytes(jpeg)
            file.absolutePath
        }.getOrNull()
}
