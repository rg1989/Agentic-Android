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

/** A file the user attached, already saved to disk by the hub (the adapter acts on it by path). */
export type AttachedFile = { path: string; name: string; mime?: string; size?: number };

/** Result of an adapter's startup auth check. ok=false surfaces a remediation on the phone + web. */
export interface ProbeResult { ok: boolean; label?: string; command?: string }

/** The brain behind an agent. Only `name` + `runTurn` are required; everything else is an opt-in hook. */
export interface AgentAdapter {
  /** Display name announced to the hub (env AGENT_NAME overrides this at runtime). */
  name: string;
  /** One-time startup check: can this brain actually answer here? Omit = assumed ready. */
  probe?(): Promise<ProbeResult>;
  /** Run a single user turn; resolve with the reply text to send back to the phone. */
  runTurn(prompt: string): Promise<string>;
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

  ws.on("open", () => {
    ws.send(JSON.stringify({ t: "hello", name: process.env.AGENT_NAME ?? adapter.name, id: process.env.AGENT_INSTANCE_ID }));
    console.error(`agent "${adapter.name}" connected to hub ${HUB_WS}`);
    try { adapter.onConnect?.(emit); } catch (e) { console.error("onConnect failed:", String(e)); }
    // Don't claim "Ready" on the link alone if the adapter can verify auth — show the truth (and the fix).
    if (adapter.probe) {
      void adapter.probe().then((p) =>
        status(p.ok ? { label: "Ready", ready: true } : { label: p.label ?? "⚠ Not ready", ready: false, command: p.command }));
    } else status({ label: "Ready", ready: true });
  });

  ws.on("message", (raw) => {
    let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t !== "user") return; // phone-mcp fetches the catalog itself; nothing else to handle here
    const text = String(m.text ?? "");
    const files: AttachedFile[] = Array.isArray(m.files) ? m.files : [];
    // Let the user start a fresh conversation (a no-op reset for stateless adapters).
    if (!files.length && /^\/(clear|reset|new)\s*$/i.test(text.trim())) {
      adapter.reset?.();
      emit("assistant_message", { text: "Started a fresh conversation — earlier messages are forgotten." });
      return;
    }
    const prompt = buildPrompt(text, files);
    if (!prompt.trim()) return; // empty event — don't poke the brain with nothing
    status({ label: "Thinking…" });
    void adapter.runTurn(prompt).then((reply) => {
      // Self-heal readiness from the REAL result so a fixed/broken auth flips on the next message.
      const fail = adapter.authFailed?.(reply) ?? null;
      status(fail ? { label: fail.label, ready: false, command: fail.command } : { label: "Ready", ready: true });
      emit("assistant_message", { text: reply });
    });
  });

  ws.on("close", () => { console.error("hub connection closed — exiting"); process.exit(1); });
  ws.on("error", (e) => console.error("hub ws error:", String(e)));
}
