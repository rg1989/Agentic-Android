package com.agenticandroid.automation

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.CompletableDeferred

/**
 * Tier-2 computer-use (DESIGN Q "next milestone"). When the user enables this in
 * Settings > Accessibility (or via adb), it lets the agent drive the phone like a person:
 * tap/swipe gestures, text input, global actions, reading the screen, and screenshots.
 *
 * The instance is exposed statically so the ui.* capabilities can reach it; null = not enabled.
 */
class AgentAccessibilityService : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) { /* not observing events in v1 */ }
    override fun onInterrupt() {}
    override fun onServiceConnected() { instance = this }
    override fun onDestroy() { if (instance === this) instance = null; super.onDestroy() }

    fun tap(x: Float, y: Float): Boolean {
        val path = Path().apply { moveTo(x, y) }
        val g = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, 60)).build()
        return dispatchGesture(g, null, null)
    }

    fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, ms: Long): Boolean {
        val path = Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
        val g = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, ms.coerceIn(20, 5000))).build()
        return dispatchGesture(g, null, null)
    }

    fun global(action: String): Boolean {
        val code = when (action.lowercase()) {
            "back" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recents" -> GLOBAL_ACTION_RECENTS
            "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
            "quicksettings" -> GLOBAL_ACTION_QUICK_SETTINGS
            else -> return false
        }
        return performGlobalAction(code)
    }

    /** Type into the currently-focused editable field. */
    fun inputText(text: String): Boolean {
        val node = findFocusedEditable(rootInActiveWindow) ?: return false
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    private fun findFocusedEditable(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isEditable && node.isFocused) return node
        for (i in 0 until node.childCount) findFocusedEditable(node.getChild(i))?.let { return it }
        return null
    }

    /** Flat list of visible, meaningful nodes: text/description, class, clickable, on-screen bounds. */
    fun readScreen(max: Int = 120): List<Map<String, Any>> {
        val out = ArrayList<Map<String, Any>>()
        fun walk(n: AccessibilityNodeInfo?) {
            if (n == null || out.size >= max) return
            val t = n.text?.toString(); val d = n.contentDescription?.toString()
            if (!t.isNullOrBlank() || !d.isNullOrBlank() || n.isClickable) {
                val r = android.graphics.Rect(); n.getBoundsInScreen(r)
                out.add(linkedMapOf(
                    "text" to (t ?: ""), "desc" to (d ?: ""),
                    "class" to (n.className?.toString() ?: ""),
                    "clickable" to n.isClickable, "editable" to n.isEditable,
                    "cx" to r.centerX(), "cy" to r.centerY(),
                ))
            }
            for (i in 0 until n.childCount) walk(n.getChild(i))
        }
        walk(rootInActiveWindow)
        return out
    }

    /** Capture the current screen as a Bitmap (API 30+). */
    suspend fun screenshotBitmap(): Bitmap {
        if (Build.VERSION.SDK_INT < 30) error("screenshot requires Android 11+")
        val done = CompletableDeferred<Bitmap>()
        takeScreenshot(android.view.Display.DEFAULT_DISPLAY, mainExecutor, object : TakeScreenshotCallback {
            override fun onSuccess(result: ScreenshotResult) {
                try {
                    val hb = result.hardwareBuffer
                    val bmp = Bitmap.wrapHardwareBuffer(hb, result.colorSpace)
                        ?: error("could not wrap screenshot buffer")
                    val copy = bmp.copy(Bitmap.Config.ARGB_8888, false)
                    hb.close()
                    done.complete(copy)
                } catch (e: Exception) { done.completeExceptionally(e) }
            }
            override fun onFailure(errorCode: Int) { done.completeExceptionally(IllegalStateException("screenshot failed: $errorCode")) }
        })
        return done.await()
    }

    companion object {
        @Volatile var instance: AgentAccessibilityService? = null
    }
}
