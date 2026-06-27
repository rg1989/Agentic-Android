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
      const agents = Array.isArray(s.agents)
        ? s.agents.filter((a: any) => a.connected && a.orchestrator !== true).map((a: any) => ({ id: a.id, name: a.name, description: a.description ?? null, active: !!a.active, kind: a.kind }))
        : [];
      return jtext({ hub: s.hubName ?? null, agents });
    },
  );

  server.registerTool(
    "ask_agent",
    { description: "Delegate a subtask to a WORKER harness on this hub and get its answer. Pass the harness's `id` (preferred when names repeat) or `name`, plus the `message`. Never target the harness marked `active` on a phone-backed hub — that is the user-facing brain.", inputSchema: { agent: z.string(), message: z.string() } },
    async ({ agent, message }: { agent: string; message: string }) => {
      const r: any = await fetch(`${HUB}/ask`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "x-ask-depth": String(depth + 1),
          ...(opts.fromId ? { "x-ask-from-id": opts.fromId } : {}),
          ...(opts.fromName ? { "x-ask-from-name": opts.fromName } : {}),
        },
        body: JSON.stringify({ agent, text: message }),
      }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
      return jtext(r.reply != null ? { reply: r.reply } : r);
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
