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

beforeEach(async () => {
  relay = createRelay();
  const port = await relay.listen();
  const url = `http://127.0.0.1:${port}`;
  const HUB = generateIdentity();   // the hub's own identity
  const PHONE = generateIdentity(); // the paired phone
  phone = new PhoneSim(PHONE, HUB.edPub, url);
  await phone.connect();
  panel = await startPanel({ identity: HUB, peerEdPub: PHONE.edPub, relayUrl: url, httpPort: 0, agentPort: 0 });
  httpPort = (panel.http.address() as any).port;
  agentPort = (panel.agentWss.address() as any).port;
});
afterEach(async () => { await panel.close(); phone.close(); relay.close(); });

test("GET /status responds and reports the hub is up", async () => {
  const r = await fetch(`http://127.0.0.1:${httpPort}/status`).then((x) => x.json()) as Record<string, unknown>;
  assert.ok("agents" in r, "status has an agents array");
});

test("an agent can connect and /say round-trips through it (regression)", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${agentPort}`);
  await new Promise<void>((res) => ws.on("open", () => res()));
  ws.send(JSON.stringify({ t: "hello", name: "Echo" }));
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === "selftest") { ws.send(JSON.stringify({ t: "selftest_ok", token: m.token })); return; } // pass the hub's verifier probe
    if (m.t === "user") ws.send(JSON.stringify({ t: "event", topic: "assistant_message", data: { text: `echo:${m.text}` } }));
  });
  await delay(50);
  const r = await fetch(`http://127.0.0.1:${httpPort}/say`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "ping" }),
  }).then((x) => x.json()) as Record<string, unknown>;
  assert.equal(r.reply, "echo:ping");
  ws.close();
});
