import { test, before } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createRelay, type Relay } from "../src/relay.ts";
import { BusEndpoint } from "../src/peer.ts";
import { ready, generateIdentity, sign, type Identity } from "../src/crypto.ts";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tenc = new TextEncoder();

before(async () => {
  await ready();
});

async function bootRelay(opts = {}): Promise<{ relay: Relay; url: string }> {
  const relay = createRelay(opts);
  const port = await relay.listen();
  return { relay, url: `http://127.0.0.1:${port}` };
}

test("routes a request between two paired peers (E2E, correlated)", async () => {
  const { relay, url } = await bootRelay();
  const A = generateIdentity(),
    B = generateIdentity();
  const b = new BusEndpoint({ self: B, peerEdPub: A.edPub, relayUrl: url });
  b.onRequest(async (req) => ({ status: "ok", result: { echo: req.params } }));
  await b.connect();
  const a = new BusEndpoint({ self: A, peerEdPub: B.edPub, relayUrl: url });
  await a.connect();

  const r = await a.request("echo", { x: 1 });
  assert.equal(r.status, "ok");
  assert.deepEqual((r.result as any).echo, { x: 1 });

  a.close();
  b.close();
  await relay.close();
});

test("queues for an offline peer, fires wake hook, flushes on reconnect", async () => {
  const woke: string[] = [];
  const { relay, url } = await bootRelay({ onWake: (fp: string) => woke.push(fp) });
  const A = generateIdentity(),
    B = generateIdentity();

  const a = new BusEndpoint({ self: A, peerEdPub: B.edPub, relayUrl: url });
  await a.connect();
  a.event("ping", { n: 1 }); // B is offline
  await delay(30);
  assert.ok(relay.queueDepth(B.fp) >= 1, "message should be queued");
  assert.ok(woke.includes(B.fp), "wake hook should fire for offline peer");

  const got: any[] = [];
  const b = new BusEndpoint({ self: B, peerEdPub: A.edPub, relayUrl: url });
  b.onEvent((ev) => got.push(ev));
  await b.connect(); // triggers flush
  await delay(30);
  assert.equal(got.length, 1);
  assert.equal(got[0].topic, "ping");
  assert.equal(relay.queueDepth(B.fp), 0, "queue should be drained");

  a.close();
  b.close();
  await relay.close();
});

test("blob endpoint stores E2E bytes and expires after TTL", async () => {
  const { relay, url } = await bootRelay({ blobTtlMs: 60 });
  const A = generateIdentity(),
    B = generateIdentity();
  const a = new BusEndpoint({ self: A, peerEdPub: B.edPub, relayUrl: url });
  const b = new BusEndpoint({ self: B, peerEdPub: A.edPub, relayUrl: url });
  // blob put/get does not require a WS connection, only the relay HTTP endpoint
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const handle = await a.putBlob(bytes);
  const fetched = await b.getBlob(handle.blob_id);
  assert.deepEqual(fetched, bytes);

  await delay(90); // > TTL
  await assert.rejects(() => b.getBlob(handle.blob_id), /404/);
  await relay.close();
});

test("relay rejects from-spoofing (a peer forging someone else's `from`)", async () => {
  const { relay, url } = await bootRelay();
  const A = generateIdentity(),
    B = generateIdentity();
  const ws = await authedSocket(url, A);
  const errs: string[] = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.ctl === "error") errs.push(m.message);
  });
  ws.send(JSON.stringify({ v: 1, id: "x", from: B.fp, to: B.fp, ts: Date.now(), enc: "zz" })); // spoof from
  await delay(40);
  assert.ok(errs.some((e) => /spoof/i.test(e)), `expected spoof rejection, got ${JSON.stringify(errs)}`);
  await relay.close();
});

function authedSocket(url: string, id: Identity): Promise<WebSocket> {
  const ws = new WebSocket(url.replace(/^http/, "ws"));
  return new Promise((resolve, reject) => {
    ws.on("open", () => ws.send(JSON.stringify({ ctl: "hello", fp: id.fp, edpub: id.edPub })));
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.ctl === "challenge") ws.send(JSON.stringify({ ctl: "auth", sig: sign(id.edSec, tenc.encode(m.nonce)) }));
      else if (m.ctl === "welcome") resolve(ws);
      else if (m.ctl === "error") reject(new Error(m.message));
    });
    ws.on("error", reject);
  });
}
