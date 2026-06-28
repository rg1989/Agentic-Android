import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createRelay, type Relay } from "../src/relay.ts";
import { PhoneSim } from "../src/phone-sim.ts";
import { ready, generateIdentity } from "../src/crypto.ts";
import { startPanel } from "../src/panel.ts";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
let home: string;
before(async () => {
  await ready();
  home = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-webchat-"));
  process.env.AGENTIC_HOME = home;
  fs.writeFileSync(path.join(home, "agent.json"), JSON.stringify({ self: { edPub: "test-edpub", fp: "test-fp" }, relayUrl: "http://127.0.0.1:0" }));
});
after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* */ } });

let relay: Relay, panel: Awaited<ReturnType<typeof startPanel>>, phone: PhoneSim, httpPort: number, agentPort: number;
const base = () => `http://127.0.0.1:${httpPort}`;
const getJson = (p: string) => fetch(base() + p).then((r) => r.json());
const postJson = (p: string, body: unknown) => fetch(base() + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function fakeAgent(name: string, onUser?: (m: any, ws: WebSocket) => void) {
  const ws = new WebSocket(`ws://127.0.0.1:${agentPort}`);
  await new Promise<void>((res) => ws.on("open", () => res()));
  ws.send(JSON.stringify({ t: "hello", name }));
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === "selftest") { ws.send(JSON.stringify({ t: "selftest_ok", token: m.token })); return; }
    if (m.t === "user" && onUser) onUser(m, ws);
  });
  await delay(30);
  return ws;
}

beforeEach(async () => {
  relay = createRelay();
  const port = await relay.listen();
  const url = `http://127.0.0.1:${port}`;
  const HUB = generateIdentity(); const PHONE = generateIdentity();
  phone = new PhoneSim(PHONE, HUB.edPub, url); await phone.connect();
  panel = await startPanel({ identity: HUB, peerEdPub: PHONE.edPub, relayUrl: url, httpPort: 0, agentPort: 0 });
  httpPort = (panel.http.address() as any).port;
  agentPort = (panel.agentWss.address() as any).port;
});
afterEach(async () => { await panel.close(); phone.close(); relay.close(); });

test("GET /sessions returns a session list with an active id", async () => {
  const s = await getJson("/sessions") as any;
  assert.ok(Array.isArray(s.sessions));
  assert.ok(s.activeId, "there is an active session");
});

test("session lifecycle: new → rename → delete over HTTP (shared store)", async () => {
  const before = ((await getJson("/sessions")) as any).sessions.length;
  await postJson("/session/new", {});
  const s1 = await getJson("/sessions") as any;
  assert.equal(s1.sessions.length, before + 1);
  const id = s1.activeId;
  const rr = await (await postJson("/session/rename", { id, title: "My renamed chat" })).json() as any;
  assert.ok(rr.ok);
  assert.equal((rr.sessions.find((x: any) => x.id === id)).title, "My renamed chat");
  await postJson("/session/delete", { id });
  const s3 = await getJson("/sessions") as any;
  assert.ok(!s3.sessions.find((x: any) => x.id === id), "deleted session is gone");
});

test("POST /upload stores bytes; GET /blob serves them back with the given mime", async () => {
  const r = await (await fetch(base() + "/upload?name=note.txt&mime=text/plain", { method: "POST", body: "hello blob" })).json() as any;
  assert.ok(r.ok && r.blobId, "upload returns a blobId");
  assert.equal(r.size, "hello blob".length);
  const back = await fetch(base() + `/blob/${r.blobId}?mime=text/plain`);
  assert.equal(back.headers.get("content-type"), "text/plain");
  assert.equal(await back.text(), "hello blob");
  const dl = await fetch(base() + `/blob/${r.blobId}?download=1&name=note.txt`);
  assert.match(dl.headers.get("content-disposition") ?? "", /attachment; filename="note.txt"/);
});

test("POST /ask-async forwards {t:user} to the active agent and returns ok immediately (non-blocking)", async () => {
  let got: any = null;
  const ws = await fakeAgent("Solo", (m) => { got = m; }); // first connected → active
  const r = await (await postJson("/ask-async", { text: "hello async" })).json() as any;
  assert.deepEqual(r, { ok: true }); // returns before any reply — no 60s block
  await delay(60);
  assert.equal(got?.text, "hello async", "the agent received the user frame");
  ws.close();
});

test("POST /ask-async with no agent connected is 503", async () => {
  const r = await postJson("/ask-async", { text: "nobody home" });
  assert.equal(r.status, 503);
});

test("GET /stream is an event-stream and replays state on connect", async () => {
  const res = await fetch(base() + "/stream");
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  let buf = "";
  for (let i = 0; i < 6 && !/event: sessions/.test(buf); i++) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += new TextDecoder().decode(value);
  }
  assert.match(buf, /event: sessions/, "replays the sessions frame to a new browser");
  assert.match(buf, /event: agent_identity/, "replays identity");
  await reader.cancel();
});

test("a reply from the agent is broadcast over /stream to the browser (live receive)", async () => {
  const ws = await fakeAgent("Echo", (m, sock) => sock.send(JSON.stringify({ t: "event", topic: "assistant_message", data: { text: `echo:${m.text}` } })));
  const res = await fetch(base() + "/stream");
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  await delay(20);
  await postJson("/ask-async", { text: "ping" });
  let buf = "";
  for (let i = 0; i < 10 && !/echo:ping/.test(buf); i++) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += new TextDecoder().decode(value);
  }
  assert.match(buf, /event: assistant_message/);
  assert.match(buf, /echo:ping/, "the agent's reply reached the SSE stream");
  await reader.cancel();
  ws.close();
});
