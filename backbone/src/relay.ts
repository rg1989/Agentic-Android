/**
 * Thin relay — a dumb, untrusted post office (Q2/Q5).
 *
 *  - Accountless: a client authenticates by signing a challenge with its identity key.
 *  - Key-addressed: routes opaque encrypted envelopes by destination fingerprint.
 *  - Offline queue: holds envelopes for a disconnected peer; flushes on reconnect; pokes an
 *    injectable wake hook (prod = FCM push) so a backgrounded phone reconnects.
 *  - Blob endpoint: out-of-band E2E-encrypted media with a TTL (keeps big bytes out of the queue).
 *
 * The relay can NEVER read message contents — it only sees from/to fingerprints + sizes.
 *
 * ponytail: in-memory queue + blob store (single process). Mark: swap for Redis/disk to persist or
 *   scale past one node. Blob auth = random-id-as-capability; mark: add a per-blob signature if needed.
 */
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { parseFrame, type Envelope } from "./protocol.ts";
import { fingerprint, verify, randomId, ready as cryptoReady } from "./crypto.ts";

const enc = new TextEncoder();

export interface RelayOptions {
  /** Called when an envelope is queued for an OFFLINE fingerprint. Prod: send FCM to wake the app. */
  onWake?: (fp: string) => void;
  /** Max queued envelopes per offline peer (drop-oldest beyond this). */
  maxQueuePerPeer?: number;
  /** Blob TTL in ms. */
  blobTtlMs?: number;
  /** Max WS message bytes (control channel stays small; media goes via blobs). */
  maxPayloadBytes?: number;
}

interface PeerState {
  ws: WebSocket;
  edpub: string;
}

export interface Relay {
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
  /** test/inspection hooks */
  readonly peers: Map<string, PeerState>;
  queueDepth(fp: string): number;
  blobCount(): number;
}

export function createRelay(opts: RelayOptions = {}): Relay {
  const maxQueue = opts.maxQueuePerPeer ?? 1000;
  const blobTtl = opts.blobTtlMs ?? 5 * 60_000;
  const maxPayload = opts.maxPayloadBytes ?? 256 * 1024;

  const peers = new Map<string, PeerState>(); // fp -> connected+authed socket
  const queues = new Map<string, Envelope[]>(); // fp -> pending envelopes (offline)
  const blobs = new Map<string, { data: Buffer; expires: number }>();

  const httpServer = http.createServer((req, res) => handleHttp(req, res, blobs, blobTtl));
  const wss = new WebSocketServer({ server: httpServer, maxPayload });

  function deliverOrQueue(env: Envelope) {
    const peer = peers.get(env.to);
    if (peer && peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(JSON.stringify(env));
      return;
    }
    const q = queues.get(env.to) ?? [];
    q.push(env);
    if (q.length > maxQueue) q.shift(); // drop oldest
    queues.set(env.to, q);
    opts.onWake?.(env.to);
  }

  function flush(fp: string) {
    const q = queues.get(fp);
    const peer = peers.get(fp);
    if (!q || !peer) return;
    queues.delete(fp);
    for (const env of q) peer.ws.send(JSON.stringify(env));
  }

  wss.on("connection", (ws) => {
    // Per-connection handshake state.
    let stage: "hello" | "challenge" | "open" = "hello";
    let claimedFp = "";
    let edpub = "";
    let nonce = "";

    const fail = (message: string) => {
      try {
        ws.send(JSON.stringify({ ctl: "error", message }));
      } catch {}
      ws.close();
    };

    ws.on("message", (raw) => {
      let parsed;
      try {
        parsed = parseFrame(raw.toString());
      } catch {
        return fail("malformed frame");
      }

      if (parsed.kind === "ctl") {
        const f = parsed.frame;
        if (f.ctl === "hello" && stage === "hello") {
          if (fingerprint(f.edpub) !== f.fp) return fail("fingerprint does not match public key");
          claimedFp = f.fp;
          edpub = f.edpub;
          nonce = randomId(24);
          stage = "challenge";
          ws.send(JSON.stringify({ ctl: "challenge", nonce }));
          return;
        }
        if (f.ctl === "auth" && stage === "challenge") {
          if (!verify(edpub, f.sig, enc.encode(nonce))) return fail("bad signature");
          // Authenticated. Register (replacing any stale socket for this fp).
          peers.get(claimedFp)?.ws.close();
          peers.set(claimedFp, { ws, edpub });
          stage = "open";
          ws.send(JSON.stringify({ ctl: "welcome" }));
          flush(claimedFp);
          return;
        }
        return fail("unexpected control frame");
      }

      // Envelope frame — only authenticated peers may route, and only as themselves.
      if (stage !== "open") return fail("not authenticated");
      const env = parsed.env;
      if (env.from !== claimedFp) return fail("from-spoofing");
      deliverOrQueue(env);
    });

    ws.on("close", () => {
      if (stage === "open" && peers.get(claimedFp)?.ws === ws) peers.delete(claimedFp);
    });
    ws.on("error", () => {});
  });

  // TTL sweeper for blobs.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, b] of blobs) if (b.expires <= now) blobs.delete(id);
  }, 30_000);
  sweeper.unref?.();

  return {
    peers,
    queueDepth: (fp) => queues.get(fp)?.length ?? 0,
    blobCount: () => blobs.size,
    async listen(port = 0) {
      await cryptoReady();
      await new Promise<void>((resolve) => httpServer.listen(port, resolve));
      const addr = httpServer.address();
      return typeof addr === "object" && addr ? addr.port : port;
    },
    async close() {
      clearInterval(sweeper);
      for (const p of peers.values()) p.ws.terminate();
      wss.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

// ---------- blob endpoints (out-of-band media) ----------
function handleHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  blobs: Map<string, { data: Buffer; expires: number }>,
  blobTtl: number,
) {
  const m = req.url?.match(/^\/blob\/([A-Za-z0-9_-]{8,128})$/);
  if (!m) {
    res.writeHead(404).end("not found");
    return;
  }
  const id = m[1];

  if (req.method === "PUT" || req.method === "POST") {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 64 * 1024 * 1024) {
        // 64MB cap; ponytail ceiling, raise when streaming/large media lands
        res.writeHead(413).end("too large");
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      blobs.set(id, { data: Buffer.concat(chunks), expires: Date.now() + blobTtl });
      res.writeHead(201).end("stored");
    });
    return;
  }

  if (req.method === "GET") {
    const b = blobs.get(id);
    if (!b || b.expires <= Date.now()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "application/octet-stream" }).end(b.data);
    return;
  }

  res.writeHead(405).end("method not allowed");
}

// ---------- runnable entrypoint: `pnpm relay` ----------
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8787);
  const relay = createRelay({
    // ponytail: log on wake. Swap this for a real FCM send (admin SDK) in prod — that's the only
    // line that needs to change to wake a backgrounded phone.
    onWake: (fp) => console.log(`[wake] queued message for offline ${fp.slice(0, 12)}… (send FCM here)`),
  });
  relay.listen(port).then((p) => {
    console.log(`relay listening: ws://0.0.0.0:${p}  |  blobs: http://0.0.0.0:${p}/blob/:id`);
  });
}
