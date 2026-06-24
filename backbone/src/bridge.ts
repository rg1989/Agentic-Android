/**
 * Bridge — the agent-side daemon (Q3). One local process doing double duty:
 *   - OUTBOUND: an MCP server whose tools are derived from the phone's advertised capability catalog.
 *     An LLM agent (Claude Code / any MCP host) calls a tool -> bridge forwards a `request` to the
 *     phone -> returns the typed `response` as the tool result (errors included, so the agent can
 *     observe & recover — Q10).
 *   - INBOUND: holds the relay connection; on a phone `event`, drives the agent via `agentRunner`
 *     (prod: spawn `claude -p "<event>" --resume <session>`; here: an injectable function).
 *   - SCHEDULER: deferred actions (Q6). The always-on bridge holds the timer; on fire it sends the
 *     request to the phone, then wakes the agent with the result as a `task.result` event.
 *
 * Non-MCP agents skip the MCP server entirely and speak the raw bus via BusEndpoint.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { BusEndpoint } from "./peer.ts";
import { type Identity } from "./crypto.ts";
import { type EventMsg } from "./protocol.ts";

export type AgentRunner = (event: { topic: string; data: Record<string, unknown> }) => void | Promise<void>;

export interface CatalogEntry {
  method: string;
  sensitivity: string;
  summary: string;
}

export interface BridgeOptions {
  self: Identity;
  peerEdPub: string;
  relayUrl: string;
  /** Drives the agent on inbound events. Default just logs. */
  agentRunner?: AgentRunner;
}

const methodToTool = (m: string) => m.replace(/[^a-zA-Z0-9_-]/g, "_");

export class Bridge {
  readonly bus: BusEndpoint;
  readonly mcp: McpServer;
  private readonly agentRunner: AgentRunner;
  catalog: CatalogEntry[] = [];
  private taskSeq = 0;
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(opts: BridgeOptions) {
    this.agentRunner = opts.agentRunner ?? ((e) => console.error("[agent woken]", e.topic, JSON.stringify(e.data)));
    this.bus = new BusEndpoint({ self: opts.self, peerEdPub: opts.peerEdPub, relayUrl: opts.relayUrl });
    this.bus.onEvent((ev: EventMsg) => void this.agentRunner({ topic: ev.topic, data: ev.data }));
    this.mcp = new McpServer({ name: "agentic-android", version: "0.1.0" });
  }

  /** Connect to the relay, fetch the phone's catalog, and build MCP tools from it. */
  async start(): Promise<void> {
    await this.bus.connect();
    const resp = await this.bus.request("list_capabilities", {});
    if (resp.status !== "ok") throw new Error("failed to fetch capability catalog");
    this.catalog = (resp.result as { capabilities: CatalogEntry[] }).capabilities;
    for (const cap of this.catalog) this.registerCapabilityTool(cap);
    this.registerScheduleTool();
    this.registerBlobTool();
  }

  /** Expose the MCP server over a transport (stdio in prod; InMemory in tests). */
  async connectMcp(transport: Transport): Promise<void> {
    await this.mcp.connect(transport);
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    await this.mcp.close().catch(() => {});
    this.bus.close();
  }

  private registerCapabilityTool(cap: CatalogEntry) {
    this.mcp.registerTool(
      methodToTool(cap.method),
      {
        title: cap.method,
        description: `${cap.summary} (sensitivity: ${cap.sensitivity})`,
        inputSchema: { args: z.record(z.any()).optional().describe("capability parameters") },
      },
      async ({ args }) => {
        const resp = await this.bus.request(cap.method, (args ?? {}) as Record<string, unknown>);
        const payload = resp.status === "ok" ? { status: "ok", result: resp.result } : { status: "error", error: resp.error };
        return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: resp.status === "error" };
      },
    );
  }

  private registerScheduleTool() {
    this.mcp.registerTool(
      "schedule",
      {
        title: "schedule",
        description: "Run a phone action after a delay. Returns immediately; the result arrives later as a task.result event that wakes you.",
        inputSchema: {
          delay_ms: z.number().int().nonnegative(),
          method: z.string(),
          args: z.record(z.any()).optional(),
        },
      },
      async ({ delay_ms, method, args }) => {
        const taskId = `task_${++this.taskSeq}`;
        const timer = setTimeout(async () => {
          this.timers.delete(timer);
          try {
            const resp = await this.bus.request(method, (args ?? {}) as Record<string, unknown>);
            await this.agentRunner({
              topic: "task.result",
              data: { task_id: taskId, method, status: resp.status, result: resp.result, error: resp.error },
            });
          } catch (e) {
            await this.agentRunner({ topic: "task.result", data: { task_id: taskId, method, status: "error", error: { code: "DISPATCH_FAILED", message: String(e) } } });
          }
        }, delay_ms);
        this.timers.add(timer);
        return { content: [{ type: "text", text: JSON.stringify({ scheduled: true, task_id: taskId, fires_in_ms: delay_ms }) }] };
      },
    );
  }

  private registerBlobTool() {
    this.mcp.registerTool(
      "get_blob",
      {
        title: "get_blob",
        description: "Fetch and decrypt an out-of-band media blob (e.g. a photo) by id. Returns base64 bytes.",
        inputSchema: { blob_id: z.string() },
      },
      async ({ blob_id }) => {
        const bytes = await this.bus.getBlob(blob_id);
        return { content: [{ type: "text", text: JSON.stringify({ blob_id, size: bytes.length, base64: Buffer.from(bytes).toString("base64") }) }] };
      },
    );
  }
}

// ---------- runnable entrypoint: `pnpm bridge` (an MCP server for Claude Code) ----------
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { generateIdentity, ready as cryptoReady, fingerprint } from "./crypto.ts";

interface BridgeConfig {
  self: Identity;
  peerEdPub?: string; // set after pairing with the phone
  relayUrl: string;
  agentResumeId?: string; // Claude Code session id for --resume continuity (Q9)
}

function configPath(): string {
  const dir = process.env.AGENTIC_HOME ?? path.join(os.homedir(), ".agentic-android");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "agent.json");
}

/** Spawn `claude -p` to drive the agent on an inbound phone event (Mode 1, Q9). */
function claudeAgentRunner(cfg: BridgeConfig): AgentRunner {
  return (event) => {
    const prompt = `[phone:${event.topic}] ${JSON.stringify(event.data)}`;
    const args = ["-p", prompt];
    if (cfg.agentResumeId) args.push("--resume", cfg.agentResumeId);
    // Mark: Mode-1 spawn-per-event. Upgrade path = a warm Agent-SDK loop for low-latency voice.
    const child = spawn("claude", args, { stdio: "ignore", detached: true });
    child.on("error", (e) => console.error("[agentRunner] failed to spawn claude:", e.message));
    child.unref();
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await cryptoReady();
  const cp = configPath();

  if (!fs.existsSync(cp)) {
    const self = generateIdentity();
    const relayUrl = process.env.RELAY_URL ?? "http://127.0.0.1:8787";
    fs.writeFileSync(cp, JSON.stringify({ self, relayUrl } satisfies BridgeConfig, null, 2));
    const payload = Buffer.from(JSON.stringify({ edPub: self.edPub, fp: self.fp, relayUrl })).toString("base64");
    console.error("No pairing yet. Scan this on the phone (Pair Agent), then paste the phone's edPub into", cp, "as `peerEdPub`:\n");
    console.error("  PAIR:" + payload + "\n");
    process.exit(0);
  }

  const cfg = JSON.parse(fs.readFileSync(cp, "utf8")) as BridgeConfig;
  if (!cfg.peerEdPub) {
    console.error("Config has no `peerEdPub` yet — finish pairing with the phone first. See", cp);
    process.exit(1);
  }
  console.error(`bridge: agent ${cfg.self.fp.slice(0, 12)}… paired with phone ${fingerprint(cfg.peerEdPub).slice(0, 12)}… via ${cfg.relayUrl}`);

  const bridge = new Bridge({ self: cfg.self, peerEdPub: cfg.peerEdPub, relayUrl: cfg.relayUrl, agentRunner: claudeAgentRunner(cfg) });
  await bridge.start();
  await bridge.connectMcp(new StdioServerTransport());
  console.error(`bridge: MCP server ready over stdio; ${bridge.catalog.length} phone capabilities exposed as tools.`);
}
