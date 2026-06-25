package com.agenticandroid

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import org.vosk.android.StorageService

/**
 * Always-on wake word (Phase 3), fully offline via Vosk. Listens continuously for the wake phrase
 * (default "hey agent"); on hearing it, takes the rest of the utterance — or the next one — as a
 * command and sends it to the agent through [PhoneAgentService]. Runs as a microphone foreground
 * service so it survives backgrounding.
 *
 * Half-duplex: ignores results while a spoken reply is playing (so it doesn't hear the agent), and
 * is paused by [pause]/[resume] while hold-to-talk owns the mic.
 *
 * The "speak the phrase and it triggers" behaviour is hardware/voice-dependent — the parsing is
 * unit-tested ([WakePhrase]); the model-load + listen path logs to the "WakeWord" tag.
 */
class WakeWordService : Service(), RecognitionListener {
    private var model: Model? = null
    private var speech: SpeechService? = null
    private var awaitingCommand = false
    private var lastWakeAt = 0L
    private val chimes by lazy { Chimes() }

    override fun onCreate() {
        super.onCreate()
        instance = this
        SettingsStore.init(this)
        startForeground(NOTIF_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        StorageService.unpack(
            this, MODEL_ASSET, "model",
            { m -> model = m; startRecognition() },
            { e -> android.util.Log.e(TAG, "vosk model unpack failed", e) },
        )
    }

    private fun startRecognition() {
        val m = model ?: return
        try {
            val rec = Recognizer(m, 16000.0f)
            speech = SpeechService(rec, 16000.0f).also { it.startListening(this) }
            android.util.Log.i(TAG, "listening for wake phrase \"${SettingsStore.wakePhrase.value}\"")
        } catch (e: Exception) {
            android.util.Log.e(TAG, "startRecognition failed", e)
        }
    }

    /** Pause/resume listening — used while hold-to-talk owns the mic. */
    fun pause() { runCatching { speech?.setPause(true) } }
    fun resume() { runCatching { speech?.setPause(false) } }

    override fun onResult(hypothesis: String?) {
        val text = textOf(hypothesis)
        if (text.isBlank()) return
        if (PhoneAgentService.speaking.value) return            // don't react to the agent's own voice
        if (PhoneAgentService.instance?.micMuted == true) return // hard mute

        val now = System.currentTimeMillis()
        if (awaitingCommand && now - lastWakeAt < CAPTURE_WINDOW_MS) {
            awaitingCommand = false
            dispatch(text) // a follow-up utterance after a bare wake phrase
            return
        }

        val cmd = WakePhrase.extract(text, SettingsStore.wakePhrase.value) ?: return
        if (cmd.isNotBlank()) {
            dispatch(cmd) // "hey agent <command>" in one breath
        } else {
            // Heard the wake phrase alone — chime and capture the next utterance as the command.
            awaitingCommand = true
            lastWakeAt = now
            chimes.listening()
            PhoneAgentService.instance?.setStatus("🎙️ Listening…")
        }
    }

    private fun dispatch(command: String) {
        val c = command.trim()
        if (c.isEmpty()) return
        android.util.Log.i(TAG, "wake → command: $c")
        chimes.sent()
        PhoneAgentService.instance?.sendUserMessage(c)
    }

    override fun onPartialResult(hypothesis: String?) {}
    override fun onFinalResult(hypothesis: String?) {}
    override fun onError(e: Exception?) { android.util.Log.e(TAG, "vosk error", e) }
    override fun onTimeout() {}

    private fun textOf(h: String?): String =
        runCatching { JSONObject(h ?: "{}").optString("text", "") }.getOrDefault("")

    override fun onDestroy() {
        if (instance === this) instance = null
        runCatching { speech?.stop(); speech?.shutdown() }
        speech = null
        runCatching { model?.close() }
        model = null
        chimes.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    private fun buildNotification(): Notification {
        val ch = "wake"
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(ch, "Wake word", NotificationManager.IMPORTANCE_MIN),
        )
        return Notification.Builder(this, ch)
            .setContentTitle("Listening for \"${SettingsStore.wakePhrase.value}\"")
            .setContentText("Say it to talk to your agent hands-free.")
            .setSmallIcon(R.drawable.ic_agent_notification)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val TAG = "WakeWord"
        private const val NOTIF_ID = 2
        const val MODEL_ASSET = "vosk-model-small-en-us-0.15"
        private const val CAPTURE_WINDOW_MS = 8000L
        @Volatile var instance: WakeWordService? = null
        fun start(ctx: Context) { ctx.startForegroundService(Intent(ctx, WakeWordService::class.java)) }
        fun stop(ctx: Context) { ctx.stopService(Intent(ctx, WakeWordService::class.java)) }
    }
}
