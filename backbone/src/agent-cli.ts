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
import { runAgent, buildHubServers, type AgentAdapter, type TurnContext } from "./agent-runner.ts";
import { parseClaudeEvent, makeLineParser } from "./parse-claude-stream.ts";
export { buildPrompt } from "./agent-runner.ts"; // shared with the other agents (and unit-tested here)

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
const ORCH = process.env.AGENT_HUBS
  ? " You also coordinate other agents. Use the hub_* tools: list_agents to see who is available and their strengths; ask_agent to delegate a subtask (use the agent's id when names repeat) and get its answer. For a large task, split it, delegate to the best-suited workers (in parallel when independent), then synthesize one reply. Never delegate to the agent marked active — that is you."
  : "";
const SYSTEM_FULL = SYSTEM + ORCH;

function tsxBin(): string {
  const local = path.join(HERE, "..", "node_modules", ".bin", "tsx");
  return fs.existsSync(local) ? local : "tsx";
}

// ---------- slash-command / skill discovery (so the phone can show a `/` menu like the TUI) ----------
type SlashCmd = { invoke: string; description: string; hint?: string; kind: "skill" | "command"; group: string };

function fmField(text: string, key: string): string | undefined {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return undefined;
  const lines = fm[1].split(/\r?\n/);
  const idx = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (idx < 0) return undefined;
  const inline = lines[idx].slice(lines[idx].indexOf(":") + 1).trim();
  // Plain inline value (most skills/commands).
  if (inline && !/^[|>][+-]?$/.test(inline)) return inline.replace(/^["']|["']$/g, "");
  // YAML block scalar (`description: >`): join the following indented lines.
  const cont: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^\s+\S/.test(lines[i])) cont.push(lines[i].trim());
    else if (lines[i].trim() === "") continue;
    else break;
  }
  return cont.join(" ").trim() || undefined;
}
const clip = (s = "", n = 160) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Skills live one dir deep with a SKILL.md; invoked as `/<prefix><dir>` (prefix = "plugin:" or ""). */
function scanSkills(dir: string, prefix: string, group: string, out: SlashCmd[]) {
  let names: string[]; try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    let text: string; try { text = fs.readFileSync(path.join(dir, name, "SKILL.md"), "utf8"); } catch { continue; }
    out.push({ invoke: prefix + name, description: clip(fmField(text, "description") ?? ""), kind: "skill", group });
  }
}
/** Commands are *.md, possibly nested; a nested dir becomes a `:` namespace (`commands/gsd/x.md` → `/gsd:x`). */
function scanCommands(dir: string, plugin: string, group: string, out: SlashCmd[]) {
  const found: { parts: string[]; file: string }[] = [];
  const walk = (d: string, parts: string[]) => {
    let entries: fs.Dirent[]; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(d, e.name), [...parts, e.name]);
      else if (e.name.endsWith(".md")) found.push({ parts: [...parts, e.name.slice(0, -3)], file: path.join(d, e.name) });
    }
  };
  walk(dir, []);
  for (const { parts, file } of found) {
    let text: string; try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    out.push({
      invoke: (plugin ? [plugin, ...parts] : parts).join(":"),
      description: clip(fmField(text, "description") ?? ""),
      hint: fmField(text, "argument-hint"),
      kind: "command", group,
    });
  }
}

/** Replicate the Claude TUI's discovery: user skills/commands, project commands, and plugin skills/commands. */
function discoverSlash(): SlashCmd[] {
  const home = os.homedir();
  const out: SlashCmd[] = [];
  scanSkills(path.join(home, ".claude", "skills"), "", "Skills", out);
  scanCommands(path.join(home, ".claude", "commands"), "", "Commands", out);
  scanCommands(path.join(process.cwd(), ".claude", "commands"), "", "Project", out);
  const pcache = path.join(home, ".claude", "plugins", "cache");
  let mkts: string[]; try { mkts = fs.readdirSync(pcache); } catch { mkts = []; }
  for (const mkt of mkts) {
    let plugins: string[]; try { plugins = fs.readdirSync(path.join(pcache, mkt)); } catch { continue; }
    for (const plugin of plugins) {
      let vers: string[]; try { vers = fs.readdirSync(path.join(pcache, mkt, plugin)); } catch { continue; }
      for (const ver of vers) {
        const vdir = path.join(pcache, mkt, plugin, ver);
        try { if (!fs.statSync(vdir).isDirectory()) continue; } catch { continue; }
        scanSkills(path.join(vdir, "skills"), plugin + ":", `Plugin: ${plugin}`, out);
        scanCommands(path.join(vdir, "commands"), plugin, `Plugin: ${plugin}`, out);
      }
    }
  }
  const seen = new Set<string>();
  return out
    .filter((c) => c.invoke && !c.invoke.includes(" ") && (seen.has(c.invoke) ? false : (seen.add(c.invoke), true)))
    .sort((a, b) => a.group.localeCompare(b.group) || a.invoke.localeCompare(b.invoke));
}

/** MCP config handed to the CLI: a `phone` server = our stdio phone-mcp, pointed at this hub. */
function mcpConfig(): string {
  return JSON.stringify({
    mcpServers: {
      phone: { command: tsxBin(), args: [path.join(HERE, "phone-mcp.ts")], env: { HUB_HTTP } },
      ...buildHubServers(process.env.AGENT_HUBS, tsxBin(), path.join(HERE, "hub-mcp.ts"), process.env.ASK_DEPTH ?? "0"),
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
  "and sign in), then try again.";

/** One-time startup check: can `claude -p` actually answer here? Returns remediation if not. */
function probeAuth(): Promise<{ ok: boolean; command?: string }> {
  return new Promise((resolve) => {
    const child = spawn(CLI, ["-p", "--output-format", "json", "ping"], { env: claudeEnv() });
    try { child.stdin?.end(); } catch { /* */ }
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

// The agent's conversation memory. Each `claude -p` is stateless on its own, so we keep ONE Claude
// session alive across turns via --resume — otherwise the agent forgets what it just said (e.g. offers
// to "peek at a session", you say "yeah peek", and a fresh amnesiac process grabs the camera instead).
let sessionId: string | undefined;
/** Start a fresh conversation (e.g. on /clear or /reset). */
function resetSession() { sessionId = undefined; }

/** Resolve a stream-json/json `result` into a reply string, applying auth + stale-session handling. */
function settleReply(text: string, isError: boolean, resolve: (s: string) => void) {
  if (!isError) return resolve(text || "(no reply)");
  const msg = text || "unknown";
  if (sessionId && /session|resume|no conversation|not found/i.test(msg)) resetSession();
  resolve(NEEDS_LOGIN.test(msg) ? LOGIN_HELP : `Agent error: ${msg}`);
}

/** Run one turn through the user's CLI agent. When the hub is watching internals (ctx.onActivity),
 *  use `--output-format stream-json` so we can narrate Task subagents + tool calls; else cheap `json`. */
function runTurn(text: string, ctx?: TurnContext): Promise<string> {
  return new Promise((resolve) => {
    const watch = !!ctx?.onActivity;
    const fmt = watch ? ["stream-json", "--verbose"] : ["json"];
    const args = ["-p", "--output-format", ...fmt, "--mcp-config", mcpConfig(), "--dangerously-skip-permissions"];
    if (sessionId) args.push("--resume", sessionId);      // continue the same conversation (memory!)
    else args.push("--append-system-prompt", SYSTEM_FULL); // seed identity/instructions on the first turn
    args.push(text);
    const child = spawn(CLI, args, { env: claudeEnv() });
    // The prompt rides as an arg — close stdin so the CLI doesn't block 3s waiting for piped input.
    try { child.stdin?.end(); } catch { /* */ }
    let out = "", err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve(`Couldn't run "${CLI}": ${String(e)}. Is it installed and logged in?`));

    if (watch) {
      let finalText: string | null = null, isErr = false, sid: string | undefined, lastText = "";
      const feed = makeLineParser((obj) => {
        const ev = parseClaudeEvent(obj);
        for (const a of ev.activities) ctx!.onActivity!(a);
        if (ev.text) lastText = ev.text;
        if (ev.sessionId) sid = ev.sessionId;
        if (ev.final) { finalText = ev.final.text || lastText; isErr = !!ev.final.isError; if (ev.final.sessionId) sid = ev.final.sessionId; }
      });
      child.stdout.on("data", (d) => feed(d.toString()));
      child.on("close", () => {
        if (sid) sessionId = sid;
        if (finalText == null) return resolve(lastText.trim() || err.trim() || "(no reply)");
        settleReply(finalText, isErr, resolve);
      });
      return;
    }

    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => {
      try {
        const j = JSON.parse(out);
        if (typeof j.session_id === "string") sessionId = j.session_id; // remember the thread for next turn
        settleReply(String(j.result ?? "(no reply)"), j.is_error === true, resolve);
      } catch {
        resolve(out.trim() || err.trim() || "(no reply)");
      }
    });
  });
}

/** The Claude brain as a thin adapter for the shared hub harness (agent-runner). */
const adapter: AgentAdapter = {
  // AGENT_NAME (set by the hub) overrides this so several agents get distinct roster labels.
  name: process.env.AGENT_NAME ?? "Claude",
  // Verify Claude can actually authenticate here, so the phone/web show the truth (and the exact fix)
  // instead of "connected" followed by a 401 on the first message.
  probe: () => probeAuth().then((p) => {
    if (p.ok) return { ok: true };
    console.error("\n" + "─".repeat(64) + "\n" +
      "  Claude isn't signed in for headless use on THIS computer.\n" +
      `  Fix:  ${p.command ?? "claude setup-token"}\n` +
      "  then paste the token on the setup page (it reconnects automatically).\n" +
      "─".repeat(64) + "\n");
    return { ok: false, label: "⚠ Sign in to Claude on your computer", command: p.command };
  }),
  runTurn,
  reset: resetSession,
  // Mirror the Claude TUI's `/` menu on the phone — only for an actual `claude` binary.
  onConnect: (emit) => {
    if (!path.basename(CLI).includes("claude")) return;
    try { const commands = discoverSlash(); emit("agent_commands", { commands }); console.error(`published ${commands.length} slash commands/skills to the phone`); }
    catch (e) { console.error("slash discovery failed:", String(e)); }
  },
  // A fresh token starting to work (or breaking) flips the phone/web state on the next message.
  authFailed: (reply) => (reply === LOGIN_HELP ? { label: "⚠ Sign in to Claude on your computer", command: "claude setup-token" } : null),
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--list-commands")) {
    const c = discoverSlash();
    console.log(`${c.length} slash commands/skills:\n` + c.map((x) => `  /${x.invoke}  [${x.kind}]  ${x.description.slice(0, 60)}`).join("\n"));
  } else {
    await runAgent(adapter);
  }
}
