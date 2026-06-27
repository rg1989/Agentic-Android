/**
 * agent-verify.test.ts — the self-test/heartbeat state machine, driven by a fake clock so the deadlines
 * fire deterministically (same injected-deps trick as scheduler.test.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Verifier, type Diagnostic } from "../src/agent-verify.ts";

function harness(opts: { selftestTimeoutMs?: number; heartbeatGraceMs?: number } = {}) {
  let t = 0;
  let nextId = 1;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  const diags: Diagnostic[] = [];
  let changes = 0;
  const v = new Verifier({
    now: () => t,
    setTimer: (ms, fn) => { const id = nextId++; timers.push({ at: t + ms, fn, id }); return id; },
    clearTimer: (h) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); },
    onDiagnose: (d) => diags.push(d),
    onChange: () => { changes++; },
    remedy: "run the client",
    ...opts,
  });
  const advance = (ms: number) => {
    t += ms;
    for (const tm of [...timers]) {
      if (tm.at <= t) { const i = timers.indexOf(tm); if (i >= 0) timers.splice(i, 1); tm.fn(); }
    }
  };
  return { v, advance, diags, changeCount: () => changes };
}

test("agent that never answers the self-test is marked failed with exactly one diagnostic", () => {
  const h = harness({ selftestTimeoutMs: 8000 });
  h.v.onConnect("a", "Hermes");
  assert.equal(h.v.status("a"), "verifying");
  assert.equal(h.diags.length, 0);
  h.advance(8000);
  assert.equal(h.v.status("a"), "failed");
  assert.equal(h.diags.length, 1);
  assert.match(h.diags[0].problem, /self-test|reading the socket/i);
  assert.equal(h.diags[0].remedy, "run the client");
});

test("selftest_ok before the deadline → verified, deadline never fires", () => {
  const h = harness();
  h.v.onConnect("a", "Hermes");
  h.advance(2000);
  h.v.onAlive("a"); // selftest_ok arrived
  assert.equal(h.v.status("a"), "verified");
  h.advance(20000); // the old deadline must have been cleared
  assert.equal(h.v.status("a"), "verified");
  assert.equal(h.diags.length, 0);
});

test("a real reply self-heals an already-failed agent", () => {
  const h = harness();
  h.v.onConnect("a", "Hermes");
  h.advance(8000);
  assert.equal(h.v.status("a"), "failed");
  h.v.onAlive("a"); // first real assistant_message
  assert.equal(h.v.status("a"), "verified");
});

test("a verified, heartbeat-aware agent goes stale when beats stop, and revives on a fresh beat", () => {
  const h = harness({ heartbeatGraceMs: 45000 });
  h.v.onConnect("a", "Hermes");
  h.v.onHeartbeat("a"); // alive + proves it's heartbeat-aware
  assert.equal(h.v.status("a"), "verified");
  h.advance(50000);
  h.v.sweep();
  assert.equal(h.v.status("a"), "stale");
  assert.equal(h.diags.length, 1);
  h.v.onHeartbeat("a");
  assert.equal(h.v.status("a"), "verified");
});

test("an agent that never sent a heartbeat is never swept to stale", () => {
  const h = harness();
  h.v.onConnect("a", "Hermes");
  h.v.onAlive("a"); // verified via selftest_ok, but no heartbeat
  h.advance(10_000_000);
  h.v.sweep();
  assert.equal(h.v.status("a"), "verified");
});

test("remove() cancels a pending deadline so it can't fire later", () => {
  const h = harness();
  h.v.onConnect("a", "Hermes");
  h.v.remove("a");
  h.advance(20000);
  assert.equal(h.v.status("a"), null);
  assert.equal(h.diags.length, 0);
});
