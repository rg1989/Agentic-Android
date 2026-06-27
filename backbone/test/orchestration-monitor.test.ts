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
  home = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-orch-"));
  process.env.AGENTIC_HOME = home;
  fs.writeFileSync(path.join(home, "agent.json"), JSON.stringify({ self: { edPub: "test-edpub", fp: "test-fp" }, relayUrl: "http://127.0.0.1:0" }));
});
after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* */ } });

let relay: Relay, panel: Awaited<ReturnType<typeof startPanel>>, phone: PhoneSim, httpPort: number, agentPort: number;
const base = () => `http://127.0.0.1:${httpPort}`;

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
const activity = (ws: WebSocket, data: Record<string, unknown>) => ws.send(JSON.stringify({ t: "event", topic: "agent_activity", data }));

/** Collect SSE "orch" events for a window. */
async function collectOrch(ms: number): Promise<any[]> {
  const out: any[] = [];
  const res = await fetch(base() + "/stream");
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  let buf = "";
  const deadline = Date.now() + ms;
  (async () => {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /event: (\w+)/.exec(block), dl = /data: (.*)/.exec(block);
        if (ev && ev[1] === "orch" && dl) { try { out.push(JSON.parse(dl[1])); } catch { /* */ } }
      }
    }
    await reader.cancel();
  })();
  return new Promise((resolve) => setTimeout(() => resolve(out), ms + 50));
}

beforeEach(async () => {
  relay = createRelay();
  const url = `http://127.0.0.1:${await relay.listen()}`;
  const HUB = generateIdentity(); const PHONE = generateIdentity();
  phone = new PhoneSim(PHONE, HUB.edPub, url); await phone.connect();
  panel = await startPanel({ identity: HUB, peerEdPub: PHONE.edPub, relayUrl: url, httpPort: 0, agentPort: 0 });
  httpPort = (panel.http.address() as any).port;
  agentPort = (panel.agentWss.address() as any).port;
});
afterEach(async () => { await panel.close(); phone.close(); relay.close(); });

test("the orchestration monitor streams a turn root, within-agent subagents, and cross-agent delegations — all nested", async () => {
  const boss = await fakeAgent("Boss"); // first connected → active (the driver-seat orchestrator)
  const worker = await fakeAgent("Worker", (m, ws) => ws.send(JSON.stringify({ t: "event", topic: "assistant_message", data: { text: `did:${m.text}`, askId: m.askId } })));
  const s = await fetch(base() + "/status").then((r) => r.json()) as any;
  const bossId = s.active.id;
  const workerId = s.agents.find((a: any) => a.name === "Worker").id;

  const events = collectOrch(900);
  await delay(40);
  // 1) user prompt to the active orchestrator → a turn root
  await fetch(base() + "/ask-async", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "plan the launch" }) });
  await delay(60);
  // 2) the orchestrator reports an internal subagent (Claude Task), then closes it
  activity(boss, { id: "sa1", kind: "subagent", name: "researcher", detail: "find sources", status: "start" });
  await delay(40);
  activity(boss, { id: "sa1", status: "end", reply: "8 sources" });
  // 3) the orchestrator delegates to a peer agent (ask_agent → /ask with its identity)
  await delay(40);
  await fetch(base() + "/ask", { method: "POST", headers: { "content-type": "application/json", "x-ask-from-id": bossId, "x-ask-from-name": "Boss" }, body: JSON.stringify({ agent: workerId, text: "write section" }) });
  await delay(80);

  const ev = await events;
  const turn = ev.find((e) => e.kind === "turn");
  assert.ok(turn, "a turn root was emitted for the prompt to the orchestrator");
  assert.equal(turn.agentName, "Boss");
  assert.equal(turn.parentId, null);

  const subStart = ev.find((e) => e.kind === "subagent" && e.status === "running");
  assert.ok(subStart, "the within-agent subagent appears");
  assert.equal(subStart.parentId, turn.id, "the subagent nests under the orchestrator's turn");
  assert.match(subStart.label, /researcher/);
  const subDone = ev.find((e) => e.kind === "subagent" && e.status === "done");
  assert.ok(subDone && subDone.reply === "8 sources", "the subagent settles with its value");

  const delg = ev.find((e) => e.kind === "delegation" && e.status === "running");
  assert.ok(delg, "the cross-agent delegation appears");
  assert.equal(delg.agentName, "Worker");
  assert.equal(delg.parentId, turn.id, "the delegation nests under the orchestrator's turn (x-ask-from attribution)");
  const delgDone = ev.find((e) => e.kind === "delegation" && e.status === "done");
  assert.ok(delgDone && delgDone.reply === "did:write section", "the delegation settles with the worker's reply");

  boss.close(); worker.close();
});
