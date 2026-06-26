/**
 * agent-text — a chat-only agent for ANY command-line tool that isn't Claude-Code-compatible.
 * On each user message it runs `AGENT_CMD <prompt>` and sends stdout back as the reply. No MCP, so it
 * can talk but can't drive the phone — that's the "Other agent" with phone-control OFF in the setup UI.
 * Claude-Code-compatible CLIs (Claude, Cursor, Hermes, Pi, …) go through agent-cli.ts instead.
 *
 * Env: AGENT_CMD (the command, e.g. "hermes" or "my-cli --flag"), AGENT_NAME, AGENT_INSTANCE_ID.
 */
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { runAgent } from "./agent-runner.ts";

const CMD = (process.env.AGENT_CMD ?? "").trim();
// ponytail: split "program --flag" on whitespace (no quote handling); the prompt is passed as the LAST
// argv entry, never through a shell, so a prompt with shell metachars can't inject. CLIs that read the
// prompt from stdin need a one-line wrapper — upgrade to a configurable prompt-mode if that comes up.
const [bin, ...baseArgs] = CMD.split(/\s+/).filter(Boolean);

function runTurn(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    if (!bin) return resolve("(no command is configured for this agent — set it in the hub setup page)");
    const child = spawn(bin, [...baseArgs, prompt], { env: process.env });
    try { child.stdin?.end(); } catch { /* */ }
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve(`Couldn't run "${bin}": ${String(e)}. Is it installed and on PATH?`));
    child.on("close", () => resolve(out.trim() || err.trim() || "(no reply)"));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAgent({ name: process.env.AGENT_NAME ?? "agent", runTurn });
}
