import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Envelope,
  InnerMessage,
  parseFrame,
  parseInner,
  encodeInner,
  newId,
  PROTOCOL_VERSION,
} from "../src/protocol.ts";

test("newId produces unique ids", () => {
  const ids = new Set(Array.from({ length: 1000 }, () => newId()));
  assert.equal(ids.size, 1000);
});

test("Envelope validates a well-formed envelope", () => {
  const env = { v: PROTOCOL_VERSION, id: "m1", from: "aa", to: "bb", ts: 123, enc: "Y2lwaGVy" };
  assert.deepEqual(Envelope.parse(env), env);
});

test("Envelope rejects missing/invalid fields", () => {
  assert.throws(() => Envelope.parse({ v: 1, id: "m1", from: "aa", to: "bb", ts: 1 })); // no enc
  assert.throws(() => Envelope.parse({ v: 2, id: "m1", from: "aa", to: "bb", ts: 1, enc: "x" })); // bad version
});

test("parseFrame distinguishes control frames from envelopes", () => {
  const ctl = parseFrame(JSON.stringify({ ctl: "challenge", nonce: "abc" }));
  assert.equal(ctl.kind, "ctl");
  const env = parseFrame(JSON.stringify({ v: 1, id: "m", from: "a", to: "b", ts: 0, enc: "z" }));
  assert.equal(env.kind, "env");
});

test("parseFrame rejects unknown control frames", () => {
  assert.throws(() => parseFrame(JSON.stringify({ ctl: "nope" })));
});

test("InnerMessage round-trips all 4 kinds", () => {
  const msgs: InnerMessage[] = [
    { type: "request", method: "phone.ring", params: { ms: 2000 } },
    { type: "response", reply_to: "m1", status: "ok", result: { ok: true } },
    { type: "event", topic: "user_message", data: { text: "hi" } },
    { type: "ack", ack: "m1" },
  ];
  for (const m of msgs) assert.deepEqual(parseInner(encodeInner(m)), m);
});

test("response without reply_to is rejected", () => {
  assert.throws(() => InnerMessage.parse({ type: "response", status: "ok" }));
});

test("unknown inner type is rejected", () => {
  assert.throws(() => InnerMessage.parse({ type: "frobnicate" }));
});
