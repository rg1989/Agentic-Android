/**
 * BusEndpoint — the relay client that both the bridge (agent side) and the phone wrap.
 * Owns: relay handshake, E2E encrypt/decrypt, request/response correlation, events, and blobs.
 *
 * One endpoint connects ONE local identity to ONE paired remote peer (pairwise, Q5).
 * ponytail: single remote peer per endpoint. Mark: a multiplexing endpoint for N paired peers later.
 */
import { WebSocket } from "ws";
import {
  newId,
  parseFrame,
  parseInner,
  encodeInner,
  type Envelope,
  type RequestMsg,
  type ResponseMsg,
  type EventMsg,
  PROTOCOL_VERSION,
} from "./protocol.ts";
import {
  type Identity,
  fingerprint,
  sign,
  sealString,
  openString,
  sealFor,
  openFrom,
  randomId,
} from "./crypto.ts";

const enc = new TextEncoder();

export type RequestHandler = (
  req: RequestMsg,
  fromFp: string,
) => Promise<{ status: "ok" | "error"; result?: unknown; error?: ResponseMsg["error"] }>;
export type EventHandler = (ev: EventMsg) => void;

export interface PeerConfig {
  self: Identity;
  peerEdPub: string; // remote's ed public key (obtained at pairing)
  relayUrl: string; // http://host:port
  requestTimeoutMs?: number;
}

export class BusEndpoint {
  private ws?: WebSocket;
  private readonly peerFp: string;
  private readonly pending = new Map<string, { resolve: (r: ResponseMsg) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private reqHandler?: RequestHandler;
  private evHandler?: EventHandler;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: PeerConfig) {
    this.peerFp = fingerprint(cfg.peerEdPub);
    this.timeoutMs = cfg.requestTimeoutMs ?? 30_000;
  }

  onRequest(h: RequestHandler) {
    this.reqHandler = h;
  }
  onEvent(h: EventHandler) {
    this.evHandler = h;
  }

  connect(): Promise<void> {
    const wsUrl = this.cfg.relayUrl.replace(/^http/, "ws");
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.on("open", () => {
        ws.send(JSON.stringify({ ctl: "hello", fp: this.cfg.self.fp, edpub: this.cfg.self.edPub }));
      });
      ws.on("message", (raw) => {
        let parsed;
        try {
          parsed = parseFrame(raw.toString());
        } catch {
          return;
        }
        if (parsed.kind === "ctl") {
          const f = parsed.frame;
          if (f.ctl === "challenge") {
            ws.send(JSON.stringify({ ctl: "auth", sig: sign(this.cfg.self.edSec, enc.encode(f.nonce)) }));
          } else if (f.ctl === "welcome") {
            resolve();
          } else if (f.ctl === "error") {
            reject(new Error(`relay: ${f.message}`));
          }
          return;
        }
        this.onEnvelope(parsed.env).catch(() => {});
      });
      ws.on("error", (e) => reject(e instanceof Error ? e : new Error(String(e))));
      ws.on("close", () => {
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("connection closed"));
        }
        this.pending.clear();
      });
    });
  }

  close() {
    this.ws?.close();
  }

  private send(env: Envelope) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("not connected");
    this.ws.send(JSON.stringify(env));
  }

  private wrap(innerJson: string): Envelope {
    return {
      v: PROTOCOL_VERSION,
      id: newId(),
      from: this.cfg.self.fp,
      to: this.peerFp,
      ts: Date.now(),
      enc: sealString(this.cfg.peerEdPub, this.cfg.self.edSec, innerJson),
    };
  }

  private async onEnvelope(env: Envelope) {
    if (env.from !== this.peerFp) return; // only our paired peer
    let inner;
    try {
      inner = parseInner(openString(this.cfg.peerEdPub, this.cfg.self.edSec, env.enc));
    } catch {
      return; // undecryptable / malformed -> drop
    }

    if (inner.type === "response") {
      const p = this.pending.get(inner.reply_to);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(inner.reply_to);
        p.resolve(inner);
      }
      return;
    }
    if (inner.type === "event") {
      this.evHandler?.(inner);
      return;
    }
    if (inner.type === "request") {
      let out: { status: "ok" | "error"; result?: unknown; error?: ResponseMsg["error"] };
      if (this.reqHandler) {
        try {
          out = await this.reqHandler(inner, env.from);
        } catch (e) {
          out = { status: "error", error: { code: "HANDLER_THREW", message: String(e), retriable: false } };
        }
      } else {
        out = { status: "error", error: { code: "NO_HANDLER", message: "no request handler", retriable: false } };
      }
      const resp: ResponseMsg = { type: "response", reply_to: env.id, status: out.status, result: out.result, error: out.error };
      this.send(this.wrap(encodeInner(resp)));
      return;
    }
    // ack -> ignored in v1
  }

  /** Send a request to the paired peer and await its response (or timeout). */
  request(method: string, params: Record<string, unknown> = {}): Promise<ResponseMsg> {
    const env = this.wrap(encodeInner({ type: "request", method, params }));
    return new Promise<ResponseMsg>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(env.id);
        reject(new Error(`request timeout: ${method}`));
      }, this.timeoutMs);
      this.pending.set(env.id, { resolve, reject, timer });
      try {
        this.send(env);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(env.id);
        reject(e as Error);
      }
    });
  }

  /** Fire an unsolicited event at the paired peer (no reply expected). */
  event(topic: string, data: Record<string, unknown> = {}) {
    this.send(this.wrap(encodeInner({ type: "event", topic, data })));
  }

  // ---------- out-of-band blobs (E2E, via relay TTL store) ----------
  async putBlob(bytes: Uint8Array, contentType = "application/octet-stream"): Promise<{ blob_id: string; size: number; content_type: string }> {
    const id = randomId(16);
    const packed = sealFor(this.cfg.peerEdPub, this.cfg.self.edSec, bytes);
    const res = await fetch(`${this.cfg.relayUrl}/blob/${id}`, { method: "PUT", body: packed });
    if (!res.ok) throw new Error(`blob put failed: ${res.status}`);
    return { blob_id: id, size: bytes.length, content_type: contentType };
  }
  async getBlob(blobId: string): Promise<Uint8Array> {
    const res = await fetch(`${this.cfg.relayUrl}/blob/${blobId}`);
    if (!res.ok) throw new Error(`blob get failed: ${res.status}`);
    const packed = await res.text();
    return openFrom(this.cfg.peerEdPub, this.cfg.self.edSec, packed);
  }
}
