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

async function fakeAgent(name: string, opts: { description?: string; onUser?: (m: any, ws: WebSocket) => void } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${agentPort}`);
  await new Promise<void>((res) => ws.on("open", () => res()));
  ws.send(JSON.stringify({ t: "hello", name, ...(opts.description ? { description: opts.description } : {}) }));
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
