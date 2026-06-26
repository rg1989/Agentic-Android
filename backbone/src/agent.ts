/**
 * The AGENT — a replaceable client that connects IN to the hub and provides the brain.
 *
 * It owns no phone connection and no state: it dials the hub's local WebSocket, receives the user's
 * messages + the capability catalog, and asks the hub to run capabilities / emit replies. Swap this
 * for any other agent (different LLM, a script, a human-in-the-loop) without touching the hub or
 * re-pairing the phone — the hub holds all the state.
 *
 * Config (provider/model/name/key) lives under ~/.agentic-android/agent.json `brain`.
 * Run: `pnpm agent`   (hub must be running: `pnpm panel`)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocket } from "ws";
import { makeBrain, type BrainCfg, type Cap, type AgentBus } from "./brain.ts";

function configPath(): string {
  const dir = process.env.AGENTIC_HOME ?? path.join(os.homedir(), ".agentic-android");
  return path.join(dir, "agent.json");
}
function readBrainCfg(): BrainCfg {
  const b = (JSON.parse(fs.readFileSync(configPath(), "utf8")).brain ?? {}) as Partial<BrainCfg>;
  return {
    provider: b.provider ?? "anthropic", // falls back to a keyword stub if the key env is unset
    model: b.model ?? "claude-opus-4-8",
    apiKeyEnv: b.apiKeyEnv ?? "ANTHROPIC_API_KEY",
    maxSteps: b.maxSteps ?? 8,
    system: b.system,
    name: process.env.AGENT_NAME ?? b.name, // AGENT_NAME lets you run several distinguishable agents
  };
}
/** Human-readable name this agent announces to the hub (and thus the phone). */
function displayName(): string {
  if (process.env.AGENT_NAME) return process.env.AGENT_NAME; // explicit override wins
  const c = readBrainCfg();
  const hasKey = !!process.env[c.apiKeyEnv || "ANTHROPIC_API_KEY"];
  // Be honest: only call it by the configured name when a real model is actually in play.
  // Otherwise it's the keyword stub — don't announce "Claude" for it.
  const realBrain = c.provider === "anthropic" && hasKey;
  return realBrain ? (c.name ?? "Claude") : "Basic agent";
}

async function main() {
  const HUB = process.env.HUB_URL ?? `ws://127.0.0.1:${process.env.AGENT_PORT ?? 8124}`;
  let caps: Cap[] = [];
  let nextId = 1;
  const pending = new Map<string, (r: { status: string; result?: unknown; error?: unknown }) => void>();

  const ws = new WebSocket(HUB);

  // The brain reaches the phone only through the hub (request a capability / emit an event).
  const hubBus: AgentBus = {
    request(method, params = {}) {
      const id = String(nextId++);
      return new Promise((resolve) => {
        pending.set(id, resolve);
        const timer = setTimeout(() => {
          if (pending.delete(id)) resolve({ status: "error", error: { code: "TIMEOUT", message: method, retriable: true } });
        }, 40_000);
        timer.unref?.();
        ws.send(JSON.stringify({ t: "tool", id, method, params }));
      });
    },
    event(topic, data = {}) { ws.send(JSON.stringify({ t: "event", topic, data })); },
  };

  const runBrain = makeBrain({
    bus: hubBus,
    getCaps: () => caps,
    log: (ty, s) => console.error(`[${ty}] ${s}`),
    getCfg: readBrainCfg,
  });

  ws.on("open", () => {
    ws.send(JSON.stringify({ t: "hello", name: displayName() }));
    console.error(`agent "${displayName()}" connected to hub ${HUB}`);
  });
  ws.on("message", (raw) => {
    let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === "ready" || m.t === "catalog") {
      caps = (m.catalog ?? []) as Cap[];
      console.error(`catalog: ${caps.length} capabilities`);
    } else if (m.t === "result") {
      const r = pending.get(m.id);
      if (r) { pending.delete(m.id); r({ status: m.status, result: m.result, error: m.error }); }
    } else if (m.t === "user") {
      // Surface any attached files to the brain as a path + mime it can open/act on.
      const files = Array.isArray(m.files) ? m.files : [];
      const note = files
        .map((f: any) => `\n\n[Attached file: ${f.name}${f.mime ? ` (${f.mime})` : ""} saved at ${f.path}]`)
        .join("");
      void runBrain(String(m.text ?? "") + note);
    }
  });
  ws.on("close", () => { console.error("hub connection closed — exiting"); process.exit(1); });
  ws.on("error", (e) => console.error("hub ws error:", String(e)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
