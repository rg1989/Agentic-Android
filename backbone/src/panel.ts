/**
 * The HUB — the persistent glue on the machine. It owns the phone connection + identity + all state,
 * and the (replaceable) agent connects IN to it:
 *   - phone side: connects to the relay as the paired identity (~/.agentic-android/agent.json);
 *   - agent side: a local WebSocket the agent dials into (the brain runs in a SEPARATE process,
 *     `pnpm agent`). The hub forwards the user's messages to the agent, executes the capability
 *     calls the agent asks for, persists media + the event log, and relays replies back to the phone;
 *   - human side: a web UI to drive the phone by hand + watch every event.
 *
 * The agent owns no state — swap it freely; the hub holds config, history, and media.
 *
 * Run: `pnpm panel` (or `pnpm hub`) → http://127.0.0.1:8123, agent WS on :8124.
 * Note: shares the phone identity with the MCP bridge — run ONE of them at a time.
 */
import http from "node:http";
import QRCode from "qrcode";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { ready, type Identity } from "./crypto.ts";
import { BusEndpoint } from "./peer.ts";
import type { MsgPart } from "./parts.ts";
import { Scheduler, type Task } from "./scheduler.ts";
import { Verifier } from "./agent-verify.ts";
import { makeDelegator } from "./delegate.ts";
import { randomUUID } from "node:crypto";

interface Cap { method: string; sensitivity: string; summary: string }
let caps: Cap[] = []; // populated in the background once the phone answers
interface AgentCfg { preset: string; commandTemplate: string; enabled: boolean }
type EventType = "request" | "response" | "error" | "phone_event" | "agent_run" | "connection" | "config"
  | "user_message" | "assistant_message" | "llm" | "tool";
interface LogEvent { id: number; ts: number; type: EventType; summary: string; detail?: unknown }

const AGENT_PRESETS: Record<string, string> = {
  claude: 'claude -p "{prompt}"',
  codex: 'codex exec "{prompt}"',
  omp: 'omp -p "{prompt}"',
  cursor: 'cursor-agent -p "{prompt}"',
  custom: "",
};
// Brand marks shown before each harness name (in the add-list AND the connected list). Real logos for
// Claude (simple-icons) and Cursor (svgl cube); clean monograms for omp (π = Oh My Pi) and Hermes — neither
// has a canonical brand logo. Neutral badges for basic/other/remote. All inlined (no CDN, matching the
// vendored-assets convention), on a uniform dark app-icon badge; sized via the .alogo CSS.
const LOGO_BG = "#1b1d24";
const AGENT_LOGOS: Record<string, string> = {
  claude: `<svg class="alogo" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="${LOGO_BG}"/><g transform="translate(4.3 4.3) scale(.64)" fill="#D97757"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></g></svg>`,
  cursor: `<svg class="alogo" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="${LOGO_BG}"/><g transform="translate(5.4 4.5) scale(.0282)" fill="#E6E6E6"><path d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z"/></g></svg>`,
  omp: `<svg class="alogo" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="${LOGO_BG}"/><text x="12" y="17.4" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="15" font-weight="700" fill="#2DD4BF">&#960;</text></svg>`,
  hermes: `<svg class="alogo" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="${LOGO_BG}"/><text x="12" y="17.2" text-anchor="middle" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="13.5" font-weight="700" fill="#818CF8">H</text></svg>`,
  basic: `<svg class="alogo" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="${LOGO_BG}"/><circle cx="12" cy="12" r="4.4" fill="#6b7280"/></svg>`,
  other: `<svg class="alogo" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="${LOGO_BG}"/><text x="12" y="16.4" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="11" font-weight="700" fill="#94a3b8">&#8250;_</text></svg>`,
  remote: `<svg class="alogo" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="${LOGO_BG}"/><path transform="translate(4.4 6.6) scale(.62)" fill="#94a3b8" d="M19 18H6a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.6-1.4A4 4 0 0 1 19 18z"/></svg>`,
};
const ALL_TYPES: EventType[] = ["user_message", "assistant_message", "llm", "tool", "request", "response", "error", "phone_event", "agent_run", "connection", "config"];

function configDir(): string {
  return process.env.AGENTIC_HOME ?? path.join(os.homedir(), ".agentic-android");
}
function configPath(): string { return path.join(configDir(), "agent.json"); }
function eventsPath(): string { return path.join(configDir(), "panel-events.jsonl"); }
/** The agent's consolidated photo folder, next to its config: ~/.agentic-android/media/photos/ */
function mediaDir(): string { return path.join(configDir(), "media", "photos"); }
/** Files the user sent from the phone (any mime), next to the photos. */
function filesDir(): string { return path.join(configDir(), "media", "files"); }

// ---------- persistent event log ----------
const events: LogEvent[] = [];
let seq = 0;
const MAX_MEM = 5000;
function loadEvents() {
  try {
    const lines = fs.readFileSync(eventsPath(), "utf8").trim().split("\n").filter(Boolean);
    for (const l of lines.slice(-MAX_MEM)) { try { const e = JSON.parse(l) as LogEvent; events.push(e); seq = Math.max(seq, e.id); } catch { /* skip */ } }
  } catch { /* no file yet */ }
}
function logEvent(type: EventType, summary: string, detail?: unknown): LogEvent {
  const e: LogEvent = { id: ++seq, ts: Date.now(), type, summary, detail };
  events.push(e);
  if (events.length > MAX_MEM) events.shift();
  try { fs.appendFileSync(eventsPath(), JSON.stringify(e) + "\n"); } catch { /* best-effort */ }
  return e;
}

// ---------- persistent chat sessions (the hub owns chat history) ----------
// Multiple named sessions per hub. `conversation` is the ACTIVE session's turns (in memory, so all
// existing code keeps working); each session's turns persist to sessions/<id>.jsonl and the index to
// sessions.jsonl. A legacy single conversation.jsonl is migrated into a session on first load.
interface ChatTurn { role: "user" | "assistant"; text: string; ts: number; parts?: MsgPart[] }
interface Session { id: string; title: string; createdAt: number; lastTs: number }
let sessions: Session[] = [];
let activeSessionId = "";
let conversation: ChatTurn[] = []; // turns of the active session
const MAX_CONVO = 500;
function convoPath(): string { return path.join(configDir(), "conversation.jsonl"); } // legacy
function sessionsDir(): string { return path.join(configDir(), "sessions"); }
function sessionsIndexPath(): string { return path.join(configDir(), "sessions.jsonl"); }
function sessionFilePath(id: string): string { return path.join(sessionsDir(), `${id}.jsonl`); }

function trimTitle(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t ? (t.length > 42 ? t.slice(0, 42) + "…" : t) : "New chat";
}
function readTurns(file: string): ChatTurn[] {
  try { return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as ChatTurn); }
  catch { return []; }
}
function persistSessionsIndex() {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(sessionsIndexPath(), sessions.map((s) => JSON.stringify(s)).join("\n") + (sessions.length ? "\n" : ""));
  } catch { /* best-effort */ }
}
function newSession(): Session {
  const s: Session = { id: randomUUID(), title: "New chat", createdAt: Date.now(), lastTs: Date.now() };
  sessions.push(s); activeSessionId = s.id; conversation = [];
  try { fs.mkdirSync(sessionsDir(), { recursive: true }); fs.writeFileSync(sessionFilePath(s.id), ""); } catch { /* */ }
  persistSessionsIndex();
  return s;
}
function selectSession(id: string): boolean {
  const s = sessions.find((x) => x.id === id);
  if (!s) return false;
  activeSessionId = id; conversation = readTurns(sessionFilePath(id));
  return true;
}
function deleteSession(id: string) {
  sessions = sessions.filter((s) => s.id !== id);
  try { fs.rmSync(sessionFilePath(id)); } catch { /* */ }
  persistSessionsIndex();
  if (activeSessionId === id) {
    if (sessions.length === 0) newSession();
    else { const newest = [...sessions].sort((a, b) => a.lastTs - b.lastTs).at(-1)!; selectSession(newest.id); }
  }
}
function loadConversation() {
  try { sessions = fs.readFileSync(sessionsIndexPath(), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Session); }
  catch { sessions = []; }
  if (sessions.length === 0 && fs.existsSync(convoPath())) {
    // migrate the legacy single conversation into a session so nothing is lost
    const legacy = readTurns(convoPath());
    const id = randomUUID();
    try { fs.mkdirSync(sessionsDir(), { recursive: true }); fs.copyFileSync(convoPath(), sessionFilePath(id)); } catch { /* */ }
    const firstUser = legacy.find((t) => t.role === "user" && t.text.trim());
    sessions = [{ id, title: firstUser ? trimTitle(firstUser.text) : "New chat", createdAt: legacy[0]?.ts ?? Date.now(), lastTs: legacy.at(-1)?.ts ?? Date.now() }];
    persistSessionsIndex();
  }
  if (sessions.length === 0) { newSession(); return; }
  const newest = [...sessions].sort((a, b) => a.lastTs - b.lastTs).at(-1)!;
  selectSession(newest.id);
}
function addTurn(role: ChatTurn["role"], text: string, parts?: MsgPart[]) {
  if (!text && !parts?.length) return;
  const turn: ChatTurn = { role, text, ts: Date.now(), ...(parts?.length ? { parts } : {}) };
  conversation.push(turn);
  if (conversation.length > MAX_CONVO) conversation.shift();
  try { fs.mkdirSync(sessionsDir(), { recursive: true }); fs.appendFileSync(sessionFilePath(activeSessionId), JSON.stringify(turn) + "\n"); } catch { /* */ }
  const s = sessions.find((x) => x.id === activeSessionId);
  if (s) {
    s.lastTs = turn.ts;
    if (role === "user" && (!s.title || s.title === "New chat")) s.title = trimTitle(text);
    persistSessionsIndex();
  }
}
function renameSession(id: string, title: string): boolean {
  const s = sessions.find((x) => x.id === id);
  if (!s) return false;
  const t = trimTitle(title);
  if (t && t !== "New chat") s.title = t;
  persistSessionsIndex();
  return true;
}
/** Sessions list for the phone (newest first) + which is active. */
function sessionsPayload() {
  return { sessions: [...sessions].sort((a, b) => b.lastTs - a.lastTs).map((s) => ({ id: s.id, title: s.title, ts: s.lastTs })), activeId: activeSessionId };
}

// ---------- agent config (persisted in agent.json) ----------
function loadCfg(): any { return JSON.parse(fs.readFileSync(configPath(), "utf8")); }
function readAgentCfg(): AgentCfg {
  const a = (loadCfg().agent ?? {}) as Partial<AgentCfg>;
  return { preset: a.preset ?? "claude", commandTemplate: a.commandTemplate ?? AGENT_PRESETS.claude, enabled: a.enabled ?? true };
}
function writeAgentCfg(next: AgentCfg) {
  const cfg = loadCfg();
  cfg.agent = next;
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

/** Tokens are base64url-ish and never contain whitespace; copying one out of a terminal often wraps
 * it and injects spaces/newlines mid-string, which silently 401s. Strip ALL whitespace, not just ends. */
function cleanToken(t: string): string { return t.replace(/\s+/g, ""); }
/** Headless Claude auth token (from `claude setup-token`), if the user saved one. */
function claudeOauthToken(): string | undefined {
  try { const t = loadCfg().brain?.oauthToken; if (typeof t === "string" && cleanToken(t)) return cleanToken(t); } catch { /* */ }
  return process.env.CLAUDE_CODE_OAUTH_TOKEN ? cleanToken(process.env.CLAUDE_CODE_OAUTH_TOKEN) : undefined;
}
function saveClaudeOauthToken(token: string) {
  const cfg = loadCfg();
  cfg.brain = { ...(cfg.brain ?? {}), oauthToken: cleanToken(token) };
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}
/** This Mac's LAN IP (so the phone can reach the relay over Wi-Fi instead of the USB tunnel). */
function lanIp(): string | undefined {
  const ifaces = os.networkInterfaces();
  for (const name of ["en0", "en1", ...Object.keys(ifaces)]) {
    for (const a of ifaces[name] ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return undefined;
}
/** Relay address to put in the phone's pairing QR. Order: saved choice (set in the web UI) →
 *  PHONE_RELAY_URL env → auto LAN IP (same Wi-Fi) → localhost. A Tailscale/public URL works as the
 *  saved choice for "any network". */
function phoneRelayUrl(cfgRelayUrl: string): string {
  let saved: string | undefined;
  try { const v = loadCfg().phoneRelayUrl; if (typeof v === "string" && v.trim()) saved = v.trim(); } catch { /* */ }
  const chosen = saved ?? process.env.PHONE_RELAY_URL;
  if (chosen && chosen !== "auto") {
    if (chosen === "usb") return cfgRelayUrl; // 127.0.0.1
    return chosen; // a LAN/Tailscale/public URL
  }
  const ip = lanIp();
  if (!ip) return cfgRelayUrl;
  try { const u = new URL(cfgRelayUrl); return `http://${ip}:${u.port || "8799"}`; } catch { return `http://${ip}:8799`; }
}
function saveRelayChoice(value: string) {
  const cfg = loadCfg();
  if (value === "auto") delete cfg.phoneRelayUrl; else cfg.phoneRelayUrl = value;
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

/** This hub's display name, shown on the phone. Defaults to the machine hostname (e.g. "macbook"),
 *  trimming the trailing ".local" Bonjour suffix. Configurable in the web UI. */
function hubName(): string {
  try { const v = loadCfg().hubName; if (typeof v === "string" && v.trim()) return v.trim(); } catch { /* */ }
  return os.hostname().replace(/\.local$/i, "");
}
function saveHubName(name: string) {
  const cfg = loadCfg();
  const v = String(name ?? "").trim();
  if (v) cfg.hubName = v; else delete cfg.hubName; // empty → fall back to hostname
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

/** A clean env for spawning `claude` headlessly: drop a stray API key + the *parent* Claude-Code
 *  session vars (which make a nested `claude -p` run credential-less), and inject the saved token. */
function claudeSpawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  for (const k of Object.keys(env)) if (k === "CLAUDECODE" || (k.startsWith("CLAUDE_CODE_") && k !== "CLAUDE_CODE_OAUTH_TOKEN")) delete env[k];
  const tk = claudeOauthToken(); if (tk) env.CLAUDE_CODE_OAUTH_TOKEN = tk;
  return env;
}

/** Spawn the configured shell-agent for non-message phone events (optional, legacy). */
function runAgent(template: string, prompt: string) {
  const cmd = template.replace(/\{prompt\}/g, prompt.replace(/(["\\$`])/g, "\\$1"));
  const child = spawn(cmd, { shell: true, stdio: "ignore", detached: true });
  child.on("error", (e) => logEvent("error", `agent spawn failed: ${e.message}`, { cmd }));
  child.unref();
}

// ---------- Material icons (authentic Material Symbols path data, inlined as SVG) ----------
// Delivered as inline SVG — no web-font / CDN dependency, matching the locally-vendored libs. One source
// of truth for the server-rendered pages (nav, settings, chat shell); chat.js keeps a tiny mirror for the
// icons it builds at runtime. Colour follows currentColor; size via the `size` arg or CSS.
const ICON_PATHS: Record<string, string> = {
  dashboard: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
  hub: "M21 6.5c0-1.38-1.12-2.5-2.5-2.5S16 5.12 16 6.5c0 .42.11.81.28 1.16l-2.12 2.12c-.35-.17-.74-.28-1.16-.28-.42 0-.81.11-1.16.28L9.72 7.66C9.89 7.31 10 6.92 10 6.5 10 5.12 8.88 4 7.5 4S5 5.12 5 6.5 6.12 9 7.5 9c.42 0 .81-.11 1.16-.28l2.12 2.12c-.17.35-.28.74-.28 1.16s.11.81.28 1.16l-2.12 2.12C8.31 15.11 7.92 15 7.5 15 6.12 15 5 16.12 5 17.5S6.12 20 7.5 20 10 18.88 10 17.5c0-.42-.11-.81-.28-1.16l2.12-2.12c.35.17.74.28 1.16.28s.81-.11 1.16-.28l2.12 2.12c-.17.35-.28.74-.28 1.16 0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5-1.12-2.5-2.5-2.5c-.42 0-.81.11-1.16.28l-2.12-2.12c.17-.35.28-.74.28-1.16s-.11-.81-.28-1.16l2.12-2.12c.35.17.74.28 1.16.28C19.88 9 21 7.88 21 6.5z",
  chat: "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z",
  settings: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
  menu: "M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z",
  add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  search: "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  delete: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  eraser: "M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.008 4.008 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0zM4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53-4.95-4.95-4.95 4.95z",
  copy: "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z",
  check: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  info: "M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z",
  tree: "M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3z",
  send: "M2.01 21 23 12 2.01 3 2 10l15 2-15 2z",
  attach: "M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5S13.5 3.62 13.5 5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7.5 2.79 7.5 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z",
  arrowDown: "M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z",
  file: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
  warning: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  regen: "M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z",
  bolt: "M7 2v11h3v9l7-12h-4l4-8z",
  link: "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z",
  smartphone: "M17 1H7c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 18H7V5h10v14z",
  cable: "M19 7V4h-2v3h-2V4h-2v5h6v2c0 1.1-.9 2-2 2h-4c-2.21 0-4 1.79-4 4v4h2v-4c0-1.1.9-2 2-2h4c2.21 0 4-1.79 4-4V9h-2V7h2zM5 4v5h6V4H9v3H7V4H5z",
  storage: "M2 20h20v-4H2v4zm2-3h2v2H4v-2zM2 4v4h20V4H2zm4 3H4V5h2v2zm-4 7h20v-4H2v4zm2-3h2v2H4v-2z",
  schedule: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  pin: "M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z",
};
/** An inline Material-icon SVG, coloured by currentColor. */
const icon = (name: string, size = 18) =>
  `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${ICON_PATHS[name] ?? ""}"/></svg>`;

// ---------- shared app shell: ONE sidebar menu wraps every page so they feel like one app ----------
const NAV = [
  { href: "/panel", label: "Control Panel", icon: "dashboard" },
  { href: "/connections", label: "Connections", icon: "link" },
  { href: "/chat", label: "Chat", icon: "chat" },
  { href: "/settings", label: "Settings", icon: "settings" },
];
/** The left nav, with the current page marked active. Pure string → safe to interpolate into any page.
 *  Unpinned, it collapses to an icon rail and expands on hover; the pin state persists in localStorage.
 *  The inline script ships with the nav so every page (chat, settings, panel, connections) gets it. */
const sidebar = (active: string) => `<aside class="sidebar" id="sidebar">
  <div class="brand"><div class="mark" aria-hidden="true"></div><div class="bt">Agentic Android</div>
    <button class="navpin" id="navpin" aria-label="Pin sidebar" title="Pin sidebar">${icon("pin", 17)}</button></div>
  ${NAV.map((n) => `<a class="navitem${n.href === active ? " on" : ""}" href="${n.href}"><span class="ni">${icon(n.icon, 19)}</span><span class="nl">${n.label}</span></a>`).join("\n  ")}
</aside>
<script>(function(){var sb=document.getElementById("sidebar"),btn=document.getElementById("navpin");if(!sb||!btn)return;
  function apply(p){sb.classList.toggle("nav-collapsed",!p);btn.classList.toggle("on",p);btn.title=p?"Unpin sidebar (auto-collapse)":"Pin sidebar (keep open)";}
  apply(localStorage.getItem("nav-pinned")!=="0");
  btn.addEventListener("click",function(){var p=localStorage.getItem("nav-pinned")==="0";localStorage.setItem("nav-pinned",p?"1":"0");apply(p);});
})();</script>`;
/** Canonical base — design tokens, document reset, body, and the brand mark — defined ONCE and
 *  included by every page so the shared shell (sidebar, header, logo) is pixel-identical across
 *  navigation. Each page layers its own component styles on top of this. */
const BASE_CSS = `
  :root{color-scheme:dark;
    --bg:#0a0b10;--surface:#14161e;--surface-2:#1a1d27;--surface-3:#21242f;
    --border:rgba(255,255,255,0.07);--border-strong:rgba(255,255,255,0.13);
    --text:#eceef4;--text-dim:#9b9eab;--text-faint:#62656f;
    --accent:#6366f1;--accent-hi:#818cf8;--accent-soft:rgba(99,102,241,0.16);
    --ok:#34d399;--warn:#fbbf24;--err:#f87171;
    --radius:14px;--radius-sm:10px;
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;}
  *{box-sizing:border-box;} html,body{height:100%;}
  body{font:15px/1.6 var(--sans);margin:0;color:var(--text);background:var(--bg);
    background-image:radial-gradient(1100px 560px at 78% -12%,rgba(99,102,241,0.10),transparent 62%);
    -webkit-font-smoothing:antialiased;}
  .mark{width:42px;height:42px;flex:none;background:url(/public/logo.svg) center/contain no-repeat;}`;
/** The frame shared by every page — geometry only; tokens + mark come from BASE_CSS. */
const SHELL_CSS = `
  .app { display: flex; min-height: 100vh; align-items: stretch; }
  .sidebar { width: 232px; flex: none; box-sizing: border-box; padding: 18px 14px; display: flex; flex-direction: column; gap: 4px;
    border-right: 1px solid var(--border); background: rgba(10,11,16,0.55); position: sticky; top: 0; height: 100vh;
    white-space: nowrap; overflow: hidden; transition: width .16s ease; }
  .sidebar .brand { display: flex; align-items: center; gap: 11px; padding: 6px 8px 18px; }
  .sidebar .brand .bt { font-size: 16px; font-weight: 650; letter-spacing: -0.01em; flex: 1; min-width: 0; }
  .sidebar .navpin { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
    background: none; border: 0; border-radius: 8px; color: var(--text-faint); cursor: pointer; transition: color .15s, background .15s; }
  .sidebar .navpin:hover { background: var(--surface); color: var(--text-dim); }
  .sidebar .navpin.on { color: var(--accent-hi); }
  .sidebar .navitem { display: flex; align-items: center; gap: 11px; color: var(--text-dim); text-decoration: none;
    font-size: 14px; font-weight: 540; padding: 10px 12px; border-radius: 10px; transition: background .15s, color .15s; }
  .sidebar .navitem .ni { width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; color: var(--text-faint); transition: color .15s; }
  .sidebar .navitem .ni svg { display: block; }
  .sidebar .navitem:hover { background: var(--surface); color: var(--text); }
  .sidebar .navitem:hover .ni { color: var(--text-dim); }
  .sidebar .navitem.on { background: var(--accent-soft); color: var(--text); }
  .sidebar .navitem.on .ni { color: var(--accent-hi); }
  .appmain { flex: 1; min-width: 0; }
  /* Unpinned: collapse to an icon rail, expand on hover. Wide screens only — the mobile bar (below) is untouched. */
  @media (min-width: 761px) {
    .sidebar.nav-collapsed { width: 66px; }
    .sidebar.nav-collapsed .nl, .sidebar.nav-collapsed .brand .bt { opacity: 0; }
    .sidebar.nav-collapsed .navpin { display: none; }
    .sidebar.nav-collapsed .navitem { justify-content: center; padding: 10px; }
    .sidebar.nav-collapsed .brand { gap: 0; padding-left: 0; padding-right: 0; justify-content: center; }
    .sidebar.nav-collapsed .brand .mark { width: 34px; height: 34px; }
    .sidebar.nav-collapsed:hover { width: 232px; }
    .sidebar.nav-collapsed:hover .nl, .sidebar.nav-collapsed:hover .brand .bt { opacity: 1; }
    .sidebar.nav-collapsed:hover .navpin { display: inline-flex; }
    .sidebar.nav-collapsed:hover .navitem { justify-content: flex-start; padding: 10px 12px; }
    .sidebar .nl, .sidebar .brand .bt { transition: opacity .12s ease; }
  }
  @media (max-width: 760px) {
    .app { flex-direction: column; }
    .sidebar { width: auto; height: auto; position: static; flex-direction: row; gap: 4px; overflow-x: auto;
      border-right: 0; border-bottom: 1px solid var(--border); }
    .sidebar .brand { display: none; }
  }`;
/** The full-width sticky page header used by Connections — shared so Settings matches it pixel-for-pixel. */
const HEADER_CSS = `
  .chead { position: sticky; top: 0; z-index: 9; display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
    padding: 13px 26px; min-height: 56px; border-bottom: 1px solid var(--border);
    background: rgba(10,11,16,0.72); backdrop-filter: saturate(160%) blur(14px); -webkit-backdrop-filter: saturate(160%) blur(14px); }
  .chead .ttl { display: flex; align-items: center; gap: 13px; min-width: 0; }
  .chead .ttl .hi { width: 34px; height: 34px; border-radius: 10px; flex: none; display: inline-flex; align-items: center; justify-content: center;
    color: var(--accent-hi); background: var(--accent-soft); border: 1px solid rgba(129,140,248,0.28); }
  .chead .ttl h1 { font-size: 16px; margin: 0; font-weight: 650; letter-spacing: -0.01em; }
  .chead .ttl .csub { margin: 1px 0 0; font-size: 12px; color: var(--text-dim); }
  .statusbar { margin-left: auto; display: flex; gap: 10px; flex-wrap: wrap; }
  .schip { display: flex; align-items: center; gap: 9px; background: var(--surface); border: 1px solid var(--border); border-radius: 11px; padding: 7px 13px; }
  .schip .dot { width: 9px; height: 9px; border-radius: 99px; background: var(--text-faint); flex: none; }
  .schip .dot.on { background: var(--ok); box-shadow: 0 0 0 4px rgba(52,211,153,0.16); }
  .schip .t { font-size: 11px; color: var(--text-dim); line-height: 1.15; }
  .schip .v { font-size: 12.5px; font-weight: 560; line-height: 1.2; }`;

/** A minimal full page in the shell — for the simple/new pages (Chat, Settings). */
const shellDoc = (active: string, title: string, bodyInner: string, extraCss = "") => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/svg+xml" href="/public/logo.svg">
<title>Agentic Android — ${title}</title>
<style>
  ${BASE_CSS}
  .inner{max-width:760px;margin:0 auto;padding:34px 28px 64px;}
  h2{font-size:20px;margin:0 0 6px;font-weight:650;letter-spacing:-0.01em;}
  .lead{color:var(--text-dim);font-size:14px;margin:0 0 22px;}
  .card{background:linear-gradient(180deg,var(--surface-2),var(--surface));border:1px solid var(--border);border-radius:14px;padding:20px 22px;margin-bottom:14px;}
  .card h3{margin:0 0 6px;font-size:15px;font-weight:600;} .card p{margin:0;color:var(--text-dim);font-size:13.5px;}
  code{font-family:var(--mono);font-size:12.5px;background:rgba(8,9,13,0.6);border:1px solid var(--border);border-radius:7px;padding:2px 7px;}
  a{color:var(--accent-hi);}
  ${SHELL_CSS}
  ${extraCss}
</style></head>
<body><div class="app">${sidebar(active)}<main class="appmain"><div class="inner">${bodyInner}</div></main></div></body></html>`;

// ---- Chat page: a full client (sessions, slash menu, files, rich render, live SSE). The HTML skeleton
// lives here; all CSS + logic are served as static files from backbone/public/ via GET /public/* so the
// ~500-line client isn't trapped in a template literal. See docs/.../2026-06-27-web-chat-spec.md.
const CHAT_BODY = `<link rel="stylesheet" href="/public/vendor/github-dark.min.css">
<link rel="stylesheet" href="/public/chat.css">
<div class="chatshell">
  <aside class="sx" id="sx" aria-label="Chats">
    <div class="sxhead"><button class="newchat" id="newchat">${icon("add", 18)}<span>New chat</span></button></div>
    <div class="sxsearch"><span class="si">${icon("search", 16)}</span><input id="sxsearch" placeholder="Search chats…" autocomplete="off" aria-label="Search chats"></div>
    <div class="sxlist" id="sxlist"></div>
  </aside>
  <div class="rsz" id="sxrsz" role="separator" aria-label="Resize chat list" title="Drag to resize"></div>
  <div class="scrim" id="scrim" hidden></div>
  <section class="cmain">
    <header class="chathead">
      <button class="iconbtn drawer" id="drawer" aria-label="Toggle chat list">${icon("menu", 20)}</button>
      <div class="seat">
        <select id="agentsel" class="sel" aria-label="Harness"></select>
      </div>
      <div class="seatstatus" id="seatstatus" aria-live="polite"></div>
      <button class="iconbtn orchtoggle" id="orchtoggle" aria-label="Orchestration panel" title="Orchestration — watch delegations live">${icon("tree", 18)}</button>
    </header>
    <div class="msgs" id="msgs" role="log" aria-live="polite" aria-label="Conversation"></div>
    <button class="jump" id="jump" hidden>${icon("arrowDown", 15)}<span>Latest</span></button>
    <div class="composer-wrap">
      <div class="chips" id="chips"></div>
      <div class="slash" id="slash" role="listbox" hidden></div>
      <form class="composer" id="composer">
        <button type="button" class="iconbtn attach" id="attach" aria-label="Attach file">${icon("attach", 20)}</button>
        <textarea id="inp" rows="1" placeholder="Message the harness…   ( / for commands, Shift+Enter for newline )" autocomplete="off" aria-label="Message"></textarea>
        <button type="submit" id="send">${icon("send", 17)}<span>Send</span></button>
        <button type="button" id="stop" hidden>Stop</button>
      </form>
      <input type="file" id="filein" multiple hidden>
    </div>
  </section>
  <div class="rsz rsz-orch" id="orchrsz" role="separator" aria-label="Resize orchestration panel" title="Drag to resize"></div>
  <aside class="orchpanel" id="orchpanel" aria-label="Orchestration" hidden>
    <header class="orchhead">
      <div class="otitle"><span class="olive" id="olive"></span>Orchestration</div>
      <div class="ohbtns">
        <button class="iconbtn" id="orchclear" aria-label="Clear orchestration tree" title="Clear the tree" disabled>${icon("eraser", 18)}</button>
        <button class="iconbtn" id="orchclose" aria-label="Close orchestration panel">${icon("close", 18)}</button>
      </div>
    </header>
    <div class="orchmodes" id="orchmodes" role="tablist" aria-label="View">
      <button type="button" data-ov="tree" class="on" role="tab" title="File-system tree">Tree</button>
      <button type="button" data-ov="flow" role="tab" title="Flow graph — task forward, result back">Flow</button>
      <span class="orchmodehint">live tree of delegations + the sub-agents each harness reports</span>
    </div>
    <div class="orchtree" id="orchtree"></div>
    <div class="orchflow" id="orchflow" hidden></div>
  </aside>
</div>
<div class="orchtip" id="orchtip" hidden></div>
<script src="/public/vendor/marked.min.js"></script>
<script src="/public/vendor/purify.min.js"></script>
<script src="/public/vendor/highlight.min.js"></script>
<script src="/public/chat.js"></script>`;

const PAGE = (caps: Cap[], relayUrl: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/svg+xml" href="/public/logo.svg">
<title>Agentic Android — Control Panel</title>
<style>
  ${BASE_CSS}
  header {
    position: sticky; top: 0; z-index: 10; padding: 14px 24px; min-height: 56px;
    border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
    background: rgba(10,11,16,0.72);
    backdrop-filter: saturate(160%) blur(14px); -webkit-backdrop-filter: saturate(160%) blur(14px);
  }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  h1 { font-size: 16px; margin: 0; font-weight: 650; letter-spacing: -0.01em; }
  .sub { color: var(--text-dim); font-size: 12px; margin-top: 1px; }
  .sub .mono { font-family: var(--mono); color: var(--text); opacity: 0.85; }
  .agentbar { margin-left: auto; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .agentbar label { font-size: 12px; color: var(--text-dim); }
  select, input {
    background: var(--surface); border: 1px solid var(--border); color: var(--text);
    border-radius: var(--radius-sm); padding: 8px 10px; font-size: 13px;
    transition: border-color .15s, box-shadow .15s;
  }
  select:hover, input:hover { border-color: var(--border-strong); }
  select:focus, input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  input.cmd { width: 250px; font-family: var(--mono); font-size: 12.5px; }
  input.search { width: 100%; }
  input.num { width: 84px; }
  input.wide { width: 170px; }
  .switch { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .switch input { width: auto; }
  button {
    background: linear-gradient(180deg, var(--accent-hi), var(--accent)); color: #fff; border: 0;
    border-radius: 10px; padding: 8px 14px; font-size: 13px; font-weight: 560; cursor: pointer; letter-spacing: 0.01em;
    box-shadow: 0 1px 0 rgba(255,255,255,0.16) inset, 0 6px 16px rgba(79,70,229,0.32);
    transition: filter .15s, transform .04s;
  }
  button:hover { filter: brightness(1.08); }
  button:active { transform: translateY(1px); }
  button.ghost { background: var(--surface-2); color: var(--text); box-shadow: none; border: 1px solid var(--border); }
  button.ghost:hover { background: var(--surface-3); border-color: var(--border-strong); }
  button.stop {
    background: linear-gradient(180deg, #f87171, #ef4444);
    box-shadow: 0 1px 0 rgba(255,255,255,0.16) inset, 0 6px 16px rgba(239,68,68,0.30);
  }
  .wrap { display: grid; grid-template-columns: 1fr 1.1fr; height: calc(100vh - 56px); min-height: 0; }
  .caps { padding: 18px 24px; overflow: auto; }
  .caps::-webkit-scrollbar, .log::-webkit-scrollbar { width: 10px; }
  .caps::-webkit-scrollbar-thumb, .log::-webkit-scrollbar-thumb {
    background: var(--surface-3); border-radius: 99px; border: 2px solid transparent; background-clip: padding-box; }
  .card {
    background: linear-gradient(180deg, var(--surface-2), var(--surface));
    border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; margin-bottom: 12px;
    box-shadow: 0 1px 0 rgba(255,255,255,0.03) inset;
    transition: border-color .15s, box-shadow .15s, transform .15s;
  }
  .card:hover { border-color: var(--border-strong); box-shadow: 0 10px 26px rgba(0,0,0,0.34); }
  .card h3 { margin: 0 0 2px; font-size: 14px; font-weight: 620; letter-spacing: -0.005em; }
  .card .s { color: var(--text-dim); font-size: 12px; margin-bottom: 10px; }
  .tag { font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
    padding: 2px 8px; border-radius: 99px; margin-left: 8px; vertical-align: middle; }
  .allow { background: rgba(52,211,153,0.14); color: var(--ok); }
  .ask { background: rgba(251,191,36,0.14); color: var(--warn); }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .logpane { border-left: 1px solid var(--border); background: rgba(8,9,13,0.6);
    display: flex; flex-direction: column; min-height: 0; }
  .logctl { padding: 12px 16px; border-bottom: 1px solid var(--border);
    display: flex; flex-direction: column; gap: 9px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip {
    font-size: 11px; font-weight: 540; padding: 4px 10px; border-radius: 99px;
    border: 1px solid var(--border); cursor: pointer; user-select: none;
    background: var(--surface); color: var(--text-faint);
    transition: color .15s, border-color .15s, background .15s;
  }
  .chip:hover { color: var(--text-dim); border-color: var(--border-strong); }
  .chip.on { color: #fff; }
  .chip.on[data-t=request]{ background: rgba(99,102,241,0.20); border-color: rgba(129,140,248,0.55); }
  .chip.on[data-t=response]{ background: rgba(52,211,153,0.18); border-color: rgba(52,211,153,0.55); }
  .chip.on[data-t=error]{ background: rgba(248,113,113,0.18); border-color: rgba(248,113,113,0.55); }
  .chip.on[data-t=phone_event]{ background: rgba(167,139,250,0.18); border-color: rgba(167,139,250,0.55); }
  .chip.on[data-t=agent_run]{ background: rgba(251,191,36,0.16); border-color: rgba(251,191,36,0.5); }
  .chip.on[data-t=connection]{ background: rgba(34,211,238,0.16); border-color: rgba(34,211,238,0.5); }
  .chip.on[data-t=config]{ background: rgba(148,163,184,0.16); border-color: rgba(148,163,184,0.45); }
  .log { overflow: auto; padding: 6px 14px; flex: 1; }
  .entry {
    font: 12px/1.5 var(--mono); border-bottom: 1px solid rgba(255,255,255,0.04);
    padding: 8px 4px; cursor: pointer; border-radius: 6px; transition: background .12s;
  }
  .entry:hover { background: rgba(255,255,255,0.025); }
  .entry .t { color: var(--text-faint); }
  .entry .b { font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 6px; margin: 0 7px; }
  .b.request{ background: rgba(99,102,241,0.18); color: #a5b4fc; }
  .b.response{ background: rgba(52,211,153,0.16); color: #6ee7b7; }
  .b.error{ background: rgba(248,113,113,0.16); color: #fca5a5; }
  .b.phone_event{ background: rgba(167,139,250,0.16); color: #c4b5fd; }
  .b.agent_run{ background: rgba(251,191,36,0.14); color: #fcd34d; }
  .b.connection{ background: rgba(34,211,238,0.14); color: #67e8f9; }
  .b.config{ background: rgba(148,163,184,0.14); color: #cbd5e1; }
  .detail { display: none; white-space: pre-wrap; word-break: break-word; color: var(--text-dim);
    margin-top: 6px; padding-top: 6px; border-top: 1px dashed rgba(255,255,255,0.06); }
  .entry.open .detail { display: block; }
  .count { color: var(--text-faint); font-size: 11px; }
  ${SHELL_CSS}
</style></head><body>
<div class="app">${sidebar("/panel")}<main class="appmain">
<header>
  <div class="brand">
    <div>
      <h1>Control Panel</h1>
      <div class="sub">harness → relay <span class="mono">${relayUrl}</span> → phone · ${caps.length} capabilities</div>
    </div>
  </div>
  <div class="agentbar">
    <label>Harness</label>
    <select id="preset"></select>
    <input class="cmd" id="cmd" placeholder='command with {prompt}'>
    <label class="switch"><input type="checkbox" id="aen"> on inbound</label>
    <button id="savecfg" class="ghost">Save</button>
  </div>
</header>
<div class="wrap">
  <div class="caps" id="caps"></div>
  <div class="logpane">
    <div class="logctl">
      <input class="search" id="q" placeholder="search the log…">
      <div class="chips" id="chips"></div>
      <div class="count" id="count"></div>
    </div>
    <div class="log" id="log"></div>
  </div>
</div>
<script>
const TYPES = ${JSON.stringify(ALL_TYPES)};
const PRESETS = ${JSON.stringify(AGENT_PRESETS)};
const shown = new Set(TYPES);
let lastId = 0, q = "";

// ----- capabilities -----
async function call(method, args) {
  try { await fetch('/call', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,args})}); }
  catch(e) {}
  refresh();
}
function capCard(c) {
  if (c.method==='phone.stop_ring') return null;
  let ctrl;
  if (c.method==='phone.ring') ctrl = '<div class="row"><button onclick="call(\\'phone.ring\\',{ms:0})">Ring</button>'+
    '<button class="stop" onclick="call(\\'phone.stop_ring\\',{})">Stop</button>'+
    '<input class="num" id="rms" type="number" value="0"><button onclick="call(\\'phone.ring\\',{ms:+rms.value})">Ring ms</button></div>';
  else if (c.method==='sms.send') ctrl='<div class="row"><input class="wide" id="sto" placeholder="to"><input class="wide" id="sb" placeholder="message">'+
    '<button onclick="call(\\'sms.send\\',{to:sto.value,body:sb.value})">Send</button></div>';
  else ctrl='<div class="row"><button onclick="call(\\''+c.method+'\\',{})">Call</button></div>';
  const d=document.createElement('div'); d.className='card';
  d.innerHTML='<h3>'+c.method+'<span class="tag '+c.sensitivity+'">'+c.sensitivity+'</span></h3><div class="s">'+c.summary+'</div>'+ctrl;
  return d;
}
const capHost=document.getElementById('caps');
async function loadCaps(){
  for (let i=0;i<20;i++){
    try { const c=await (await fetch('/catalog')).json();
      if (c.length){ capHost.innerHTML=''; for(const x of c){const el=capCard(x); if(el) capHost.appendChild(el);} return; } } catch(e){}
    capHost.innerHTML='<div class="card s">waiting for the phone to connect…</div>';
    await new Promise(r=>setTimeout(r,2000));
  }
}
loadCaps();

// ----- type toggle chips -----
const chipHost=document.getElementById('chips');
for (const t of TYPES){const c=document.createElement('span'); c.className='chip on'; c.dataset.t=t; c.textContent=t;
  c.onclick=()=>{ if(shown.has(t)){shown.delete(t);c.classList.remove('on');} else {shown.add(t);c.classList.add('on');} render(); };
  chipHost.appendChild(c);}

// ----- search -----
document.getElementById('q').oninput=(e)=>{ q=e.target.value.toLowerCase(); render(); };

// ----- log render -----
let all=[];
function render() {
  const log=document.getElementById('log');
  const rows=all.filter(e=>shown.has(e.type)).filter(e=>!q || JSON.stringify(e).toLowerCase().includes(q));
  document.getElementById('count').textContent=rows.length+' / '+all.length+' events';
  log.innerHTML='';
  for (const e of rows.slice(-500).reverse()) {
    const div=document.createElement('div'); div.className='entry';
    const tm=new Date(e.ts).toLocaleTimeString();
    const bid=e.detail&&e.detail.blob_id;
    const img=bid?'<img src="/blob/'+bid+'" style="max-width:260px;display:block;margin-top:6px;border-radius:8px">':'';
    div.innerHTML='<span class="t">'+tm+'</span><span class="b '+e.type+'">'+e.type+'</span>'+escapeHtml(e.summary)+
      '<div class="detail">'+escapeHtml(JSON.stringify(e.detail??{},null,2))+img+'</div>';
    div.onclick=()=>div.classList.toggle('open');
    log.appendChild(div);
  }
}
function escapeHtml(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
async function refresh() {
  try { const r=await fetch('/events?since='+lastId); const j=await r.json();
    if (j.length){ all=all.concat(j); lastId=j[j.length-1].id; if(all.length>5000) all=all.slice(-5000); render(); } } catch(e){}
}
(async()=>{ const r=await fetch('/events'); all=await r.json(); if(all.length) lastId=all[all.length-1].id; render(); })();
setInterval(refresh, 1500);

// ----- agent config -----
const presetSel=document.getElementById('preset');
for (const p of Object.keys(PRESETS)){const o=document.createElement('option'); o.value=p; o.textContent=p; presetSel.appendChild(o);}
presetSel.onchange=()=>{ if(PRESETS[presetSel.value]!=='') document.getElementById('cmd').value=PRESETS[presetSel.value]; };
async function loadCfg(){ const c=await (await fetch('/config')).json();
  presetSel.value=c.preset; document.getElementById('cmd').value=c.commandTemplate; document.getElementById('aen').checked=c.enabled; }
document.getElementById('savecfg').onclick=async()=>{
  const body={preset:presetSel.value, commandTemplate:document.getElementById('cmd').value, enabled:document.getElementById('aen').checked};
  await fetch('/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  refresh();
};
loadCfg();
</script></main></div></body></html>`;

/** A preset card's "run it yourself" snippet: collapsed by default, the exact terminal command, copy-on-hover.
 *  Clicking the button adds the harness for you; this is the equivalent command if you'd rather launch it manually. */
const cmdSnippet = (script: string) =>
  `<details class="cmdsnip"><summary>Run in a terminal instead</summary>` +
  `<span class="copyfield"><code>cd backbone &amp;&amp; ${script}</code>` +
  `<button class="iconbtn snipcopy" title="Copy command" aria-label="Copy command">` +
  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>` +
  `</button></span></details>`;

/** Guided, self-service setup page — connect an agent, then pair the phone (QR). Lives at "/". */
const SETUP_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/svg+xml" href="/public/logo.svg">
<title>Agentic Android — Setup</title>
<style>
  ${BASE_CSS}
  .wrap { max-width: 720px; margin: 0 auto; padding: 40px 22px 64px; }
  .hero { display: flex; align-items: center; gap: 16px; margin-bottom: 6px; }
  h1 { font-size: 26px; margin: 0; font-weight: 700; letter-spacing: -0.02em; }
  .sub { color: var(--text-dim); margin: 2px 0 26px; font-size: 14px; }
  .status { display: flex; gap: 12px; margin-bottom: 26px; flex-wrap: wrap; }
  .pill {
    display: flex; align-items: center; gap: 11px;
    background: linear-gradient(180deg, var(--surface-2), var(--surface));
    border: 1px solid var(--border); border-radius: 13px; padding: 13px 16px;
    flex: 1; min-width: 210px;
    box-shadow: 0 1px 0 rgba(255,255,255,0.03) inset;
    transition: border-color .15s, box-shadow .15s;
  }
  .pill:hover { border-color: var(--border-strong); box-shadow: 0 8px 22px rgba(0,0,0,0.30); }
  .dot {
    width: 11px; height: 11px; border-radius: 99px; background: var(--text-faint); flex: none;
    box-shadow: 0 0 0 0 rgba(63,185,80,0); transition: box-shadow .3s;
  }
  .dot.on { background: var(--ok); box-shadow: 0 0 0 4px rgba(52,211,153,0.16); }
  .dot.wait { background: var(--warn); box-shadow: 0 0 0 4px rgba(251,191,36,0.14); }
  .dot.lit { background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
  .dot.bad { background: var(--warn); }
  .pill .t { font-size: 12px; color: var(--text-dim); }
  .pill .v { font-size: 14px; font-weight: 560; }
  .step {
    background: linear-gradient(180deg, var(--surface-2), var(--surface));
    border: 1px solid var(--border); border-radius: var(--radius); padding: 20px 22px; margin-bottom: 16px;
    box-shadow: 0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 30px rgba(0,0,0,0.22);
    transition: border-color .2s, box-shadow .2s;
  }
  .step.done {
    border-color: rgba(52,211,153,0.42);
    box-shadow: 0 0 0 1px rgba(52,211,153,0.10), 0 12px 30px rgba(0,0,0,0.22);
  }
  .step h2 { font-size: 17px; margin: 0 0 4px; display: flex; align-items: center; gap: 11px; font-weight: 650; letter-spacing: -0.01em; }
  .num {
    width: 26px; height: 26px; border-radius: 99px;
    background: var(--surface-3); color: var(--text-dim); font-size: 13px; font-weight: 600;
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    border: 1px solid var(--border);
    transition: background .2s, color .2s, border-color .2s;
  }
  .step.done .num { background: var(--ok); color: #04130c; border-color: transparent; }
  .step p { color: var(--text-dim); font-size: 13.5px; margin: 8px 0 4px; }
  .opts { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 8px; }
  .opt {
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    padding: 9px 14px; cursor: pointer; font-size: 13px; color: var(--text-dim);
    transition: border-color .15s, background .15s, color .15s;
  }
  .opt:hover { border-color: var(--border-strong); color: var(--text); }
  .opt.sel { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }
  code, .cmd { font-family: var(--mono); font-size: 13px; }
  .cmdrow { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .cmd { background: rgba(8,9,13,0.6); border: 1px solid var(--border); border-radius: 10px; padding: 11px 13px; flex: 1; overflow: auto; white-space: nowrap; color: var(--text); }
  button {
    background: linear-gradient(180deg, var(--accent-hi), var(--accent)); color: #fff; border: 0;
    border-radius: 10px; padding: 10px 16px; font-size: 13px; font-weight: 580; cursor: pointer;
    box-shadow: 0 1px 0 rgba(255,255,255,0.16) inset, 0 6px 16px rgba(79,70,229,0.32);
    transition: filter .15s, transform .04s;
  }
  button:hover { filter: brightness(1.08); }
  button:active { transform: translateY(1px); }
  button.ghost { background: var(--surface-2); color: var(--text); box-shadow: none; border: 1px solid var(--border); }
  button.ghost:hover { background: var(--surface-3); border-color: var(--border-strong); }
  .hint { color: var(--text-dim); font-size: 12.5px; margin-top: 8px; }
  .qrbox { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; margin-top: 14px; }
  .qr { background: #fff; border-radius: 14px; padding: 11px; width: 184px; height: 184px; flex: none; box-shadow: 0 12px 30px rgba(0,0,0,0.40); }
  ol { margin: 6px 0 0; padding-left: 20px; } ol li { margin: 4px 0; font-size: 13.5px; color: var(--text-dim); }
  a { color: var(--accent-hi); } .foot { margin-top: 28px; font-size: 13px; color: var(--text-dim); }
  .presetlist { display: flex; flex-direction: column; gap: 9px; margin: 14px 0 6px; }
  .preset {
    display: flex; align-items: center; gap: 14px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 12px; padding: 13px 15px; cursor: pointer;
    transition: border-color .15s, background .15s, box-shadow .15s, transform .08s;
  }
  .preset:hover { border-color: var(--border-strong); background: var(--surface-2); }
  .preset:active { transform: translateY(1px); }
  .preset.on { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 3px var(--accent-soft); }
  .preset.busy { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 3px var(--accent-soft); cursor: progress; }
  .preset .pinfo { flex: 1; min-width: 0; }
  .preset .pt { font-size: 14.5px; font-weight: 600; }
  .preset .pd { font-size: 12.5px; color: var(--text-dim); margin-top: 3px; }
  .preset .pcmd { display: inline-block; margin-top: 8px; font-family: var(--mono); font-size: 11.5px;
    color: var(--text-dim); background: rgba(8,9,13,0.5); border: 1px solid var(--border); border-radius: 7px; padding: 3px 9px; }
  .preset .cmdsnip { margin-top: 8px; }
  .preset .cmdsnip summary { display: inline-flex; align-items: center; gap: 5px; width: max-content; cursor: pointer;
    list-style: none; user-select: none; font-size: 11.5px; color: var(--text-dim); }
  .preset .cmdsnip summary::-webkit-details-marker { display: none; }
  .preset .cmdsnip summary::before { content: '▸'; font-size: 9px; transition: transform .12s; }
  .preset .cmdsnip[open] summary::before { transform: rotate(90deg); }
  .preset .cmdsnip summary:hover { color: var(--text); }
  .preset .cmdsnip .copyfield { margin-top: 7px; }
  .preset .cmdsnip .copyfield code { font-family: var(--mono); font-size: 11.5px; color: var(--text); white-space: nowrap; }
  .preset .cmdsnip .iconbtn { opacity: 0; transition: opacity .12s, background .15s, color .15s; }
  .preset .cmdsnip:hover .iconbtn, .preset .cmdsnip:focus-within .iconbtn { opacity: 1; }
  .preset .pcfg { flex: none; }
  .ptoggle { position: relative; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; }
  /* the checkbox is a passive indicator now — the whole .preset row owns the click */
  .ptoggle input { width: 19px; height: 19px; pointer-events: none; accent-color: var(--accent); }
  .preset.busy .ptoggle input { visibility: hidden; }
  .pspin { display: none; position: absolute; width: 16px; height: 16px; border: 2px solid var(--accent-soft);
    border-top-color: var(--accent-hi); border-radius: 50%; animation: ospin .7s linear infinite; }
  .preset.busy .pspin { display: block; }
  @keyframes ospin { to { transform: rotate(360deg); } }
  .adv { color: var(--accent-hi); font-size: 13px; cursor: pointer; display: inline-block; margin: 8px 0 2px; user-select: none; }
  .callout {
    background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.30); border-radius: 11px;
    padding: 14px 16px; margin-top: 12px; font-size: 13.5px; color: #fde68a;
  }
  .callout code { background: rgba(8,9,13,0.6); color: #fff; padding: 5px 10px; border-radius: 7px; display: inline-block; margin-top: 8px; font-size: 13px; }
  .agentlist { display: flex; flex-direction: column; gap: 9px; margin: 10px 0 16px; }
  .agentrow {
    display: flex; align-items: center; gap: 12px;
    background: linear-gradient(180deg, var(--surface-2), var(--surface));
    border: 1px solid var(--border); border-radius: 12px; padding: 12px 15px;
    transition: border-color .15s, box-shadow .15s;
  }
  .agentrow:hover { border-color: var(--border-strong); }
  .agentrow.active {
    border-color: rgba(52,211,153,0.42);
    background: linear-gradient(180deg, rgba(52,211,153,0.10), rgba(52,211,153,0.04));
    box-shadow: 0 0 0 1px rgba(52,211,153,0.08);
  }
  .agentrow .nm { font-size: 14px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 540; }
  .agentrow .badge { font-size: 11px; font-weight: 560; padding: 3px 10px; border-radius: 99px; background: var(--surface-3); color: var(--text-dim); flex: none; }
  .agentrow .badge.act { background: var(--ok); color: #04130c; }
  .agentrow button { padding: 6px 12px; font-size: 12px; flex: none; }
  /* brand mark before each harness name — same size across brands; a touch larger in the add-list
     (not yet enabled), smaller once it's an enabled/connected harness. */
  .alogo { display: block; flex: none; border-radius: 6px; }
  .preset .alogo { width: 26px; height: 26px; }
  .agentrow .alg { display: inline-flex; flex: none; }
  .agentrow .alogo { width: 18px; height: 18px; }
  .agentrow .cloud { margin: 0 2px 0 0; font-size: 14px; cursor: help; flex: none; opacity: .85; }
  .addbox { border-top: 1px dashed var(--border-strong); padding-top: 16px; margin-top: 12px; }
  .addlabel { font-size: 13px; color: var(--text-dim); margin-bottom: 8px; font-weight: 540; }
  .phonechk { display: flex; align-items: flex-start; gap: 9px; font-size: 13px; color: var(--text); cursor: pointer; }
  .phonechk input { margin-top: 3px; flex: none; }
  .empty { color: var(--text-faint); font-size: 13px; padding: 10px 4px; }
  input, select {
    background: var(--surface); border: 1px solid var(--border); color: var(--text);
    border-radius: var(--radius-sm); padding: 9px 12px; font-size: 13px;
    transition: border-color .15s, box-shadow .15s;
  }
  input:hover { border-color: var(--border-strong); }
  input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  pre { background: rgba(8,9,13,0.6); border: 1px solid var(--border); border-radius: 10px; }
  summary { color: var(--accent-hi); font-size: 13px; }
  details[open] summary { margin-bottom: 6px; }
  ${SHELL_CSS}
  /* connections: full-width sticky header + two-column layout, to match the Control Panel */
  .chead { position: sticky; top: 0; z-index: 9; display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
    padding: 13px 26px; min-height: 56px; border-bottom: 1px solid var(--border);
    background: rgba(10,11,16,0.72); backdrop-filter: saturate(160%) blur(14px); -webkit-backdrop-filter: saturate(160%) blur(14px); }
  .chead .ttl h1 { font-size: 16px; margin: 0; font-weight: 650; letter-spacing: -0.01em; }
  .chead .ttl .csub { margin: 1px 0 0; font-size: 12px; color: var(--text-dim); }
  .statusbar { margin-left: auto; display: flex; gap: 10px; flex-wrap: wrap; }
  .schip { display: flex; align-items: center; gap: 9px; background: var(--surface); border: 1px solid var(--border); border-radius: 11px; padding: 7px 13px; }
  .schip .t { font-size: 11px; color: var(--text-dim); line-height: 1.15; }
  .schip .v { font-size: 12.5px; font-weight: 560; line-height: 1.2; }
  .conngrid { display: flex; flex-direction: column; gap: 16px; max-width: 760px; margin: 0 auto; padding: 22px 26px 64px; }
  .conngrid .col { display: contents; } /* flatten the old two-column wrappers → the 3 cards stack in order */
  .conngrid .step { margin: 0; }
  /* inline info tooltip + compact copy icon (keep cards short) */
  .info { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 99px;
    border: 1px solid var(--border-strong); color: var(--text-dim); font-size: 10px; font-style: normal; font-weight: 700;
    cursor: help; position: relative; vertical-align: middle; margin-left: 5px; }
  .info:hover, .info:focus { color: var(--text); border-color: var(--accent); outline: none; }
  .info::after { content: attr(data-tip); position: absolute; left: 0; top: calc(100% + 8px);
    width: max-content; max-width: 300px; background: var(--surface-3); color: var(--text); border: 1px solid var(--border-strong);
    border-radius: 9px; padding: 9px 11px; font-size: 12px; line-height: 1.45; font-weight: 400; text-align: left;
    box-shadow: 0 10px 26px rgba(0,0,0,0.45); opacity: 0; visibility: hidden; transition: opacity .12s; z-index: 20; pointer-events: none; }
  .info:hover::after, .info:focus::after { opacity: 1; visibility: visible; }
  .copyfield { display: inline-flex; align-items: stretch; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: rgba(8,9,13,0.6); }
  .copyfield code { border: 0; background: transparent; padding: 6px 10px; }
  .iconbtn { background: transparent; border: 0; border-left: 1px solid var(--border); color: var(--text-dim); cursor: pointer;
    padding: 0 9px; box-shadow: none; border-radius: 0; display: inline-flex; align-items: center; }
  .iconbtn:hover { background: var(--surface-2); color: var(--text); filter: none; }
  .iconbtn.ok { color: var(--ok); }
  /* pair-your-phone: steps + manual code sit BESIDE the QR, not in their own rows */
  .qrbox { align-items: flex-start; }
  .qrbox .qrside { display: flex; flex-direction: column; gap: 12px; flex: 1; min-width: 188px; }
  .qrbox .qrside ol { margin: 0; }
  .manualrow { font-size: 13px; color: var(--text-dim); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  /* roster rows show each agent's strength so you can see who does what at a glance */
  .agentrow .nm { display: flex; flex-direction: column; gap: 1px; }
  .agentrow .nm .anm { font-weight: 540; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .agentrow .nm .adesc { font-size: 12px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style></head>
<body><div class="app">${sidebar("/connections")}<main class="appmain">
  <header class="chead">
    <div class="ttl"><h1>Connections</h1><div class="csub">Link your phone and your harnesses to this hub.</div></div>
    <div class="statusbar">
      <div class="schip"><span id="ad" class="dot"></span><div><div class="t">Harness</div><div id="av" class="v">checking…</div></div></div>
      <div class="schip"><span id="pd" class="dot"></span><div><div class="t">Phone</div><div id="pv" class="v">checking…</div></div></div>
    </div>
  </header>
  <div class="conngrid">
    <div class="col">
  <div class="step" id="step1">
    <h2>Your harnesses</h2>
    <p>Harnesses are the brains that talk to you and act on your phone. Connect one or several — then switch between them anytime, from the phone or right here.</p>
    <div id="agentlist" class="agentlist"></div>
    <div class="addbox">
      <div class="addlabel">Add a harness</div>
      <div class="presetlist">
        <div class="preset" data-type="claude">
          ${AGENT_LOGOS.claude}
          <div class="pinfo"><div class="pt">Claude</div><div class="pd">Runs the <code>claude</code> CLI on this computer.</div>${cmdSnippet("pnpm agent:claude")}</div>
          <span class="ptoggle" title="Click the row to add"><input type="checkbox" class="ptogglebox" data-type="claude" /><span class="pspin"></span></span>
        </div>
        <div class="preset" data-type="omp">
          ${AGENT_LOGOS.omp}
          <div class="pinfo"><div class="pt">omp (Oh My Pi)</div><div class="pd">Open-source coding harness. Full phone control via MCP.</div>${cmdSnippet("pnpm agent:omp")}</div>
          <span class="ptoggle" title="Click the row to add"><input type="checkbox" class="ptogglebox" data-type="omp" /><span class="pspin"></span></span>
        </div>
        <div class="preset" data-type="cursor">
          ${AGENT_LOGOS.cursor}
          <div class="pinfo"><div class="pt">Cursor</div><div class="pd">Runs the <code>cursor-agent</code> CLI on this computer. Full phone control via MCP.</div>${cmdSnippet("pnpm agent:cursor")}</div>
          <span class="ptoggle" title="Click the row to add"><input type="checkbox" class="ptogglebox" data-type="cursor" /><span class="pspin"></span></span>
        </div>
        <div class="preset" data-type="basic">
          ${AGENT_LOGOS.basic}
          <div class="pinfo"><div class="pt">Built-in helper</div><div class="pd">No setup, no login. Basic replies — good for a first test.</div><code class="pcmd">built-in · no external command</code></div>
          <span class="ptoggle" title="Click the row to add"><input type="checkbox" class="ptogglebox" data-type="basic" /><span class="pspin"></span></span>
        </div>
        <div class="preset cfg" data-type="other">
          ${AGENT_LOGOS.other}
          <div class="pinfo"><div class="pt">Other local harness</div><div class="pd">Hermes, Pi, Codex… any CLI on this computer.</div></div>
          <button class="ghost pcfg" data-type="other">Configure</button>
        </div>
        <div id="otherform" style="display:none;">
          <input id="oname" placeholder="Name (e.g. Hermes)" style="width:100%;margin:0 0 8px;" />
          <input id="ocmd" placeholder="command to run (e.g. hermes, pi, cursor-agent)" style="width:100%;margin:0 0 8px;font-family:var(--mono);" />
          <label class="phonechk"><input type="checkbox" id="ophone" checked /><span>Can control the phone <span class="hint" style="margin:0;">— for Claude Code-compatible CLIs (Claude, Hermes, Pi). Off = chat only.</span></span></label>
          <div class="cmdrow" style="margin-top:10px;"><button id="connect">Add harness</button><span id="astate" class="hint" style="margin:0;"></span></div>
        </div>
        <div class="preset cfg" data-type="remote">
          ${AGENT_LOGOS.remote}
          <div class="pinfo"><div class="pt">Remote / cloud harness</div><div class="pd">A Hermes (or anything) running elsewhere that connects to this hub itself.</div></div>
          <button class="ghost pcfg" data-type="remote">Set up</button>
        </div>
        <div id="remoteinfo" style="display:none;">
          <p class="step-p">No “Add” button — a remote harness connects itself. Send the prompt below to your cloud harness; it spells out exactly how to reach this hub and reply. (Keep the address on your tailnet — the port is unauthenticated by design.)</p>
          <pre id="remoteprompt" style="padding:12px 13px;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto;margin:0;">loading…</pre>
          <div class="cmdrow" style="margin-top:8px;"><button id="copyprompt">Copy prompt</button><span class="hint" id="remotewait" style="margin:0;">⏳ Waiting for a remote harness to connect…</span></div>
        </div>
      </div>
      <div id="alog" class="callout" style="display:none;"></div>
    </div>
  </div>
    </div>
    <div class="col">

  <div class="step" id="step2">
    <h2>Pair your phone</h2>
    <div class="hubname-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 14px;">
      <span class="hint" style="margin:0;">This hub's name on your phone:</span>
      <input id="hubname" placeholder="this computer" style="flex:1;min-width:150px;" />
      <button id="hubnamesave" class="ghost" style="padding:8px 12px;">Save</button>
      <span id="hubnamestate" class="hint" style="margin:0;"></span>
    </div>
    <div class="qrbox">
      <img class="qr" id="qrimg" src="/pair-qr" alt="Pairing QR code" />
      <div class="qrside">
        <ol>
          <li>Scan the code in the app's pairing screen.</li>
          <li>The phone connects to <b id="prelay">this Mac</b>.</li>
          <li>This panel turns green when it connects.</li>
        </ol>
        <div class="manualrow">
          <span>Can't scan? Enter this code:</span>
          <span class="copyfield"><code id="manualcode" style="font-family:var(--mono);color:var(--text);">…</code><button id="copymanual" class="iconbtn" title="Copy code" aria-label="Copy code"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button></span>
        </div>
      </div>
    </div>
    <div style="margin-top:12px;">
      <div class="hint" style="margin-bottom:6px;">How should the phone reach this hub?</div>
      <div class="opts">
        <div class="opt sel" data-relay="auto">Same Wi-Fi</div>
        <div class="opt" data-relay="anywhere">Anywhere (Tailscale)</div>
        <div class="opt" data-relay="usb">USB cable</div>
      </div>
      <div id="relayrow" style="display:none;gap:8px;margin:8px 0;">
        <input id="relayinput" placeholder="your Mac's Tailscale IP, e.g. 100.x.x.x" style="flex:1;min-width:0;" />
      </div>
      <span id="relaystate" class="hint" style="margin:0;"></span>
    </div>
    <details style="margin-top:14px;"><summary style="cursor:pointer;font-size:13px;">Phone won't connect?</summary>
      <ul style="font-size:13px;margin:8px 0 0;padding-left:18px;">
        <li><b>Same Wi-Fi:</b> the phone and this Mac must be on the same network — or use Tailscale to skip that.</li>
        <li><b>Firewall:</b> if macOS asks to allow <code>node</code> to accept incoming connections, click Allow (System Settings, Network, Firewall).</li>
        <li><b>Any network:</b> install Tailscale on both, pick "Anywhere" above, paste your Mac's Tailscale IP, then re-pair.</li>
        <li><b>Still stuck:</b> in the phone app tap "Retry", or re-pair by scanning the QR again.</li>
      </ul>
    </details>
  </div>
    </div>
  </div>
<script>
  const LOGOS = ${JSON.stringify(AGENT_LOGOS)};
  // Pick a brand mark for a connected harness: by kind first (claude/omp/cursor/basic), else by name for
  // self-connected externals (Hermes etc.); fall back to the neutral "other" badge.
  function logoKeyFor(a){
    const k=(a.kind||'').toLowerCase(); if(LOGOS[k]) return k;
    const n=(a.name||'').toLowerCase();
    if(n.indexOf('hermes')>=0) return 'hermes';
    if(n.indexOf('claude')>=0) return 'claude';
    if(n.indexOf('cursor')>=0) return 'cursor';
    if(n.indexOf('omp')>=0||n.indexOf('oh my pi')>=0) return 'omp';
    return 'other';
  }
  // Configure rows (other / remote) expand their own form below them.
  function toggleCfg(t){
    const of=document.getElementById('otherform'), ri=document.getElementById('remoteinfo');
    if(t==='other'){ const show=of.style.display==='none'; of.style.display=show?'block':'none'; ri.style.display='none'; if(show) document.getElementById('oname').focus(); }
    else { const show=ri.style.display==='none'; ri.style.display=show?'block':'none'; of.style.display='none'; if(show) loadRemotePrompt(); }
  }
  // Clicking a preset row ADDS that harness; once it's running it moves to the list above and leaves the
  // add-list (no duplicate). Disconnect happens from its row up there. Source of truth is /status; a spinner
  // covers the in-flight gap.
  let _lastAgents=[]; const presetWant={}, presetPending={};
  async function togglePreset(kind, want){
    presetWant[kind]=want; presetPending[kind]=true; syncPresets(_lastAgents);
    document.getElementById('alog').style.display='none';
    try{
      if(want){
        const r=await (await fetch('/agent/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:kind})})).json();
        if(!r.ok){ presetPending[kind]=false; presetWant[kind]=false; showCallout(r.error||'Could not start the harness.', r.command); syncPresets(_lastAgents); poll(); return; }
      } else {
        for(const a of _lastAgents.filter(a=>a.managed && a.kind===kind))   // un-add: stop every managed harness of this kind
          await fetch('/agent/stop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:a.id})});
      }
    }catch(e){ presetPending[kind]=false; showCallout(String(e)); syncPresets(_lastAgents); }
    poll(); for(let i=1;i<=10;i++) setTimeout(poll, i*600);
  }
  function syncPresets(list){
    ['claude','omp','cursor','basic'].forEach(kind=>{
      const row=document.querySelector('.preset[data-type="'+kind+'"]'); if(!row) return;
      const running=list.some(a=>a.managed && a.kind===kind);
      if(presetPending[kind] && running===presetWant[kind]) presetPending[kind]=false; // settled
      const pending=!!presetPending[kind];
      // Running (and not mid-start) → it lives in the list above; hide its add-row so there's no duplicate.
      // While starting, keep the row but show it busy (spinner + colour). Disconnecting it above flips
      // running false and the row reappears in its original slot.
      row.style.display=(running && !pending)?'none':'';
      const box=row.querySelector('.ptogglebox'); if(box){ box.checked=false; box.disabled=pending; }
      row.classList.toggle('busy', pending);
    });
  }
  // The WHOLE row is the click target now (not just the checkbox/button).
  document.querySelectorAll('.preset[data-type]').forEach(row=>{
    const kind=row.dataset.type;
    row.onclick=()=>{
      if(kind==='other'||kind==='remote'){ toggleCfg(kind); return; } // config rows expand their form
      if(presetPending[kind]) return;                                  // already starting — ignore repeats
      togglePreset(kind, true);                                        // add it (disconnect is up in the list)
    };
  });
  // The "run in a terminal instead" snippet lives inside the clickable row — keep its expand/copy clicks
  // from bubbling up and adding the harness. Copy button writes the command and flashes a check.
  document.querySelectorAll('.preset .cmdsnip').forEach(function(d){
    d.addEventListener('click', function(e){ e.stopPropagation(); });
    const btn=d.querySelector('.snipcopy');
    if(btn) btn.onclick=function(){ const t=d.querySelector('code').textContent;
      if(navigator.clipboard&&t) navigator.clipboard.writeText(t);
      const o=btn.innerHTML; btn.classList.add('ok'); btn.innerHTML='✓';
      setTimeout(function(){ btn.innerHTML=o; btn.classList.remove('ok'); },1200); };
  });
  let _promptLoaded=false;
  async function loadRemotePrompt(){ if(_promptLoaded) return; _promptLoaded=true;
    try{ const t=await (await fetch('/remote-prompt')).text(); document.getElementById('remoteprompt').textContent=t; }
    catch(e){ document.getElementById('remoteprompt').textContent='(could not load the prompt — is the hub running?)'; _promptLoaded=false; } }
  document.getElementById('copyprompt').onclick=()=>{ const a=document.getElementById('remoteprompt').textContent; if(navigator.clipboard) navigator.clipboard.writeText(a); const b=document.getElementById('copyprompt'); const t=b.textContent; b.textContent='Copied'; setTimeout(()=>{b.textContent=t;},1200); };
  function showCallout(error,command){
    const lg=document.getElementById('alog'); lg.innerHTML='';
    const p=document.createElement('div'); p.textContent=error; lg.appendChild(p);
    if(command){ const code=document.createElement('code'); code.textContent=command; lg.appendChild(code); }
    if(command==='claude setup-token'){
      const row=document.createElement('div'); row.style.cssText='margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;';
      const inp=document.createElement('input'); inp.placeholder='paste the token it prints (sk-ant-oat...)'; inp.style.cssText='flex:1;min-width:200px;';
      const btn=document.createElement('button'); btn.textContent='Save token';
      btn.onclick=async()=>{ try{ const r=await (await fetch('/agent/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:inp.value})})).json(); btn.textContent=r.ok?'Saved — now press Connect':'Save failed'; }catch(e){ btn.textContent='Save failed'; } };
      row.appendChild(inp); row.appendChild(btn); lg.appendChild(row);
      const hint=document.createElement('div'); hint.style.cssText='margin-top:8px;font-size:12.5px;color:var(--text-dim);'; hint.textContent='The token is printed in the terminal where you ran the command (not the browser). Paste it here, Save, then press Connect.'; lg.appendChild(hint);
    }
    lg.style.display='block';
  }
  // Optimistic "starting…" row so the list shows the agent the instant you click — the /agent/start
  // sign-in probe (Claude) can take a few seconds before the real row arrives, and a dead screen reads
  // as "nothing happened". The next /status poll replaces this with the real (managed) row.
  function pendingRow(type){
    const host=document.getElementById('agentlist');
    const empty=host.querySelector('.empty'); if(empty) empty.remove();
    let row=document.getElementById('pendingrow');
    if(!row){ row=document.createElement('div'); row.className='agentrow'; row.id='pendingrow';
      const dot=document.createElement('span'); dot.className='dot wait'; row.appendChild(dot);
      const nm=document.createElement('div'); nm.className='nm'; row.appendChild(nm);
      const b=document.createElement('span'); b.className='badge'; b.textContent='starting…'; row.appendChild(b);
      host.insertBefore(row, host.firstChild); }
    const names={omp:'omp', claude:'Claude', basic:'Built-in helper'};
    row.querySelector('.nm').textContent = type==='other' ? (document.getElementById('oname').value.trim()||'agent') : (names[type]||type);
  }
  function clearPending(){ const pr=document.getElementById('pendingrow'); if(pr) pr.remove(); }
  document.getElementById('connect').onclick=async()=>{   // "Other local harness" only — presets use checkboxes
    const btn=document.getElementById('connect'); const st=document.getElementById('astate');
    const command=document.getElementById('ocmd').value.trim();
    if(!command){ st.textContent='enter a command'; document.getElementById('ocmd').focus(); return; }
    const body={type:'other', name:document.getElementById('oname').value.trim(), command, phone:document.getElementById('ophone').checked};
    // Instant feedback: busy button + the optimistic row, so the wait is never a blank screen.
    btn.disabled=true; const lbl=btn.textContent; btn.textContent='Adding…';
    st.textContent=''; document.getElementById('alog').style.display='none';
    pendingRow('other');
    try{
      const r=await (await fetch('/agent/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();
      if(!r.ok){ clearPending(); showCallout(r.error||'Could not start the agent.', r.command); }
      else { document.getElementById('oname').value=''; document.getElementById('ocmd').value=''; }
    }catch(e){ clearPending(); showCallout(String(e)); }
    btn.disabled=false; btn.textContent=lbl;
    // Poll briskly for a few seconds so "starting…" flips to Active without waiting on the 2s tick.
    poll(); for(let i=1;i<=8;i++) setTimeout(poll, i*600);
  };
  function set(dot,val,on,wait,txt){ const d=document.getElementById(dot); d.className='dot'+(on?' on':wait?' wait':''); document.getElementById(val).textContent=txt; }
  async function setActive(id){ try{ await fetch('/agent/select',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})}); }catch(e){} poll(); }
  async function stopAgent(id){ try{ await fetch('/agent/stop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})}); }catch(e){} poll(); }
  function agentRow(a){
    const row=document.createElement('div'); row.className='agentrow'+(a.active?' active':'');
    const dot=document.createElement('span');
    // Every CONNECTED harness is green (it IS connected); a connected-but-not-signed-in active one stays
    // amber. Not-yet-connected = amber "starting". The active harness is set apart by the row border alone.
    dot.className='dot '+(!a.connected?'wait':(a.active&&a.ready===false?'bad':'on'));
    row.appendChild(dot);
    const lg=document.createElement('span'); lg.className='alg'; lg.innerHTML=LOGOS[logoKeyFor(a)]||''; row.appendChild(lg);
    const nm=document.createElement('div'); nm.className='nm';
    const an=document.createElement('div'); an.className='anm'; an.textContent=a.name; nm.appendChild(an);
    if(a.description){ const ad=document.createElement('div'); ad.className='adesc'; ad.textContent=a.description; nm.appendChild(ad); }
    row.appendChild(nm);
    // Cloud marker lives on the RIGHT, next to the active area — it flags a self-connected external harness.
    if(a.connected && !a.managed){ const c=document.createElement('span'); c.className='cloud'; c.textContent='☁'; c.title='Cloud / external harness — it connected to this hub on its own (a remote brain or a hand-started CLI), not launched here.'; row.appendChild(c); }
    if(!a.connected){ const b=document.createElement('span'); b.className='badge'; b.textContent='starting…'; row.appendChild(b); }
    else if(a.active){ const b=document.createElement('span'); b.className='badge act'; b.textContent='Active'; row.appendChild(b); }
    else { const btn=document.createElement('button'); btn.className='ghost'; btn.textContent='Set active'; btn.onclick=()=>setActive(a.id); row.appendChild(btn); }
    if(a.managed){ const btn=document.createElement('button'); btn.className='ghost'; btn.textContent='Disconnect'; btn.onclick=()=>stopAgent(a.id); row.appendChild(btn); }
    return row;
  }
  let _agentsSig='';
  function renderAgents(list){
    const sig=JSON.stringify(list); if(sig===_agentsSig) return; _agentsSig=sig;  // only rebuild when it changes
    const host=document.getElementById('agentlist'); host.innerHTML='';
    if(!list.length){ const e=document.createElement('div'); e.className='empty'; e.textContent='No harnesses connected yet — add one below.'; host.appendChild(e); return; }
    list.forEach(a=>host.appendChild(agentRow(a)));
  }
  let _calloutKey='';
  async function poll(){ try{ const s=await (await fetch('/status')).json();
    const list=s.agents||[]; const active=s.active;
    const aOk = !!active && active.ready!==false;       // active agent connected AND able to authenticate
    const starting = list.some(a=>!a.connected);
    _lastAgents=list; renderAgents(list); syncPresets(list);
    set('ad','av', aOk, (active&&active.ready===false)||starting,
      !list.length ? (starting?'Starting…':'No harness connected')
      : active ? (active.ready===false ? ('Sign-in needed — '+active.name)
                 : ('Active: '+active.name + (list.length>1?(' · +'+(list.length-1)+' more'):'')))
               : 'Connecting…');
    set('pd','pv',s.phone.connected,s.paired&&!s.phone.connected, s.phone.connected?('Connected — '+s.phone.caps+' actions'):(s.paired?'Paired, waiting…':'Not paired — do step 2'));
    document.getElementById('step1').classList.toggle('done',aOk);
    document.getElementById('step2').classList.toggle('done',s.phone.connected);
    if(s.phoneRelay){ const pr=document.getElementById('prelay'); if(pr) pr.textContent=s.phoneRelay; }
    const hn=document.getElementById('hubname'); if(hn && document.activeElement!==hn && hn.dataset.dirty!=='1' && s.hubName) hn.value=s.hubName;
    const mc=document.getElementById('manualcode'); if(mc) mc.textContent = s.pairCode || '—';
    const ext=(s.agents||[]).filter(a=>a.connected && !a.managed); const rw=document.getElementById('remotewait');
    if(rw) rw.textContent = ext.length
      ? ('✓ '+ext.length+' remote/external harness'+(ext.length>1?'es':'')+' connected — pick one in the list above to make it active.')
      : '⏳ Waiting for a remote harness to connect… it appears in the list above the moment it does. The port is unauthenticated by design — keep it on your tailnet only.';
    // Reflect the SAVED relay choice in the picker on first load (so Tailscale shows selected, not Wi-Fi).
    if(!window._relaySynced && s.relayChoice){ window._relaySynced=true;
      const opt=document.querySelector('[data-relay="'+s.relayChoice+'"]');
      if(opt){ document.querySelectorAll('[data-relay]').forEach(x=>x.classList.toggle('sel',x===opt));
        if(s.relayChoice==='anywhere'){ document.getElementById('relayrow').style.display='flex';
          const ri=document.getElementById('relayinput'); if(!ri.value && (s.phoneRelay||'').startsWith('http')) ri.value=s.phoneRelay; } } }
    const st=document.getElementById('astate');
    if(starting) st.textContent='starting…'; else if(st.textContent==='starting…'||st.textContent==='adding…') st.textContent='';
    // Honest callout for the ACTIVE agent: connected but can't authenticate → show the exact fix.
    // Keyed so we don't rebuild it every 2s (which would wipe a token being typed); cleared once ready.
    if(aOk || !active){ if(_calloutKey){ _calloutKey=''; document.getElementById('alog').style.display='none'; } }
    else { const key=(active&&active.ready===false)?('a:'+(active.status||'')+'|'+(active.command||'')):'';
      if(key && key!==_calloutKey){ _calloutKey=key; showCallout(active.status||'Claude needs sign-in on this computer.', active.command); } }
  }catch(e){} }
  const relayOpts=[...document.querySelectorAll('[data-relay]')];
  const relayInput=document.getElementById('relayinput');
  relayOpts.forEach(o=>o.onclick=()=>{
    relayOpts.forEach(x=>x.classList.toggle('sel',x===o));
    const kind=o.dataset.relay;
    document.getElementById('relayrow').style.display = kind==='anywhere' ? 'flex' : 'none';
    if(kind==='anywhere'){
      // Prefill with the saved Tailscale address if there is one, and focus so it's obvious what to do.
      const cur=document.getElementById('prelay').textContent||'';
      if(!relayInput.value && cur.startsWith('http')) relayInput.value=cur;
      relayInput.focus();
    } else setRelay(kind);
  });
  // Auto-apply: commit on blur or Enter — no Apply button.
  relayInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); relayInput.blur(); } });
  relayInput.addEventListener('change', ()=>{ if(relayInput.value.trim()) setRelay(relayInput.value); });
  async function setRelay(value){
    const st=document.getElementById('relaystate'); st.textContent='saving…';
    try{ const r=await (await fetch('/relay-url',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value})})).json();
      if(r.ok){ st.textContent='✓ saved'; document.getElementById('qrimg').src='/pair-qr?t='+Date.now(); setTimeout(()=>{ if(st.textContent==='✓ saved') st.textContent=''; },1600); } else { st.textContent=r.error||'failed'; } }
    catch(e){ st.textContent='failed'; }
  }
  const _hn=document.getElementById('hubname');
  if(_hn){ _hn.addEventListener('input',()=>{_hn.dataset.dirty='1';});
    document.getElementById('hubnamesave').onclick=async()=>{
      const st=document.getElementById('hubnamestate'); st.textContent='saving…';
      try{ const r=await (await fetch('/hub-name',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:_hn.value})})).json();
        if(r.ok){ st.textContent='✓ saved'; _hn.dataset.dirty=''; if(r.hubName) _hn.value=r.hubName; document.getElementById('qrimg').src='/pair-qr?t='+Date.now(); }
        else st.textContent=r.error||'failed'; }catch(e){ st.textContent='failed'; }
    };
  }
  const _cm=document.getElementById('copymanual');
  if(_cm) _cm.onclick=()=>{ const t=document.getElementById('manualcode').textContent; if(navigator.clipboard&&t&&t!=='—'&&t!=='…') navigator.clipboard.writeText(t); const o=_cm.innerHTML; _cm.innerHTML='✓'; _cm.classList.add('ok'); setTimeout(()=>{_cm.innerHTML=o;_cm.classList.remove('ok');},1200); };
  setInterval(poll,2000); poll();
</script></main></div></body></html>`;

/** Settings — read-only hub facts, styled to match the Connections page (sticky header + gradient cards). */
interface SettingsInfo { hubName: string; webUrl: string; agentSocket: string; relayUrl: string; phoneReach: string; maxDepth: number }
const SETTINGS_PAGE = (s: SettingsInfo) => {
  const esc = (v: string) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const row = (ic: string, label: string, value: string, copy = true) => `<div class="kv">
    <span class="kvi">${icon(ic, 17)}</span><span class="kvl">${label}</span>
    <span class="kvv">${copy
      ? `<span class="copyfield"><code>${esc(value)}</code><button class="iconbtn copy" title="Copy" aria-label="Copy">${icon("copy", 13)}</button></span>`
      : `<code>${esc(value)}</code>`}</span></div>`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/svg+xml" href="/public/logo.svg">
<title>Agentic Android — Settings</title>
<style>
  ${BASE_CSS}
  ${SHELL_CSS}
  ${HEADER_CSS}
  .setwrap { max-width: 760px; margin: 0 auto; padding: 26px 26px 64px; display: flex; flex-direction: column; gap: 16px; }
  .scard { background: linear-gradient(180deg, var(--surface-2), var(--surface)); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 18px 22px 8px; box-shadow: 0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 30px rgba(0,0,0,0.22);
    transition: border-color .2s, box-shadow .2s; }
  .scard:hover { border-color: var(--border-strong); }
  .scard .sh { display: flex; align-items: center; gap: 12px; }
  .scard .sh .si { width: 34px; height: 34px; border-radius: 10px; flex: none; display: inline-flex; align-items: center; justify-content: center;
    color: var(--accent-hi); background: var(--accent-soft); border: 1px solid rgba(129,140,248,0.28); }
  .scard .sh h2 { font-size: 15px; margin: 0; font-weight: 620; letter-spacing: -0.005em; }
  .scard .sh .sd { font-size: 12.5px; color: var(--text-dim); margin: 1px 0 0; }
  .kv { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--border); }
  .scard .sh + .kv { border-top: 0; margin-top: 8px; }
  .kvi { color: var(--text-faint); flex: none; display: inline-flex; }
  .kvl { font-size: 13px; color: var(--text-dim); flex: none; width: 168px; }
  .kvv { margin-left: auto; min-width: 0; display: flex; justify-content: flex-end; }
  .kvv > code { font-family: var(--mono); font-size: 12.5px; color: var(--text); background: none; border: 0; padding: 0; }
  .copyfield { display: inline-flex; align-items: stretch; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: rgba(8,9,13,0.6); }
  .copyfield code { font-family: var(--mono); font-size: 12.5px; color: var(--text); border: 0; background: transparent; padding: 6px 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 360px; }
  .iconbtn.copy { background: transparent; border: 0; border-left: 1px solid var(--border); color: var(--text-dim); cursor: pointer; padding: 0 9px; display: inline-flex; align-items: center; transition: background .15s, color .15s; }
  .iconbtn.copy:hover { background: var(--surface-2); color: var(--text); }
  .iconbtn.copy.ok { color: var(--ok); }
  .note { font-size: 13px; color: var(--text-dim); line-height: 1.55; padding: 12px 0 14px; border-top: 1px solid var(--border); }
  .note a { color: var(--accent-hi); }
  @media (max-width: 560px) { .kv { flex-wrap: wrap; } .kvl { width: auto; } .kvv { margin-left: 0; width: 100%; justify-content: flex-start; } .copyfield code { max-width: 200px; } }
</style></head>
<body><div class="app">${sidebar("/settings")}<main class="appmain">
  <header class="chead">
    <div class="ttl"><span class="hi">${icon("settings", 19)}</span>
      <div><h1>Settings</h1><div class="csub">Configure this hub and how it connects. Read-only for now — editable controls land as features need them.</div></div></div>
    <div class="statusbar"><div class="schip"><span class="dot on"></span><div><div class="t">Hub</div><div class="v">Running</div></div></div></div>
  </header>
  <div class="setwrap">
    <div class="scard">
      <div class="sh"><span class="si">${icon("storage", 19)}</span><div><h2>This hub</h2><div class="sd">Identity &amp; local endpoints.</div></div></div>
      ${row("smartphone", "Name on your phone", s.hubName, false)}
      ${row("dashboard", "Web UI", s.webUrl)}
      ${row("bolt", "Harness socket", s.agentSocket)}
    </div>
    <div class="scard">
      <div class="sh"><span class="si">${icon("link", 19)}</span><div><h2>Connectivity</h2><div class="sd">How the phone reaches this hub.</div></div></div>
      ${row("link", "Relay server", s.relayUrl)}
      ${row("smartphone", "Phone reaches hub at", s.phoneReach)}
      <div class="note">Pair a phone and switch the network it uses (Wi-Fi, Tailscale, USB) on the <a href="/">Connections</a> page.</div>
    </div>
    <div class="scard">
      <div class="sh"><span class="si">${icon("tree", 19)}</span><div><h2>Orchestration</h2><div class="sd">Limits for harness-to-harness delegation.</div></div></div>
      ${row("tree", "Max delegation hops", String(s.maxDepth), false)}
      <div class="note">When a harness holds the driver seat it can delegate to your other harnesses; this caps how deep those hops can chain. Watch them live in the Orchestration panel inside <a href="/chat">Chat</a>.</div>
    </div>
    <div class="scard">
      <div class="sh"><span class="si">${icon("info", 19)}</span><div><h2>Coming soon</h2><div class="sd">On the roadmap for this page.</div></div></div>
      <div class="note">Editable hub name, relay/connectivity, per-agent defaults, consent policy, and orchestration limits — all configurable right here.</div>
    </div>
    <div class="scard">
      <div class="sh"><span class="si">${icon("info", 19)}</span><div><h2>About</h2><div class="sd">Who built this.</div></div></div>
      <div class="note">Agentic Android — built by <a href="https://www.linkedin.com/in/roman-grinevich/" target="_blank" rel="noopener">Roman Grinevich</a>. Open-source; contributors are credited in <code>AUTHORS.md</code> — add your line when you send a PR, and sign your work.</div>
    </div>
  </div>
<script>
  document.querySelectorAll('.copyfield .copy').forEach(function(b){ b.onclick=function(){
    var t=b.parentElement.querySelector('code').textContent;
    if(navigator.clipboard&&t) navigator.clipboard.writeText(t);
    var o=b.innerHTML; b.innerHTML='${icon("check", 13)}'; b.classList.add('ok');
    setTimeout(function(){ b.innerHTML=o; b.classList.remove('ok'); },1200);
  }; });
</script></main></div></body></html>`;
};

export interface StartPanelOpts {
  identity?: Identity; peerEdPub?: string; relayUrl?: string;
  host?: string; httpPort?: number; agentPort?: number;
}

export async function startPanel(opts: StartPanelOpts = {}) {
  await ready();
  const cfg = loadCfg();
  const self = opts.identity ?? cfg.self;
  const peerEdPub = opts.peerEdPub ?? cfg.peerEdPub!;
  const relayUrl = opts.relayUrl ?? cfg.relayUrl;
  const HOST = opts.host ?? process.env.PANEL_HOST ?? "127.0.0.1";
  loadEvents();
  loadConversation();

  const bus = new BusEndpoint({ self, peerEdPub, relayUrl });
  await bus.connect();
  logEvent("connection", `connected to relay ${relayUrl}`, { relayUrl });
  let _panelClosed = false;

  // ---- Server-Sent Events: the web chat is a live peer of the phone. Instead of touching every
  // bus.event() call site, we wrap bus.event ONCE so every hub→client event also fans out to browsers
  // over GET /stream. The browser mirrors exactly what the phone receives over the relay. ----
  const sseClients = new Set<http.ServerResponse>();
  const sseSend = (res: http.ServerResponse, topic: string, data: unknown) => {
    try { res.write(`event: ${topic}\ndata: ${JSON.stringify(data ?? {})}\n\n`); } catch { /* client gone */ }
  };
  const sseBroadcast = (topic: string, data: unknown) => { for (const r of sseClients) sseSend(r, topic, data); };
  const _busEventRaw = bus.event.bind(bus);
  (bus as unknown as { event: (t: string, d: unknown) => void }).event = (topic, data) => { sseBroadcast(topic, data); return _busEventRaw(topic, data as Record<string, unknown>); };

  // ---------- pairing payload (shared by the QR + the manual code) ----------
  /** The exact string the phone needs to pair: a "PAIR:"-prefixed base64url blob of the hub's identity. */
  const pairPayload = () => "PAIR:" + Buffer.from(JSON.stringify({
    edPub: cfg.self.edPub, fp: cfg.self.fp, relayUrl: phoneRelayUrl(cfg.relayUrl), hubName: hubName(),
  })).toString("base64url");
  /** host:port the phone dials to reach this hub's relay (for the manual-code prefix). */
  const phoneHost = () => { try { return new URL(phoneRelayUrl(cfg.relayUrl)).host; } catch { return ""; } };

  // Manual pairing code: park the (non-secret) pairing payload at the relay so the phone can pair by
  // typing a short code instead of scanning. Cached + refreshed before expiry; invalidated whenever the
  // payload changes (relay address or hub name). The displayed code is "host/CODE" — the phone splits it
  // to learn where to fetch the payload (it isn't paired yet, so it can't know the host otherwise).
  let pairCodeCache: { code: string; host: string; expires: number } | null = null;
  const invalidatePairCode = () => { pairCodeCache = null; };
  async function ensurePairCode(): Promise<string | null> {
    const now = Date.now();
    if (pairCodeCache && pairCodeCache.expires > now + 60_000) return `${pairCodeCache.host}/${pairCodeCache.code}`;
    try {
      const r = await fetch(`${cfg.relayUrl}/pair-code`, { method: "POST", headers: { "content-type": "text/plain" }, body: pairPayload() });
      if (!r.ok) return null;
      const { code, ttlMs } = await r.json() as { code: string; ttlMs?: number };
      pairCodeCache = { code, host: phoneHost(), expires: now + (ttlMs ?? 600_000) };
      return `${pairCodeCache.host}/${pairCodeCache.code}`;
    } catch { return null; }
  }

  // ---------- the agent connects IN over a local WebSocket; the brain runs as its OWN process ----------
  const AGENT_PORT = opts.agentPort ?? Number(process.env.AGENT_PORT ?? 8124);
  let agentSock: WebSocket | null = null; // the ACTIVE harness's socket — all existing routing uses this
  let agentName: string | null = null;
  let agentReady: boolean | null = null; // null = unknown (probing); false = connected but can't auth
  let agentStatus: { label?: string; command?: string } = {};
  let agentCommands: unknown[] = []; // slash command/skill catalog the agent published, for the phone's `/` menu
  let pendingSay: ((text: string) => void) | null = null; // resolves /say with the next agent reply
  // Phase 8: the hub can hold several harnesses at once. `agentSock` stays the active one (single-harness
  // behavior is unchanged); this roster tracks everyone connected so the phone can see + switch them.
  const agents = new Map<string, { ws: WebSocket; name: string; description?: string; orchestrator?: boolean }>();
  let activeAgentId: string | null = null;
  // `external` = the agent dialed in on its own (a remote/cloud brain or a hand-started CLI), i.e. the
  // hub didn't spawn it. The phone + web show a cloud icon for these.
  // `orchestrator` = it holds this hub's driver seat (list_agents/ask_agent). Hub-launched agents always
  // do; external agents self-declare it in their hello. Display-only now (which harnesses can delegate);
  // loop prevention is positional — see POST /ask. Kept so the roster can flag delegation-capable workers.
  const isOrchestrator = (id: string) => managed.get(id)?.orchestrator ?? !!agents.get(id)?.orchestrator;
  const rosterList = () => [...agents].map(([id, a]) => ({ id, name: a.name, description: a.description, active: id === activeAgentId, external: !managed.has(id), orchestrator: isOrchestrator(id), verified: verifier.status(id) ?? "verifying" }));
  const announceRoster = () => bus.event("agents_roster", { agents: rosterList() });

  // ---- Orchestration monitor: a live tree of every delegation the hub mediates (ask_agent) + the
  // internal subagents an agent reports about itself (agent_activity). Streamed web-only over SSE
  // ("orch"); the drawer in /chat renders it. Parent linkage: orchInbound[agentId] = the node that is
  // currently making that harness work, so a worker harness's own delegations/sub-agents nest under it. ----
  type OrchStatus = "running" | "done" | "error";
  interface OrchNode { kind: "turn" | "delegation" | "subagent" | "tool"; id: string; parentId: string | null; agentId: string; agentName: string; label: string; depth: number; status: OrchStatus; ts: number; ms?: number; reply?: string }
  const orchNodes = new Map<string, OrchNode>();
  const orchInbound = new Map<string, string>();
  const orchEmit = (n: OrchNode) => { sseBroadcast("orch", n); if (orchNodes.size > 400) { const oldest = [...orchNodes.values()].sort((a, b) => a.ts - b.ts)[0]; if (oldest) orchNodes.delete(oldest.id); } };
  const clearOrch = () => { orchNodes.clear(); orchInbound.clear(); sseBroadcast("orch_clear", {}); };
  const isErrReply = (r?: string) => !!r && (r === "(agent disconnected)" || r === "(no reply within timeout)");
  function orchTurnStart(agentId: string, text: string) {
    const a = agents.get(agentId); if (!a) return;
    const id = "turn-" + randomUUID();
    const node: OrchNode = { kind: "turn", id, parentId: null, agentId, agentName: a.name, label: text || "(message)", depth: 0, status: "running", ts: Date.now() };
    orchNodes.set(id, node); orchInbound.set(agentId, id); orchEmit(node);
  }
  function orchTurnSettle(agentId: string, reply: string) {
    const id = orchInbound.get(agentId); if (!id) return;
    const node = orchNodes.get(id);
    if (node && node.kind === "turn") { node.status = "done"; node.ms = Date.now() - node.ts; node.reply = reply.slice(0, 400); orchEmit(node); }
    orchInbound.delete(agentId);
    // The turn is over, so nothing is actually running anymore — settle any node still marked "running"
    // (a tool/delegation whose end event never arrived because the harness's turn ended first), so the
    // tree doesn't show a phantom in-progress job after the answer is in.
    for (const n of orchNodes.values()) {
      if (n.status === "running") { n.status = "done"; if (n.ms == null) n.ms = Date.now() - n.ts; orchEmit(n); }
    }
  }

  const MAX_ASK_DEPTH = Number(process.env.MAX_ASK_DEPTH ?? 8);
  // A delegated worker that spawns its OWN subagents routinely needs minutes, not seconds — 60s was far
  // too tight (cold-start + nested fan-out timed out, forcing wasteful retries). Default 5 min, env-tunable.
  const ASK_TIMEOUT_MS = Number(process.env.ASK_TIMEOUT_MS ?? 300_000);
  const delegator = makeDelegator({
    newId: () => randomUUID(),
    timeoutMs: ASK_TIMEOUT_MS,
    send: (id, text, askId) => {
      const a = agents.get(id);
      if (!a || a.ws.readyState !== WebSocket.OPEN) throw new Error("agent not connected");
      a.ws.send(JSON.stringify({ t: "user", text, askId }));
    },
    onEvent: (e) => {
      if (e.phase === "start") {
        const fromId = String(e.meta?.fromId ?? "") || activeAgentId || "";
        const node: OrchNode = { kind: "delegation", id: e.askId, parentId: orchInbound.get(fromId) ?? null, agentId: e.agentId, agentName: agents.get(e.agentId)?.name ?? e.agentId, label: e.text, depth: Number(e.meta?.depth ?? 1), status: "running", ts: Date.now() };
        orchNodes.set(e.askId, node); orchInbound.set(e.agentId, e.askId); orchEmit(node);
      } else {
        const node = orchNodes.get(e.askId);
        if (node) { node.status = isErrReply(e.reply) ? "error" : "done"; node.ms = e.ms; node.reply = (e.reply ?? "").slice(0, 400); orchEmit(node); }
        orchInbound.delete(e.agentId);
      }
    },
  });
  /** Resolve an agent selector (id wins; else unique case-insensitive name). */
  const resolveAgentId = (sel: string): { id: string } | { error: string; available: { id: string; name: string }[] } => {
    const list = [...agents].map(([id, a]) => ({ id, name: a.name }));
    if (agents.has(sel)) return { id: sel };
    const byName = list.filter((a) => a.name.toLowerCase() === sel.toLowerCase());
    if (byName.length === 1) return { id: byName[0].id };
    return { error: byName.length > 1 ? `ambiguous agent name "${sel}" — use an id` : `no agent "${sel}"`, available: list };
  };

  /** Where a remote/cloud agent dials in: same host the phone reaches, on the agent port. */
  const agentWsUrl = () => { try { const u = new URL(phoneRelayUrl(cfg.relayUrl)); return `ws://${u.hostname}:${AGENT_PORT}`; } catch { return `ws://127.0.0.1:${AGENT_PORT}`; } };
  /** Where a remote agent fetches the hub's own files (same host the phone reaches, on the panel port). */
  const agentHttpUrl = () => { const p = process.env.PANEL_PORT ?? 8123; try { const u = new URL(phoneRelayUrl(cfg.relayUrl)); return `http://${u.hostname}:${p}`; } catch { return `http://127.0.0.1:${p}`; } };
  /** The "impossible to get wrong" one-liner: fetch + run the hub's ready-made client on the remote box. */
  const bootstrapOneLiner = () => `curl -fsSL ${agentHttpUrl()}/agent-bootstrap | MODEL_CMD='claude -p' AGENT_NAME='Hermes' sh`;
  /** The shell script /agent-bootstrap serves: download the stdlib python client and exec it. */
  const bootstrapScript = () => [
    `#!/bin/sh`,
    `# Agentic-Android — one-line remote-agent bootstrap. Fetches the hub's own client and runs it.`,
    `# Usage:  curl -fsSL ${agentHttpUrl()}/agent-bootstrap | MODEL_CMD='your-model-cli' sh`,
    `set -eu`,
    `HUB="\${HUB:-${agentWsUrl()}}"`,
    `NAME="\${AGENT_NAME:-Hermes}"`,
    `if [ -z "\${MODEL_CMD:-}" ]; then echo "Set MODEL_CMD to the CLI that runs your model, e.g.  MODEL_CMD='claude -p'  (it gets the user's message as the last argument and must print the reply to stdout)."; exit 1; fi`,
    `DEST="\${TMPDIR:-/tmp}/agentic-client.py"`,
    `curl -fsSL "${agentHttpUrl()}/agent-client.py" -o "$DEST"`,
    `echo "Agentic-Android client → $HUB   (model: $MODEL_CMD)"`,
    `exec python3 "$DEST" --hub "$HUB" --name "$NAME" --cmd "$MODEL_CMD"`,
    ``,
  ].join("\n");
  /** A copy-paste prompt the user hands to a remote/cloud agent so it connects + actually replies.
   *  Built here (not in the page template) so the protocol text isn't mangled by template escaping. */
  const remoteAgentPrompt = () => {
    const ws = agentWsUrl();
    return [
      `You are being connected as the "brain" for an Agentic-Android hub — a self-hosted bridge that lets you see and control the user's Android phone (camera, screen read/tap, location, SMS, notifications, apps, and more). Open ONE persistent WebSocket to the hub, then answer the user's chat messages and drive the phone with tool calls. Implement exactly this protocol.`,
      ``,
      `EASIEST PATH — JUST RUN THE HUB'S CLIENT (strongly preferred; skip everything below if you can run a shell command)`,
      `  The hub hosts its OWN tested, known-good client that implements this whole protocol correctly — persistent loop, heartbeat, self-test, reconnect. Prefer it over writing your own; bugs are fixed centrally so it stays correct. Run it in the BACKGROUND. MODEL_CMD must be a CLI that takes the user's message as its LAST positional argument and prints the reply to stdout (e.g. 'claude -p' or 'hermes -z'):`,
      `    ${bootstrapOneLiner()}`,
      `  That's it — it stays running and answers every message on its own. Only implement the manual protocol below if you genuinely cannot run that command.`,
      ``,
      `CRITICAL — THIS IS A LONG-RUNNING PROGRAM, NOT A ONE-OFF CHAT REPLY (read this first)`,
      `  Do NOT just open the socket, say "ready", and end your turn. The instant your turn ends, nothing is reading the socket — the next user message arrives unread and the user is stuck on "Sending…" forever. This is the #1 failure: the hub shows you "connected" (you handshook) but you never answer.`,
      `  Therefore you MUST WRITE AND RUN a small long-lived client program — a script/daemon you launch in the BACKGROUND so it keeps running after your turn ends. That program, not you, holds the socket and loops forever: on each {t:"user"} frame it calls your model to produce a reply and sends it back ON ITS OWN, with no further prompting from anyone, message after message, until the user stops it.`,
      `  "Hold the socket open across messages" means a process that stays alive — NOT you re-reading a frame within a single reply. If you cannot keep a background process running, you cannot be this brain: say so plainly instead of half-connecting and going silent.`,
      ``,
      `ENDPOINT`,
      `  ${ws}`,
      `  Plain WebSocket — no TLS, no auth. You must be able to reach this host (it's on the user's Tailscale/LAN). Open ONE connection and KEEP IT OPEN across messages — do NOT reconnect per message (that spawns duplicate connections). If it drops, reconnect with backoff, one connection at a time.`,
      ``,
      `HANDSHAKE`,
      `  1. On open, send:  {"t":"hello","name":"<your name, e.g. Hermes>"}`,
      `  2. The hub sends your tool catalog:  {"t":"ready","catalog":[ {"method":"...","summary":"..."}, ... ]}  (may be re-sent as {"t":"catalog",...}). These are the phone capabilities you can call.`,
      ``,
      `LIVENESS — the hub checks you're really there (this is how it catches the silent failure above)`,
      `  - Right after connecting the hub sends  {"t":"selftest","token":"..."}  — reply IMMEDIATELY (from code, not your model) with  {"t":"selftest_ok","token":"<same token>"}. If you don't within a few seconds, the hub marks you broken and tells the user you're not really answering.`,
      `  - Send a  {"t":"heartbeat"}  frame every ~15s from your loop so the hub knows your process is still alive (a dead process can leave the socket open).`,
      `  - If anything is wrong the hub sends  {"t":"diag","problem":"...","remedy":"..."}  — read it; it tells you exactly what to fix.`,
      ``,
      `WHEN THE USER SENDS A MESSAGE  (the step most clients miss — without it the user sees "sending…" forever)`,
      `  The hub pushes:  {"t":"user","text":"<what the user typed>","files":[{"name","mime","path"}]?}`,
      `  You MUST handle it and reply:`,
      `    a. (optional) signal progress:  {"t":"event","topic":"agent_status","data":{"label":"Thinking…"}}`,
      `    b. think; call phone tools if useful (below);`,
      `    c. ALWAYS finish by sending your reply as an EVENT (this is what appears in the chat):`,
      `         {"t":"event","topic":"assistant_message","data":{"text":"<your reply>"}}`,
      `    d. (optional) {"t":"event","topic":"agent_status","data":{"label":"Ready","ready":true}}`,
      ``,
      `CALLING A PHONE TOOL`,
      `  Send:    {"t":"tool","id":"<unique-id>","method":"<catalog method, e.g. device.info>","params":{...}}`,
      `  Reply:   {"t":"result","id":"<same id>","status":"ok"|"error","result":<any>,"error":<any>}`,
      `  Correlate by id. Calls can take a few seconds (the phone may prompt for consent). Chain as many as you need, THEN send your assistant_message.`,
      ``,
      `FRAMING RULES (strict)`,
      `  - Every frame is one JSON text message keyed by "t" (both directions).`,
      `  - To speak to the user you MUST wrap it: {"t":"event","topic":"assistant_message","data":{"text":"..."}}. A bare {"text":...} or {"type":...} is ignored.`,
      `  - Ignore frames whose "t" you don't recognise.`,
      ``,
      `REFERENCE LOOP (pseudocode)`,
      `  ws = connect("${ws}")`,
      `  onopen:    send {t:"hello", name:"Hermes"}`,
      `  onmessage(m):`,
      `    if m.t == "ready" or "catalog":  catalog = m.catalog`,
      `    elif m.t == "result":            resolve the pending tool call m.id`,
      `    elif m.t == "user":`,
      `        send {t:"event", topic:"agent_status", data:{label:"Thinking…"}}`,
      `        reply = think(m.text, catalog, callTool)   # callTool sends {t:"tool",...}, awaits {t:"result",...}`,
      `        send {t:"event", topic:"assistant_message", data:{text: reply}}`,
      ``,
      `Confirm a long-lived background process is now running that (1) holds one open socket, (2) loops reading {t:"user"} frames and replies to EVERY one with an assistant_message event WITHOUT being prompted again, and (3) survives across many messages and reconnects if the socket drops — then tell the user you're connected and ready. If it's only alive for this one turn, do not claim you're ready.`,
    ].join("\n");
  };

  // ---- managed agent processes: start/stop brains from the setup UI (no terminal). SEVERAL at once. ----
  // Each managed child is keyed by an instanceId we pass in via env; the agent echoes it in its hello so
  // its roster entry uses the SAME id — that lets the UI stop exactly the agent the user picked.
  type Managed = { child: ChildProcess; kind: string; name: string; log: string; orchestrator: boolean };
  const managed = new Map<string, Managed>();
  const backboneDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const tsxBin = () => { const b = path.join(backboneDir, "node_modules", ".bin", "tsx"); return fs.existsSync(b) ? b : "tsx"; };

  function stopManaged(id: string) {
    const m = managed.get(id);
    if (m) { try { m.child.kill("SIGTERM"); } catch { /* */ } managed.delete(id); }
  }
  function stopAllManaged() { for (const id of [...managed.keys()]) stopManaged(id); }
  /** A display name not already taken by a connected/managed agent (so duplicates read "Claude (2)"). */
  function uniqueAgentName(base: string): string {
    const taken = new Set<string>([...agents.values()].map((a) => a.name).concat([...managed.values()].map((m) => m.name)));
    if (!taken.has(base)) return base;
    for (let n = 2; n < 99; n++) { const cand = `${base} (${n})`; if (!taken.has(cand)) return cand; }
    return base;
  }
  /** Spawn another agent process (additive — does NOT stop existing ones). Returns its instanceId.
   *  kind: "claude" (your Claude) · "basic" (built-in) · "other" (any CLI; opts.phone picks the runner). */
  function spawnAgent(kind: string, command?: string, opts: { name?: string; phone?: boolean; orchestrator?: boolean; desc?: string } = {}): string {
    const instanceId = randomUUID();
    let env: NodeJS.ProcessEnv = { ...process.env };
    let script = "src/agent.ts";                                  // basic (keyword) agent
    let baseName = "Built-in helper";
    if (kind === "claude") { script = "src/agent-cli.ts"; env = claudeSpawnEnv(); baseName = "Claude"; }            // your Claude
    else if (kind === "omp") { script = "src/agent-omp.ts"; baseName = "omp"; }                                     // Oh My Pi — keeps its own env (provider keys / OAuth)
    else if (kind === "cursor") { script = "src/agent-cursor.ts"; baseName = "Cursor"; }                            // Cursor — keeps its own env (cursor-agent login / CURSOR_API_KEY)
    else if (kind === "other" || kind === "custom") {
      baseName = opts.name?.trim() || command || "agent";
      if (opts.phone === false) { script = "src/agent-text.ts"; env.AGENT_CMD = command || ""; }                    // chat-only: any CLI
      else { script = "src/agent-cli.ts"; env = claudeSpawnEnv(); env.AGENT_CLI = command || "claude"; }           // Claude-Code-compatible: full phone control
    }
    const name = uniqueAgentName(baseName);
    env.AGENT_INSTANCE_ID = instanceId;
    env.AGENT_NAME = name;
    if (opts.desc) env.AGENT_DESC = opts.desc;                 // strength shown in the roster (list_agents)
    // Every hub-launched agent gets the hub's OWN driver seat (hub-mcp via AGENT_HUBS) so it can
    // list_agents / ask_agent the other harnesses whenever it's the one you're talking to. Loopback —
    // it's co-located with the hub. Loop prevention is positional now (you can't delegate to the
    // driver-seat agent), so there's no longer a regular-vs-orchestrator distinction to spawn.
    env.AGENT_HUBS = `self=http://127.0.0.1:${process.env.PANEL_PORT ?? 8123}`;
    const child = spawn(tsxBin(), [script], { cwd: backboneDir, env });
    const m: Managed = { child, kind, name, log: "", orchestrator: true };
    const cap = (d: Buffer) => { m.log = (m.log + d.toString()).slice(-3000); };
    child.stdout?.on("data", cap); child.stderr?.on("data", cap);
    child.on("exit", (code) => { m.log += `\n[agent process exited: ${code}]`; });
    managed.set(instanceId, m);
    return instanceId;
  }
  // Quick auth probe so the UI can say "run `claude login`" before the user even chats.
  function authLoggedIn(cli: string): Promise<boolean> {
    return new Promise((resolve) => {
      const c = spawn(cli, ["auth", "status"], { env: process.env });
      let out = ""; const t = setTimeout(() => { try { c.kill(); } catch { /* */ } resolve(false); }, 6000);
      c.on("error", () => { clearTimeout(t); resolve(false); });
      c.stdout?.on("data", (d) => (out += d.toString()));
      c.on("close", () => { clearTimeout(t); try { resolve(JSON.parse(out).loggedIn === true); } catch { resolve(false); } });
    });
  }
  function probeClaude(cli: string): Promise<{ ok: boolean; message?: string; command?: string }> {
    return new Promise((resolve) => {
      const env = claudeSpawnEnv();
      const c = spawn(cli, ["-p", "--output-format", "json", "ping"], { env });
      let out = "";
      const timer = setTimeout(() => { try { c.kill(); } catch { /* */ } resolve({ ok: true }); }, 12000);
      c.on("error", () => { clearTimeout(timer); resolve({ ok: false, message: `Couldn't find "${cli}" on this computer. Install it first, then press Connect again.` }); });
      c.stdout?.on("data", (d) => (out += d.toString()));
      c.on("close", async () => {
        clearTimeout(timer);
        try {
          const j = JSON.parse(out);
          if (j.is_error && /401|auth|login|credential|unauthor/i.test(String(j.result))) {
            const signedIn = cli === "claude" ? await authLoggedIn(cli) : false;
            if (signedIn) return resolve({ ok: false, message: "You're signed in, but the agent runs Claude headlessly, which needs a one-time token here. In a terminal run the command below, then press Connect again.", command: "claude setup-token" });
            return resolve({ ok: false, message: "Claude isn't signed in on this computer. In a terminal run the command below, then press Connect again.", command: cli === "claude" ? "claude auth login" : undefined });
          }
        } catch { /* */ }
        resolve({ ok: true });
      });
    });
  }
  // Fast "is this command even on PATH?" gate. Used for harnesses we can't probe the Claude way
  // (omp, cursor, chat-only CLIs) so selecting a missing one fails HERE with install guidance,
  // instead of only erroring later, mid-chat, when the adapter spawns it. Fails open (resolve true)
  // if `which` itself is missing or slow — the adapter's own ENOENT message is the backstop.
  function binInstalled(bin: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!bin) return resolve(true);
      const c = spawn("which", [bin], { env: process.env });
      const t = setTimeout(() => { try { c.kill(); } catch { /* */ } resolve(true); }, 4000);
      c.on("error", () => { clearTimeout(t); resolve(true); });
      c.on("close", (code) => { clearTimeout(t); resolve(code === 0); });
    });
  }
  // Harnesses with a known external binary + how to install it, for a clear "not installed" message.
  const BIN_INFO: Record<string, { bin: string; label: string; command?: string }> = {
    omp: { bin: "omp", label: "omp (Oh My Pi)" },
    cursor: { bin: "cursor-agent", label: "Cursor", command: "curl https://cursor.com/install -fsS | bash" },
  };

  /** The hub owns media: when a tool result carries an image blob, save it to ~/.agentic-android/media. */
  async function saveMediaFromResult(result: unknown) {
    if (!result || typeof result !== "object") return;
    const r = result as { blob_id?: string; content_type?: string };
    if (!r.blob_id || !(r.content_type ?? "").startsWith("image/")) return;
    try {
      const bytes = await bus.getBlob(r.blob_id);
      fs.mkdirSync(mediaDir(), { recursive: true });
      const ext = (r.content_type ?? "").includes("png") ? "png" : "jpg";
      const file = path.join(mediaDir(), `photo_${Date.now()}.${ext}`);
      fs.writeFileSync(file, Buffer.from(bytes));
      logEvent("response", `saved photo → ${file}`, { file, bytes: bytes.length });
    } catch (e) { logEvent("error", "saveMedia failed", { error: String(e) }); }
  }

  /** Execute a capability the agent asked for, against the phone; persist media; log. */
  async function execForAgent(method: string, params: Record<string, unknown>) {
    logEvent("request", method, params);
    try {
      const resp = await bus.request(method, params ?? {});
      if (resp.status === "ok") { logEvent("response", `${method} ok`, resp.result); await saveMediaFromResult(resp.result); }
      else logEvent("error", `${method} error`, resp.error);
      return resp;
    } catch (e) {
      logEvent("error", `${method} threw: ${String(e)}`);
      return { status: "error" as const, result: undefined, error: { code: "HUB_ERROR", message: String(e), retriable: false } };
    }
  }

  // ---------- hub-owned scheduler (Phase 9): deferred/recurring phone actions ----------
  const schedulePath = path.join(configDir(), "schedule.jsonl");
  const loadSchedule = (): Task[] => {
    try { return fs.readFileSync(schedulePath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Task); }
    catch { return []; }
  };
  const persistSchedule = (tasks: Task[]) => {
    try { fs.writeFileSync(schedulePath, tasks.map((t) => JSON.stringify(t)).join("\n") + (tasks.length ? "\n" : "")); }
    catch (e) { logEvent("error", `persist schedule failed: ${String(e)}`); }
  };
  const scheduler = new Scheduler({
    now: () => Date.now(),
    setTimer: (ms, fn) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    persist: persistSchedule,
    load: loadSchedule,
    genId: () => randomUUID(),
    fire: async (task) => {
      // The always-on hub runs the action itself, surfaces it to the phone chat, and (if connected)
      // hands the result to the agent — so it fires even if the scheduling agent's turn ended long ago.
      logEvent("agent_run", `scheduled fire: ${task.method}`, task);
      const resp = await execForAgent(task.method, task.args);
      const summary = resp.status === "ok" ? "done" : `error: ${JSON.stringify(resp.error)}`;
      const note = `⏰ Ran scheduled ${task.method} — ${summary}.`;
      bus.event("assistant_message", { text: note });
      addTurn("assistant", note);
      if (agentSock) agentSock.send(JSON.stringify({ t: "task_result", id: task.id, method: task.method, status: resp.status, result: resp.result, error: resp.error }));
    },
  });
  scheduler.loadAndArm();
  logEvent("config", `scheduler: re-armed ${scheduler.list().length} task(s) from disk`);

  // Hub-handled "tools" the agent can call (intercepted before reaching the phone). Appended to the
  // catalog the agent sees so the brain knows it can schedule.
  const SCHEDULER_TOOLS: Cap[] = [
    { method: "schedule", sensitivity: "ALLOW", summary: "Schedule a phone action for later. Args: {method, args?, delayMs OR atMs, everyMs? to repeat}." },
    { method: "list_scheduled", sensitivity: "ALLOW", summary: "List pending scheduled tasks." },
    { method: "cancel_scheduled", sensitivity: "ALLOW", summary: "Cancel a scheduled task. Args: {id}." },
  ];
  const agentCatalog = () => [...caps, ...SCHEDULER_TOOLS];
  const handleSchedulerTool = (method: string, params: Record<string, unknown>): unknown => {
    if (method === "schedule") {
      const t = scheduler.add({
        method: String(params.method), args: (params.args as Record<string, unknown>) ?? {},
        delayMs: params.delayMs as number | undefined, atMs: params.atMs as number | undefined,
        everyMs: params.everyMs as number | undefined, agentId: agentName ?? undefined,
      });
      return { scheduled: true, id: t.id, fireAt: t.fireAt };
    }
    if (method === "list_scheduled") return { tasks: scheduler.list() };
    if (method === "cancel_scheduled") return { cancelled: scheduler.cancel(String(params.id)) };
    return { error: "unknown scheduler tool" };
  };
  const isSchedulerTool = (m: string) => m === "schedule" || m === "list_scheduled" || m === "cancel_scheduled";

  // Verify every agent actually answers (not just "socket opened") — turns the silent "connected but
  // never replies" failure into a visible, explained one. The diagnostic goes 3 ways: the event log, a
  // {t:"diag"} frame to the agent (so it can self-correct), and an assistant_message into the chat.
  const verifier = new Verifier({
    now: () => Date.now(),
    setTimer: (ms, fn) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    remedy: `The easy fix: run the hub's ready-made client on that machine — it stays running and answers every message automatically:\n  ${bootstrapOneLiner()}\n(Set MODEL_CMD to your model's CLI. Or copy the full prompt from the hub's setup page.)`,
    onChange: () => announceRoster(),
    onDiagnose: (d) => {
      logEvent("error", `agent "${d.name}" failed verification: ${d.problem}`, d);
      const sock = agents.get(d.agentId)?.ws;
      if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ t: "diag", problem: d.problem, remedy: d.remedy }));
      const text = `⚠️ ${d.name} isn't really answering: ${d.problem}\n\n${d.remedy}`;
      bus.event("assistant_message", { text });
      addTurn("assistant", text);
    },
  });
  const sweepTimer = setInterval(() => verifier.sweep(), 10000);

  const agentWss = new WebSocketServer({ port: AGENT_PORT, host: process.env.AGENT_HOST ?? HOST });
  agentWss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === "hello") {
        const name = String(m.name ?? "agent");
        const description = typeof m.description === "string" ? m.description : undefined;
        // A managed agent echoes the instanceId we spawned it with → reuse it so its roster entry and its
        // process share one id (the UI can then stop it). External agents get a fresh id.
        const id = (typeof m.id === "string" && m.id) ? m.id : randomUUID();
        (ws as any)._agentId = id;
        agents.set(id, { ws, name, description, orchestrator: m.orchestrator === true });
        // Become the active agent only if there isn't a live one already (preserves single-agent flow).
        if (!agentSock || !activeAgentId || !agents.has(activeAgentId)) {
          activeAgentId = id; agentSock = ws; agentName = name;
          agentReady = null; agentStatus = {}; agentCommands = [];
          bus.event("agent_identity", { name: agentName });
        }
        logEvent("connection", `agent connected: "${name}" (${agents.size} online)`);
        verifier.onConnect(id, name);
        announceRoster();
        ws.send(JSON.stringify({ t: "ready", catalog: agentCatalog() }));
        // Probe the REAL message path: a working client answers selftest_ok in code (no LLM turn). No
        // answer in time → the agent gets flagged "failing self-test" instead of a silent green dot.
        const selftestToken = randomUUID();
        (ws as any)._selftestToken = selftestToken;
        ws.send(JSON.stringify({ t: "selftest", token: selftestToken }));
      } else if (m.t === "selftest_ok") {
        const id = (ws as any)._agentId as string | undefined;
        if (id && m.token === (ws as any)._selftestToken) verifier.onAlive(id);
      } else if (m.t === "heartbeat") {
        const id = (ws as any)._agentId as string | undefined;
        if (id) verifier.onHeartbeat(id);
      } else if (m.t === "tool") {
        const method = String(m.method);
        if (isSchedulerTool(method)) {
          const result = handleSchedulerTool(method, (m.params ?? {}) as Record<string, unknown>);
          logEvent("response", `${method} ok`, result);
          ws.send(JSON.stringify({ t: "result", id: m.id, status: "ok", result }));
        } else {
          void execForAgent(method, m.params ?? {}).then((resp) => {
            // execForAgent awaits the phone (seconds); the agent may have disconnected meanwhile.
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "result", id: m.id, status: resp.status, result: resp.result, error: resp.error }));
          });
        }
      } else if (m.t === "event") {
        const topic = String(m.topic); const data = (m.data ?? {}) as Record<string, unknown>;
        if (topic === "agent_status") {
          if (typeof (data as any).ready === "boolean") agentReady = (data as any).ready;
          agentStatus = { label: data.label as string | undefined, command: (data as any).command as string | undefined };
          bus.event("agent_status", data);
        }
        else if (topic === "agent_commands") {
          agentCommands = Array.isArray((data as any).commands) ? (data as any).commands : [];
          bus.event("agent_commands", { commands: agentCommands });
          logEvent("connection", `agent published ${agentCommands.length} slash commands`);
        }
        else if (topic === "assistant_message") {
          const id = (ws as any)._agentId as string | undefined;
          if (id) verifier.onAlive(id); // a real reply proves the loop works → self-heal to "verified"
          const askId = typeof (data as any).askId === "string" ? (data as any).askId : undefined;
          // A reply echoing a live askId is a delegated sub-answer → route to the waiter, stay quiet.
          if (id && delegator.onReply(id, askId, String(data.text ?? ""))) return;
          if (id) orchTurnSettle(id, String(data.text ?? "")); // the driver-seat agent's final reply closes the turn root
          bus.event("assistant_message", data);
          logEvent("assistant_message", String(data.text ?? "").slice(0, 200), data);
          const parts = Array.isArray((data as any).parts) ? ((data as any).parts as MsgPart[]) : undefined;
          addTurn("assistant", String(data.text ?? ""), parts);
          pendingSay?.(String(data.text ?? "")); pendingSay = null;
        }
        else if (topic === "agent_activity") {
          // The agent narrates its OWN internals (e.g. Claude Task subagents + tool calls) so the
          // orchestration tree can show within-agent children, not just hub-mediated delegations.
          const fromId = (ws as any)._agentId as string | undefined;
          if (!fromId) return;
          const act = data as { id?: unknown; parentId?: unknown; kind?: unknown; name?: unknown; detail?: unknown; status?: unknown; error?: unknown; reply?: unknown };
          const nodeId = fromId + ":" + String(act.id ?? randomUUID());
          const parentId = act.parentId ? fromId + ":" + String(act.parentId) : (orchInbound.get(fromId) ?? null);
          if (act.status === "end") {
            const node = orchNodes.get(nodeId);
            if (node) { node.status = act.error ? "error" : "done"; node.ms = Date.now() - node.ts; if (act.reply) node.reply = String(act.reply).slice(0, 400); orchEmit(node); }
          } else {
            const kind = act.kind === "subagent" ? "subagent" : "tool";
            const parentDepth = parentId ? orchNodes.get(parentId)?.depth : undefined;
            const label = String(act.name ?? "work") + (kind === "subagent" && act.detail ? ": " + String(act.detail) : "");
            const node: OrchNode = { kind, id: nodeId, parentId, agentId: fromId, agentName: agents.get(fromId)?.name ?? fromId, label, depth: (parentDepth ?? 0) + 1, status: "running", ts: Date.now() };
            orchNodes.set(nodeId, node); orchEmit(node);
          }
        }
      }
    });
    ws.on("close", () => {
      const id = (ws as any)._agentId as string | undefined;
      if (id) { delegator.onGone(id); agents.delete(id); verifier.remove(id); } // fail in-flight asks before dropping the worker harness
      // Skip bus.event() calls if we are tearing down — the TCP socket can fire its close event
      // after bus.close() completes (OS-level async), causing spurious "not connected" throws.
      if (_panelClosed) return;
      if (agentSock === ws) {
        // The active agent left — promote another connected one, or go empty.
        const next = [...agents.entries()][0];
        if (next) {
          activeAgentId = next[0]; agentSock = next[1].ws; agentName = next[1].name;
          agentReady = null; agentStatus = {}; agentCommands = [];
          bus.event("agent_identity", { name: agentName });
          logEvent("connection", `active agent left; switched to "${agentName}"`);
        } else {
          agentSock = null; agentName = null; agentReady = null; agentStatus = {}; agentCommands = []; activeAgentId = null;
          logEvent("connection", "agent disconnected");
        }
      }
      announceRoster();
    });
  });
  logEvent("connection", `harness WebSocket on ws://127.0.0.1:${AGENT_PORT}`);

  // ---------- phone -> hub -> agent ----------
  const histMsgs = () => conversation.slice(-100).map((t) => ({ role: t.role, text: t.text, ts: t.ts, ...(t.parts?.length ? { parts: t.parts } : {}) }));
  const emitHistory = () => bus.event("history", { messages: histMsgs() });
  const emitSessions = () => bus.event("sessions", sessionsPayload());
  // One user→agent delivery path shared by the phone (relay user_message) and the web chat (POST
  // /ask-async): persist attached file blobs to disk, record the turn, forward to the active agent.
  // The reply returns asynchronously via the agent WS → bus.event("assistant_message") → phone + SSE.
  async function deliverUserMessage(text: string, parts?: MsgPart[]) {
    logEvent("user_message", text, { text, parts });
    const files: { path: string; name: string; mime?: string; size?: number }[] = [];
    for (const p of parts ?? []) {
      if (p.kind !== "file") continue;
      try {
        const bytes = await bus.getBlob(p.blobId);
        fs.mkdirSync(filesDir(), { recursive: true });
        const safe = p.name.replace(/[^\w.\-]+/g, "_") || "file";
        const fp = path.join(filesDir(), `${Date.now()}_${safe}`);
        fs.writeFileSync(fp, bytes);
        files.push({ path: fp, name: p.name, mime: p.mime, size: bytes.length });
        logEvent("phone_event", `saved attached file ${p.name} (${bytes.length} bytes)`, { path: fp });
      } catch (e) { logEvent("error", `failed to save attached file ${p.name}`, { error: String(e) }); }
    }
    addTurn("user", text || (files.length ? `(sent ${files.length} file${files.length > 1 ? "s" : ""})` : ""), parts);
    if (agentSock && activeAgentId) {
      agentSock.send(JSON.stringify({ t: "user", text, ...(files.length ? { files } : {}) }));
      orchTurnStart(activeAgentId, text); // root of the orchestration tree: your prompt → the driver-seat harness
    } else { bus.event("assistant_message", { text: "No agent is connected. Start one on the machine: `pnpm agent`." }); logEvent("error", "user_message but no agent connected"); }
  }
  bus.onEvent((ev) => {
    if (ev.topic === "whoami") {
      bus.event("agent_identity", { name: agentName ?? "No agent connected", relay: cfg.relayUrl });
      bus.event("hub_identity", { name: hubName(), fp: cfg.self.fp }); // the hub's own (machine) name, for the phone's hub list
      // Replay the active session + the session list so the phone shows history on (re)connect.
      emitHistory();
      emitSessions();
      // If the agent connected but can't authenticate, a freshly-opened phone would otherwise miss the
      // one-time status event — replay it so the phone shows the warning, not a silent "connected".
      if (agentReady === false && agentStatus.label) bus.event("agent_status", { label: agentStatus.label });
      // Replay the slash catalog so a phone that connects after the agent still gets the `/` menu.
      if (agentCommands.length) bus.event("agent_commands", { commands: agentCommands });
      announceRoster(); // Phase 8: tell the phone which harnesses are connected right now
      // The phone just (re)connected — re-fetch its capability catalog so the panel shows "Connected —
      // N actions" instead of "Paired, waiting…" (the startup fetch loop may have given up before the
      // phone re-registered, e.g. after a hub restart). Chat already works over the event path.
      void refreshCatalog();
      logEvent("connection", `identified to phone as "${agentName ?? "No agent"}" (replayed ${Math.min(conversation.length, 100)} turns)`);
      return;
    }
    if (ev.topic === "select_agent") {
      // Phase 8: the phone picked which connected harness should be active; route to its socket.
      const id = String((ev.data as { id?: unknown }).id ?? "");
      const a = agents.get(id);
      if (a) {
        activeAgentId = id; agentSock = a.ws; agentName = a.name;
        agentReady = null; agentStatus = {}; agentCommands = [];
        bus.event("agent_identity", { name: agentName });
        announceRoster();
        logEvent("connection", `phone selected agent "${a.name}"`);
      }
      return;
    }
    if (ev.topic === "new_session") {
      newSession();
      emitHistory(); emitSessions();
      logEvent("config", "phone started a new chat");
      return;
    }
    if (ev.topic === "select_session") {
      if (selectSession(String((ev.data as { id?: unknown }).id ?? ""))) { emitHistory(); emitSessions(); }
      return;
    }
    if (ev.topic === "delete_session") {
      deleteSession(String((ev.data as { id?: unknown }).id ?? ""));
      emitHistory(); emitSessions();
      logEvent("config", "phone deleted a chat");
      return;
    }
    if (ev.topic === "user_message") {
      const d = ev.data as { text?: unknown; parts?: unknown };
      const parts = Array.isArray(d.parts) ? (d.parts as MsgPart[]) : undefined;
      void deliverUserMessage(String(d.text ?? ""), parts);
      return;
    }
    logEvent("phone_event", `phone event: ${ev.topic}`, ev.data);
    const ac = readAgentCfg();
    if (ac.enabled && ac.commandTemplate.trim()) {
      const prompt = `[phone:${ev.topic}] ${JSON.stringify(ev.data)}`;
      runAgent(ac.commandTemplate, prompt);
      logEvent("agent_run", `ran agent for ${ev.topic}`, { commandTemplate: ac.commandTemplate, prompt });
    }
  });

  /** Push the catalog to the connected agent (called whenever caps refresh). */
  function pushCatalog() { if (agentSock?.readyState === WebSocket.OPEN) agentSock.send(JSON.stringify({ t: "catalog", catalog: agentCatalog() })); }

  // Fetch the phone's catalog in the BACKGROUND so the panel serves even if the phone is offline.
  const refreshCatalog = async () => {
    try {
      const r = await bus.request("list_capabilities", {});
      if (r.status === "ok") { caps = (r.result as { capabilities: Cap[] }).capabilities; logEvent("connection", `catalog: ${caps.length} capabilities`); pushCatalog(); }
    } catch { /* phone offline; retry below */ }
  };
  // Keep trying until the phone answers (fast at first, then relaxed) — don't give up after a fixed
  // window, or a phone that links up late (e.g. the hub restarted while the phone was reconnecting)
  // would stay stuck on "Paired, waiting…" forever even though chat works.
  void (async () => { let n = 0; while (caps.length === 0 && !_panelClosed) { await refreshCatalog(); if (caps.length === 0 && !_panelClosed) await new Promise((r) => setTimeout(r, n++ < 10 ? 3000 : 15000)); } })();

  const PORT = opts.httpPort ?? Number(process.env.PANEL_PORT ?? 8123);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const json = (o: unknown, code = 200) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/connections")) {
      res.setHeader("content-type", "text/html"); res.setHeader("cache-control", "no-store"); res.end(SETUP_PAGE); return;
    }
    if (req.method === "GET" && url.pathname === "/panel") {
      res.setHeader("content-type", "text/html"); res.end(PAGE(caps, cfg.relayUrl)); return;
    }
    if (req.method === "GET" && url.pathname === "/chat") {
      res.setHeader("content-type", "text/html"); res.end(shellDoc("/chat", "Chat", CHAT_BODY)); return;
    }
    if (req.method === "GET" && url.pathname === "/settings") {
      res.setHeader("content-type", "text/html");
      res.end(SETTINGS_PAGE({
        hubName: hubName(),
        webUrl: `http://127.0.0.1:${PORT}`,
        agentSocket: `ws://127.0.0.1:${AGENT_PORT}`,
        relayUrl: cfg.relayUrl,
        phoneReach: phoneRelayUrl(cfg.relayUrl),
        maxDepth: MAX_ASK_DEPTH,
      }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/status") {
      // Every agent the hub knows: connected ones (the roster) + any managed child still starting up.
      const connectedIds = new Set(agents.keys());
      const list = [
        ...rosterList().map((a) => ({
          id: a.id, name: a.name, description: a.description, active: a.active, connected: true,
          ready: a.active ? agentReady : null, managed: managed.has(a.id), kind: managed.get(a.id)?.kind ?? "external",
          orchestrator: a.orchestrator, verified: a.verified, reason: verifier.reason(a.id) ?? null,
        })),
        ...[...managed.entries()].filter(([id]) => !connectedIds.has(id)).map(([id, m]) => ({
          id, name: m.name, active: false, connected: false, ready: null, managed: true, kind: m.kind,
          orchestrator: m.orchestrator, verified: "verifying" as const, reason: null,
        })),
      ];
      void ensurePairCode().then((pairCode) => json({
        agents: list,
        active: activeAgentId ? { id: activeAgentId, name: agentName, ready: agentReady, status: agentStatus.label ?? null, command: agentStatus.command ?? null } : null,
        phone: { connected: caps.length > 0, caps: caps.length },
        paired: !!cfg.peerEdPub,
        relayUrl: cfg.relayUrl,
        phoneRelay: phoneRelayUrl(cfg.relayUrl),
        // Where a REMOTE agent (cloud box, another machine) dials in — same host the phone reaches, agent port.
        agentWs: agentWsUrl(),
        relayChoice: (() => { try { const v = loadCfg().phoneRelayUrl; return typeof v === "string" && v.trim() ? (v === "usb" ? "usb" : "anywhere") : "auto"; } catch { return "auto"; } })(),
        hubName: hubName(),         // this hub's name, shown on the phone
        pairCode: pairCode,         // "host/CODE" for manual pairing, or null if the relay didn't answer
      }));
      return; // async response above — don't fall through to the other routes / the 404 tail
    }
    if (req.method === "GET" && url.pathname === "/remote-prompt") {
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(remoteAgentPrompt());
      return;
    }
    // The "impossible to get wrong" path: a remote box runs `curl .../agent-bootstrap | MODEL_CMD=... sh`,
    // which fetches /agent-client.py and execs it. The client speaks the full protocol correctly.
    if (req.method === "GET" && url.pathname === "/agent-bootstrap") {
      res.setHeader("content-type", "text/x-shellscript; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(bootstrapScript());
      return;
    }
    if (req.method === "GET" && url.pathname === "/agent-client.py") {
      res.setHeader("content-type", "text/x-python; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      try { res.end(fs.readFileSync(path.join(backboneDir, "examples", "agent-client.py"))); }
      catch { res.statusCode = 500; res.end("# agent-client.py is missing on the hub"); }
      return;
    }
    if (req.method === "POST" && url.pathname === "/agent/start") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const { type, command, name, phone, orchestrator, desc } = JSON.parse(body || "{}");
          const kind = String(type ?? "basic");
          const cmd = String(command ?? "").trim();
          const wantsPhone = phone !== false; // default: Claude-Code-compatible (full phone control)
          if ((kind === "other" || kind === "custom") && !cmd) return json({ ok: false, error: "Enter the command to run." });
          // Probe the CLI only when it'll run in Claude-compatible mode (claude itself, or phone-control "other").
          if (kind === "claude") {
            const probe = await probeClaude("claude");
            if (!probe.ok) return json({ ok: false, error: probe.message, command: probe.command });
          } else if ((kind === "other" || kind === "custom") && wantsPhone) {
            const probe = await probeClaude(cmd.split(/\s+/)[0] || "claude");
            if (!probe.ok) return json({ ok: false, error: probe.message, command: probe.command });
          } else if (BIN_INFO[kind]) {
            // omp / cursor — not Claude-compatible, so probe is a plain PATH check.
            const info = BIN_INFO[kind];
            if (!(await binInstalled(info.bin)))
              return json({ ok: false, error: `${info.label} isn't installed on this computer — the "${info.bin}" command wasn't found on your PATH. Install it, then add it again.`, command: info.command });
          } else if ((kind === "other" || kind === "custom") && !wantsPhone) {
            // chat-only custom CLI: at least confirm the binary exists before we spawn it.
            const bin = cmd.split(/\s+/)[0];
            if (!(await binInstalled(bin)))
              return json({ ok: false, error: `"${bin}" isn't installed on this computer — that command wasn't found on your PATH. Install it (or fix the command), then add it again.` });
          }
          const id = spawnAgent(kind, cmd, { name: typeof name === "string" ? name : undefined, phone: wantsPhone, orchestrator: !!orchestrator, desc: typeof desc === "string" ? desc : undefined });
          logEvent("connection", `started agent process: ${kind}${orchestrator ? " [orchestrator]" : ""}${cmd ? ` (${cmd})` : ""} phone=${wantsPhone} (${id})`);
          json({ ok: true, id });
        } catch (e) { json({ ok: false, error: String(e) }, 500); }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/agent/select") {
      // Web UI sets which connected agent is active (mirrors the phone's select_agent).
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const id = String(JSON.parse(body || "{}").id ?? "");
          const a = agents.get(id);
          if (!a) return json({ ok: false, error: "no such agent" }, 404);
          activeAgentId = id; agentSock = a.ws; agentName = a.name;
          agentReady = null; agentStatus = {}; agentCommands = [];
          bus.event("agent_identity", { name: agentName });
          announceRoster();
          logEvent("connection", `panel selected agent "${a.name}"`);
          json({ ok: true });
        } catch (e) { json({ ok: false, error: String(e) }, 500); }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/agent/stop") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => {
        const id = (() => { try { return String(JSON.parse(body || "{}").id ?? ""); } catch { return ""; } })();
        if (id) { stopManaged(id); logEvent("connection", `stopped agent process ${id} (from UI)`); }
        else { stopAllManaged(); logEvent("connection", "stopped all agent processes (from UI)"); }
        json({ ok: true });
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/agent/interrupt") {
      // Stop: abort every connected harness's in-flight turn (orchestrator + any workers it delegated to).
      // A no-op for idle harnesses, so blasting all of them is the simplest way to halt a runaway chain.
      let n = 0;
      for (const a of agents.values()) {
        if (a.ws.readyState === WebSocket.OPEN) { try { a.ws.send(JSON.stringify({ t: "interrupt" })); n++; } catch { /* */ } }
      }
      logEvent("connection", `interrupt sent to ${n} harness(es) (from UI)`);
      return json({ ok: true, interrupted: n });
    }
    if (req.method === "POST" && url.pathname === "/relay-url") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const { value } = JSON.parse(body || "{}");
          let v = String(value ?? "auto").trim();
          // accept: "auto" (Wi-Fi LAN), "usb" (localhost), or a Tailscale/LAN address. Be forgiving:
          // a bare IP/host ("100.64.1.5" or "100.64.1.5:8799") is normalized to http://host:8799.
          if (v !== "auto" && v !== "usb") {
            if (!/^https?:\/\/|^wss?:\/\//i.test(v)) v = "http://" + v;
            try {
              const u = new URL(v);
              if (!u.port) u.port = "8799";        // default to the relay port
              v = u.toString().replace(/\/+$/, ""); // strip trailing slash
            } catch { return json({ ok: false, error: "Couldn't read that address — try your Tailscale IP, e.g. 100.x.x.x" }); }
          }
          saveRelayChoice(v);
          invalidatePairCode(); // the phone-facing address changed → re-register the manual code
          logEvent("config", `phone relay set to ${v}`);
          json({ ok: true, phoneRelay: phoneRelayUrl(cfg.relayUrl) });
        } catch (e) { json({ ok: false, error: String(e) }, 500); }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/hub-name") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const { name } = JSON.parse(body || "{}");
          saveHubName(String(name ?? ""));
          invalidatePairCode(); // hub name rides in the pairing payload → re-register the manual code
          bus.event("hub_identity", { name: hubName(), fp: cfg.self.fp }); // push the new name to the connected phone live
          logEvent("config", `hub name set to "${hubName()}"`);
          json({ ok: true, hubName: hubName() });
        } catch (e) { json({ ok: false, error: String(e) }, 500); }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/agent/token") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const { token } = JSON.parse(body || "{}");
          const t = String(token ?? "").trim();
          if (!t) return json({ ok: false, error: "Empty token." });
          saveClaudeOauthToken(t);
          logEvent("config", "saved Claude headless token");
          json({ ok: true });
        } catch (e) { json({ ok: false, error: String(e) }, 500); }
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/pair-qr") {
      const token = pairPayload();
      QRCode.toString(token, { type: "svg", margin: 1, width: 220 })
        .then((svg) => { res.setHeader("content-type", "image/svg+xml"); res.end(svg); })
        .catch((e) => { res.statusCode = 500; res.end(String(e)); });
      return;
    }
    if (req.method === "GET" && url.pathname === "/events") {
      const since = Number(url.searchParams.get("since") ?? 0);
      const types = url.searchParams.get("types")?.split(",").filter(Boolean);
      const q = url.searchParams.get("q")?.toLowerCase();
      let out = events.filter((e) => e.id > since);
      if (types) out = out.filter((e) => types.includes(e.type));
      if (q) out = out.filter((e) => JSON.stringify(e).toLowerCase().includes(q));
      return json(out);
    }
    if (req.method === "GET" && url.pathname === "/catalog") { void refreshCatalog().then(() => json(caps)); return; }
    if (req.method === "GET" && url.pathname.startsWith("/blob/")) {
      const id = url.pathname.slice("/blob/".length);
      const mime = url.searchParams.get("mime") || "image/jpeg"; // legacy default keeps existing image refs working
      const name = url.searchParams.get("name");
      const download = url.searchParams.get("download");
      bus.getBlob(id).then((bytes) => {
        res.setHeader("content-type", mime);
        if (download) res.setHeader("content-disposition", `attachment${name ? `; filename="${name.replace(/[^\w.\- ]+/g, "_")}"` : ""}`);
        res.end(Buffer.from(bytes));
      }).catch((e) => { res.statusCode = 502; res.end(String(e)); });
      return;
    }
    // ---- Web-chat backend: static vendored libs, live SSE stream, non-blocking send, sessions, files ----
    if (req.method === "GET" && url.pathname.startsWith("/public/")) {
      const publicDir = path.join(backboneDir, "public");
      const full = path.normalize(path.join(publicDir, decodeURIComponent(url.pathname.slice("/public/".length))));
      if (full !== publicDir && !full.startsWith(publicDir + path.sep)) { res.statusCode = 403; res.end("forbidden"); return; }
      fs.readFile(full, (err, buf) => {
        if (err) { res.statusCode = 404; res.end("not found"); return; }
        const ext = path.extname(full).toLowerCase();
        const ct = ext === ".js" ? "application/javascript; charset=utf-8" : ext === ".css" ? "text/css; charset=utf-8"
          : ext === ".svg" ? "image/svg+xml" : ext === ".json" ? "application/json" : ext === ".woff2" ? "font/woff2" : "application/octet-stream";
        // Vendored libs are immutable → cache hard. Our own chat.css/chat.js change with the app, so make
        // them revalidate every load (otherwise UI edits stay invisible behind a stale cache for an hour).
        const isVendor = full.startsWith(path.join(publicDir, "vendor") + path.sep);
        res.setHeader("content-type", ct); res.setHeader("cache-control", isVendor ? "max-age=86400" : "no-cache"); res.end(buf);
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/stream") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write(": connected\n\n");
      sseClients.add(res);
      // Replay current state to THIS browser only (mirrors the phone's whoami replay), so a fresh tab
      // hydrates immediately without a separate poll.
      sseSend(res, "agent_identity", { name: agentName ?? "No agent connected" });
      sseSend(res, "agents_roster", { agents: rosterList() });
      sseSend(res, "sessions", sessionsPayload());
      sseSend(res, "history", { messages: histMsgs() });
      if (agentCommands.length) sseSend(res, "agent_commands", { commands: agentCommands });
      if (agentStatus.label || agentReady != null) sseSend(res, "agent_status", { label: agentStatus.label ?? null, ready: agentReady });
      for (const n of orchNodes.values()) sseSend(res, "orch", n); // replay the live orchestration tree
      const hb = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* */ } }, 15000);
      req.on("close", () => { clearInterval(hb); sseClients.delete(res); });
      return;
    }
    if (req.method === "POST" && url.pathname === "/ask-async") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const { text, parts } = JSON.parse(body || "{}");
          if (!agentSock) return json({ ok: false, error: "no agent connected" }, 503);
          void deliverUserMessage(String(text ?? ""), Array.isArray(parts) ? (parts as MsgPart[]) : undefined);
          json({ ok: true });
        } catch (e) { json({ ok: false, error: String(e) }, 500); }
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/sessions") return json(sessionsPayload());
    if (req.method === "GET" && url.pathname === "/history") {
      const id = url.searchParams.get("id");
      const turns = id ? readTurns(sessionFilePath(id)) : conversation;
      return json({ messages: turns.slice(-200).map((t) => ({ role: t.role, text: t.text, ts: t.ts, ...(t.parts?.length ? { parts: t.parts } : {}) })) });
    }
    if (req.method === "GET" && url.pathname === "/commands") return json({ commands: agentCommands });
    if (req.method === "POST" && url.pathname === "/orch/clear") { clearOrch(); return json({ ok: true }); }
    if (req.method === "POST" && (url.pathname === "/session/new" || url.pathname === "/session/select" || url.pathname === "/session/delete" || url.pathname === "/session/rename")) {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const b = JSON.parse(body || "{}");
          const id = String(b.id ?? "");
          if (url.pathname === "/session/new") { newSession(); clearOrch(); }
          else if (url.pathname === "/session/select") { if (!selectSession(id)) return json({ ok: false, error: "no such session" }, 404); clearOrch(); }
          else if (url.pathname === "/session/delete") deleteSession(id);
          else if (url.pathname === "/session/rename") { if (!renameSession(id, String(b.title ?? ""))) return json({ ok: false, error: "no such session" }, 404); }
          emitHistory(); emitSessions();
          json({ ok: true, ...sessionsPayload() });
        } catch (e) { json({ ok: false, error: String(e) }, 500); }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/upload") {
      const name = url.searchParams.get("name") ?? "file";
      const mime = url.searchParams.get("mime") || String(req.headers["content-type"] ?? "application/octet-stream");
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", async () => {
        try {
          const bytes = new Uint8Array(Buffer.concat(chunks));
          if (!bytes.length) return json({ ok: false, error: "empty upload" }, 400);
          const { blob_id } = await bus.putBlob(bytes, mime);
          json({ ok: true, blobId: blob_id, name, mime, size: bytes.length });
        } catch (e) { json({ ok: false, error: String(e) }, 500); }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/ask") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const { agent, text } = JSON.parse(body || "{}");
          if (Number(req.headers["x-ask-depth"] ?? 0) > MAX_ASK_DEPTH) return json({ error: "ask depth exceeded" }, 508);
          const r = resolveAgentId(String(agent ?? ""));
          if ("error" in r) return json(r, 404);
          // Source attribution for the orchestration tree: hub-mcp tags the caller (x-ask-from-*); fall
          // back to the active agent at depth ≤ 1 (the driver-seat brain making the first hop).
          const depth = Number(req.headers["x-ask-depth"] ?? 1);
          const fromId = String(req.headers["x-ask-from-id"] ?? "") || (depth <= 1 ? activeAgentId ?? "" : "");
          const fromName = String(req.headers["x-ask-from-name"] ?? "") || agents.get(fromId)?.name || "";
          // Positional loop prevention: every harness can delegate, so the only forbidden targets are the
          // driver-seat agent (the user-facing brain — "you" from its own turn) and the caller itself.
          // Longer cycles (worker→worker→worker) are bounded by MAX_ASK_DEPTH above.
          if (r.id === activeAgentId) return json({ error: "that harness is in the driver seat — delegate to a different worker" }, 400);
          if (fromId && r.id === fromId) return json({ error: "a harness can't delegate to itself" }, 400);
          logEvent("request", `/ask → ${agents.get(r.id)?.name ?? r.id}`, { text });
          const reply = await delegator.ask(r.id, String(text ?? ""), { fromId, fromName, depth });
          logEvent("response", "/ask reply", { reply });
          json({ reply });
        } catch (e) { json({ error: String(e) }, 500); }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/say") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const { text } = JSON.parse(body || "{}");
          if (!agentSock) return json({ error: "no agent connected (run `pnpm agent`)" }, 503);
          logEvent("user_message", String(text ?? ""), { text, via: "/say" });
          addTurn("user", String(text ?? ""));
          const reply = await new Promise<string>((resolve) => {
            const timer = setTimeout(() => { pendingSay = null; resolve("(no reply within timeout)"); }, 60_000);
            pendingSay = (t) => { clearTimeout(timer); resolve(t); };
            agentSock!.send(JSON.stringify({ t: "user", text: String(text ?? "") }));
          });
          json({ reply });
        } catch (e) { json({ error: String(e) }, 500); }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/demo-image") {
      // Test affordance for the Phase 6 image part: upload a sample photo as an E2E blob sealed for
      // the phone, then push an assistant_message with an image-ref part so the phone renders it inline.
      void (async () => {
        try {
          const dir = mediaDir();
          const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort() : [];
          if (!files.length) return json({ error: "no sample .jpg in media dir" }, 404);
          const jpeg = fs.readFileSync(path.join(dir, files[files.length - 1]));
          const { blob_id } = await bus.putBlob(new Uint8Array(jpeg), "image/jpeg");
          const parts: MsgPart[] = [{ kind: "image", blobId: blob_id, mime: "image/jpeg", alt: "demo photo" }];
          const text = "Here's an image.";
          bus.event("assistant_message", { text, parts } as unknown as Record<string, unknown>);
          addTurn("assistant", text, parts);
          json({ ok: true, blob_id });
        } catch (e) { json({ error: String(e) }, 500); }
      })();
      return;
    }
    if (req.method === "POST" && url.pathname === "/demo-file") {
      // Test affordance for the Phase 6 file part: send a small file as an E2E blob + a file-ref part.
      // ?kind=json|xml|code|image exercises the different preview renderers (else: a plain text note).
      void (async () => {
        try {
          const kind = url.searchParams.get("kind") ?? "text";
          let name = "notes.txt", mime = "text/plain";
          let bytes: Uint8Array;
          if (kind === "image") {
            const dir = mediaDir();
            const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort() : [];
            if (!files.length) return json({ error: "no sample .jpg in media dir" }, 404);
            bytes = new Uint8Array(fs.readFileSync(path.join(dir, files[files.length - 1])));
            name = "photo.jpg"; mime = "image/jpeg";
          } else if (kind === "json") {
            name = "data.json"; mime = "application/json";
            bytes = new Uint8Array(Buffer.from(JSON.stringify({ name: "Ada", count: 42, ok: true, tags: ["a", "b"], nested: { id: null } }, null, 2)));
          } else if (kind === "xml") {
            name = "config.xml"; mime = "application/xml";
            bytes = new Uint8Array(Buffer.from("<!-- demo -->\n<config env=\"prod\">\n  <item id=\"1\">hello</item>\n</config>\n"));
          } else if (kind === "code") {
            name = "Main.kt"; mime = "text/x-kotlin";
            bytes = new Uint8Array(Buffer.from("// greet the world\nfun main() {\n  val name = \"world\"\n  println(\"hello, \$name\") // 42\n}\n"));
          } else {
            bytes = new Uint8Array(Buffer.from("Hello from your agent.\nThis is a demo attachment.\n"));
          }
          const { blob_id } = await bus.putBlob(bytes, mime);
          const parts: MsgPart[] = [{ kind: "file", blobId: blob_id, name, mime, size: bytes.length }];
          const text = `Here's a file.`;
          bus.event("assistant_message", { text, parts } as unknown as Record<string, unknown>);
          addTurn("assistant", text, parts);
          json({ ok: true, blob_id, name });
        } catch (e) { json({ error: String(e) }, 500); }
      })();
      return;
    }
    if (req.method === "GET" && url.pathname === "/scheduled") return json({ tasks: scheduler.list() });
    if (req.method === "POST" && url.pathname === "/schedule") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const b = JSON.parse(body || "{}");
          const t = scheduler.add({ method: String(b.method), args: b.args ?? {}, delayMs: b.delayMs, atMs: b.atMs, everyMs: b.everyMs });
          logEvent("config", `scheduled ${t.method} for ${new Date(t.fireAt).toISOString()}`, t);
          json({ ok: true, id: t.id, fireAt: t.fireAt });
        } catch (e) { json({ error: String(e) }, 400); }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/cancel") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => { try { json({ cancelled: scheduler.cancel(String(JSON.parse(body || "{}").id)) }); } catch (e) { json({ error: String(e) }, 400); } });
      return;
    }
    if (req.method === "GET" && url.pathname === "/config") return json(readAgentCfg());
    if (req.method === "POST" && url.pathname === "/config") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const b = JSON.parse(body || "{}");
          const next: AgentCfg = { preset: String(b.preset ?? "custom"), commandTemplate: String(b.commandTemplate ?? ""), enabled: b.enabled !== false };
          writeAgentCfg(next);
          logEvent("config", `agent set to ${next.preset}${next.enabled ? "" : " (inbound off)"}`, next);
          json(next);
        } catch (e) { json({ error: String(e) }, 400); }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/call") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const { method, args } = JSON.parse(body || "{}");
          logEvent("request", `${method}`, args ?? {});
          const resp = await bus.request(method, args ?? {});
          if (resp.status === "ok") {
            logEvent("response", `${method} ok`, resp.result);
            // A photo/screenshot the agent just captured → surface it in the chat so the user SEES it,
            // without the agent having to hand-craft a markdown image. (Display side; phone-mcp handles vision.)
            const r = resp.result as { blob_id?: string; content_type?: string };
            if (r?.blob_id && (r.content_type ?? "").startsWith("image/")) {
              const note = method === "ui.screenshot" ? "📱 Screenshot from the phone" : "📷 Photo from the phone";
              const parts: MsgPart[] = [{ kind: "image", blobId: r.blob_id, mime: r.content_type ?? "image/jpeg", alt: note }];
              bus.event("assistant_message", { text: note, parts } as unknown as Record<string, unknown>);
              addTurn("assistant", note, parts);
            }
          } else logEvent("error", `${method} error`, resp.error);
          json(resp);
        } catch (e) { logEvent("error", `call failed: ${String(e)}`); json({ status: "error", error: { message: String(e) } }, 500); }
      });
      return;
    }
    res.statusCode = 404; res.end("not found");
  });
  await new Promise<void>((res) => server.listen(PORT, HOST, () => { console.error(`panel: http://${HOST}:${(server.address() as any).port}  (${caps.length} caps, relay ${relayUrl}, ${events.length} events loaded)`); res(); }));
  return {
    http: server,
    agentWss,
    delegator,
    async close() {
      _panelClosed = true;
      clearInterval(sweepTimer);
      for (const c of agentWss.clients) { try { c.terminate(); } catch { /* already gone */ } } // drop agents so close() (and the event loop) can settle
      await new Promise<void>((r) => agentWss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
      bus.close();
    },
  };
}

async function main() {
  const cp = configPath();
  if (!fs.existsSync(cp)) { console.error("No agent.json — pair first."); process.exit(1); }
  const cfg = loadCfg();
  if (!cfg.peerEdPub) { console.error("Not paired (no peerEdPub)."); process.exit(1); }
  await startPanel();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
