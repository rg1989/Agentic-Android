import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../src/agent-cli.ts";

// Guards the regression that leaked CLI errors into chat: a file-only message used to produce an
// empty prompt → `claude -p ""` → "no stdin"/"provide a prompt" errors. buildPrompt must never return blank
// when there's text OR files, and must hand the agent the saved path so it can open the file.

test("text only → unchanged", () => {
  assert.equal(buildPrompt("hello", []), "hello");
});

test("file only → non-empty prompt that names the saved path", () => {
  const p = buildPrompt("", [{ path: "/tmp/x/notes.txt", name: "notes.txt", mime: "text/plain" }]);
  assert.notEqual(p.trim(), "");
  assert.match(p, /\/tmp\/x\/notes\.txt/);
  assert.match(p, /notes\.txt/);
});

test("text + file → both present", () => {
  const p = buildPrompt("summarize this", [{ path: "/tmp/a.json", name: "a.json" }]);
  assert.match(p, /summarize this/);
  assert.match(p, /\/tmp\/a\.json/);
});

test("two files → counts them", () => {
  const p = buildPrompt("", [
    { path: "/tmp/a", name: "a" },
    { path: "/tmp/b", name: "b" },
  ]);
  assert.match(p, /2 files/);
});
