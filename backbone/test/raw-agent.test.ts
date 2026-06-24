/**
 * raw-agent.test.ts — proves that a scripted (non-LLM) agent drives the phone over the bus
 * WITHOUT any MCP client/transport in the picture (DESIGN.md Q3).
 *
 * Wiring: createRelay() + PhoneSim (counterpart) + RawAgent (agent-under-test).
 * No @modelcontextprotocol import anywhere in raw-agent.ts — grep-checkable.
 */
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRelay, type Relay } from "../src/relay.ts";
import { PhoneSim } from "../src/phone-sim.ts";
import { ready, generateIdentity } from "../src/crypto.ts";
import { RawAgent, type CatalogEntry, type EventMsg } from "../examples/raw-agent.ts";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Ctx {
  relay: Relay;
  phone: PhoneSim;
  agent: RawAgent;
}
let ctx: Ctx;

before(async () => {
  await ready();
});

beforeEach(async () => {
  const relay = createRelay();
  const port = await relay.listen();
  const url = `http://127.0.0.1:${port}`;

  const P = generateIdentity();
  const G = generateIdentity();

  const phone = new PhoneSim(P, G.edPub, url);
  await phone.connect();

  const agent = new RawAgent(G, P.edPub, url);
  await agent.connect();

  ctx = { relay, phone, agent };
});

afterEach(async () => {
  ctx.agent.close();
  ctx.phone.close();
  await ctx.relay.close();
});

test("RawAgent.listCapabilities() returns the phone catalog without any MCP client in the picture", async () => {
  const caps: CatalogEntry[] = await ctx.agent.listCapabilities();
  const methods = caps.map((c) => c.method);
  // Verify several well-known capabilities are present.
  for (const expected of ["phone.ring", "camera.capture", "camera.state", "sms.send", "device.wipe"]) {
    assert.ok(methods.includes(expected), `expected ${expected} in catalog [${methods.join(", ")}]`);
  }
  // Every entry has the required fields.
  for (const cap of caps) {
    assert.ok(typeof cap.method === "string" && cap.method.length > 0, "method must be a non-empty string");
    assert.ok(typeof cap.summary === "string", "summary must be a string");
    assert.ok(["allow", "ask", "deny"].includes(cap.sensitivity), `unexpected sensitivity: ${cap.sensitivity}`);
  }
});

test("scripted call('phone.ring', {ms:1000}) returns status ok with {rang:true, ms:1000}", async () => {
  const resp = await ctx.agent.call("phone.ring", { ms: 1000 });
  assert.equal(resp.status, "ok");
  assert.deepEqual(resp.result, { rang: true, ms: 1000 });
});

test("phone-initiated emitUserMessage() is delivered to onPhoneEvent", async () => {
  const received: EventMsg[] = [];
  ctx.agent.onPhoneEvent((ev) => received.push(ev));

  ctx.phone.emitUserMessage("ping from the phone");
  await delay(50);

  const msg = received.find((e) => e.topic === "user_message");
  assert.ok(msg, "expected a user_message event to be received by the agent");
  assert.equal((msg.data as any).text, "ping from the phone");
});

test("typed error CAMERA_IN_USE surfaces as ResponseMsg.error.code after setting phone.cameraHeld", async () => {
  ctx.phone.cameraHeld = true;
  const resp = await ctx.agent.call("camera.capture");
  assert.equal(resp.status, "error");
  assert.ok(resp.error, "expected an error object");
  assert.equal(resp.error.code, "CAMERA_IN_USE");
  assert.equal(resp.error.retriable, true);
});
