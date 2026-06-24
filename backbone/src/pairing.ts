/**
 * QR/token pairing handshake (Q5) — standalone module, no bridge/phone-sim imports.
 *
 * Flow:
 *   1. Initiator calls `PairingInitiator.start()`:
 *      - generates a one-time `token` and builds a `PairingToken` blob
 *      - connects to the relay as its own identity (authenticated by its fp)
 *      - waits for the responder's challenge
 *   2. The `PairingToken` string is shown as a QR code (phone scans it).
 *   3. Responder calls `PairingResponder.respond(tokenStr)`:
 *      - decodes the token, connects to the relay
 *      - sends a challenge to the initiator's fp
 *      - verifies the initiator's signed reply (proves possession of the advertised key)
 *      - sends an ack with its own edPub
 *      - both sides resolve with PairedState
 *
 * Token is single-use: after the first successful handshake the initiator closes its
 * relay connection; a second responder's challenge arrives at nobody and times out.
 *
 * All pairing messages travel over the relay (key-addressed by fp) — never plaintext paste.
 *
 * ponytail: plaintext JSON inside the relay `enc` field is deliberate — we don't have a
 *   shared secret until pairing completes. The handshake is authenticated by ed25519 sign/verify
 *   on a challenge bound to the one-time token. Mark: wrap in a DH ephemeral key if MITM on
 *   the relay is a concern (upgrade to Noise-IK).
 */
import { WebSocket } from "ws";
import {
  type Identity,
  generateIdentity,
  fingerprint,
  sign,
  verify,
  randomId,
  ready as cryptoReady,
} from "./crypto.ts";

// ---------- Token encoding/decoding ----------

export interface PairingTokenData {
  /** Initiator's ed25519 public key (base64). */
  edPub: string;
  /** Fingerprint of initiator's edPub. */
  fp: string;
  /** Relay URL the initiator is listening on. */
  relayUrl: string;
  /** One-time token that scopes this pairing exchange. */
  token: string;
}

/**
 * Encode a pairing token to a URL-safe base64 string (no padding).
 * Shape: base64url(JSON({edPub, fp, relayUrl, token})).
 * Compatible with the bridge's PAIR: blob and the Kotlin side's base64 decoder.
 */
export function encodePairingToken(data: PairingTokenData): string {
  return Buffer.from(JSON.stringify(data), "utf8").toString("base64url");
}

/** Decode a pairing token string. Throws if malformed or fp/edPub mismatch. */
export function decodePairingToken(s: string): PairingTokenData {
  let json: string;
  try {
    json = Buffer.from(s, "base64url").toString("utf8");
  } catch {
    throw new Error("pairing token: invalid base64url");
  }
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new Error("pairing token: invalid JSON");
  }
  if (
    !obj ||
    typeof obj !== "object" ||
    typeof (obj as Record<string, unknown>).edPub !== "string" ||
    typeof (obj as Record<string, unknown>).fp !== "string" ||
    typeof (obj as Record<string, unknown>).relayUrl !== "string" ||
    typeof (obj as Record<string, unknown>).token !== "string"
  ) {
    throw new Error("pairing token: missing required fields");
  }
  const d = obj as PairingTokenData;
  if (fingerprint(d.edPub) !== d.fp) {
    throw new Error("pairing token: fp does not match edPub");
  }
  return d;
}

// ---------- Relay handshake helper ----------

/**
 * Authenticate to the relay as `self` and return a minimal send/close handle.
 * All received frames after the welcome are forwarded to `onMessage`.
 */
function connectToRelay(
  self: Identity,
  relayUrl: string,
  onMessage: (raw: string) => void,
): Promise<{ send: (obj: unknown) => void; close: () => void }> {
  const wsUrl = relayUrl.replace(/^http/, "ws");
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const tenc = new TextEncoder();

    ws.on("open", () => {
      ws.send(JSON.stringify({ ctl: "hello", fp: self.fp, edpub: self.edPub }));
    });

    ws.on("message", (raw) => {
      const text = raw.toString();
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return;
      }

      if (m.ctl === "challenge") {
        ws.send(JSON.stringify({ ctl: "auth", sig: sign(self.edSec, tenc.encode(m.nonce as string)) }));
        return;
      }
      if (m.ctl === "welcome") {
        resolve({ send: (obj) => ws.send(JSON.stringify(obj)), close: () => ws.close() });
        return;
      }
      if (m.ctl === "error") {
        reject(new Error(`relay: ${m.message as string}`));
        return;
      }
      // Post-handshake envelope — forward to caller.
      onMessage(text);
    });

    ws.on("error", (e) => reject(e instanceof Error ? e : new Error(String(e))));
    ws.on("close", () => {});
  });
}

/** Build a minimal relay envelope (cleartext routing layer). */
function makeEnvelope(from: string, to: string, encPayload: string) {
  return { v: 1, id: randomId(8), from, to, ts: Date.now(), enc: encPayload };
}

// ---------- Pairing wire messages (plaintext JSON inside enc field) ----------

type PairMsg =
  | { kind: "challenge"; challenge: string; token: string; responderEdPub: string }
  | { kind: "response"; challenge: string; token: string; sig: string; initiatorEdPub: string }
  | { kind: "ack"; responderEdPub: string };

// ---------- Pairing result ----------

export interface PairedState {
  selfIdentity: Identity;
  peerEdPub: string;
  relayUrl: string;
}

// ---------- PairingInitiator ----------

export interface PairingInitiatorOptions {
  /** Identity to use. Defaults to `generateIdentity()`. */
  self?: Identity;
  relayUrl: string;
  /** How long to wait for the responder (ms). Default 120 s. */
  timeoutMs?: number;
}

export class PairingInitiator {
  readonly self: Identity;
  private readonly relayUrl: string;
  private readonly timeoutMs: number;
  readonly token: string;

  constructor(opts: PairingInitiatorOptions) {
    this.self = opts.self ?? generateIdentity();
    this.relayUrl = opts.relayUrl;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.token = randomId(16);
  }

  /** The pairing token to encode as QR / display to the user. */
  buildToken(): PairingTokenData {
    return { edPub: this.self.edPub, fp: this.self.fp, relayUrl: this.relayUrl, token: this.token };
  }

  /**
   * Connect to the relay and wait for a responder to complete the pairing.
   * Resolves with PairedState; rejects on timeout or failure.
   * Single-use: closes the relay connection after the first completion.
   */
  start(): Promise<PairedState> {
    const tenc = new TextEncoder();

    return new Promise((resolve, reject) => {
      let closed = false;
      let relay: { send: (obj: unknown) => void; close: () => void } | undefined;

      const done = (state: PairedState | Error) => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        relay?.close();
        if (state instanceof Error) reject(state);
        else resolve(state);
      };

      const timer = setTimeout(() => done(new Error("pairing timeout")), this.timeoutMs);

      const onMessage = (raw: string) => {
        let env: { enc?: string };
        try { env = JSON.parse(raw) as { enc?: string }; } catch { return; }
        if (!env.enc) return;
        let msg: PairMsg;
        try { msg = JSON.parse(env.enc) as PairMsg; } catch { return; }

        if (msg.kind === "challenge") {
          if (msg.token !== this.token) return; // not our token
          // Sign (challenge:token) with our key to prove possession.
          const sig = sign(this.self.edSec, tenc.encode(msg.challenge + ":" + msg.token));
          const response: PairMsg = {
            kind: "response",
            challenge: msg.challenge,
            token: this.token,
            sig,
            initiatorEdPub: this.self.edPub,
          };
          const responderFp = fingerprint(msg.responderEdPub);
          relay?.send(makeEnvelope(this.self.fp, responderFp, JSON.stringify(response)));
          return;
        }

        if (msg.kind === "ack") {
          done({ selfIdentity: this.self, peerEdPub: msg.responderEdPub, relayUrl: this.relayUrl });
        }
      };

      connectToRelay(this.self, this.relayUrl, onMessage)
        .then((r) => { relay = r; })
        .catch((e) => done(e instanceof Error ? e : new Error(String(e))));
    });
  }
}

// ---------- PairingResponder ----------

export interface PairingResponderOptions {
  /** Identity to use. Defaults to `generateIdentity()`. */
  self?: Identity;
  timeoutMs?: number;
}

export class PairingResponder {
  readonly self: Identity;
  private readonly timeoutMs: number;

  constructor(opts: PairingResponderOptions = {}) {
    this.self = opts.self ?? generateIdentity();
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /**
   * Decode the token, connect to the relay, challenge the initiator, verify their
   * signature, and resolve with PairedState.
   */
  respond(tokenStr: string): Promise<PairedState> {
    const data = decodePairingToken(tokenStr);
    const tenc = new TextEncoder();

    return new Promise((resolve, reject) => {
      let closed = false;
      let relay: { send: (obj: unknown) => void; close: () => void } | undefined;

      const done = (state: PairedState | Error) => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        relay?.close();
        if (state instanceof Error) reject(state);
        else resolve(state);
      };

      const timer = setTimeout(() => done(new Error("pairing responder timeout")), this.timeoutMs);

      const challenge = randomId(16);
      const initiatorFp = data.fp;

      const onMessage = (raw: string) => {
        let env: { enc?: string };
        try { env = JSON.parse(raw) as { enc?: string }; } catch { return; }
        if (!env.enc) return;
        let msg: PairMsg;
        try { msg = JSON.parse(env.enc) as PairMsg; } catch { return; }

        if (msg.kind !== "response") return;
        if (msg.token !== data.token) return;
        if (msg.challenge !== challenge) return;
        if (msg.initiatorEdPub !== data.edPub) return;

        // Verify the initiator actually holds the key advertised in the token.
        const sigInput = tenc.encode(challenge + ":" + data.token);
        if (!verify(data.edPub, msg.sig, sigInput)) {
          done(new Error("pairing: challenge signature invalid"));
          return;
        }

        // Send ack with our public key, then we're done.
        const ack: PairMsg = { kind: "ack", responderEdPub: this.self.edPub };
        relay?.send(makeEnvelope(this.self.fp, initiatorFp, JSON.stringify(ack)));

        done({ selfIdentity: this.self, peerEdPub: data.edPub, relayUrl: data.relayUrl });
      };

      connectToRelay(this.self, data.relayUrl, onMessage)
        .then((r) => {
          relay = r;
          // Send the challenge to the initiator's fingerprint.
          const challengeMsg: PairMsg = {
            kind: "challenge",
            challenge,
            token: data.token,
            responderEdPub: this.self.edPub,
          };
          relay.send(makeEnvelope(this.self.fp, initiatorFp, JSON.stringify(challengeMsg)));
        })
        .catch((e) => done(e instanceof Error ? e : new Error(String(e))));
    });
  }
}

// ---------- runnable CLI entrypoint ----------
import { pathToFileURL } from "node:url";

async function main() {
  await cryptoReady();
  const args = process.argv.slice(2);
  const sub = args[0];

  if (sub === "init") {
    const relayUrl = process.env.RELAY_URL ?? "ws://127.0.0.1:8787";
    const initiator = new PairingInitiator({ relayUrl });
    const tokenData = initiator.buildToken();
    const tokenStr = encodePairingToken(tokenData);
    console.log("=== Pairing token (show as QR on the phone) ===");
    console.log(tokenStr);
    console.log("\nDecoded:", JSON.stringify(tokenData, null, 2));
    console.log("\nWaiting for phone to approve…");
    try {
      const state = await initiator.start();
      console.log("Paired! Peer edPub:", state.peerEdPub);
      console.log("Self fp:", state.selfIdentity.fp);
    } catch (e) {
      console.error("Pairing failed:", (e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (sub === "approve") {
    const tokenStr = args[1];
    if (!tokenStr) {
      console.error("Usage: pairing approve <token>");
      process.exit(1);
    }
    const responder = new PairingResponder();
    try {
      const state = await responder.respond(tokenStr);
      console.log("Approved! Initiator edPub:", state.peerEdPub);
      console.log("Self fp:", state.selfIdentity.fp);
    } catch (e) {
      console.error("Pairing failed:", (e as Error).message);
      process.exit(1);
    }
    return;
  }

  console.error("Usage: pairing <init|approve> [token]");
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
