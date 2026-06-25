/**
 * agent-cli — a key-free agent that drives the phone with YOUR own command-line agent (your
 * `claude`, on your subscription — or any CLI). The glue (hub) never sees a key: this connects to
 * the hub like any agent, and on each user message runs the CLI with the phone exposed as MCP tools
 * (phone-mcp.ts). The CLI authenticates however the user already set it up — not our concern.
 *
 * Run: `pnpm agent:claude`  (the hub must be running; `claude` must be logged in on this machine).
 * Override the command with env AGENT_CLI, or agent.json is not consulted here on purpose — the
 * point is that auth lives entirely in the user's own tool.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";

/** The headless token saved via the setup UI (~/.agentic-android/agent.json brain.oauthToken). */
function savedToken(): string | undefined {
  try {
    const dir = process.env.AGENTIC_HOME ?? path.join(os.homedir(), ".agentic-android");
    const t = JSON.parse(fs.readFileSync(path.join(dir, "agent.json"), "utf8")).brain?.oauthToken;
    // Strip ALL whitespace, not just ends: copying a token out of a terminal often wraps it and
    // injects spaces/newlines mid-string, which silently 401s. Tokens never contain whitespace.
    if (typeof t === "string" && t.replace(/\s+/g, "")) return t.replace(/\s+/g, "");
  } catch { /* */ }
  return process.env.CLAUDE_CODE_OAUTH_TOKEN?.replace(/\s+/g, "");
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HUB_WS = process.env.HUB_URL ?? `ws://127.0.0.1:${process.env.AGENT_PORT ?? 8124}`;
const HUB_HTTP = process.env.HUB_HTTP ?? "http://127.0.0.1:8123";
const CLI = process.env.AGENT_CLI ?? "claude";

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

/** MCP config handed to the CLI: a `phone` server = our stdio phone-mcp, pointed at this hub. */
function mcpConfig(): string {
  return JSON.stringify({
    mcpServers: {
      phone: { command: tsxBin(), args: [path.join(HERE, "phone-mcp.ts")], env: { HUB_HTTP } },
    },
  });
}

/** Env for spawning the CLI: drop stray API key + child-session vars so it uses the user's own
 * (subscription / setup-token) auth instead of running credential-less. */
function claudeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  for (const k of Object.keys(env)) if (k === "CLAUDECODE" || (k.startsWith("CLAUDE_CODE_") && k !== "CLAUDE_CODE_OAUTH_TOKEN")) delete env[k];
  const tk = savedToken(); if (tk) env.CLAUDE_CODE_OAUTH_TOKEN = tk;
  return env;
}

const NEEDS_LOGIN = /401|authenticate|credential|unauthor|login/i;
/** Friendly, ACCURATE remediation when the CLI can't authenticate (no such command as `claude login`). */
const LOGIN_HELP =
  "I'm connected to your phone, but Claude isn't signed in on the computer running the hub. On that " +
  "computer, run `claude setup-token` and paste the token on the setup page (or just run `claude` once " +
  "and sign in), then try again — it uses your subscription, no API key needed.";

/** One-time startup check: can `claude -p` actually answer here? Returns remediation if not. */
function probeAuth(): Promise<{ ok: boolean; command?: string }> {
  return new Promise((resolve) => {
    const child = spawn(CLI, ["-p", "--output-format", "json", "ping"], { env: claudeEnv() });
    let out = "";
    const timer = setTimeout(() => { try { child.kill(); } catch { /* */ } resolve({ ok: true }); }, 15000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => { clearTimeout(timer); resolve({ ok: false }); });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        if (j.is_error && NEEDS_LOGIN.test(String(j.result ?? ""))) return resolve({ ok: false, command: "claude setup-token" });
      } catch { /* not JSON — assume the CLI ran */ }
      resolve({ ok: true });
    });
  });
}

/** Run one turn through the user's CLI agent. Defaults assume `claude -p` JSON output. */
function runTurn(text: string): Promise<string> {
  return new Promise((resolve) => {
    const args = [
      "-p", "--output-format", "json",
      "--mcp-config", mcpConfig(),
      "--dangerously-skip-permissions", // unattended: don't prompt for each phone tool
      "--append-system-prompt", SYSTEM,
      text,
    ];
    const child = spawn(CLI, args, { env: claudeEnv() });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve(`Couldn't run "${CLI}": ${String(e)}. Is it installed and logged in?`));
    child.on("close", () => {
      try {
        const j = JSON.parse(out);
        if (j.is_error) {
          const msg = String(j.result ?? "unknown");
          if (NEEDS_LOGIN.test(msg)) resolve(LOGIN_HELP);
          else resolve(`Agent error: ${msg}`);
        } else resolve(String(j.result ?? "(no reply)"));
      } catch {
        resolve(out.trim() || err.trim() || "(no reply)");
      }
    });
  });
}

async function main() {
  const ws = new WebSocket(HUB_WS);
  ws.on("open", () => {
    ws.send(JSON.stringify({ t: "hello", name: "Claude (your subscription)" }));
    console.error(`agent-cli connected to hub ${HUB_WS}; CLI = "${CLI}"`);
    // Don't claim "ready" on the WS link alone — actually verify Claude can authenticate here, so the
    // phone/web show the truth (and the exact fix) instead of "connected" followed by a 401 on first message.
    void probeAuth().then((p) => {
      if (p.ok) { ws.send(JSON.stringify({ t: "event", topic: "agent_status", data: { label: "Ready", ready: true } })); return; }
      ws.send(JSON.stringify({ t: "event", topic: "agent_status", data: { label: "⚠ Sign in to Claude on your computer", ready: false, command: p.command } }));
      console.error("\n" + "─".repeat(64) + "\n" +
        "  Claude isn't signed in for headless use on THIS computer.\n" +
        `  Fix:  ${p.command ?? "claude setup-token"}\n` +
        "  then paste the token on the setup page (it reconnects automatically).\n" +
        "  Uses your subscription — no API key needed.\n" +
        "─".repeat(64) + "\n");
    });
  });
  ws.on("message", (raw) => {
    let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === "user") {
      const text = String(m.text ?? "");
      ws.send(JSON.stringify({ t: "event", topic: "agent_status", data: { label: "Thinking…" } }));
      void runTurn(text).then((reply) => {
        // Self-heal readiness from the REAL result: a fresh token starting to work (or breaking) flips
        // the phone/web state on the next message — no restart needed after saving a token.
        const authFailed = reply === LOGIN_HELP;
        ws.send(JSON.stringify({ t: "event", topic: "agent_status",
          data: authFailed ? { label: "⚠ Sign in to Claude on your computer", ready: false, command: "claude setup-token" } : { label: "Ready", ready: true } }));
        ws.send(JSON.stringify({ t: "event", topic: "assistant_message", data: { text: reply } }));
      });
    }
    // {t:ready|catalog}: phone-mcp fetches tools from /catalog itself, so nothing to wire here.
  });
  ws.on("close", () => { console.error("hub connection closed — exiting"); process.exit(1); });
  ws.on("error", (e) => console.error("hub ws error:", String(e)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
