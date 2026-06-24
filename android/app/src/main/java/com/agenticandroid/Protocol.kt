package com.agenticandroid

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Wire protocol — the Kotlin side of THE contract. Byte-for-byte compatible with backbone/src/protocol.ts.
 * Outer Envelope is relay-visible; Inner (inside `enc`) is E2E-encrypted and never seen by the relay.
 */
const val PROTOCOL_VERSION = 1

@Serializable
data class Envelope(
    val v: Int = PROTOCOL_VERSION,
    val id: String,
    val from: String,
    val to: String,
    val ts: Long,
    val enc: String,
)

@Serializable
data class TypedError(val code: String, val message: String, val retriable: Boolean = false)

/** The four inner message kinds. Discriminator field is "type" to match the TS InnerMessage union. */
@Serializable
sealed class Inner {
    @Serializable @SerialName("request")
    data class Request(val method: String, val params: JsonObject = JsonObject(emptyMap())) : Inner()

    @Serializable @SerialName("response")
    data class Response(
        @SerialName("reply_to") val replyTo: String,
        val status: String, // "ok" | "error"
        val result: JsonElement? = null,
        val error: TypedError? = null,
    ) : Inner()

    @Serializable @SerialName("event")
    data class Event(val topic: String, val data: JsonObject = JsonObject(emptyMap())) : Inner()

    @Serializable @SerialName("ack")
    data class Ack(val ack: String) : Inner()
}

/** Note: TS uses "reply_to"; @SerialName above keeps the wire key identical. */
val ProtocolJson = Json {
    classDiscriminator = "type"
    ignoreUnknownKeys = true
    encodeDefaults = true
}

fun encodeInner(inner: Inner): String = ProtocolJson.encodeToString(Inner.serializer(), inner)
fun parseInner(json: String): Inner = ProtocolJson.decodeFromString(Inner.serializer(), json)
fun encodeEnvelope(env: Envelope): String = ProtocolJson.encodeToString(Envelope.serializer(), env)
fun parseEnvelope(json: String): Envelope = ProtocolJson.decodeFromString(Envelope.serializer(), json)
