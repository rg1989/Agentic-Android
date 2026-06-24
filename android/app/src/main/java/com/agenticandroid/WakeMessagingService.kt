package com.agenticandroid

import android.content.Intent
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * FCM doorbell (Q2). When the relay has a queued message for this (offline/dozing) phone, it sends a
 * data push; we wake the foreground service so it reconnects and drains the queue.
 *
 * TODO: on onNewToken, register the token with YOUR relay so it can target this device.
 */
class WakeMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val intent = Intent(this, PhoneAgentService::class.java)
        startForegroundService(intent) // wakes + reconnects (START_STICKY ensureConnected)
    }

    override fun onNewToken(token: String) {
        // TODO: POST token to relay, associated with this device fingerprint, so it can push wakes.
    }
}
