/**
 * agent-cursor — drive the phone with Cursor's `cursor-agent` CLI as the brain.
 *
 * cursor-agent's headless surface differs from Claude's, so it can't reuse agent-cli.ts:
 *   - MCP servers are file-based (no --mcp-config): it merges `~/.cursor/mcp.json` + `<cwd>/.cursor/mcp.json`,
 *     so — omp-style — we write a temp `.cursor/mcp.json` and run with cwd there.
 *   - Tool approval is `--trust --force --approve-mcps` (no --dangerously-skip-permissions).
 *   - There's no --append-system-prompt, so we fold identity into the FIRST user prompt only.
 * Memory rides on the `session_id` it returns in `--output-format json`, replayed via `--resume` next turn
 * (the same Claude-compatible final fields: `result`, `is_error`, `session_id`). Auth is Cursor's own
 * (`cursor-agent login` / CURSOR_API_KEY) — we never see a key; a cheap `cursor-agent status` probe surfaces
 * "not signed in" truthfully instead of a 401 on the first message.
 *
 * Run: `pnpm agent:cursor` (the hub must be running; `cursor-agent` must be logged in or keyed).
 * Override the binary with env AGENT_CLI; point at a different hub with HUB_HTTP / HUB_URL.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runAgent, buildHubServers, type AgentAdapter, type TurnContext } from "./agent-runner.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HUB_HTTP = process.env.HUB_HTTP ?? "http://127.0.0.1:8123";
const CLI = process.env.AGENT_CLI ?? "cursor-agent";

/** A truthful label for WHERE the agent runs, so it stops claiming to "be" the phone. */
const HOST = (() => {
  const plat: Record<string, string> = { darwin: "macOS", linux: "Linux", win32: "Windows" };
  return `${os.hostname()} (${plat[os.platform()] ?? os.platform()})`;
})();
const SYSTEM =
  `You are the user's personal agent. You run as a process on the user's OWN COMPUTER — ${HOST} — ` +
  'connected to a local "hub" over a WebSocket; your replies travel back to the user through that hub. ' +
  "You are NOT running on the phone. The Android phone is a SEPARATE edge device that you can see and " +
  "remotely control through the `phone` MCP tools (take photos, read/tap/type/swipe the screen, screenshot, " +
  "location, device info, flashlight, ring, open apps, and more). When the user asks you to do something on " +
  "the phone, actually use those tools, then reply concisely about what happened. If the user asks where you " +
  `are running, answer truthfully: on their computer (${HOST}) via the hub — the phone is only the device you operate.`;
const ORCH = process.env.AGENT_HUBS
  ? " You also coordinate other harnesses. Use the hub_* tools: list_agents to see who is available and their strengths; ask_agent to delegate ONE subtask to ONE harness. When you have independent subtasks for DIFFERENT harnesses, call ask_agents (plural) with all of them in one call so they run AT THE SAME TIME — do not chain ask_agent calls, that runs them one-after-another. For a large task: split it, ask_agents the best-suited workers in parallel, then synthesize one reply. Never delegate to the harness marked active — that is you."
  : "";
const SYSTEM_FULL = SYSTEM + ORCH;

function tsxBin(): string {
  const local = path.join(HERE, "..", "node_modules", ".bin", "tsx");
  return fs.existsSync(local) ? local : "tsx";
}

// One working dir for this process: holds the phone `.cursor/mcp.json` cursor-agent auto-discovers from cwd.
// Reused every turn (the MCP config never changes) and removed on exit. It lives under the OS temp dir.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-agent-"));
fs.mkdirSync(path.join(workDir, ".cursor"), { recursive: true });
fs.writeFileSync(
  path.join(workDir, ".cursor", "mcp.json"),
  JSON.stringify({ mcpServers: { phone: { command: tsxBin(), args: [path.join(HERE, "phone-mcp.ts")], env: { HUB_HTTP } }, ...buildHubServers(process.env.AGENT_HUBS, tsxBin(), path.join(HERE, "hub-mcp.ts"), process.env.ASK_DEPTH ?? "0") } }, null, 2),
);
process.on("exit", () => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* */ } });

// cursor-agent is stateless per call; we keep ONE chat alive across turns via the session_id it returns,
// replayed with --resume — otherwise the agent forgets what it just said between messages.
let sessionId: string | undefined;
function resetSession() { sessionId = undefined; }

const AUTH_HELP =
  "Cursor isn't signed in on the computer running the hub. On that computer run `cursor-agent login` " +
  "(or set CURSOR_API_KEY in the environment), then try again.";
const NEEDS_AUTH = /unauthor|401|403|not (?:authenticated|logged|signed)|api[\s._-]?key|sign[\s-]?in|log[\s-]?in|credential/i;

/** Pull the final reply out of `cursor-agent -p --output-format json` stdout. The format emits the
 *  result object (Claude-compatible: result/is_error/session_id); be tolerant of an NDJSON stream by
 *  scanning from the END for the last parseable object that carries a result. Pure so it's unit-tested. */
export function parseCursorResult(out: string): { text: string; sessionId?: string; isError: boolean } {
  const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const j = JSON.parse(lines[i]);
      if (j && typeof j === "object" && ("result" in j || j.type === "result")) {
        return {
          text: typeof j.result === "string" ? j.result : "",
          sessionId: typeof j.session_id === "string" ? j.session_id : undefined,
          isError: j.is_error === true,
        };
      }
    } catch { /* partial / non-JSON line */ }
  }
  return { text: out.trim(), isError: false }; // fell through (e.g. --output-format text) — use raw stdout
}

/** One-time startup auth check: `cursor-agent status --format json` → isAuthenticated. Cheap (no model call). */
function probeAuth(): Promise<{ ok: boolean; command?: string }> {
  return new Promise((resolve) => {
    const child = spawn(CLI, ["status", "--format", "json"], { env: process.env });
    try { child.stdin?.end(); } catch { /* */ }
    let out = "";
    const timer = setTimeout(() => { try { child.kill(); } catch { /* */ } resolve({ ok: true }); }, 10000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => { clearTimeout(timer); resolve({ ok: false, command: "cursor-agent login" }); });
    child.on("close", () => {
      clearTimeout(timer);
      try { if (JSON.parse(out).isAuthenticated === false) return resolve({ ok: false, command: "cursor-agent login" }); }
      catch { /* not JSON — assume the CLI ran */ }
      resolve({ ok: true });
    });
  });
}

/** Run one user turn through cursor-agent in headless json mode.
 *  ponytail: no stream-json narration yet — cursor's event schema (tool_call/thinking) differs from Claude's
 *  and isn't pinned, so we take the final json result only. Add a parse-cursor-stream.ts + watch path when
 *  the per-event schema is confirmed, to light up the orchestration tree like claude/omp do. */
function runTurn(text: string, ctx?: TurnContext): Promise<string> {
  return new Promise((resolve) => {
    // First turn (no session yet): fold identity into the prompt — cursor-agent has no --append-system-prompt.
    const prompt = sessionId ? text : `${SYSTEM_FULL}\n\n---\n\n${text}`;
    const args = ["-p", "--output-format", "json", "--trust", "--force", "--approve-mcps"];
    if (sessionId) args.push("--resume", sessionId);    // keep the same conversation going (memory!)
    args.push(prompt);
    const child = spawn(CLI, args, { cwd: workDir, env: process.env });
    // The prompt rides as an arg — close stdin so cursor-agent doesn't block waiting for piped input.
    try { child.stdin?.end(); } catch { /* */ }
    ctx?.signal?.addEventListener("abort", () => { try { child.kill("SIGTERM"); } catch { /* */ } }); // Stop → kill this run
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve(`Couldn't run "${CLI}": ${String(e)}. Is it installed and on PATH?`));
    child.on("close", () => {
      const r = parseCursorResult(out);
      if (r.sessionId) sessionId = r.sessionId;          // remember the chat for next turn
      if (r.isError) {
        if (NEEDS_AUTH.test(r.text)) return resolve(AUTH_HELP);
        return resolve(r.text ? `Agent error: ${r.text}` : (err.trim() || "Agent error"));
      }
      if (r.text) return resolve(r.text);
      const e = err.trim();
      resolve(e && NEEDS_AUTH.test(e) ? AUTH_HELP : (e || "(no reply)"));
    });
  });
}

const adapter: AgentAdapter = {
  name: process.env.AGENT_NAME ?? "Cursor",
  // Verify Cursor is signed in here, so the phone/web show the truth (and the exact fix) up front.
  probe: () => probeAuth().then((p) => (p.ok ? { ok: true } : { ok: false, label: "⚠ Sign in to Cursor on your computer", command: p.command })),
  runTurn,
  reset: resetSession,
  // A fresh login starting to work (or breaking) flips the phone/web state on the next message.
  authFailed: (reply) => (reply === AUTH_HELP ? { label: "⚠ Sign in to Cursor on your computer", command: "cursor-agent login" } : null),
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAgent(adapter);
}
