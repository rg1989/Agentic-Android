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
import { runAgent, type AgentAdapter } from "./agent-runner.ts";

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
  JSON.stringify({ mcpServers: { phone: { command: tsxBin(), args: [path.join(HERE, "phone-mcp.ts")], env: { HUB_HTTP } } } }, null, 2),
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

/** Run one user turn through `omp -p` — text mode, so the reply is just stdout. */
function runTurn(text: string): Promise<string> {
  return new Promise((resolve) => {
    const args = ["-p", "--auto-approve", "--session-dir", sessionDir];
    if (hasSession) args.push("--continue");            // keep the same conversation going (memory!)
    else args.push("--append-system-prompt", SYSTEM);   // seed identity/instructions on the first turn
    args.push(text);
    const child = spawn(CLI, args, { cwd: workDir, env: process.env });
    // The prompt rides as an arg — close stdin so omp doesn't block waiting for piped input.
    try { child.stdin?.end(); } catch { /* */ }
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve(`Couldn't run "${CLI}": ${String(e)}. Is it installed and on PATH?`));
    child.on("close", () => {
      const reply = out.trim();
      if (reply) { hasSession = true; return resolve(reply); } // a session now exists to --continue next turn
      const e = err.trim();
      if (e && NEEDS_AUTH.test(e)) return resolve(AUTH_HELP);
      resolve(e || "(no reply)");
    });
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
