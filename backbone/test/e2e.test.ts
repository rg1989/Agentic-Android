/**
 * End-to-end: MCP client (stands in for Claude Code) -> Bridge -> Relay -> PhoneSim and back.
 * Exercises every load-bearing decision from the grilling in one real flow.
 */
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRelay, type Relay } from "../src/relay.ts";
import { Bridge } from "../src/bridge.ts";
import { PhoneSim } from "../src/phone-sim.ts";
import { ready, generateIdentity } from "../src/crypto.ts";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Ctx {
  relay: Relay;
  phone: PhoneSim;
  bridge: Bridge;
  client: Client;
  agentFp: string;
  events: { topic: string; data: Record<string, unknown> }[];
  callJson: (name: string, args?: Record<string, unknown>) => Promise<{ payload: any; isError: boolean }>;
}
let ctx: Ctx;

before(async () => {
  await ready();
});

beforeEach(async () => {
  const relay = createRelay();
  const port = await relay.listen();
  const url = `http://127.0.0.1:${port}`;

  // pair phone <-> agent (each knows the other's public key)
  const P = generateIdentity();
  const G = generateIdentity();

  const phone = new PhoneSim(P, G.edPub, url);
  await phone.connect();

  const events: Ctx["events"] = [];
  const bridge = new Bridge({ self: G, peerEdPub: P.edPub, relayUrl: url, agentRunner: (e) => void events.push(e) });
  await bridge.start();

  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await bridge.connectMcp(serverT);
  const client = new Client({ name: "test-agent", version: "0.0.1" });
  await client.connect(clientT);

  const callJson = async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await client.callTool({ name, arguments: args });
    return { payload: JSON.parse(r.content[0].text), isError: !!r.isError };
  };

  ctx = { relay, phone, bridge, client, agentFp: G.fp, events, callJson };
});

afterEach(async () => {
  await ctx.client.close();
  await ctx.bridge.close();
  ctx.phone.close();
  await ctx.relay.close();
});

test("phone capability catalog is exposed as MCP tools", async () => {
  const tools = (await ctx.client.listTools()).tools.map((t) => t.name);
  for (const expected of ["phone_ring", "camera_capture", "camera_state", "sms_send", "schedule", "get_blob"]) {
    assert.ok(tools.includes(expected), `missing tool ${expected} in ${tools.join(",")}`);
  }
});

test("outbound action round-trips with a typed result", async () => {
  const { payload, isError } = await ctx.callJson("phone_ring", { args: { ms: 5000 } });
  assert.equal(isError, false);
  assert.equal(payload.status, "ok");
  assert.deepEqual(payload.result, { rang: true, ms: 5000 });
});

test("typed errors + observe/recover chaining + E2E media blob", async () => {
  ctx.phone.cameraHeld = true;

  // 1) capture fails with a typed, retriable error
  const fail = await ctx.callJson("camera_capture");
  assert.equal(fail.isError, true);
  assert.equal(fail.payload.error.code, "CAMERA_IN_USE");
  assert.equal(fail.payload.error.retriable, true);

  // 2) agent observes state
  const state = await ctx.callJson("camera_state");
  assert.equal(state.payload.result.held, true);

  // 3) agent recovers, then captures
  await ctx.callJson("camera_release");
  const ok = await ctx.callJson("camera_capture", { args: { width: 64, height: 64 } });
  assert.equal(ok.isError, false);
  const blobId = ok.payload.result.blob_id;
  assert.ok(blobId, "expected a blob handle");

  // 4) fetch + decrypt the media over the out-of-band path
  const blob = await ctx.callJson("get_blob", { blob_id: blobId });
  assert.equal(blob.payload.size, 64 * 64);
  const first = Buffer.from(blob.payload.base64, "base64")[0];
  assert.equal(first, 7, "decrypted image bytes should match the phone's deterministic fixture");
});

test("consent: ask is gated by confirmation; deny is hard-blocked", async () => {
  const agentFp = ctx.agentFp; // the agent fingerprint the phone sees

  // sms.send defaults to `ask`; no confirmer wired -> declined
  let sms = await ctx.callJson("sms_send", { args: { to: "+100" } });
  assert.equal(sms.isError, true);
  assert.equal(sms.payload.error.code, "CONSENT_DENIED");

  // wire a confirmer that approves -> now allowed
  ctx.phone.setConfirmer(async () => true);
  sms = await ctx.callJson("sms_send", { args: { to: "+100" } });
  assert.equal(sms.isError, false);
  assert.equal(sms.payload.result.sent, true);

  // device.wipe is `deny` -> blocked even with an approving confirmer
  const wipe = await ctx.callJson("device_wipe");
  assert.equal(wipe.isError, true);
  assert.equal(wipe.payload.error.code, "CONSENT_DENIED");

  // per-(agent x capability) override: deny ringing for THIS agent
  ctx.phone.setPolicy(agentFp, "phone.ring", "deny");
  const ring = await ctx.callJson("phone_ring");
  assert.equal(ring.isError, true);
  assert.equal(ring.payload.error.code, "CONSENT_DENIED");
});

test("inbound phone event wakes the agent (capability B)", async () => {
  ctx.phone.emitUserMessage("hey, what's on my calendar?");
  await delay(40);
  const msg = ctx.events.find((e) => e.topic === "user_message");
  assert.ok(msg, "agent should have been woken by the phone event");
  assert.equal((msg!.data as any).text, "hey, what's on my calendar?");
});

test("deferred scheduling fires later and wakes the agent with the result", async () => {
  const sched = await ctx.callJson("schedule", { delay_ms: 50, method: "phone.ring", args: { ms: 1000 } });
  assert.equal(sched.payload.scheduled, true);
  assert.equal(ctx.events.length, 0, "nothing should have fired yet");

  await delay(120);
  const result = ctx.events.find((e) => e.topic === "task.result");
  assert.ok(result, "scheduled task should have produced a wake event");
  assert.equal((result!.data as any).status, "ok");
  assert.equal((result!.data as any).method, "phone.ring");
  assert.equal((result!.data as any).result.rang, true);
});
