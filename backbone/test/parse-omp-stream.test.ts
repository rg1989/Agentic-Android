import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOmpEvent } from "../src/parse-omp-stream.ts";

test("tool_execution_start becomes a tool activity with the intent as detail", () => {
  const ev = parseOmpEvent({ type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: { command: "echo hi" }, intent: "Echo hi" });
  assert.deepEqual({ id: ev.activities[0].id, kind: ev.activities[0].kind, name: ev.activities[0].name, detail: ev.activities[0].detail, status: ev.activities[0].status },
    { id: "call_1", kind: "tool", name: "bash", detail: "Echo hi", status: "start" });
});

test("a subagent/dispatch tool is labelled as a subagent", () => {
  assert.equal(parseOmpEvent({ type: "tool_execution_start", toolCallId: "c", toolName: "task" }).activities[0].kind, "subagent");
  assert.equal(parseOmpEvent({ type: "tool_execution_start", toolCallId: "c", toolName: "dispatch_agent" }).activities[0].kind, "subagent");
  assert.equal(parseOmpEvent({ type: "tool_execution_start", toolCallId: "c", toolName: "read" }).activities[0].kind, "tool");
});

test("tool_execution_end closes the activity by id with its error flag + a short result", () => {
  const ev = parseOmpEvent({ type: "tool_execution_end", toolCallId: "call_1", toolName: "bash", result: "hi\n", isError: false });
  assert.equal(ev.activities[0].id, "call_1");
  assert.equal(ev.activities[0].status, "end");
  assert.equal(ev.activities[0].error, false);
  assert.equal(ev.activities[0].reply, "hi");
});

test("assistant message_end yields the running answer text; agent_end yields the final", () => {
  const mid = parseOmpEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "partial" }] } });
  assert.equal(mid.text, "partial");
  const user = parseOmpEvent({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "prompt" }] } });
  assert.equal(user.text, undefined);
  const end = parseOmpEvent({ type: "agent_end", messages: [
    { role: "user", content: [{ type: "text", text: "q" }] },
    { role: "assistant", content: [{ type: "text", text: "the answer" }] },
  ] });
  assert.deepEqual(end.final, { text: "the answer" });
});
