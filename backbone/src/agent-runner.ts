/**
 * agent-runner — the shared WebSocket harness every CLI-backed agent uses to attach to the hub.
 *
 * It owns the boilerplate that used to be copy-pasted into each agent: dial the hub, announce a name,
 * receive the user's messages (+ attached files), drive ONE turn through a brain, and stream status +
 * replies back. The brain itself is an `AgentAdapter` — a small object that says how to run a turn and
 * (optionally) how to probe auth, reset the conversation, publish slash commands, or detect an auth
 * failure. Add a new agent by writing an adapter, not another socket loop.
 *
 * Hub link: ws://127.0.0.1:8124 (override with HUB_URL or AGENT_PORT). Names/ids come from env so the
 * hub can label several agents and stop exactly the one it spawned (AGENT_NAME / AGENT_INSTANCE_ID).
 */
import { WebSocket } from "ws";

const HUB_WS = process.env.HUB_URL ?? `ws://127.0.0.1:${process.env.AGENT_PORT ?? 8124}`;

/** Parse AGENT_HUBS ("label=url,label2=url2") into MCP server entries that spawn hub-mcp per hub. */
export function buildHubServers(agentHubs: string | undefined, tsxBin: string, hubMcpPath: string, askDepth = "0"): Record<string, { command: string; args: string[]; env: Record<string, string> }> {
  const out: Record<string, { command: string; args: string[]; env: Record<string, string> }> = {};
  for (const pair of (agentHubs ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const label = pair.slice(0, eq).trim();
    const hubUrl = pair.slice(eq + 1).trim();
    if (!label || !hubUrl) continue;
    // Pass the orchestrator's own identity through (when known) so its ask_agent calls are attributed to
    // it in the hub's orchestration tree (x-ask-from-*), giving exact parent→child linkage when nested.
    const env: Record<string, string> = { HUB_HTTP: hubUrl, HUB_LABEL: label, ASK_DEPTH: askDepth };
    if (process.env.AGENT_INSTANCE_ID) env.FROM_ID = process.env.AGENT_INSTANCE_ID;
    if (process.env.AGENT_NAME) env.FROM_NAME = process.env.AGENT_NAME;
    out[`hub_${label}`] = { command: tsxBin, args: [hubMcpPath], env };
  }
  return out;
}

/** A file the user attached, already saved to disk by the hub (the adapter acts on it by path). */
export type AttachedFile = { path: string; name: string; mime?: string; size?: number };

/** Result of an adapter's startup auth check. ok=false surfaces a remediation on the phone + web. */
export interface ProbeResult { ok: boolean; label?: string; command?: string }

/** A within-agent activity the adapter can report mid-turn (subagent spawn / tool call) for the
 *  hub's orchestration tree. The hub nests these under the agent via `parentId` (a prior activity id). */
export interface AgentActivity { id: string; parentId?: string | null; kind: "subagent" | "tool"; name: string; detail?: string; status: "start" | "end"; error?: boolean; reply?: string }
/** Per-turn context handed to runTurn so it can stream internal activity back to the hub. `signal`
 *  fires when the user hits Stop — adapters should kill their in-flight child process on abort. */
export interface TurnContext { onActivity?: (a: AgentActivity) => void; signal?: AbortSignal }

/** The brain behind an agent. Only `name` + `runTurn` are required; everything else is an opt-in hook. */
export interface AgentAdapter {
  /** Display name announced to the hub (env AGENT_NAME overrides this at runtime). */
  name: string;
  /** One-line strength shown in the hub roster so a harness can delegate to other harnesses by strength. */
  description?: string;
  /** One-time startup check: can this brain actually answer here? Omit = assumed ready. */
  probe?(): Promise<ProbeResult>;
  /** Run a single user turn; resolve with the reply text. `ctx.onActivity` (optional) reports internals. */
  runTurn(prompt: string, ctx?: TurnContext): Promise<string>;
  /** Start a fresh conversation (e.g. the user typed /clear). No-op if the brain is stateless. */
  reset?(): void;
  /** After the socket opens: publish anything one-time (e.g. a slash-command catalog). */
  onConnect?(emit: (topic: string, data: Record<string, unknown>) => void): void;
  /** Inspect a reply to re-flag readiness (e.g. an auth-failure message → "sign in needed"). */
  authFailed?(reply: string): { label: string; command?: string } | null;
}

function fileNote(files: AttachedFile[]): string {
  return files.map((f) => `[Attached file: ${f.name}${f.mime ? ` (${f.mime})` : ""} saved at ${f.path}]`).join("\n");
}
/** Fold the user's text + any attached files into one NON-EMPTY prompt (a blank prompt makes some CLIs
 *  block on stdin or error), so adapters can pass it straight to their brain. */
export function buildPrompt(text: string, files: AttachedFile[]): string {
  const note = files.length ? fileNote(files) : "";
  if (text.trim() && note) return `${text}\n\n${note}`;
  if (note) return `The user sent you ${files.length === 1 ? "a file" : `${files.length} files`} with no message.\n${note}\nOpen it and respond.`;
  return text;
}

/** Connect an adapter to the hub and run its message loop until the socket closes. */
export async function runAgent(adapter: AgentAdapter): Promise<void> {
  const ws = new WebSocket(HUB_WS);
  const emit = (topic: string, data: Record<string, unknown>) => ws.send(JSON.stringify({ t: "event", topic, data }));
  const status = (data: Record<string, unknown>) => emit("agent_status", data);
  let beat: ReturnType<typeof setInterval> | null = null;
  let current: AbortController | null = null; // the in-flight turn, so the hub's Stop can abort it

  ws.on("open", () => {
    // orchestrator = launched with AGENT_HUBS, so it holds the hub's driver-seat tools (list_agents/ask_agent).
    // Hub-launched harnesses always get it; the flag just tells the roster which harnesses can delegate.
    ws.send(JSON.stringify({ t: "hello", name: process.env.AGENT_NAME ?? adapter.name, id: process.env.AGENT_INSTANCE_ID, description: process.env.AGENT_DESC ?? adapter.description, orchestrator: !!process.env.AGENT_HUBS }));
    console.error(`agent "${adapter.name}" connected to hub ${HUB_WS}`);
    // Heartbeat so the hub can tell "alive" from "socket open but process dead".
    beat = setInterval(() => { try { ws.send(JSON.stringify({ t: "heartbeat" })); } catch { /* socket closing */ } }, 15000);
    try { adapter.onConnect?.(emit); } catch (e) { console.error("onConnect failed:", String(e)); }
    // Don't claim "Ready" on the link alone if the adapter can verify auth — show the truth (and the fix).
    if (adapter.probe) {
      void adapter.probe().then((p) =>
        status(p.ok ? { label: "Ready", ready: true } : { label: p.label ?? "⚠ Not ready", ready: false, command: p.command }));
    } else status({ label: "Ready", ready: true });
  });

  ws.on("message", (raw) => {
    let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
    // Liveness check from the hub — answer in code (no brain turn) so it knows the read-loop is alive.
    if (m.t === "selftest") { ws.send(JSON.stringify({ t: "selftest_ok", token: m.token })); return; }
    if (m.t === "diag") { console.error(`hub diagnostic: ${m.problem}\n  remedy: ${m.remedy}`); return; }
    if (m.t === "interrupt") { current?.abort(); return; } // user hit Stop — kill the in-flight turn
    if (m.t !== "user") return; // phone-mcp fetches the catalog itself; nothing else to handle here
    const text = String(m.text ?? "");
    const askId = typeof m.askId === "string" ? m.askId : undefined;
    const files: AttachedFile[] = Array.isArray(m.files) ? m.files : [];
    // Let the user start a fresh conversation (a no-op reset for stateless adapters).
    if (!files.length && /^\/(clear|reset|new)\s*$/i.test(text.trim())) {
      adapter.reset?.();
      emit("assistant_message", { text: "Started a fresh conversation — earlier messages are forgotten.", ...(askId ? { askId } : {}) });
      return;
    }
    const prompt = buildPrompt(text, files);
    if (!prompt.trim()) return; // empty event — don't poke the brain with nothing
    status({ label: "Thinking…" });
    const ac = new AbortController(); current = ac;
    void adapter.runTurn(prompt, { onActivity: (a) => emit("agent_activity", a as unknown as Record<string, unknown>), signal: ac.signal }).then((reply) => {
      if (current === ac) current = null;
      const stopped = ac.signal.aborted;
      // Self-heal readiness from the REAL result so a fixed/broken auth flips on the next message.
      const fail = stopped ? null : adapter.authFailed?.(reply) ?? null;
      status(fail ? { label: fail.label, ready: false, command: fail.command } : { label: "Ready", ready: true });
      emit("assistant_message", { text: stopped ? (reply && reply.trim() ? reply + "\n\n_(stopped)_" : "_(stopped)_") : reply, ...(askId ? { askId } : {}) });
    });
  });

  ws.on("close", () => { if (beat) clearInterval(beat); console.error("hub connection closed — exiting"); process.exit(1); });
  ws.on("error", (e) => console.error("hub ws error:", String(e)));
}
