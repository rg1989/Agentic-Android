/**
 * Control panel — a web UI for driving the phone by hand AND watching everything that happens.
 * Connects to the relay as the paired agent (identity from ~/.agentic-android/agent.json), and:
 *   - exposes a button per phone capability (manual calls),
 *   - records every event (request / response / error / inbound phone event / agent run /
 *     connection / config change) to a persistent log with search + per-type toggles,
 *   - lets you configure WHICH agent drives inbound phone events (Claude / Codex / any command
 *     template with a {prompt} placeholder), persisted into agent.json.
 *
 * Run: `pnpm panel` then open http://127.0.0.1:8123
 * Note: shares the agent identity with the MCP bridge — run ONE of them at a time.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ready } from "./crypto.ts";
import { BusEndpoint } from "./peer.ts";
import { makeBrain, type BrainCfg } from "./brain.ts";

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

// Brain (the agent that drives the phone) config, persisted under agent.json `brain`.
function readBrainCfg(): BrainCfg {
  const b = (loadCfg().brain ?? {}) as Partial<BrainCfg>;
  return {
    provider: b.provider ?? "anthropic", // falls back to a keyword stub if the key env is unset
    model: b.model ?? "claude-opus-4-8",
    apiKeyEnv: b.apiKeyEnv ?? "ANTHROPIC_API_KEY",
    maxSteps: b.maxSteps ?? 8,
    system: b.system,
  };
}

/** Spawn the configured agent with the event prompt substituted in. User-configured local command. */
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

async function main() {
  await ready();
  const cp = configPath();
  if (!fs.existsSync(cp)) { console.error("No agent.json — pair first."); process.exit(1); }
  const cfg = loadCfg();
  if (!cfg.peerEdPub) { console.error("Not paired (no peerEdPub)."); process.exit(1); }
  loadEvents();

  const bus = new BusEndpoint({ self: cfg.self, peerEdPub: cfg.peerEdPub, relayUrl: cfg.relayUrl });
  await bus.connect();
  logEvent("connection", `connected to relay ${cfg.relayUrl}`, { relayUrl: cfg.relayUrl });

  // The brain: turns a user's message into phone actions + a reply (the assistant).
  const runBrain = makeBrain({
    bus,
    getCaps: () => caps,
    log: (ty, s, d) => logEvent(ty as EventType, s, d),
    getCfg: readBrainCfg,
  });

  // inbound phone events: a user's voice/text message -> the brain; everything else -> log (+ optional shell agent)
  bus.onEvent((ev) => {
    if (ev.topic === "user_message") {
      const text = String((ev.data as { text?: unknown }).text ?? "");
      void runBrain(text);
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

  // Fetch the phone's catalog in the BACKGROUND so the panel serves even if the phone is offline.
  const refreshCatalog = async () => {
    try {
      const r = await bus.request("list_capabilities", {});
      if (r.status === "ok") { caps = (r.result as { capabilities: Cap[] }).capabilities; logEvent("connection", `catalog: ${caps.length} capabilities`); }
    } catch { /* phone offline; retry below */ }
  };
  void (async () => { for (let i = 0; i < 30 && caps.length === 0; i++) { await refreshCatalog(); if (caps.length === 0) await new Promise((r) => setTimeout(r, 3000)); } })();

  const PORT = Number(process.env.PANEL_PORT ?? 8123);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const json = (o: unknown, code = 200) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };

    if (req.method === "GET" && url.pathname === "/") {
      res.setHeader("content-type", "text/html"); res.end(PAGE(caps, cfg.relayUrl)); return;
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
    if (req.method === "GET" && url.pathname === "/catalog") return json(caps);
    if (req.method === "GET" && url.pathname.startsWith("/blob/")) {
      const id = url.pathname.slice("/blob/".length);
      bus.getBlob(id).then((bytes) => { res.setHeader("content-type", "image/jpeg"); res.end(Buffer.from(bytes)); })
        .catch((e) => { res.statusCode = 502; res.end(String(e)); });
      return;
    }
    if (req.method === "POST" && url.pathname === "/say") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try { const { text } = JSON.parse(body || "{}"); const reply = await runBrain(String(text ?? "")); json({ reply }); }
        catch (e) { json({ error: String(e) }, 500); }
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
