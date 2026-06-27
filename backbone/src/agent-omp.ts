/**
 * agent-omp — drive the phone with omp (Oh My Pi), the open-source coding agent, as the brain.
 *
 * Like agent-cli but for omp's CLI surface: omp discovers MCP servers from a `.mcp.json` in its WORKING
 * DIRECTORY (no --mcp-config flag), skips tool prompts with --auto-approve (no --yolo), and keeps
 * conversation memory with --continue against a private --session-dir. In print mode (`omp -p`) the
 * final assistant text goes straight to stdout, so there's no JSON event stream to parse.
 *
 * Run: `pnpm agent:omp` (the hub must be running; omp must have a provider key or its own login).
 * Override the binary with env AGENT_CLI; point at a different hub with HUB_HTTP / HUB_URL.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runAgent, buildHubServers, type AgentAdapter, type TurnContext } from "./agent-runner.ts";
import { makeLineParser } from "./parse-claude-stream.ts";
import { parseOmpEvent } from "./parse-omp-stream.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HUB_HTTP = process.env.HUB_HTTP ?? "http://127.0.0.1:8123";
const CLI = process.env.AGENT_CLI ?? "omp";

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
  ? " You also coordinate other agents. Use the hub_* tools: list_agents to see who is available and their strengths; ask_agent to delegate a subtask (use the agent's id when names repeat) and get its answer. For a large task, split it, delegate to the best-suited workers (in parallel when independent), then synthesize one reply. Never delegate to the agent marked active — that is you."
  : "";
const SYSTEM_FULL = SYSTEM + ORCH;

function tsxBin(): string {
  const local = path.join(HERE, "..", "node_modules", ".bin", "tsx");
  return fs.existsSync(local) ? local : "tsx";
}

// One working dir for this process: holds the phone `.mcp.json` omp discovers + its session store.
// Reused every turn (the MCP config never changes) and removed on exit. It lives under the OS temp dir,
// NOT under $HOME, so omp won't auto-switch away from it (see omp's --allow-home).
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-agent-"));
const sessionDir = path.join(workDir, "sessions");
fs.writeFileSync(
  path.join(workDir, ".mcp.json"),
  JSON.stringify({ mcpServers: { phone: { command: tsxBin(), args: [path.join(HERE, "phone-mcp.ts")], env: { HUB_HTTP } }, ...buildHubServers(process.env.AGENT_HUBS, tsxBin(), path.join(HERE, "hub-mcp.ts"), process.env.ASK_DEPTH ?? "0") } }, null, 2),
);
process.on("exit", () => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* */ } });

// omp -p is stateless per call; --continue resumes the latest session in our private session-dir, so the
// agent keeps memory across turns. `hasSession` flips on only after a turn actually produces a session.
let hasSession = false;
function resetSession() { hasSession = false; }

const AUTH_HELP =
  "omp isn't set up with a model provider on this computer. Set ANTHROPIC_API_KEY (or another provider " +
  "key) in the environment, or run `omp` once interactively to sign in, then try again.";
const NEEDS_AUTH = /api[\s._-]?key|unauthor|401|403|credential|not (?:configured|authenticated)|no .*provider|sign[\s-]?in|log[\s-]?in/i;

/** Run one user turn through omp. Text mode normally; `--mode=json` when the hub is watching internals
 *  (ctx.onActivity), so we can narrate omp's tool calls + subagents the same way Claude does. */
function runTurn(text: string, ctx?: TurnContext): Promise<string> {
  return new Promise((resolve) => {
    const watch = !!ctx?.onActivity;
    const args = ["-p", ...(watch ? ["--mode", "json"] : []), "--auto-approve", "--session-dir", sessionDir];
    if (hasSession) args.push("--continue");            // keep the same conversation going (memory!)
    else args.push("--append-system-prompt", SYSTEM_FULL); // seed identity/instructions on the first turn
    args.push(text);
    const child = spawn(CLI, args, { cwd: workDir, env: process.env });
    // The prompt rides as an arg — close stdin so omp doesn't block waiting for piped input.
    try { child.stdin?.end(); } catch { /* */ }
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve(`Couldn't run "${CLI}": ${String(e)}. Is it installed and on PATH?`));
    const settle = (reply: string) => {
      const r = reply.trim();
      if (r) { hasSession = true; return resolve(r); } // a session now exists to --continue next turn
      const e = err.trim();
      resolve(e && NEEDS_AUTH.test(e) ? AUTH_HELP : (e || "(no reply)"));
    };

    if (watch) {
      let final: string | null = null, lastText = "";
      const feed = makeLineParser((obj) => {
        const ev = parseOmpEvent(obj);
        for (const a of ev.activities) ctx!.onActivity!(a);
        if (ev.text) lastText = ev.text;
        if (ev.final) final = ev.final.text || lastText;
      });
      child.stdout.on("data", (d) => feed(d.toString()));
      child.on("close", () => settle(final ?? lastText));
      return;
    }

    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => settle(out));
  });
}

// ponytail: no upfront probe — that would burn a model call on every spawn. We announce "Ready" and let
// the FIRST turn's stderr self-heal readiness via authFailed (same end-state as a probe, for free).
const adapter: AgentAdapter = {
  name: process.env.AGENT_NAME ?? "omp",
  runTurn,
  reset: resetSession,
  authFailed: (reply) => (reply === AUTH_HELP ? { label: "⚠ Set up omp on your computer" } : null),
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAgent(adapter);
}
