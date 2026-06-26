/**
 * Brain — the agent that drives the phone. Pluggable: any LLM (Claude by default) decides which of
 * the phone's capabilities to call in response to a user message, then replies.
 *
 * On a `user_message` (from the phone, via voice/text) it runs an agentic loop: LLM → tool calls →
 * phone executes → results → LLM → final reply, sent back as an `assistant_message` event.
 *
 * Provider is chosen in the agent config:
 *   - "anthropic": real Claude via @anthropic-ai/sdk (needs the API key env var).
 *   - "stub":      no key needed — a keyword router that still exercises the full input→tool→reply
 *                  loop on the real device, so the plumbing is verifiable. Drop in a key to upgrade.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AssistantMessage } from "./parts.ts";

export interface Cap { method: string; sensitivity: string; summary: string }
export interface BrainCfg { provider: string; model: string; apiKeyEnv: string; maxSteps: number; system?: string; name?: string }

/**
 * The agent reaches the phone ONLY through the hub: request a capability, or emit an event
 * (status / assistant_message). It never touches the bus, blobs, or media — the hub owns all that.
 * Satisfied structurally by both the hub link (agent.ts) and a real BusEndpoint.
 */
export interface AgentBus {
  request(method: string, params?: Record<string, unknown>): Promise<{ status: string; result?: unknown; error?: unknown }>;
  event(topic: string, data?: Record<string, unknown>): void;
}

export interface BrainDeps {
  bus: AgentBus;
  getCaps: () => Cap[];
  log: (type: string, summary: string, detail?: unknown) => void;
  getCfg: () => BrainCfg;
}

const DEFAULT_SYSTEM =
  "You are the user's phone assistant — like Claude, but your computer is their Android phone. " +
  "You can see and operate the phone through the provided tools: take photos, read/tap/type/swipe/screenshot the screen, " +
  "get location and device info, open apps, toggle the flashlight, ring it, and more. " +
  "When the user asks for something on the phone, use the tools to actually do it, then tell them the result. Be concise and concrete.";

const toName = (m: string) => m.replace(/[^a-zA-Z0-9_-]/g, "_");

/** Friendly "what I'm doing now" label for a capability, shown as a live status on the phone. */
function friendlyStatus(method: string): string {
  const map: Record<string, string> = {
    "camera.capture": "📷 Taking a photo…",
    "ui.screenshot": "🖼️ Capturing the screen…",
    "device.info": "📱 Checking the device…",
    "torch.set": "🔦 Toggling the flashlight…",
    "phone.ring": "🔔 Ringing the phone…",
    "location.get": "📍 Getting your location…",
    "vibrate": "📳 Buzzing…",
    "ui.read": "👀 Reading the screen…",
    "ui.tap": "👆 Tapping…",
    "ui.swipe": "👆 Swiping…",
    "ui.global": "🧭 Navigating…",
  };
  return map[method] ?? `⚙️ Running ${method}…`;
}

export function makeBrain(deps: BrainDeps) {
  return async function runBrain(userText: string): Promise<string> {
    deps.log("user_message", userText, { text: userText });
    deps.bus.event("agent_status", { label: "Thinking…" }); // live status on the phone
    const cfg = deps.getCfg();
    const key = process.env[cfg.apiKeyEnv || "ANTHROPIC_API_KEY"];
    let reply: string | AssistantMessage;
    try {
      reply = cfg.provider === "anthropic" && key
        ? await anthropicLoop(deps, userText, cfg, key)
        : await stubLoop(deps, userText);
    } catch (e) {
      reply = `Sorry — I hit an error: ${String(e)}`;
      deps.log("error", "brain error", { error: String(e) });
    }
    const msg: AssistantMessage = typeof reply === "string" ? { text: reply } : reply;
    deps.log("assistant_message", msg.text.slice(0, 200), msg);
    deps.bus.event("assistant_message", msg as unknown as Record<string, unknown>);
    return msg.text;
  };
}

/** Real Claude agentic loop with the phone capabilities as tools. */
async function anthropicLoop(deps: BrainDeps, userText: string, cfg: BrainCfg, key: string): Promise<string> {
  const client = new Anthropic({ apiKey: key });
  const caps = deps.getCaps();
  const nameToMethod = new Map(caps.map((c) => [toName(c.method), c.method]));
  const tools = caps.map((c) => ({
    name: toName(c.method),
    description: `${c.summary} (sensitivity: ${c.sensitivity})`,
    input_schema: { type: "object" as const, additionalProperties: true, properties: {} },
  }));

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userText }];
  for (let step = 0; step < (cfg.maxSteps || 8); step++) {
    deps.log("llm", `thinking (step ${step + 1})`, { model: cfg.model || "claude-opus-4-8" });
    deps.bus.event("agent_status", { label: "Thinking…" });
    const resp = await client.messages.create({
      model: cfg.model || "claude-opus-4-8",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      system: cfg.system || DEFAULT_SYSTEM,
      tools,
      messages,
    });
    messages.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason !== "tool_use") {
      return resp.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n").trim()
        || "(done)";
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of resp.content) {
      if (block.type !== "tool_use") continue;
      const method = nameToMethod.get(block.name) ?? block.name;
      deps.log("tool", method, block.input);
      deps.bus.event("agent_status", { label: friendlyStatus(method) });
      const r = await deps.bus.request(method, (block.input ?? {}) as Record<string, unknown>);
      deps.log(r.status === "ok" ? "response" : "error", `${method} ${r.status}`, r.status === "ok" ? r.result : r.error);
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(r.status === "ok" ? r.result : r.error) });
    }
    messages.push({ role: "user", content: results });
  }
  return "(stopped — reached the step limit)";
}

/** No-key keyword router. Exercises the real input→tool→reply loop so the plumbing is verifiable. */
async function stubLoop(deps: BrainDeps, userText: string): Promise<string | AssistantMessage> {
  const t = userText.toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));

  // Acknowledge an attached file (Phase 7) so the send-file path is verifiable end to end.
  const fileNote = userText.match(/\[Attached file: ([^\]]+)\]/);
  if (fileNote) return `📎 Got your file — ${fileNote[1]}.`;

  // Demo trigger for the Phase 6 rich-reply pipeline (markdown + table parts). No device needed.
  if (has("demo rich", "demo parts", "rich demo")) {
    return {
      text: "Here is a rich reply: a short report and a table.",
      parts: [
        { kind: "markdown", text: "## Status report\n- battery: **100%**\n- network: _online_\n- see `panel.ts`" },
        { kind: "table", columns: ["Metric", "Value"], rows: [["Battery", "100%"], ["CPU", "42%"], ["Storage", "free"]] },
      ],
    };
  }
  const call = async (method: string, args: Record<string, unknown> = {}) => {
    deps.log("tool", method, args);
    deps.bus.event("agent_status", { label: friendlyStatus(method) });
    const r = await deps.bus.request(method, args);
    deps.log(r.status === "ok" ? "response" : "error", `${method} ${r.status}`, r.status === "ok" ? r.result : r.error);
    return r;
  };
  const methods = new Set(deps.getCaps().map((c) => c.method));
  const can = (m: string) => methods.has(m);

  if (has("photo", "picture", "camera", "selfie") && can("camera.capture")) {
    const r = await call("camera.capture", { width: 1280, height: 720 });
    return r.status === "ok" ? `📷 Took a photo — it's here in the chat and saved to your gallery.` : `Couldn't take a photo: ${JSON.stringify(r.error)}`;
  }
  if (has("screenshot", "screen") && can("ui.screenshot")) {
    const r = await call("ui.screenshot");
    return r.status === "ok" ? `🖼️ Captured a screenshot — view it in the control panel.` : `Screenshot failed: ${JSON.stringify(r.error)}`;
  }
  if (has("battery", "device", "phone info", "model", "charge") && can("device.info")) {
    const r = await call("device.info");
    if (r.status !== "ok") return `Couldn't read device info.`;
    const d = r.result as Record<string, unknown>;
    const batt = d.battery_pct != null ? `${d.battery_pct}%${d.charging ? " and charging" : ""}` : "unknown";
    return `📱 ${[d.manufacturer, d.model].filter(Boolean).join(" ")} running Android ${d.android ?? "?"}. Battery is at ${batt}.`;
  }
  if (has("flashlight", "torch", "light") && can("torch.set")) {
    const on = !has("off");
    await call("torch.set", { on });
    return `🔦 Flashlight ${on ? "on" : "off"}.`;
  }
  if (has("ring", "find my phone", "locate", "where's my phone") && can("phone.ring")) {
    await call("phone.ring", { ms: 3000 });
    return `🔔 Ringing your phone for 3 seconds.`;
  }
  if (has("location", "where am i", "gps") && can("location.get")) {
    const r = await call("location.get");
    if (r.status !== "ok") return `Couldn't get location: ${JSON.stringify(r.error)}`;
    const g = r.result as { lat?: number; lon?: number; accuracy_m?: number };
    if (g.lat != null && g.lon != null) {
      const acc = g.accuracy_m != null ? ` (±${Math.round(g.accuracy_m)}m)` : "";
      return `📍 You're at ${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}${acc}.\nhttps://maps.google.com/?q=${g.lat},${g.lon}`;
    }
    return `📍 ${JSON.stringify(g)}`;
  }
  if (has("vibrate", "buzz") && can("vibrate")) {
    await call("vibrate", { ms: 600 });
    return `📳 Buzzed.`;
  }
  if (has("home") && can("ui.global")) {
    await call("ui.global", { action: "home" });
    return `🏠 Went to the home screen.`;
  }
  // default: introduce myself + what I can do (no API key required to use the system —
  // connect your own agent for a real brain; this built-in one is just a keyword fallback).
  return `Hi — I'm the built-in basic agent (keywords, no AI model). For a real brain, connect your ` +
    `own agent on your machine (e.g. your Claude — your subscription, no API key needed). ` +
    `Meanwhile I can: "take a photo", "battery?", "flashlight on", "ring my phone", "screenshot", "where am I". ` +
    `(${deps.getCaps().length} phone tools.)`;
}
