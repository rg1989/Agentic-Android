package com.agenticandroid

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * BusEndpoint — Kotlin mirror of backbone/src/peer.ts. Relay client owning the handshake, E2E
 * encrypt/decrypt, request/response correlation, events, and blobs. UNVERIFIED here (no toolchain).
 */
class BusEndpoint(
    private val self: Identity,
    private val peerEdPub: String,
    private val relayUrl: String,
    private val requestTimeoutMs: Long = 30_000,
) {
    private val peerFp = Crypto.fingerprint(peerEdPub)
    private val http = OkHttpClient()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val pending = ConcurrentHashMap<String, CompletableDeferred<Inner.Response>>()
    private val seq = AtomicInteger(0)
    private var ws: WebSocket? = null
    private var connectDone: CompletableDeferred<Unit>? = null

    /** Phone side handles inbound requests (capability dispatch). Returns result or typed error. */
    var onRequest: (suspend (Inner.Request, String) -> CapResult)? = null
    var onEvent: ((Inner.Event) -> Unit)? = null

    private fun newId(): String = "m_${System.currentTimeMillis().toString(36)}_${seq.incrementAndGet().toString(36)}"

    suspend fun connect() {
        val done = CompletableDeferred<Unit>()
        connectDone = done
        val req = Request.Builder().url(relayUrl.replaceFirst("http", "ws")).build()
        ws = http.newWebSocket(req, Listener())
        withTimeout(15_000) { done.await() }
    }

    fun close() {
        ws?.close(1000, null)
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            webSocket.send(Json.encodeToString(JsonObject.serializer(), buildJsonObject {
                put("ctl", "hello"); put("fp", self.fp); put("edpub", self.edPub)
            }))
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            // Surface the real error (cleartext blocked, host unreachable, refused) instead of a
            // silent 15s timeout. No-op if connect already succeeded.
            connectDone?.completeExceptionally(t)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val obj = ProtocolJson.parseToJsonElement(text)
            val map = (obj as? JsonObject) ?: return
            val ctl = map["ctl"]?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
            if (ctl != null) {
                when (ctl) {
                    "challenge" -> {
                        val nonce = (map["nonce"] as kotlinx.serialization.json.JsonPrimitive).content
                        webSocket.send(Json.encodeToString(JsonObject.serializer(), buildJsonObject {
                            put("ctl", "auth"); put("sig", Crypto.sign(self.edSec, nonce.toByteArray()))
                        }))
                    }
                    "welcome" -> connectDone?.complete(Unit)
                    "error" -> connectDone?.completeExceptionally(
                        IllegalStateException((map["message"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: "relay error"))
                }
                return
            }
            scope.launch { onEnvelope(parseEnvelope(text)) }
        }
    }

    private suspend fun onEnvelope(env: Envelope) {
        if (env.from != peerFp) return
        val inner = runCatching { parseInner(Crypto.openString(peerEdPub, self.edSec, env.enc)) }.getOrNull() ?: return
        when (inner) {
            is Inner.Response -> pending.remove(inner.replyTo)?.complete(inner)
            is Inner.Event -> onEvent?.invoke(inner)
            is Inner.Request -> {
                val out = runCatching { onRequest?.invoke(inner, env.from) }
                    .getOrElse { CapResult(error = TypedError("HANDLER_THREW", it.message ?: "error")) }
                    ?: CapResult(error = TypedError("NO_HANDLER", "no request handler"))
                val resp = Inner.Response(
                    replyTo = env.id,
                    status = if (out.error == null) "ok" else "error",
                    result = out.result, error = out.error,
                )
                send(wrap(resp))
            }
            is Inner.Ack -> {} // ignored in v1
        }
    }

    private fun wrap(inner: Inner): Envelope = Envelope(
        id = newId(), from = self.fp, to = peerFp, ts = System.currentTimeMillis(),
        enc = Crypto.sealString(peerEdPub, self.edSec, encodeInner(inner)),
    )

    private fun send(env: Envelope) {
        ws?.send(encodeEnvelope(env)) ?: error("not connected")
    }

    suspend fun request(method: String, params: JsonObject = JsonObject(emptyMap())): Inner.Response {
        val env = wrap(Inner.Request(method, params))
        val deferred = CompletableDeferred<Inner.Response>()
        pending[env.id] = deferred
        send(env)
        return try {
            withTimeout(requestTimeoutMs) { deferred.await() }
        } finally {
            pending.remove(env.id)
        }
    }

    fun event(topic: String, data: JsonObject = JsonObject(emptyMap())) = send(wrap(Inner.Event(topic, data)))

    // ---- out-of-band blobs ----
    fun putBlob(bytes: ByteArray): String {
        val id = randomHex(16)
        val packed = Crypto.sealFor(peerEdPub, self.edSec, bytes)
        val req = Request.Builder().url("$relayUrl/blob/$id")
            .put(packed.toRequestBody("application/octet-stream".toMediaType())).build()
        http.newCall(req).execute().use { if (!it.isSuccessful) error("blob put ${it.code}") }
        return id
    }

    fun getBlob(blobId: String): ByteArray {
        val req = Request.Builder().url("$relayUrl/blob/$blobId").get().build()
        http.newCall(req).execute().use {
            if (!it.isSuccessful) error("blob get ${it.code}")
            return Crypto.openFrom(peerEdPub, self.edSec, it.body!!.string())
        }
    }

    private fun randomHex(n: Int): String {
        val b = ByteArray(n); java.security.SecureRandom().nextBytes(b)
        return b.joinToString("") { "%02x".format(it) }
    }
}
