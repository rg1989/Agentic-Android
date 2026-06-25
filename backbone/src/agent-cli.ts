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
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HUB_WS = process.env.HUB_URL ?? `ws://127.0.0.1:${process.env.AGENT_PORT ?? 8124}`;
const HUB_HTTP = process.env.HUB_HTTP ?? "http://127.0.0.1:8123";
const CLI = process.env.AGENT_CLI ?? "claude";

const SYSTEM =
  "You are the user's phone assistant — your computer is their Android phone, reachable through the " +
  "`phone` MCP tools (take photos, read/tap/type/swipe the screen, screenshot, location, device info, " +
  "flashlight, ring, open apps, and more). When the user asks for something on the phone, actually use " +
  "the tools to do it, then reply concisely about what happened.";

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
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // use the CLI's own (e.g. subscription) auth, not a stray key
    const child = spawn(CLI, args, { env });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve(`Couldn't run "${CLI}": ${String(e)}. Is it installed and logged in?`));
    child.on("close", () => {
      try {
        const j = JSON.parse(out);
        if (j.is_error) resolve(`Agent error: ${String(j.result ?? "unknown")}`);
        else resolve(String(j.result ?? "(no reply)"));
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
  });
  ws.on("message", (raw) => {
    let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === "user") {
      const text = String(m.text ?? "");
      ws.send(JSON.stringify({ t: "event", topic: "agent_status", data: { label: "Thinking…" } }));
      void runTurn(text).then((reply) =>
        ws.send(JSON.stringify({ t: "event", topic: "assistant_message", data: { text: reply } })));
    }
    // {t:ready|catalog}: phone-mcp fetches tools from /catalog itself, so nothing to wire here.
  });
  ws.on("close", () => { console.error("hub connection closed — exiting"); process.exit(1); });
  ws.on("error", (e) => console.error("hub ws error:", String(e)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
