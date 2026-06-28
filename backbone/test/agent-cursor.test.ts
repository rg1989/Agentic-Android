import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCursorResult } from "../src/agent-cursor.ts";

test("pulls reply, session id, and ok status from a single json result object", () => {
  const out = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "PONG", session_id: "abc-123" });
  assert.deepEqual(parseCursorResult(out), { text: "PONG", sessionId: "abc-123", isError: false });
});

test("flags an error result so the adapter can map it to a remediation", () => {
  const out = JSON.stringify({ type: "result", is_error: true, result: "401 Unauthorized", session_id: "x" });
  const r = parseCursorResult(out);
  assert.equal(r.isError, true);
  assert.equal(r.text, "401 Unauthorized");
});

test("scans from the end of an NDJSON stream for the final result object", () => {
  const out = [
    JSON.stringify({ type: "system" }),
    JSON.stringify({ type: "assistant", message: "thinking…" }),
    JSON.stringify({ type: "result", is_error: false, result: "done", session_id: "s9" }),
  ].join("\n");
  assert.deepEqual(parseCursorResult(out), { text: "done", sessionId: "s9", isError: false });
});

test("no parseable result (e.g. text format) falls back to raw stdout", () => {
  assert.deepEqual(parseCursorResult("just plain text\n"), { text: "just plain text", isError: false });
});
