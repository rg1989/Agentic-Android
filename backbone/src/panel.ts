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
import { ready } from "./crypto.ts";
import { BusEndpoint } from "./peer.ts";
import type { MsgPart } from "./parts.ts";
import { Scheduler, type Task } from "./scheduler.ts";
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
  custom: "",
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

const PAGE = (caps: Cap[], relayUrl: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agentic Android — Control Panel</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0a0b10;
    --surface: #14161e;
    --surface-2: #1a1d27;
    --surface-3: #21242f;
    --border: rgba(255,255,255,0.07);
    --border-strong: rgba(255,255,255,0.13);
    --text: #eceef4;
    --text-dim: #9b9eab;
    --text-faint: #62656f;
    --accent: #6366f1;
    --accent-hi: #818cf8;
    --accent-soft: rgba(99,102,241,0.16);
    --ok: #34d399;
    --warn: #fbbf24;
    --err: #f87171;
    --radius: 14px;
    --radius-sm: 10px;
    --mono: ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    --sans: -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font: 14px/1.5 var(--sans); margin: 0; color: var(--text); background: var(--bg);
    background-image: radial-gradient(1100px 560px at 78% -12%, rgba(99,102,241,0.10), transparent 62%);
    -webkit-font-smoothing: antialiased;
  }
  header {
    position: sticky; top: 0; z-index: 10; padding: 14px 24px; min-height: 56px;
    border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
    background: rgba(10,11,16,0.72);
    backdrop-filter: saturate(160%) blur(14px); -webkit-backdrop-filter: saturate(160%) blur(14px);
  }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .mark {
    width: 30px; height: 30px; border-radius: 9px; flex: none; position: relative;
    background:
      radial-gradient(circle at 30% 28%, #a5b4fc, transparent 46%),
      linear-gradient(145deg, #6366f1, #4f46e5 55%, #7c3aed);
    box-shadow: 0 0 0 1px rgba(255,255,255,0.10) inset, 0 6px 18px rgba(79,70,229,0.40);
  }
  .mark::after { content: ""; position: absolute; inset: 0; border-radius: inherit;
    background: radial-gradient(circle at 72% 78%, rgba(255,255,255,0.22), transparent 40%); }
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
</style></head><body>
<header>
  <div class="brand">
    <div class="mark" aria-hidden="true"></div>
    <div>
      <h1>Control Panel</h1>
      <div class="sub">agent → relay <span class="mono">${relayUrl}</span> → phone · ${caps.length} capabilities</div>
    </div>
  </div>
  <div class="agentbar">
    <label>Agent</label>
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
</script></body></html>`;

/** Guided, self-service setup page — connect an agent, then pair the phone (QR). Lives at "/". */
const SETUP_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agentic Android — Setup</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0a0b10;
    --surface: #14161e;
    --surface-2: #1a1d27;
    --surface-3: #21242f;
    --border: rgba(255,255,255,0.07);
    --border-strong: rgba(255,255,255,0.13);
    --text: #eceef4;
    --text-dim: #9b9eab;
    --text-faint: #62656f;
    --accent: #6366f1;
    --accent-hi: #818cf8;
    --accent-soft: rgba(99,102,241,0.16);
    --ok: #34d399;
    --warn: #fbbf24;
    --err: #f87171;
    --radius: 16px;
    --radius-sm: 11px;
    --mono: ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    --sans: -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font: 15px/1.6 var(--sans); margin: 0; color: var(--text); background: var(--bg);
    background-image:
      radial-gradient(900px 480px at 80% -8%, rgba(99,102,241,0.12), transparent 62%),
      radial-gradient(700px 420px at 8% 4%, rgba(124,58,237,0.08), transparent 60%);
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 40px 22px 64px; }
  .hero { display: flex; align-items: center; gap: 16px; margin-bottom: 6px; }
  .mark {
    width: 40px; height: 40px; border-radius: 12px; flex: none; position: relative;
    background:
      radial-gradient(circle at 30% 28%, #a5b4fc, transparent 46%),
      linear-gradient(145deg, #6366f1, #4f46e5 55%, #7c3aed);
    box-shadow: 0 0 0 1px rgba(255,255,255,0.10) inset, 0 8px 22px rgba(79,70,229,0.40);
  }
  .mark::after { content: ""; position: absolute; inset: 0; border-radius: inherit;
    background: radial-gradient(circle at 72% 78%, rgba(255,255,255,0.22), transparent 40%); }
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
  .qr { background: #fff; border-radius: 14px; padding: 12px; width: 204px; height: 204px; flex: none; box-shadow: 0 12px 30px rgba(0,0,0,0.40); }
  ol { margin: 6px 0 0; padding-left: 20px; } ol li { margin: 4px 0; font-size: 13.5px; color: var(--text-dim); }
  a { color: var(--accent-hi); } .foot { margin-top: 28px; font-size: 13px; color: var(--text-dim); }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin: 14px 0 6px; }
  .card2 {
    flex: 1; min-width: 215px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 13px; padding: 14px 16px; cursor: pointer;
    transition: border-color .15s, background .15s, box-shadow .15s, transform .12s;
  }
  .card2:hover { border-color: var(--border-strong); box-shadow: 0 8px 20px rgba(0,0,0,0.28); }
  .card2.sel { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 3px var(--accent-soft); }
  .card2 .ct { font-size: 15px; font-weight: 600; } .card2 .cd { font-size: 12.5px; color: var(--text-dim); margin-top: 4px; }
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
</style></head>
<body><div class="wrap">
  <div class="hero">
    <div class="mark" aria-hidden="true"></div>
    <h1>Agentic Android</h1>
  </div>
  <p class="sub">This is the hub on your computer — the glue between your phone and your agent.</p>

  <div class="status">
    <div class="pill"><span id="ad" class="dot"></span><div><div class="t">Agent</div><div id="av" class="v">checking…</div></div></div>
    <div class="pill"><span id="pd" class="dot"></span><div><div class="t">Phone</div><div id="pv" class="v">checking…</div></div></div>
  </div>

  <div class="step" id="step1">
    <h2><span class="num">1</span> Your agents</h2>
    <p>Agents are the brains that talk to you and act on your phone. Connect one or several — then switch between them anytime, from the phone or right here.</p>
    <div id="agentlist" class="agentlist"></div>
    <div class="addbox">
      <div class="addlabel">Add an agent</div>
      <div class="cards">
        <div class="card2 sel" data-type="claude"><div class="ct">Claude</div><div class="cd">Runs the <code>claude</code> CLI on this computer.</div></div>
        <div class="card2" data-type="omp"><div class="ct">omp (Oh My Pi)</div><div class="cd">Open-source coding agent. Full phone control via MCP.</div></div>
        <div class="card2" data-type="basic"><div class="ct">Built-in helper</div><div class="cd">No setup, no login. Basic replies — good for a first test.</div></div>
        <div class="card2" data-type="other"><div class="ct">Other local agent</div><div class="cd">Hermes, Pi, Cursor, Codex… any CLI on this computer.</div></div>
        <div class="card2" data-type="remote"><div class="ct">Remote / cloud agent</div><div class="cd">A Hermes (or anything) running elsewhere that connects to this hub itself.</div></div>
      </div>
      <div id="otherform" style="display:none;margin-top:10px;">
        <input id="oname" placeholder="Name (e.g. Hermes)" style="width:100%;margin:0 0 8px;" />
        <input id="ocmd" placeholder="command to run (e.g. hermes, pi, cursor-agent)" style="width:100%;margin:0 0 8px;font-family:var(--mono);" />
        <label class="phonechk"><input type="checkbox" id="ophone" checked /><span>Can control the phone <span class="hint" style="margin:0;">— for Claude Code-compatible CLIs (Claude, Cursor, Hermes, Pi). Off = chat only.</span></span></label>
      </div>
      <div id="remoteinfo" style="display:none;margin-top:10px;">
        <p class="step-p">No “Add” button — a remote agent connects itself. Send the prompt below to your cloud agent; it spells out exactly how to reach this hub and reply. (Keep the address on your tailnet — the port is unauthenticated by design.)</p>
        <pre id="remoteprompt" style="padding:12px 13px;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto;margin:0;">loading…</pre>
        <div class="cmdrow" style="margin-top:8px;"><button id="copyprompt">Copy prompt</button><span class="hint" id="remotewait" style="margin:0;">⏳ Waiting for a remote agent to connect…</span></div>
      </div>
      <div class="cmdrow" id="addrow" style="margin-top:14px;"><button id="connect">Add agent</button><span id="astate" class="hint" style="margin:0;"></span></div>
      <div id="alog" class="callout" style="display:none;"></div>
    </div>
  </div>

  <div class="step" id="step2">
    <h2><span class="num">2</span> Pair your phone</h2>
    <p>Open the Agentic Android app → tap <b>Pair</b> (or the agent name → <b>Pair another agent</b>) → scan this:</p>
    <div class="qrbox">
      <img class="qr" id="qrimg" src="/pair-qr" alt="Pairing QR code" />
      <ol>
        <li>Scan the code in the app's pairing screen.</li>
        <li>The phone will connect to <b id="prelay">this Mac</b>.</li>
        <li>This panel turns green when it connects.</li>
      </ol>
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
        <button id="relayapply" style="white-space:nowrap;">Apply</button>
      </div>
      <span id="relaystate" class="hint"></span>
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

  <p class="foot">Need the raw controls + event log? <a href="/panel">Open the control panel →</a></p>
</div>
<script>
  let curType='claude';
  const cards=[...document.querySelectorAll('.card2')];
  cards.forEach(c=>c.onclick=()=>{ cards.forEach(x=>x.classList.toggle('sel',x===c)); curType=c.dataset.type;
    document.getElementById('otherform').style.display = curType==='other' ? 'block' : 'none';
    document.getElementById('remoteinfo').style.display = curType==='remote' ? 'block' : 'none';
    document.getElementById('addrow').style.display = curType==='remote' ? 'none' : 'flex';
    if(curType==='remote') loadRemotePrompt(); });
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
  document.getElementById('connect').onclick=async()=>{
    const btn=document.getElementById('connect'); const st=document.getElementById('astate');
    let body;
    if(curType==='other'){
      const command=document.getElementById('ocmd').value.trim();
      if(!command){ st.textContent='enter a command'; document.getElementById('ocmd').focus(); return; }
      body={type:'other', name:document.getElementById('oname').value.trim(), command, phone:document.getElementById('ophone').checked};
    } else if(curType==='remote'){ return; }   // remote agents connect themselves — nothing to start
    else { body={type:curType}; }
    // Instant feedback: busy button + the optimistic row, so the wait is never a blank screen.
    btn.disabled=true; const lbl=btn.textContent; btn.textContent='Adding…';
    st.textContent=''; document.getElementById('alog').style.display='none';
    pendingRow(curType);
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
    dot.className='dot '+(!a.connected?'wait':(a.active?(a.ready===false?'bad':'on'):'lit'));
    row.appendChild(dot);
    if(a.connected && !a.managed){ const c=document.createElement('span'); c.textContent='☁'; c.title='Cloud / external agent — it connected to this hub on its own (a remote brain or a hand-started CLI), not launched here.'; c.style.cssText='margin:0 4px 0 0;font-size:14px;cursor:help;'; row.appendChild(c); }
    const nm=document.createElement('div'); nm.className='nm'; nm.textContent=a.name; row.appendChild(nm);
    if(!a.connected){ const b=document.createElement('span'); b.className='badge'; b.textContent='starting…'; row.appendChild(b); }
    else if(a.active){ const b=document.createElement('span'); b.className='badge act'; b.textContent='Active'; row.appendChild(b); }
    else { const btn=document.createElement('button'); btn.className='ghost'; btn.textContent='Set active'; btn.onclick=()=>setActive(a.id); row.appendChild(btn); }
    if(a.managed){ const btn=document.createElement('button'); btn.className='ghost'; btn.textContent='Stop'; btn.onclick=()=>stopAgent(a.id); row.appendChild(btn); }
    return row;
  }
  let _agentsSig='';
  function renderAgents(list){
    const sig=JSON.stringify(list); if(sig===_agentsSig) return; _agentsSig=sig;  // only rebuild when it changes
    const host=document.getElementById('agentlist'); host.innerHTML='';
    if(!list.length){ const e=document.createElement('div'); e.className='empty'; e.textContent='No agents connected yet — add one below.'; host.appendChild(e); return; }
    list.forEach(a=>host.appendChild(agentRow(a)));
  }
  let _calloutKey='';
  async function poll(){ try{ const s=await (await fetch('/status')).json();
    const list=s.agents||[]; const active=s.active;
    const aOk = !!active && active.ready!==false;       // active agent connected AND able to authenticate
    const starting = list.some(a=>!a.connected);
    renderAgents(list);
    set('ad','av', aOk, (active&&active.ready===false)||starting,
      !list.length ? (starting?'Starting…':'No agent connected')
      : active ? (active.ready===false ? ('Sign-in needed — '+active.name)
                 : ('Active: '+active.name + (list.length>1?(' · +'+(list.length-1)+' more'):'')))
               : 'Connecting…');
    set('pd','pv',s.phone.connected,s.paired&&!s.phone.connected, s.phone.connected?('Connected — '+s.phone.caps+' actions'):(s.paired?'Paired, waiting…':'Not paired — do step 2'));
    document.getElementById('step1').classList.toggle('done',aOk);
    document.getElementById('step2').classList.toggle('done',s.phone.connected);
    if(s.phoneRelay){ const pr=document.getElementById('prelay'); if(pr) pr.textContent=s.phoneRelay; }
    const ext=(s.agents||[]).filter(a=>a.connected && !a.managed); const rw=document.getElementById('remotewait');
    if(rw) rw.textContent = ext.length
      ? ('✓ '+ext.length+' remote/external agent'+(ext.length>1?'s':'')+' connected — pick one in the list above to make it active.')
      : '⏳ Waiting for a remote agent to connect… it appears in the list above the moment it does. The port is unauthenticated by design — keep it on your tailnet only.';
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
  relayInput.addEventListener('keydown', e=>{ if(e.key==='Enter') setRelay(relayInput.value); });
  document.getElementById('relayapply').onclick=()=>setRelay(relayInput.value);
  async function setRelay(value){
    const st=document.getElementById('relaystate'); st.textContent='saving…';
    try{ const r=await (await fetch('/relay-url',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value})})).json();
      if(r.ok){ st.textContent='✓ saved as '+(r.phoneRelay||value)+' — re-scan the QR to apply'; document.getElementById('qrimg').src='/pair-qr?t='+Date.now(); } else { st.textContent=r.error||'failed'; } }
    catch(e){ st.textContent='failed'; }
  }
  setInterval(poll,2000); poll();
</script></body></html>`;

async function main() {
  await ready();
  const cp = configPath();
  if (!fs.existsSync(cp)) { console.error("No agent.json — pair first."); process.exit(1); }
  const cfg = loadCfg();
  if (!cfg.peerEdPub) { console.error("Not paired (no peerEdPub)."); process.exit(1); }
  loadEvents();
  loadConversation();

  const bus = new BusEndpoint({ self: cfg.self, peerEdPub: cfg.peerEdPub, relayUrl: cfg.relayUrl });
  await bus.connect();
  logEvent("connection", `connected to relay ${cfg.relayUrl}`, { relayUrl: cfg.relayUrl });

  // ---------- the agent connects IN over a local WebSocket; the brain runs as its OWN process ----------
  const AGENT_PORT = Number(process.env.AGENT_PORT ?? 8124);
  let agentSock: WebSocket | null = null; // the ACTIVE agent's socket — all existing routing uses this
  let agentName: string | null = null;
  let agentReady: boolean | null = null; // null = unknown (probing); false = connected but can't auth
  let agentStatus: { label?: string; command?: string } = {};
  let agentCommands: unknown[] = []; // slash command/skill catalog the agent published, for the phone's `/` menu
  let pendingSay: ((text: string) => void) | null = null; // resolves /say with the next agent reply
  // Phase 8: the hub can hold several agents at once. `agentSock` stays the active one (single-agent
  // behavior is unchanged); this roster tracks everyone connected so the phone can see + switch them.
  const agents = new Map<string, { ws: WebSocket; name: string }>();
  let activeAgentId: string | null = null;
  // `external` = the agent dialed in on its own (a remote/cloud brain or a hand-started CLI), i.e. the
  // hub didn't spawn it. The phone + web show a cloud icon for these.
  const rosterList = () => [...agents].map(([id, a]) => ({ id, name: a.name, active: id === activeAgentId, external: !managed.has(id) }));
  const announceRoster = () => bus.event("agents_roster", { agents: rosterList() });

  /** Where a remote/cloud agent dials in: same host the phone reaches, on the agent port. */
  const agentWsUrl = () => { try { const u = new URL(phoneRelayUrl(cfg.relayUrl)); return `ws://${u.hostname}:${AGENT_PORT}`; } catch { return `ws://127.0.0.1:${AGENT_PORT}`; } };
  /** A copy-paste prompt the user hands to a remote/cloud agent so it connects + actually replies.
   *  Built here (not in the page template) so the protocol text isn't mangled by template escaping. */
  const remoteAgentPrompt = () => {
    const ws = agentWsUrl();
    return [
      `You are being connected as the "brain" for an Agentic-Android hub — a self-hosted bridge that lets you see and control the user's Android phone (camera, screen read/tap, location, SMS, notifications, apps, and more). Open ONE persistent WebSocket to the hub, then answer the user's chat messages and drive the phone with tool calls. Implement exactly this protocol.`,
      ``,
      `ENDPOINT`,
      `  ${ws}`,
      `  Plain WebSocket — no TLS, no auth. You must be able to reach this host (it's on the user's Tailscale/LAN). Open ONE connection and KEEP IT OPEN across messages — do NOT reconnect per message (that spawns duplicate ghost agents). If it drops, reconnect with backoff, one connection at a time.`,
      ``,
      `HANDSHAKE`,
      `  1. On open, send:  {"t":"hello","name":"<your name, e.g. Hermes>"}`,
      `  2. The hub sends your tool catalog:  {"t":"ready","catalog":[ {"method":"...","summary":"..."}, ... ]}  (may be re-sent as {"t":"catalog",...}). These are the phone capabilities you can call.`,
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
      `Confirm you can (1) hold one open socket, (2) receive {t:"user"} frames, and (3) reply with the assistant_message event — then tell the user you're connected and ready.`,
    ].join("\n");
  };

  // ---- managed agent processes: start/stop brains from the setup UI (no terminal). SEVERAL at once. ----
  // Each managed child is keyed by an instanceId we pass in via env; the agent echoes it in its hello so
  // its roster entry uses the SAME id — that lets the UI stop exactly the agent the user picked.
  type Managed = { child: ChildProcess; kind: string; name: string; log: string };
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
  function spawnAgent(kind: string, command?: string, opts: { name?: string; phone?: boolean } = {}): string {
    const instanceId = randomUUID();
    let env: NodeJS.ProcessEnv = { ...process.env };
    let script = "src/agent.ts";                                  // basic (keyword) agent
    let baseName = "Built-in helper";
    if (kind === "claude") { script = "src/agent-cli.ts"; env = claudeSpawnEnv(); baseName = "Claude"; }            // your Claude
    else if (kind === "omp") { script = "src/agent-omp.ts"; baseName = "omp"; }                                     // Oh My Pi — keeps its own env (provider keys / OAuth)
    else if (kind === "other" || kind === "custom") {
      baseName = opts.name?.trim() || command || "agent";
      if (opts.phone === false) { script = "src/agent-text.ts"; env.AGENT_CMD = command || ""; }                    // chat-only: any CLI
      else { script = "src/agent-cli.ts"; env = claudeSpawnEnv(); env.AGENT_CLI = command || "claude"; }           // Claude-Code-compatible: full phone control
    }
    const name = uniqueAgentName(baseName);
    env.AGENT_INSTANCE_ID = instanceId;
    env.AGENT_NAME = name;
    const child = spawn(tsxBin(), [script], { cwd: backboneDir, env });
    const m: Managed = { child, kind, name, log: "" };
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

  const agentWss = new WebSocketServer({ port: AGENT_PORT });
  agentWss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === "hello") {
        const name = String(m.name ?? "agent");
        // A managed agent echoes the instanceId we spawned it with → reuse it so its roster entry and its
        // process share one id (the UI can then stop it). External agents get a fresh id.
        const id = (typeof m.id === "string" && m.id) ? m.id : randomUUID();
        (ws as any)._agentId = id;
        agents.set(id, { ws, name });
        // Become the active agent only if there isn't a live one already (preserves single-agent flow).
        if (!agentSock || !activeAgentId || !agents.has(activeAgentId)) {
          activeAgentId = id; agentSock = ws; agentName = name;
          agentReady = null; agentStatus = {}; agentCommands = [];
          bus.event("agent_identity", { name: agentName });
        }
        logEvent("connection", `agent connected: "${name}" (${agents.size} online)`);
        announceRoster();
        ws.send(JSON.stringify({ t: "ready", catalog: agentCatalog() }));
      } else if (m.t === "tool") {
        const method = String(m.method);
        if (isSchedulerTool(method)) {
          const result = handleSchedulerTool(method, (m.params ?? {}) as Record<string, unknown>);
          logEvent("response", `${method} ok`, result);
          ws.send(JSON.stringify({ t: "result", id: m.id, status: "ok", result }));
        } else {
          void execForAgent(method, m.params ?? {}).then((resp) =>
            ws.send(JSON.stringify({ t: "result", id: m.id, status: resp.status, result: resp.result, error: resp.error })));
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
          bus.event("assistant_message", data);
          logEvent("assistant_message", String(data.text ?? "").slice(0, 200), data);
          const parts = Array.isArray((data as any).parts) ? ((data as any).parts as MsgPart[]) : undefined;
          addTurn("assistant", String(data.text ?? ""), parts);
          pendingSay?.(String(data.text ?? "")); pendingSay = null;
        }
      }
    });
    ws.on("close", () => {
      const id = (ws as any)._agentId as string | undefined;
      if (id) agents.delete(id);
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
  logEvent("connection", `agent WebSocket on ws://127.0.0.1:${AGENT_PORT}`);

  // ---------- phone -> hub -> agent ----------
  const histMsgs = () => conversation.slice(-100).map((t) => ({ role: t.role, text: t.text, ts: t.ts, ...(t.parts?.length ? { parts: t.parts } : {}) }));
  const emitHistory = () => bus.event("history", { messages: histMsgs() });
  const emitSessions = () => bus.event("sessions", sessionsPayload());
  bus.onEvent((ev) => {
    if (ev.topic === "whoami") {
      bus.event("agent_identity", { name: agentName ?? "No agent connected", relay: cfg.relayUrl });
      // Replay the active session + the session list so the phone shows history on (re)connect.
      emitHistory();
      emitSessions();
      // If the agent connected but can't authenticate, a freshly-opened phone would otherwise miss the
      // one-time status event — replay it so the phone shows the warning, not a silent "connected".
      if (agentReady === false && agentStatus.label) bus.event("agent_status", { label: agentStatus.label });
      // Replay the slash catalog so a phone that connects after the agent still gets the `/` menu.
      if (agentCommands.length) bus.event("agent_commands", { commands: agentCommands });
      announceRoster(); // Phase 8: tell the phone which agents are connected right now
      // The phone just (re)connected — re-fetch its capability catalog so the panel shows "Connected —
      // N actions" instead of "Paired, waiting…" (the startup fetch loop may have given up before the
      // phone re-registered, e.g. after a hub restart). Chat already works over the event path.
      void refreshCatalog();
      logEvent("connection", `identified to phone as "${agentName ?? "No agent"}" (replayed ${Math.min(conversation.length, 100)} turns)`);
      return;
    }
    if (ev.topic === "select_agent") {
      // Phase 8: the phone picked which connected agent should be active; route to its socket.
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
      const text = String(d.text ?? "");
      const parts = Array.isArray(d.parts) ? (d.parts as MsgPart[]) : undefined;
      logEvent("user_message", text, { text, parts });
      // Persist any attached file blobs to disk so the agent gets a real local path + mime to open.
      void (async () => {
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
        if (agentSock) agentSock.send(JSON.stringify({ t: "user", text, ...(files.length ? { files } : {}) }));
        else {
          bus.event("assistant_message", { text: "No agent is connected. Start one on the machine: `pnpm agent`." });
          logEvent("error", "user_message but no agent connected");
        }
      })();
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
  void (async () => { let n = 0; while (caps.length === 0) { await refreshCatalog(); if (caps.length === 0) await new Promise((r) => setTimeout(r, n++ < 10 ? 3000 : 15000)); } })();

  const PORT = Number(process.env.PANEL_PORT ?? 8123);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const json = (o: unknown, code = 200) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };

    if (req.method === "GET" && url.pathname === "/") {
      res.setHeader("content-type", "text/html"); res.setHeader("cache-control", "no-store"); res.end(SETUP_PAGE); return;
    }
    if (req.method === "GET" && url.pathname === "/panel") {
      res.setHeader("content-type", "text/html"); res.end(PAGE(caps, cfg.relayUrl)); return;
    }
    if (req.method === "GET" && url.pathname === "/status") {
      // Every agent the hub knows: connected ones (the roster) + any managed child still starting up.
      const connectedIds = new Set(agents.keys());
      const list = [
        ...rosterList().map((a) => ({
          id: a.id, name: a.name, active: a.active, connected: true,
          ready: a.active ? agentReady : null, managed: managed.has(a.id), kind: managed.get(a.id)?.kind ?? "external",
        })),
        ...[...managed.entries()].filter(([id]) => !connectedIds.has(id)).map(([id, m]) => ({
          id, name: m.name, active: false, connected: false, ready: null, managed: true, kind: m.kind,
        })),
      ];
      return json({
        agents: list,
        active: activeAgentId ? { id: activeAgentId, name: agentName, ready: agentReady, status: agentStatus.label ?? null, command: agentStatus.command ?? null } : null,
        phone: { connected: caps.length > 0, caps: caps.length },
        paired: !!cfg.peerEdPub,
        relayUrl: cfg.relayUrl,
        phoneRelay: phoneRelayUrl(cfg.relayUrl),
        // Where a REMOTE agent (cloud box, another machine) dials in — same host the phone reaches, agent port.
        agentWs: agentWsUrl(),
        relayChoice: (() => { try { const v = loadCfg().phoneRelayUrl; return typeof v === "string" && v.trim() ? (v === "usb" ? "usb" : "anywhere") : "auto"; } catch { return "auto"; } })(),
      });
    }
    if (req.method === "GET" && url.pathname === "/remote-prompt") {
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(remoteAgentPrompt());
      return;
    }
    if (req.method === "POST" && url.pathname === "/agent/start") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const { type, command, name, phone } = JSON.parse(body || "{}");
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
          }
          const id = spawnAgent(kind, cmd, { name: typeof name === "string" ? name : undefined, phone: wantsPhone });
          logEvent("connection", `started agent process: ${kind}${cmd ? ` (${cmd})` : ""} phone=${wantsPhone} (${id})`);
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
          logEvent("config", `phone relay set to ${v}`);
          json({ ok: true, phoneRelay: phoneRelayUrl(cfg.relayUrl) });
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
      const token = "PAIR:" + Buffer.from(JSON.stringify({ edPub: cfg.self.edPub, fp: cfg.self.fp, relayUrl: phoneRelayUrl(cfg.relayUrl) })).toString("base64url");
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
      bus.getBlob(id).then((bytes) => { res.setHeader("content-type", "image/jpeg"); res.end(Buffer.from(bytes)); })
        .catch((e) => { res.statusCode = 502; res.end(String(e)); });
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
          if (resp.status === "ok") logEvent("response", `${method} ok`, resp.result);
          else logEvent("error", `${method} error`, resp.error);
          json(resp);
        } catch (e) { logEvent("error", `call failed: ${String(e)}`); json({ status: "error", error: { message: String(e) } }, 500); }
      });
      return;
    }
    res.statusCode = 404; res.end("not found");
  });
  server.listen(PORT, () => console.error(`panel: http://127.0.0.1:${PORT}  (${caps.length} caps, relay ${cfg.relayUrl}, ${events.length} events loaded)`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
