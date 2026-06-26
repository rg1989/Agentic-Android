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
import { WebSocket } from "ws";

const HUB_WS = process.env.HUB_URL ?? `ws://127.0.0.1:${process.env.AGENT_PORT ?? 8124}`;
const CMD = (process.env.AGENT_CMD ?? "").trim();
const NAME = process.env.AGENT_NAME ?? "agent";
// ponytail: split "program --flag" on whitespace (no quote handling); prompt is passed as the LAST argv
// entry, never through a shell, so a prompt with shell metachars can't inject. CLIs that read the prompt
// from stdin instead need a one-line wrapper script — upgrade to a configurable prompt-mode if that comes up.
const [bin, ...baseArgs] = CMD.split(/\s+/).filter(Boolean);

type AttachedFile = { path: string; name: string; mime?: string; size?: number };
function buildPrompt(text: string, files: AttachedFile[]): string {
  const note = files.map((f) => `[Attached file: ${f.name}${f.mime ? ` (${f.mime})` : ""} at ${f.path}]`).join("\n");
  if (text.trim() && note) return `${text}\n\n${note}`;
  if (note) return `The user sent ${files.length === 1 ? "a file" : `${files.length} files`} with no message.\n${note}`;
  return text;
}

function runTurn(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    if (!bin) return resolve("(no command is configured for this agent — set it in the hub setup page)");
    const child = spawn(bin, [...baseArgs, prompt], { env: process.env });
    let out = "", err = "";
    try { child.stdin?.end(); } catch { /* */ }
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve(`Couldn't run "${bin}": ${String(e)}. Is it installed and on PATH?`));
    child.on("close", () => resolve(out.trim() || err.trim() || "(no reply)"));
  });
}

async function main() {
  const ws = new WebSocket(HUB_WS);
  ws.on("open", () => {
    ws.send(JSON.stringify({ t: "hello", name: NAME, id: process.env.AGENT_INSTANCE_ID }));
    ws.send(JSON.stringify({ t: "event", topic: "agent_status", data: { label: "Ready", ready: true } }));
    console.error(`agent-text "${NAME}" connected to hub ${HUB_WS}; cmd="${CMD}"`);
  });
  ws.on("message", (raw) => {
    let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === "user") {
      const text = String(m.text ?? "");
      const files: AttachedFile[] = Array.isArray(m.files) ? m.files : [];
      const prompt = buildPrompt(text, files);
      if (!prompt.trim()) return;
      ws.send(JSON.stringify({ t: "event", topic: "agent_status", data: { label: "Thinking…" } }));
      void runTurn(prompt).then((reply) => {
        ws.send(JSON.stringify({ t: "event", topic: "agent_status", data: { label: "Ready", ready: true } }));
        ws.send(JSON.stringify({ t: "event", topic: "assistant_message", data: { text: reply } }));
      });
    }
  });
  ws.on("close", () => { console.error("hub connection closed — exiting"); process.exit(1); });
  ws.on("error", (e) => console.error("hub ws error:", String(e)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
