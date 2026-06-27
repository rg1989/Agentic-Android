import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDelegator } from "../src/delegate.ts";

function harness(timeoutMs = 1000) {
  const sends: { id: string; text: string; askId: string }[] = [];
  let n = 0;
  let throwOnText: string | null = null;
  const d = makeDelegator({
    newId: () => `ask${++n}`,
    timeoutMs,
    send: (id, text, askId) => {
      if (throwOnText !== null && text === throwOnText) throw new Error("closed");
      sends.push({ id, text, askId });
    },
  });
  return { d, sends, setThrow: (t: string | null) => { throwOnText = t; } };
}

test("single ask resolves with the reply matched by askId", async () => {
  const { d, sends } = harness();
  const p = d.ask("A", "hi");
  assert.equal(sends.length, 1);
  assert.equal(d.onReply("A", sends[0].askId, "hello back"), true);
  assert.equal(await p, "hello back");
});

test("two asks to the same agent serialize: one in flight, FIFO", async () => {
  const { d, sends } = harness();
  const p1 = d.ask("A", "first");
  const p2 = d.ask("A", "second");
  assert.equal(sends.length, 1);
  assert.equal(sends[0].text, "first");
  d.onReply("A", sends[0].askId, "r1");
  assert.equal(await p1, "r1");
  assert.equal(sends.length, 2);
  assert.equal(sends[1].text, "second");
  d.onReply("A", sends[1].askId, "r2");
  assert.equal(await p2, "r2");
});

test("asks to different agents run in parallel", () => {
  const { d, sends } = harness();
  d.ask("A", "a"); d.ask("B", "b");
  assert.deepEqual(sends.map((s) => s.id).sort(), ["A", "B"]);
});

test("timeout resolves the job; a late reply with the timed-out askId is ignored", async () => {
  const { d, sends } = harness(20);
  const p1 = d.ask("A", "slow");
  const askId1 = sends[0].askId;
  const p2 = d.ask("A", "next");
  assert.equal(await p1, "(no reply within timeout)");
  assert.equal(sends.length, 2);
  const askId2 = sends[1].askId;
  assert.equal(d.onReply("A", askId1, "late-first-answer"), false);
  d.onReply("A", askId2, "second-answer");
  assert.equal(await p2, "second-answer");
});

test("a duplicate reply with an already-resolved askId is a no-op", async () => {
  const { d, sends } = harness();
  const p = d.ask("A", "x");
  assert.equal(d.onReply("A", sends[0].askId, "first"), true);
  assert.equal(await p, "first");
  assert.equal(d.onReply("A", sends[0].askId, "second"), false);
});

test("a throwing send fails that job as disconnected, no pending timer", async () => {
  const { d, sends, setThrow } = harness();
  const p1 = d.ask("A", "ok");
  d.onReply("A", sends[0].askId, "r1");
  await p1;
  setThrow("boom");
  const p2 = d.ask("A", "boom");
  assert.equal(await p2, "(agent disconnected)");
  assert.equal(d.pending("A"), 0);
});

test("onGone rejects all queued asks; onReply unknown askId returns false", async () => {
  const { d } = harness();
  const p1 = d.ask("A", "a");
  const p2 = d.ask("A", "b");
  d.onGone("A");
  assert.equal(await p1, "(agent disconnected)");
  assert.equal(await p2, "(agent disconnected)");
  assert.equal(d.pending("A"), 0);
  assert.equal(d.onReply("A", "nope", "x"), false);
  assert.equal(d.onReply("A", undefined, "x"), false);
});
