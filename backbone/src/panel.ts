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

interface Cap { method: string; sensitivity: string; summary: string }
let caps: Cap[] = []; // populated in the background once the phone answers
interface AgentCfg { preset: string; commandTemplate: string; enabled: boolean }
type EventType = "request" | "response" | "error" | "phone_event" | "agent_run" | "connection" | "config"
  | "user_message" | "assistant_message" | "llm" | "tool";
interface LogEvent { id: number; ts: number; type: EventType; summary: string; detail?: unknown }

const AGENT_PRESETS: Record<string, string> = {
  claude: 'claude -p "{prompt}"',
  codex: 'codex exec "{prompt}"',
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

// ---------- persistent conversation (the hub owns chat history) ----------
// The phone holds chat only in memory; the hub persists it so reopening the app (or swapping the
// app/agent) replays the conversation. Scoped per AGENTIC_HOME, i.e. per agent.
interface ChatTurn { role: "user" | "assistant"; text: string; ts: number }
const conversation: ChatTurn[] = [];
const MAX_CONVO = 500;
function convoPath(): string { return path.join(configDir(), "conversation.jsonl"); }
function loadConversation() {
  try {
    const lines = fs.readFileSync(convoPath(), "utf8").trim().split("\n").filter(Boolean);
    for (const l of lines.slice(-MAX_CONVO)) { try { conversation.push(JSON.parse(l) as ChatTurn); } catch { /* skip */ } }
  } catch { /* no file yet */ }
}
function addTurn(role: ChatTurn["role"], text: string) {
  if (!text) return;
  const turn: ChatTurn = { role, text, ts: Date.now() };
  conversation.push(turn);
  if (conversation.length > MAX_CONVO) conversation.shift();
  try { fs.appendFileSync(convoPath(), JSON.stringify(turn) + "\n"); } catch { /* best-effort */ }
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
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system,system-ui,sans-serif; margin:0; background:#14151a; color:#e7e7ea; }
  header { padding:14px 22px; border-bottom:1px solid #2a2c34; display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
  h1 { font-size:17px; margin:0; } .sub { color:#888; font-size:12px; }
  .agentbar { margin-left:auto; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .agentbar label { font-size:12px; color:#9a9aa3; }
  select, input { background:#0f1014; border:1px solid #2a2c34; color:#e7e7ea; border-radius:7px; padding:7px 9px; font-size:13px; }
  input.cmd { width:240px; font-family:ui-monospace,Menlo,monospace; } input.search { width:100%; }
  button { background:#3b5bdb; color:#fff; border:0; border-radius:8px; padding:8px 13px; font-size:13px; cursor:pointer; }
  button:hover { background:#4c6ef5; } button.stop { background:#b02a37; } button.ghost { background:#272a33; }
  button.ghost:hover { background:#323641; }
  .wrap { display:grid; grid-template-columns: 1fr 1.1fr; height: calc(100vh - 56px); }
  .caps { padding:14px 22px; overflow:auto; } .card { background:#1c1e26; border:1px solid #2a2c34; border-radius:12px; padding:12px 15px; margin-bottom:11px; }
  .card h3 { margin:0 0 2px; font-size:14px; } .card .s { color:#8a8a93; font-size:12px; margin-bottom:9px; }
  .tag { font-size:10px; padding:2px 7px; border-radius:99px; margin-left:8px; vertical-align:middle; }
  .allow { background:#15351f; color:#5ad17f; } .ask { background:#3a2f12; color:#e3b341; }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; } input.num { width:80px; } input.wide { width:160px; }
  .logpane { border-left:1px solid #2a2c34; background:#101117; display:flex; flex-direction:column; min-height:0; }
  .logctl { padding:10px 16px; border-bottom:1px solid #2a2c34; display:flex; flex-direction:column; gap:8px; }
  .chips { display:flex; gap:6px; flex-wrap:wrap; }
  .chip { font-size:11px; padding:3px 9px; border-radius:99px; border:1px solid #2a2c34; cursor:pointer; user-select:none; background:#1a1c23; color:#888; }
  .chip.on { color:#fff; } .chip.on[data-t=request]{background:#23314f;border-color:#3b5bdb}
  .chip.on[data-t=response]{background:#15351f;border-color:#2f7d4a} .chip.on[data-t=error]{background:#3a1416;border-color:#b02a37}
  .chip.on[data-t=phone_event]{background:#2c2350;border-color:#6c4ad1} .chip.on[data-t=agent_run]{background:#2f2a12;border-color:#e3b341}
  .chip.on[data-t=connection]{background:#10303a;border-color:#2a86a6} .chip.on[data-t=config]{background:#2a2c34;border-color:#555}
  .log { overflow:auto; padding:6px 12px; flex:1; }
  .entry { font:12px/1.45 ui-monospace,Menlo,monospace; border-bottom:1px solid #1f2128; padding:7px 4px; cursor:pointer; }
  .entry .t { color:#666; } .entry .b { font-size:10px; padding:1px 6px; border-radius:5px; margin:0 6px; }
  .b.request{background:#23314f;color:#9ab0ff} .b.response{background:#15351f;color:#5ad17f} .b.error{background:#3a1416;color:#ff8a8a}
  .b.phone_event{background:#2c2350;color:#b6a0ff} .b.agent_run{background:#2f2a12;color:#e3b341} .b.connection{background:#10303a;color:#7bd3ee} .b.config{background:#2a2c34;color:#aaa}
  .detail { display:none; white-space:pre-wrap; word-break:break-word; color:#9a9aa3; margin-top:4px; }
  .entry.open .detail { display:block; }
  .count { color:#666; font-size:11px; }
</style></head><body>
<header>
  <div><h1>🤖📱 Control Panel</h1><div class="sub">agent → relay (${relayUrl}) → phone · ${caps.length} capabilities</div></div>
  <div class="agentbar">
    <label>Agent</label>
    <select id="preset"></select>
    <input class="cmd" id="cmd" placeholder='command with {prompt}'>
    <label><input type="checkbox" id="aen"> on inbound</label>
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
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font: 15px/1.6 -apple-system,system-ui,sans-serif; margin:0; background:#14151a; color:#e7e7ea; }
  .wrap { max-width: 680px; margin: 0 auto; padding: 28px 20px 60px; }
  h1 { font-size: 22px; margin: 0 0 4px; } .sub { color:#9a9aa3; margin:0 0 22px; font-size:13px; }
  .status { display:flex; gap:12px; margin-bottom:26px; flex-wrap:wrap; }
  .pill { display:flex; align-items:center; gap:9px; background:#1c1e26; border:1px solid #2a2c34; border-radius:11px; padding:11px 15px; flex:1; min-width:200px; }
  .dot { width:11px; height:11px; border-radius:99px; background:#555; flex:none; }
  .dot.on { background:#3fb950; } .dot.wait { background:#d29922; }
  .pill .t { font-size:12px; color:#8a8a93; } .pill .v { font-size:14px; }
  .step { background:#1c1e26; border:1px solid #2a2c34; border-radius:14px; padding:18px 20px; margin-bottom:16px; }
  .step.done { border-color:#264d33; }
  .step h2 { font-size:16px; margin:0 0 4px; display:flex; align-items:center; gap:9px; }
  .num { width:24px; height:24px; border-radius:99px; background:#2a2c34; color:#cdd; font-size:13px; display:inline-flex; align-items:center; justify-content:center; flex:none; }
  .step.done .num { background:#2ea043; color:#fff; }
  .step p { color:#b5b5bd; font-size:13.5px; margin:6px 0; }
  .opts { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0 8px; }
  .opt { background:#272a33; border:1px solid #2a2c34; border-radius:9px; padding:8px 13px; cursor:pointer; font-size:13px; }
  .opt.sel { background:#1f3a5f; border-color:#3b5bdb; }
  code, .cmd { font-family: ui-monospace,Menlo,monospace; font-size:13px; }
  .cmdrow { display:flex; gap:8px; align-items:center; margin-top:8px; }
  .cmd { background:#0f1014; border:1px solid #2a2c34; border-radius:8px; padding:10px 12px; flex:1; overflow:auto; white-space:nowrap; }
  button { background:#3b5bdb; color:#fff; border:0; border-radius:8px; padding:9px 14px; font-size:13px; cursor:pointer; }
  button:hover { background:#4c6ef5; } button.ghost { background:#272a33; }
  .hint { color:#8a8a93; font-size:12.5px; margin-top:8px; }
  .qrbox { display:flex; gap:18px; align-items:center; flex-wrap:wrap; margin-top:12px; }
  .qr { background:#fff; border-radius:12px; padding:10px; width:200px; height:200px; flex:none; }
  ol { margin:6px 0 0; padding-left:20px; } ol li { margin:3px 0; font-size:13.5px; color:#b5b5bd; }
  a { color:#6b8afd; } .foot { margin-top:24px; font-size:13px; }
  .cards { display:flex; gap:12px; flex-wrap:wrap; margin:14px 0 6px; }
  .card2 { flex:1; min-width:210px; background:#272a33; border:2px solid #2a2c34; border-radius:11px; padding:13px 15px; cursor:pointer; }
  .card2.sel { border-color:#3b5bdb; background:#1b2740; }
  .card2 .ct { font-size:15px; } .card2 .cd { font-size:12.5px; color:#9a9aa3; margin-top:3px; }
  .adv { color:#6b8afd; font-size:13px; cursor:pointer; display:inline-block; margin:8px 0 2px; user-select:none; }
  .callout { background:#3a2f12; border:1px solid #6b551f; border-radius:9px; padding:13px 15px; margin-top:12px; font-size:13.5px; color:#e7d9ad; }
  .callout code { background:#0f1014; color:#fff; padding:5px 10px; border-radius:6px; display:inline-block; margin-top:8px; font-size:13px; }
</style></head>
<body><div class="wrap">
  <h1>Agentic Android</h1>
  <p class="sub">This is the hub on your computer — the glue between your phone and your agent. No API key needed here.</p>

  <div class="status">
    <div class="pill"><span id="ad" class="dot"></span><div><div class="t">Agent</div><div id="av" class="v">checking…</div></div></div>
    <div class="pill"><span id="pd" class="dot"></span><div><div class="t">Phone</div><div id="pv" class="v">checking…</div></div></div>
  </div>

  <div class="step" id="step1">
    <h2><span class="num">1</span> Connect your agent</h2>
    <p>An agent is the brain that talks to you and runs things on your phone. Pick one and press Connect.</p>
    <div class="cards">
      <div class="card2 sel" data-type="claude"><div class="ct">Your Claude</div><div class="cd">Uses your Claude subscription. No API key.</div></div>
      <div class="card2" data-type="basic"><div class="ct">Built-in helper</div><div class="cd">No setup, no login. Basic replies — good for a first test.</div></div>
    </div>
    <span class="adv" id="advtoggle">Advanced: use a custom command ▸</span>
    <input id="ccmd" placeholder="a CLI that prints a reply, e.g. codex" style="display:none;width:100%;margin:6px 0 2px;background:#0f1014;border:1px solid #2a2c34;color:#e7e7ea;border-radius:8px;padding:9px 11px;font-size:13px;font-family:ui-monospace,Menlo,monospace;" />
    <div class="cmdrow" style="margin-top:14px;"><button id="connect">Connect</button><button class="ghost" id="stopagent">Stop</button><span id="astate" class="hint" style="margin:0;"></span></div>
    <div id="alog" class="callout" style="display:none;"></div>
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
        <input id="relayinput" placeholder="your Mac's Tailscale IP, e.g. 100.x.x.x" style="flex:1;min-width:0;background:#0f1014;border:1px solid #2a2c34;color:#e7e7ea;border-radius:8px;padding:9px 11px;font-size:13px;" />
        <button id="relayapply" style="white-space:nowrap;">Apply</button>
      </div>
      <span id="relaystate" class="hint"></span>
    </div>
    <details style="margin-top:14px;"><summary style="cursor:pointer;color:#6b8afd;font-size:13px;">Phone won't connect?</summary>
      <ul style="font-size:13px;color:#b5b5bd;margin:8px 0 0;padding-left:18px;">
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
  cards.forEach(c=>c.onclick=()=>{ cards.forEach(x=>x.classList.toggle('sel',x===c)); curType=c.dataset.type; document.getElementById('ccmd').style.display='none'; });
  document.getElementById('advtoggle').onclick=()=>{
    const i=document.getElementById('ccmd'); const show=i.style.display==='none';
    i.style.display=show?'block':'none';
    if(show){ curType='custom'; cards.forEach(x=>x.classList.remove('sel')); } else { curType='claude'; cards[0].classList.add('sel'); }
  };
  function showCallout(error,command){
    const lg=document.getElementById('alog'); lg.innerHTML='';
    const p=document.createElement('div'); p.textContent=error; lg.appendChild(p);
    if(command){ const code=document.createElement('code'); code.textContent=command; lg.appendChild(code); }
    if(command==='claude setup-token'){
      const row=document.createElement('div'); row.style.cssText='margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;';
      const inp=document.createElement('input'); inp.placeholder='paste the token it prints (sk-ant-oat...)'; inp.style.cssText='flex:1;min-width:200px;background:#0f1014;border:1px solid #2a2c34;color:#e7e7ea;border-radius:8px;padding:9px 11px;font-size:13px;';
      const btn=document.createElement('button'); btn.textContent='Save token';
      btn.onclick=async()=>{ try{ const r=await (await fetch('/agent/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:inp.value})})).json(); btn.textContent=r.ok?'Saved — now press Connect':'Save failed'; }catch(e){ btn.textContent='Save failed'; } };
      row.appendChild(inp); row.appendChild(btn); lg.appendChild(row);
      const hint=document.createElement('div'); hint.style.cssText='margin-top:8px;font-size:12.5px;color:#9a9aa3;'; hint.textContent='The token is printed in the terminal where you ran the command (not the browser). Paste it here, Save, then press Connect.'; lg.appendChild(hint);
    }
    lg.style.display='block';
  }
  document.getElementById('connect').onclick=async()=>{
    const st=document.getElementById('astate');
    st.textContent='starting…'; document.getElementById('alog').style.display='none';
    try{
      const body={type:curType, command:document.getElementById('ccmd').value};
      const r=await (await fetch('/agent/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();
      if(!r.ok){ st.textContent=''; showCallout(r.error||'Could not start the agent.', r.command); }
    }catch(e){ st.textContent=''; showCallout(String(e)); }
  };
  document.getElementById('stopagent').onclick=async()=>{ await fetch('/agent/stop',{method:'POST'}); document.getElementById('astate').textContent='stopped'; document.getElementById('alog').style.display='none'; };
  function set(dot,val,on,wait,txt){ const d=document.getElementById(dot); d.className='dot'+(on?' on':wait?' wait':''); document.getElementById(val).textContent=txt; }
  let _calloutKey='';
  async function poll(){ try{ const s=await (await fetch('/status')).json();
    const aReady = s.agent.ready !== false;          // null/true => assume ok until the agent reports otherwise
    const aOk = s.agent.connected && aReady;          // connected AND actually able to authenticate
    set('ad','av', aOk, (s.agent.running&&!s.agent.connected)||(s.agent.connected&&!aReady),
      !s.agent.connected ? (s.agent.running?'Starting…':'Not connected yet')
      : aReady ? ('Connected — '+(s.agent.name||'agent'))
               : 'Connected, but Claude needs sign-in');
    set('pd','pv',s.phone.connected,s.paired&&!s.phone.connected, s.phone.connected?('Connected — '+s.phone.caps+' actions'):(s.paired?'Paired, waiting…':'Not paired — do step 2'));
    document.getElementById('step1').classList.toggle('done',aOk);
    document.getElementById('step2').classList.toggle('done',s.phone.connected);
    if(s.phoneRelay){ const pr=document.getElementById('prelay'); if(pr) pr.textContent=s.phoneRelay; }
    // Reflect the SAVED relay choice in the picker on first load (so Tailscale shows selected, not Wi-Fi).
    if(!window._relaySynced && s.relayChoice){ window._relaySynced=true;
      const opt=document.querySelector('[data-relay="'+s.relayChoice+'"]');
      if(opt){ document.querySelectorAll('[data-relay]').forEach(x=>x.classList.toggle('sel',x===opt));
        if(s.relayChoice==='anywhere'){ document.getElementById('relayrow').style.display='flex';
          const ri=document.getElementById('relayinput'); if(!ri.value && (s.phoneRelay||'').startsWith('http')) ri.value=s.phoneRelay; } } }
    const st=document.getElementById('astate');
    if(aOk) st.textContent='now running: '+(s.agent.name||'agent');
    else if(s.agent.connected&&!aReady) st.textContent='connected, but Claude needs sign-in (see below)';
    else if(s.agent.running) st.textContent='starting…';
    else st.textContent='';
    // Honest callout: when the agent is connected but can't authenticate, show the exact fix.
    // Keyed so we don't rebuild it every 2s (which would wipe a token being typed); cleared once ready.
    if(aOk){ if(_calloutKey){ _calloutKey=''; document.getElementById('alog').style.display='none'; } }
    else { const key=(s.agent.connected&&!aReady)?('a:'+(s.agent.status||'')+'|'+(s.agent.command||'')):'';
      if(key && key!==_calloutKey){ _calloutKey=key; showCallout(s.agent.status||'Claude needs sign-in on this computer.', s.agent.command); } }
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
  let agentSock: WebSocket | null = null;
  let agentName: string | null = null;
  let agentReady: boolean | null = null; // null = unknown (probing); false = connected but can't auth
  let agentStatus: { label?: string; command?: string } = {};
  let agentCommands: unknown[] = []; // slash command/skill catalog the agent published, for the phone's `/` menu
  let pendingSay: ((text: string) => void) | null = null; // resolves /say with the next agent reply

  // ---- agent process control: start/stop the brain straight from the setup UI (no terminal) ----
  let agentChild: ChildProcess | null = null;
  let agentChildLog = "";
  let agentKind = "";
  const backboneDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const tsxBin = () => { const b = path.join(backboneDir, "node_modules", ".bin", "tsx"); return fs.existsSync(b) ? b : "tsx"; };

  function stopAgentProc() {
    if (agentChild) { try { agentChild.kill("SIGTERM"); } catch { /* */ } agentChild = null; }
    agentKind = "";
  }
  function spawnAgent(kind: string, command?: string) {
    stopAgentProc();
    let env: NodeJS.ProcessEnv = { ...process.env };
    let script = "src/agent.ts";                                  // basic (keyword) agent
    if (kind === "claude") { script = "src/agent-cli.ts"; env = claudeSpawnEnv(); }            // your Claude
    else if (kind === "custom") { script = "src/agent-cli.ts"; env = claudeSpawnEnv(); env.AGENT_CLI = command || "claude"; }
    agentChildLog = ""; agentKind = kind;
    const child = spawn(tsxBin(), [script], { cwd: backboneDir, env });
    const cap = (d: Buffer) => { agentChildLog = (agentChildLog + d.toString()).slice(-3000); };
    child.stdout?.on("data", cap); child.stderr?.on("data", cap);
    child.on("exit", (code) => { agentChildLog += `\n[agent process exited: ${code}]`; if (agentChild === child) agentChild = null; });
    agentChild = child;
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
            if (signedIn) return resolve({ ok: false, message: "You're signed in, but the agent runs Claude headlessly, which needs a one-time token here. In a terminal run the command below (uses your subscription — no API key), then press Connect again.", command: "claude setup-token" });
            return resolve({ ok: false, message: "Your Claude isn't signed in on this computer. In a terminal run the command below, then press Connect again. (No API key needed.)", command: cli === "claude" ? "claude auth login" : undefined });
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

  const agentWss = new WebSocketServer({ port: AGENT_PORT });
  agentWss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === "hello") {
        agentSock = ws; agentName = String(m.name ?? "agent");
        agentReady = null; agentStatus = {}; agentCommands = []; // readiness/catalog unknown until the agent reports
        logEvent("connection", `agent connected: "${agentName}"`);
        bus.event("agent_identity", { name: agentName }); // tell the phone who's here now
        ws.send(JSON.stringify({ t: "ready", catalog: caps }));
      } else if (m.t === "tool") {
        void execForAgent(String(m.method), m.params ?? {}).then((resp) =>
          ws.send(JSON.stringify({ t: "result", id: m.id, status: resp.status, result: resp.result, error: resp.error })));
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
          addTurn("assistant", String(data.text ?? ""));
          pendingSay?.(String(data.text ?? "")); pendingSay = null;
        }
      }
    });
    ws.on("close", () => { if (agentSock === ws) { agentSock = null; agentName = null; agentReady = null; agentStatus = {}; agentCommands = []; logEvent("connection", "agent disconnected"); } });
  });
  logEvent("connection", `agent WebSocket on ws://127.0.0.1:${AGENT_PORT}`);

  // ---------- phone -> hub -> agent ----------
  bus.onEvent((ev) => {
    if (ev.topic === "whoami") {
      bus.event("agent_identity", { name: agentName ?? "No agent connected", relay: cfg.relayUrl });
      // Replay the conversation the hub holds so the phone shows history on (re)connect.
      bus.event("history", { messages: conversation.slice(-100).map((t) => ({ role: t.role, text: t.text, ts: t.ts })) });
      // If the agent connected but can't authenticate, a freshly-opened phone would otherwise miss the
      // one-time status event — replay it so the phone shows the warning, not a silent "connected".
      if (agentReady === false && agentStatus.label) bus.event("agent_status", { label: agentStatus.label });
      // Replay the slash catalog so a phone that connects after the agent still gets the `/` menu.
      if (agentCommands.length) bus.event("agent_commands", { commands: agentCommands });
      logEvent("connection", `identified to phone as "${agentName ?? "No agent"}" (replayed ${Math.min(conversation.length, 100)} turns)`);
      return;
    }
    if (ev.topic === "user_message") {
      const text = String((ev.data as { text?: unknown }).text ?? "");
      logEvent("user_message", text, { text });
      addTurn("user", text);
      if (agentSock) agentSock.send(JSON.stringify({ t: "user", text }));
      else {
        bus.event("assistant_message", { text: "No agent is connected. Start one on the machine: `pnpm agent`." });
        logEvent("error", "user_message but no agent connected");
      }
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
  function pushCatalog() { if (agentSock?.readyState === WebSocket.OPEN) agentSock.send(JSON.stringify({ t: "catalog", catalog: caps })); }

  // Fetch the phone's catalog in the BACKGROUND so the panel serves even if the phone is offline.
  const refreshCatalog = async () => {
    try {
      const r = await bus.request("list_capabilities", {});
      if (r.status === "ok") { caps = (r.result as { capabilities: Cap[] }).capabilities; logEvent("connection", `catalog: ${caps.length} capabilities`); pushCatalog(); }
    } catch { /* phone offline; retry below */ }
  };
  void (async () => { for (let i = 0; i < 30 && caps.length === 0; i++) { await refreshCatalog(); if (caps.length === 0) await new Promise((r) => setTimeout(r, 3000)); } })();

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
      return json({
        agent: { connected: !!agentSock, name: agentName, running: !!agentChild, kind: agentKind, ready: agentReady, status: agentStatus.label ?? null, command: agentStatus.command ?? null, log: agentChildLog.slice(-400) },
        phone: { connected: caps.length > 0, caps: caps.length },
        paired: !!cfg.peerEdPub,
        relayUrl: cfg.relayUrl,
        phoneRelay: phoneRelayUrl(cfg.relayUrl),
        relayChoice: (() => { try { const v = loadCfg().phoneRelayUrl; return typeof v === "string" && v.trim() ? (v === "usb" ? "usb" : "anywhere") : "auto"; } catch { return "auto"; } })(),
      });
    }
    if (req.method === "POST" && url.pathname === "/agent/start") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const { type, command } = JSON.parse(body || "{}");
          const kind = String(type ?? "basic");
          if (kind === "claude") {
            const probe = await probeClaude("claude");
            if (!probe.ok) return json({ ok: false, error: probe.message, command: probe.command });
          } else if (kind === "custom") {
            const probe = await probeClaude(String(command || "claude"));
            if (!probe.ok) return json({ ok: false, error: probe.message, command: probe.command });
          }
          spawnAgent(kind, command);
          logEvent("connection", `started agent process: ${kind}`);
          json({ ok: true });
        } catch (e) { json({ ok: false, error: String(e) }, 500); }
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/agent/stop") {
      stopAgentProc();
      logEvent("connection", "stopped agent process (from UI)");
      return json({ ok: true });
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
