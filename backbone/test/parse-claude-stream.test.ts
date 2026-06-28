import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClaudeEvent, makeLineParser } from "../src/parse-claude-stream.ts";

test("a Task tool_use becomes a subagent activity with type + description", () => {
  const ev = parseClaudeEvent({ type: "assistant", parent_tool_use_id: null, session_id: "s1",
    message: { content: [{ type: "tool_use", id: "toolu_1", name: "Task", input: { subagent_type: "researcher", description: "find sources" } }] } });
  assert.equal(ev.activities.length, 1);
  const a = ev.activities[0];
  assert.deepEqual({ id: a.id, kind: a.kind, name: a.name, detail: a.detail, parentId: a.parentId, status: a.status },
    { id: "toolu_1", kind: "subagent", name: "researcher", detail: "find sources", parentId: null, status: "start" });
  assert.equal(ev.sessionId, "s1");
});

test("a non-Task tool_use is a tool activity; a subagent's own tool nests via parent_tool_use_id", () => {
  const top = parseClaudeEvent({ type: "assistant", parent_tool_use_id: null,
    message: { content: [{ type: "tool_use", id: "toolu_read", name: "Read", input: { file_path: "/x" } }] } });
  assert.equal(top.activities[0].kind, "tool");
  assert.equal(top.activities[0].name, "Read");
  assert.equal(top.activities[0].parentId, null);
  const nested = parseClaudeEvent({ type: "assistant", parent_tool_use_id: "toolu_1",
    message: { content: [{ type: "tool_use", id: "toolu_bash", name: "Bash", input: {} }] } });
  assert.equal(nested.activities[0].parentId, "toolu_1", "tool spawned by the subagent nests under its Task");
});

test("a tool_result closes the matching activity by id", () => {
  const ev = parseClaudeEvent({ type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: false }] } });
  assert.deepEqual({ id: ev.activities[0].id, status: ev.activities[0].status }, { id: "toolu_1", status: "end" });
});

test("top-level assistant text is the answer; subagent text is excluded", () => {
  const top = parseClaudeEvent({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "final answer" }] } });
  assert.equal(top.text, "final answer");
  const sub = parseClaudeEvent({ type: "assistant", parent_tool_use_id: "toolu_1", message: { content: [{ type: "text", text: "subagent chatter" }] } });
  assert.equal(sub.text, undefined);
});

test("result yields the final reply + session id + error flag", () => {
  const ok = parseClaudeEvent({ type: "result", subtype: "success", is_error: false, result: "done", session_id: "s2" });
  assert.deepEqual(ok.final, { text: "done", sessionId: "s2", isError: false });
  const bad = parseClaudeEvent({ type: "result", is_error: true, result: "boom" });
  assert.equal(bad.final?.isError, true);
});

test("makeLineParser handles split chunks + blank lines and skips garbage", () => {
  const got: any[] = [];
  const feed = makeLineParser((o) => got.push(o));
  feed('{"type":"sys'); feed('tem","subtype":"init"}\n\nnot json\n{"type":"result","result":"hi"}\n');
  assert.equal(got.length, 2);
  assert.equal(got[0].subtype, "init");
  assert.equal(got[1].result, "hi");
});

test("end-to-end: orchestrator spawns two subagents, each runs a tool, then a final answer", () => {
  const lines = [
    { type: "system", subtype: "init", session_id: "s" },
    { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "T1", name: "Task", input: { subagent_type: "researcher", description: "research" } }] } },
    { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "T2", name: "Task", input: { subagent_type: "writer", description: "write" } }] } },
    { type: "assistant", parent_tool_use_id: "T1", message: { content: [{ type: "tool_use", id: "R1", name: "WebSearch", input: {} }] } },
    { type: "user", parent_tool_use_id: "T1", message: { content: [{ type: "tool_result", tool_use_id: "R1", is_error: false }] } },
    { type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "T1", is_error: false }] } },
    { type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "T2", is_error: false }] } },
    { type: "result", subtype: "success", is_error: false, result: "all done", session_id: "s" },
  ];
  const acts: any[] = []; let final = "";
  for (const l of lines) { const ev = parseClaudeEvent(l); acts.push(...ev.activities); if (ev.final) final = ev.final.text; }
  const subs = acts.filter((a) => a.kind === "subagent" && a.status === "start");
  assert.deepEqual(subs.map((s) => s.name).sort(), ["researcher", "writer"]);
  const websearch = acts.find((a) => a.name === "WebSearch");
  assert.equal(websearch.parentId, "T1", "the researcher's WebSearch nests under it");
  const ends = acts.filter((a) => a.status === "end").map((a) => a.id).sort();
  assert.deepEqual(ends, ["R1", "T1", "T2"]);
  assert.equal(final, "all done");
});
