package com.agenticandroid

import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import com.goterl.lazysodium.interfaces.Box
import com.goterl.lazysodium.interfaces.GenericHash
import com.goterl.lazysodium.interfaces.Sign
import java.util.Base64

/**
 * Session crypto — Kotlin mirror of backbone/src/crypto.ts. ONE ed25519 identity keypair per device:
 *   signing -> relay auth ; converted to curve25519 -> E2E box (crypto_box).
 *
 * CROSS-PLATFORM INTEROP (critical): all base64 on the wire MUST be URL-SAFE, NO PADDING, to match
 * libsodium-wrappers' default `to_base64` variant on the TS side. Hence Base64.getUrlEncoder().withoutPadding().
 *
 * NOTE: Lazysodium 5.1 method names verified against its public API; if a signature differs in your
 * version, the mapping (crypto_sign_keypair / *_pk_to_curve25519 / crypto_box_easy / generichash) is stable.
 * This file is UNVERIFIED in this environment (no Kotlin toolchain) — compile & run CryptoInteropTest first.
 */
data class Identity(val edPub: String, val edSec: String, val fp: String)

object Crypto {
    private val ls = LazySodiumAndroid(SodiumAndroid())
    private val b64e = Base64.getUrlEncoder().withoutPadding()
    private val b64d = Base64.getUrlDecoder()

    private fun enc(b: ByteArray) = b64e.encodeToString(b)
    private fun dec(s: String): ByteArray = b64d.decode(s)

    fun generateIdentity(): Identity {
        val pk = ByteArray(Sign.PUBLICKEYBYTES)
        val sk = ByteArray(Sign.SECRETKEYBYTES)
        if (!ls.cryptoSignKeypair(pk, sk)) error("keypair generation failed")
        val pub = enc(pk)
        return Identity(edPub = pub, edSec = enc(sk), fp = fingerprint(pub))
    }

    fun fingerprint(edPubB64: String): String {
        val out = ByteArray(16)
        ls.cryptoGenericHash(out, out.size, dec(edPubB64), dec(edPubB64).size.toLong())
        return out.joinToString("") { "%02x".format(it) }
    }

    // ---- signing (relay auth) ----
    fun sign(edSecB64: String, message: ByteArray): String {
        val sig = ByteArray(Sign.BYTES)
        val len = LongArray(1)
        ls.cryptoSignDetached(sig, len, message, message.size.toLong(), dec(edSecB64))
        return enc(sig)
    }

    fun verify(edPubB64: String, sigB64: String, message: ByteArray): Boolean =
        runCatching { ls.cryptoSignVerifyDetached(dec(sigB64), message, message.size, dec(edPubB64)) }.getOrDefault(false)

    // ---- E2E box (messages & blobs) ----
    private fun curvePub(edPubB64: String): ByteArray {
        val out = ByteArray(Box.CURVE25519XSALSA20POLY1305_PUBLICKEYBYTES)
        ls.convertPublicKeyEd25519ToCurve25519(out, dec(edPubB64))
        return out
    }
    private fun curveSec(edSecB64: String): ByteArray {
        val out = ByteArray(Box.CURVE25519XSALSA20POLY1305_SECRETKEYBYTES)
        ls.convertSecretKeyEd25519ToCurve25519(out, dec(edSecB64))
        return out
    }

    /** Encrypt for a recipient. Output packs nonce||ciphertext, base64 (url-safe, no pad). */
    fun sealFor(recipientEdPub: String, senderEdSec: String, plaintext: ByteArray): String {
        val nonce = ls.nonce(Box.NONCEBYTES)
        val ct = ByteArray(Box.MACBYTES + plaintext.size)
        if (!ls.cryptoBoxEasy(ct, plaintext, plaintext.size.toLong(), nonce, curvePub(recipientEdPub), curveSec(senderEdSec)))
            error("box seal failed")
        return enc(nonce + ct)
    }

    /** Decrypt from a sender. Throws on auth failure (tamper / wrong key). */
    fun openFrom(senderEdPub: String, recipientEdSec: String, packedB64: String): ByteArray {
        val packed = dec(packedB64)
        val nonce = packed.copyOfRange(0, Box.NONCEBYTES)
        val ct = packed.copyOfRange(Box.NONCEBYTES, packed.size)
        val pt = ByteArray(ct.size - Box.MACBYTES)
        if (!ls.cryptoBoxOpenEasy(pt, ct, ct.size.toLong(), nonce, curvePub(senderEdPub), curveSec(recipientEdSec)))
            error("box open failed (auth)")
        return pt
    }

    fun sealString(recipientEdPub: String, senderEdSec: String, s: String) =
        sealFor(recipientEdPub, senderEdSec, s.toByteArray(Charsets.UTF_8))
    fun openString(senderEdPub: String, recipientEdSec: String, packed: String) =
        openFrom(senderEdPub, recipientEdSec, packed).toString(Charsets.UTF_8)
}
