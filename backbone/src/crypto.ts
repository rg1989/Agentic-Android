/**
 * Session crypto core. ONE ed25519 identity keypair per device:
 *   - signing  -> relay auth (prove possession of the private key)
 *   - converted to curve25519 -> E2E box encryption of messages & blobs
 *
 * The keypair IS the identity (Q5). Fingerprint = generichash(edPub).
 *
 * ponytail: libsodium crypto_box (X25519 + XSalsa20-Poly1305) between known static keys.
 *   This is authenticated E2E for v1. Upgrade path = Noise IK handshake for forward secrecy.
 */
// The ESM build of libsodium-wrappers has a broken internal import; the CJS build is fine.
// Load it via createRequire (forces the `require` export condition); keep the type-only import for types.
import { createRequire } from "node:module";
import type _sodiumNS from "libsodium-wrappers";
const _require = createRequire(import.meta.url);

let sodium: typeof _sodiumNS;
export async function ready(): Promise<void> {
  if (sodium) return;
  const s = _require("libsodium-wrappers") as typeof _sodiumNS;
  await s.ready;
  sodium = s;
}

export interface Identity {
  edPub: string; // base64
  edSec: string; // base64 (64-byte ed25519 secret)
  fp: string; // fingerprint (hex of generichash(edPub))
}

export function generateIdentity(): Identity {
  const kp = sodium.crypto_sign_keypair();
  const edPub = sodium.to_base64(kp.publicKey);
  return { edPub, edSec: sodium.to_base64(kp.privateKey), fp: fingerprint(edPub) };
}

/** Stable, collision-resistant id for an identity, derived from its public key. */
export function fingerprint(edPubB64: string): string {
  const h = sodium.crypto_generichash(16, sodium.from_base64(edPubB64));
  return sodium.to_hex(h);
}

// ---------- signing (relay auth) ----------
export function sign(edSecB64: string, message: Uint8Array): string {
  return sodium.to_base64(sodium.crypto_sign_detached(message, sodium.from_base64(edSecB64)));
}
export function verify(edPubB64: string, sigB64: string, message: Uint8Array): boolean {
  try {
    return sodium.crypto_sign_verify_detached(
      sodium.from_base64(sigB64),
      message,
      sodium.from_base64(edPubB64),
    );
  } catch {
    return false;
  }
}

// ---------- E2E encryption (messages & blobs) ----------
function toCurvePub(edPubB64: string): Uint8Array {
  return sodium.crypto_sign_ed25519_pk_to_curve25519(sodium.from_base64(edPubB64));
}
function toCurveSec(edSecB64: string): Uint8Array {
  return sodium.crypto_sign_ed25519_sk_to_curve25519(sodium.from_base64(edSecB64));
}

/** Encrypt bytes for a recipient. Output packs nonce||ciphertext, base64. */
export function sealFor(recipientEdPubB64: string, senderEdSecB64: string, plaintext: Uint8Array): string {
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ct = sodium.crypto_box_easy(plaintext, nonce, toCurvePub(recipientEdPubB64), toCurveSec(senderEdSecB64));
  const packed = new Uint8Array(nonce.length + ct.length);
  packed.set(nonce, 0);
  packed.set(ct, nonce.length);
  return sodium.to_base64(packed);
}

/** Decrypt bytes from a sender. Throws if authentication fails (tamper / wrong key). */
export function openFrom(senderEdPubB64: string, recipientEdSecB64: string, packedB64: string): Uint8Array {
  const packed = sodium.from_base64(packedB64);
  const n = sodium.crypto_box_NONCEBYTES;
  const nonce = packed.slice(0, n);
  const ct = packed.slice(n);
  return sodium.crypto_box_open_easy(ct, nonce, toCurvePub(senderEdPubB64), toCurveSec(recipientEdSecB64));
}

// string convenience for JSON inner messages
const enc = new TextEncoder();
const dec = new TextDecoder();
export function sealString(recipientEdPubB64: string, senderEdSecB64: string, s: string): string {
  return sealFor(recipientEdPubB64, senderEdSecB64, enc.encode(s));
}
export function openString(senderEdPubB64: string, recipientEdSecB64: string, packedB64: string): string {
  return dec.decode(openFrom(senderEdPubB64, recipientEdSecB64, packedB64));
}

export function randomId(bytes = 16): string {
  return sodium.to_hex(sodium.randombytes_buf(bytes));
}
