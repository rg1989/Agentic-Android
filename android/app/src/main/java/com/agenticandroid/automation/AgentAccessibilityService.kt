package com.agenticandroid.automation

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Tier-2 computer-use (DESIGN Q "next milestone"). When the user enables this in
 * Settings > Accessibility (or via adb), it lets the agent drive the phone like a person:
 * tap/swipe gestures, text input, global actions, reading the screen, and screenshots.
 *
 * The instance is exposed statically so the ui.* capabilities can reach it; null = not enabled.
 */
class AgentAccessibilityService : AccessibilityService() {
    /** Foreground app package, tracked from window-state changes (powers foreground.app, no extra perm). */
    @Volatile var foregroundPackage: String? = null
        private set

    private class Waiter(val predicate: () -> Boolean, val deferred: CompletableDeferred<Boolean>)
    private val waiters = CopyOnWriteArrayList<Waiter>()

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED)
            event.packageName?.let { foregroundPackage = it.toString() }
        // Re-check any pending ui.wait predicates on every event (window/content change).
        for (w in waiters) {
            if (runCatching { w.predicate() }.getOrDefault(false)) {
                w.deferred.complete(true); waiters.remove(w)
            }
        }
    }
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

    /** Long-press at a point (gesture held ~600ms). */
    fun longPress(x: Float, y: Float, ms: Long = 600): Boolean {
        val path = Path().apply { moveTo(x, y) }
        val g = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, ms.coerceIn(400, 5000))).build()
        return dispatchGesture(g, null, null)
    }

    /** Find nodes by visible text (substring) or fully-qualified view id ("pkg:id/name"). */
    fun findNodes(text: String?, viewId: String?, max: Int = 50): List<AccessibilityNodeInfo> {
        val root = rootInActiveWindow ?: return emptyList()
        val hits = when {
            !viewId.isNullOrBlank() -> root.findAccessibilityNodeInfosByViewId(viewId)
            !text.isNullOrBlank()   -> root.findAccessibilityNodeInfosByText(text)
            else -> null
        } ?: return emptyList()
        return hits.filterNotNull().take(max)
    }

    /** Serialize a node for the agent: text/desc/class/id/flags + on-screen bounds. */
    fun describe(n: AccessibilityNodeInfo): Map<String, Any> {
        val r = Rect(); n.getBoundsInScreen(r)
        return linkedMapOf(
            "text" to (n.text?.toString() ?: ""), "desc" to (n.contentDescription?.toString() ?: ""),
            "class" to (n.className?.toString() ?: ""), "id" to (n.viewIdResourceName ?: ""),
            "clickable" to n.isClickable, "editable" to n.isEditable, "scrollable" to n.isScrollable,
            "checked" to n.isChecked, "enabled" to n.isEnabled,
            "cx" to r.centerX(), "cy" to r.centerY(),
            "l" to r.left, "t" to r.top, "r" to r.right, "b" to r.bottom,
        )
    }

    /** Climb to the nearest clickable ancestor (Android marks the row clickable, not the inner text). */
    private fun clickable(n: AccessibilityNodeInfo): AccessibilityNodeInfo {
        var c: AccessibilityNodeInfo? = n
        while (c != null) { if (c.isClickable) return c; c = c.parent }
        return n
    }

    /** Perform a semantic action on the first node matching text/id. value used for set_text. */
    fun nodeAction(text: String?, viewId: String?, action: String, value: String?): Boolean {
        val node = findNodes(text, viewId, 1).firstOrNull() ?: return false
        return when (action.lowercase()) {
            "click", "tap"           -> clickable(node).performAction(AccessibilityNodeInfo.ACTION_CLICK)
            "long_click", "long_press" -> clickable(node).performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK)
            "set_text" -> node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value ?: "")
            })
            "focus"    -> node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
            "expand"   -> node.performAction(AccessibilityNodeInfo.ACTION_EXPAND)
            "collapse" -> node.performAction(AccessibilityNodeInfo.ACTION_COLLAPSE)
            "dismiss"  -> node.performAction(AccessibilityNodeInfo.ACTION_DISMISS)
            else -> false
        }
    }

    private fun firstScrollable(n: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (n == null) return null
        if (n.isScrollable) return n
        for (i in 0 until n.childCount) firstScrollable(n.getChild(i))?.let { return it }
        return null
    }

    /** Scroll the first scrollable container forward/backward. */
    fun scroll(forward: Boolean): Boolean {
        val node = firstScrollable(rootInActiveWindow) ?: return false
        val action = if (forward) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        return node.performAction(action)
    }

    /** Scroll forward until a node with [text] appears (or maxScrolls exhausted / no progress). */
    suspend fun scrollUntil(text: String, maxScrolls: Int = 15): Boolean {
        repeat(maxScrolls) {
            if (findNodes(text, null, 1).isNotEmpty()) return true
            if (!scroll(true)) return findNodes(text, null, 1).isNotEmpty()
            delay(350)  // suspends (cancellable) rather than blocking the dispatcher thread
        }
        return findNodes(text, null, 1).isNotEmpty()
    }

    /** Block until [predicate] holds (re-checked on each accessibility event) or timeout. */
    suspend fun waitFor(timeoutMs: Long, predicate: () -> Boolean): Boolean {
        val d = CompletableDeferred<Boolean>()
        val w = Waiter(predicate, d); waiters.add(w)
        // Register the waiter BEFORE the eager check so a transition in the gap can't be missed.
        return try {
            if (runCatching { predicate() }.getOrDefault(false)) true
            else withTimeoutOrNull(timeoutMs) { d.await() } ?: false
        } finally { waiters.remove(w) }
    }

    /** Extended performGlobalAction set beyond ui.global. Returns false if unsupported on this API level. */
    fun systemAction(action: String): Boolean {
        val code = when (action.lowercase()) {
            "power_dialog"          -> GLOBAL_ACTION_POWER_DIALOG
            "lock_screen"           -> if (Build.VERSION.SDK_INT >= 28) GLOBAL_ACTION_LOCK_SCREEN else return false
            "screenshot"            -> if (Build.VERSION.SDK_INT >= 28) GLOBAL_ACTION_TAKE_SCREENSHOT else return false
            "split_screen"          -> if (Build.VERSION.SDK_INT >= 24) GLOBAL_ACTION_TOGGLE_SPLIT_SCREEN else return false
            "dismiss_notifications" -> if (Build.VERSION.SDK_INT >= 31) GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE else return false
            else -> return false
        }
        return performGlobalAction(code)
    }

    companion object {
        @Volatile var instance: AgentAccessibilityService? = null
    }
}
