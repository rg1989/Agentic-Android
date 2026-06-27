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
  // Hermetic config: point loadCfg() at a temp agent.json so tests don't require a real ~/.agentic-android one.
  home = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-test-"));
  process.env.AGENTIC_HOME = home;
  fs.writeFileSync(path.join(home, "agent.json"), JSON.stringify({ self: { edPub: "test-edpub", fp: "test-fp" }, relayUrl: "http://127.0.0.1:0" }));
});
after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* */ } });

let relay: Relay, panel: Awaited<ReturnType<typeof startPanel>>, phone: PhoneSim, httpPort: number, agentPort: number;

async function fakeAgent(name: string, opts: { description?: string; orchestrator?: boolean; onUser?: (m: any, ws: WebSocket) => void } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${agentPort}`);
  await new Promise<void>((res) => ws.on("open", () => res()));
  ws.send(JSON.stringify({ t: "hello", name, ...(opts.description ? { description: opts.description } : {}), ...(opts.orchestrator ? { orchestrator: true } : {}) }));
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === "selftest") { ws.send(JSON.stringify({ t: "selftest_ok", token: m.token })); return; } // pass the hub's verifier probe
    if (m.t === "user" && opts.onUser) opts.onUser(m, ws);
  });
  await delay(30);
  return ws;
}
const status = () => fetch(`http://127.0.0.1:${httpPort}/status`).then((x) => x.json());

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

test("an agent's hello description appears in GET /status", async () => {
  const ws = await fakeAgent("Backend", { description: "SQL & APIs" });
  const s = await status() as any;
  const entry = s.agents.find((a: any) => a.name === "Backend");
  assert.ok(entry, "agent is in the roster");
  assert.equal(entry.description, "SQL & APIs");
  ws.close();
});

test("POST /ask routes to the named worker, returns its reply, and does NOT broadcast to the phone", async () => {
  const seenByPhone: string[] = [];
  phone.bus.onEvent((ev) => { if (ev.topic === "assistant_message") seenByPhone.push(String((ev.data as any).text)); });
  // active brain (orchestrator stand-in) + a worker:
  await fakeAgent("Orchestrator");
  const worker = await fakeAgent("Worker", { onUser: (m, ws) => ws.send(JSON.stringify({ t: "event", topic: "assistant_message", data: { text: `did:${m.text}`, askId: m.askId } })) });
  const s = await status() as any;
  const wid = s.agents.find((a: any) => a.name === "Worker").id;
  const r = await fetch(`http://127.0.0.1:${httpPort}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: wid, text: "job1" }) }).then((x) => x.json()) as any;
  assert.equal(r.reply, "did:job1");
  await delay(40);
  assert.deepEqual(seenByPhone, [], "the delegated reply never reached the phone");
  worker.close();
});

test("ask resolves even if the worker is selected active mid-flight (askId routing)", async () => {
  await fakeAgent("Orchestrator");
  let received: any = null;
  const worker = await fakeAgent("W2", { onUser: (m) => { received = m; } }); // hold the reply
  const s = await status() as any;
  const wid = s.agents.find((a: any) => a.name === "W2").id;
  const p = fetch(`http://127.0.0.1:${httpPort}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: wid, text: "j" }) }).then((x) => x.json());
  await delay(30);
  phone.bus.event("select_agent", { id: wid }); // flip active to the worker WHILE its ask is in flight
  await delay(20);
  worker.send(JSON.stringify({ t: "event", topic: "assistant_message", data: { text: "answer", askId: received.askId } }));
  assert.equal((await p as any).reply, "answer");
  worker.close();
});

test("an orchestrator self-declares in /status and POST /ask to it is 409 (no orchestrator→orchestrator)", async () => {
  await fakeAgent("Boss");                                  // first connected → becomes active
  const sub = await fakeAgent("Sub", { orchestrator: true }); // a connected orchestrator worker (not active)
  const s = await status() as any;
  const subEntry = s.agents.find((a: any) => a.name === "Sub");
  assert.equal(subEntry.orchestrator, true, "hello orchestrator flag surfaces in /status");
  const r = await fetch(`http://127.0.0.1:${httpPort}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: subEntry.id, text: "x" }) });
  assert.equal(r.status, 409);
  sub.close();
});

test("ask to the active agent on a phone-backed hub is rejected; bad depth is 508", async () => {
  await fakeAgent("Solo");
  const s = await status() as any;
  const activeId = s.active.id;
  const r = await fetch(`http://127.0.0.1:${httpPort}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: activeId, text: "x" }) });
  assert.equal(r.status, 400);
  const r2 = await fetch(`http://127.0.0.1:${httpPort}/ask`, { method: "POST", headers: { "content-type": "application/json", "x-ask-depth": "99" }, body: JSON.stringify({ agent: activeId, text: "x" }) });
  assert.equal(r2.status, 508);
});
