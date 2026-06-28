/**
 * hub-mcp — a stdio MCP server that exposes ONE hub's driver seat as tools, so any CLI agent becomes an
 * orchestrator: `list_agents` (who's on the hub + their strengths) and `ask_agent` (delegate a subtask to
 * a worker and get its answer). Proxies the hub's HTTP `GET /status` + `POST /ask` over localhost/Tailscale.
 *
 * Run standalone, or let agent-cli / agent-omp spawn it (one per hub) from AGENT_HUBS.
 *   Env: HUB_HTTP (default http://127.0.0.1:8123), HUB_LABEL, ASK_DEPTH (incoming hop count).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";

export function makeHubMcpServer(opts: { hubHttp: string; askDepth?: number; label?: string; fromId?: string; fromName?: string }): McpServer {
  const HUB = opts.hubHttp;
  const depth = opts.askDepth ?? 0;
  const server = new McpServer({ name: opts.label ? `hub:${opts.label}` : "hub", version: "0.1.0" });
  const jtext = (r: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(r) }] });

  server.registerTool(
    "list_agents",
    { description: "List the worker harnesses on this hub and their strengths. Returns id, name, description, active, kind. Prefer a harness's `id` when two share a name. Call this before ask_agent.", inputSchema: {} },
    async () => {
      const s: any = await fetch(`${HUB}/status`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
      // Show every connected harness EXCEPT the driver-seat (active) one — that's the caller itself, and
      // the hub 400s any attempt to delegate to it (positional loop prevention).
      const agents = Array.isArray(s.agents)
        ? s.agents.filter((a: any) => a.connected && a.active !== true).map((a: any) => ({ id: a.id, name: a.name, description: a.description ?? null, active: !!a.active, kind: a.kind }))
        : [];
      return jtext({ hub: s.hubName ?? null, agents });
    },
  );

  // One delegation → the hub's /ask (which queues per-worker and replies by askId).
  const askOne = async (agent: string, message: string): Promise<unknown> =>
    fetch(`${HUB}/ask`, {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-ask-depth": String(depth + 1),
        ...(opts.fromId ? { "x-ask-from-id": opts.fromId } : {}),
        ...(opts.fromName ? { "x-ask-from-name": opts.fromName } : {}),
      },
      body: JSON.stringify({ agent, text: message }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e) }));

  server.registerTool(
    "ask_agent",
    { description: "Delegate a subtask to a WORKER harness on this hub and get its answer. Pass the harness's `id` (preferred when names repeat) or `name`, plus the `message`. Never target the harness marked `active` on a phone-backed hub — that is the user-facing brain. To delegate to SEVERAL harnesses AT THE SAME TIME, use ask_agents instead — one ask_agent call blocks until its answer returns.", inputSchema: { agent: z.string(), message: z.string() } },
    async ({ agent, message }: { agent: string; message: string }) => {
      const r: any = await askOne(agent, message);
      return jtext(r.reply != null ? { reply: r.reply } : r);
    },
  );

  server.registerTool(
    "ask_agents",
    { description: "Delegate to SEVERAL worker harnesses AT ONCE, in parallel, and get all answers together. Use this (not repeated ask_agent calls) whenever the subtasks are independent — the harnesses then work simultaneously instead of one-after-another. Pass `tasks`: a list of {agent, message}. Returns a list of {agent, reply}.", inputSchema: { tasks: z.array(z.object({ agent: z.string(), message: z.string() })).min(1) } },
    async ({ tasks }: { tasks: { agent: string; message: string }[] }) => {
      const results = await Promise.all(tasks.map(async (t) => {
        const r: any = await askOne(t.agent, t.message);
        return { agent: t.agent, reply: r.reply != null ? r.reply : (r.error ?? r) };
      }));
      return jtext({ results });
    },
  );

  return server;
}

async function main() {
  const hubHttp = process.env.HUB_HTTP ?? "http://127.0.0.1:8123";
  const server = makeHubMcpServer({ hubHttp, askDepth: Number(process.env.ASK_DEPTH ?? 0), label: process.env.HUB_LABEL, fromId: process.env.FROM_ID, fromName: process.env.FROM_NAME });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`hub-mcp: hub ${hubHttp}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { void main(); }
