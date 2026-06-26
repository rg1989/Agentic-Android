import { test } from "node:test";
import assert from "node:assert/strict";
import { Scheduler, type Task, type SchedulerDeps } from "../src/scheduler.ts";

/** A controllable test harness: a clock we advance by hand and timers we fire by hand. */
function harness(initial: Task[] = []) {
  let clock = 1000;
  let seq = 0;
  const timers: { id: number; due: number; fn: () => void }[] = [];
  let persisted: Task[] = [...initial];
  const fired: Task[] = [];
  const deps: SchedulerDeps = {
    now: () => clock,
    setTimer: (ms, fn) => { const id = ++seq; timers.push({ id, due: clock + ms, fn }); return id; },
    clearTimer: (h) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); },
    persist: (tasks) => { persisted = tasks.map((t) => ({ ...t })); },
    load: () => persisted.map((t) => ({ ...t })),
    fire: (t) => { fired.push(t); },
    genId: () => `task${++seq}`,
  };
  // advance the clock and fire any timers now due (one shot — fired timers are removed)
  const advance = (ms: number) => {
    clock += ms;
    for (const t of [...timers]) {
      if (t.due <= clock) { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); t.fn(); }
    }
  };
  return { deps, advance, fired, get persisted() { return persisted; }, get timers() { return timers; } };
}

test("one-shot task fires once then is gone + persisted", async () => {
  const h = harness();
  const s = new Scheduler(h.deps);
  const t = s.add({ method: "camera.capture", args: { w: 1 }, delayMs: 5000 });
  assert.equal(s.list().length, 1);
  assert.equal(h.persisted.length, 1);
  h.advance(5000);
  await Promise.resolve();
  assert.equal(h.fired.length, 1);
  assert.equal(h.fired[0].method, "camera.capture");
  assert.equal(s.list().length, 0, "one-shot removed after firing");
  assert.equal(h.persisted.length, 0, "persisted store emptied");
  assert.equal(t.method, "camera.capture");
});

test("recurring task re-arms after each fire", async () => {
  const h = harness();
  const s = new Scheduler(h.deps);
  s.add({ method: "device.info", everyMs: 1000 });
  h.advance(1000); await Promise.resolve();
  h.advance(1000); await Promise.resolve();
  h.advance(1000); await Promise.resolve();
  assert.equal(h.fired.length, 3, "fired every interval");
  assert.equal(s.list().length, 1, "still scheduled");
});

test("cancel removes the task and its timer", () => {
  const h = harness();
  const s = new Scheduler(h.deps);
  const t = s.add({ method: "phone.ring", delayMs: 9999 });
  assert.equal(s.cancel(t.id), true);
  assert.equal(s.list().length, 0);
  assert.equal(h.timers.length, 0, "timer cleared");
  assert.equal(s.cancel("nope"), false);
});

test("loadAndArm restores persisted tasks and fires them", async () => {
  const existing: Task[] = [{ id: "x1", fireAt: 3000, method: "device.info", args: {}, createdAt: 0 }];
  const h = harness(existing);
  const s = new Scheduler(h.deps);
  s.loadAndArm();
  assert.equal(s.list().length, 1, "re-armed from disk");
  h.advance(2000); await Promise.resolve();
  assert.equal(h.fired.length, 1, "the restored task fired");
});

test("absolute atMs schedules at that time", () => {
  const h = harness();
  const s = new Scheduler(h.deps);
  const t = s.add({ method: "x", atMs: 1000 + 60_000 });
  assert.equal(t.fireAt, 61_000);
});
