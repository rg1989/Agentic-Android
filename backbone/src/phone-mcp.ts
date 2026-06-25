/**
 * phone-mcp — a stdio MCP server that exposes the phone's capabilities as tools, so ANY MCP host
 * (your own `claude` on a subscription, etc.) can drive the phone with **no API key in this app**.
 *
 * Each tool proxies to the hub's HTTP `POST /call`, which runs the capability on the phone and
 * returns the typed result. The hub owns the phone connection + state; this server just reaches it
 * over localhost. Tools are discovered from the hub's `GET /catalog`, so it always matches the
 * phone's real capabilities.
 *
 * Run standalone for any MCP host, or let `agent-cli.ts` spawn it as `claude`'s MCP server.
 *   Env: HUB_HTTP (default http://127.0.0.1:8123)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const HUB = process.env.HUB_HTTP ?? "http://127.0.0.1:8123";
const toolName = (m: string) => m.replace(/[^a-zA-Z0-9_]/g, "_");

interface Cap { method: string; sensitivity: string; summary: string }

async function main() {
  const caps = (await fetch(`${HUB}/catalog`).then((r) => r.json()).catch(() => [])) as Cap[];
  const server = new McpServer({ name: "phone", version: "0.1.0" });
  const nameToMethod = new Map<string, string>();

  for (const c of caps) {
    const name = toolName(c.method);
    nameToMethod.set(name, c.method);
    server.registerTool(
      name,
      {
        description: `${c.summary} (sensitivity: ${c.sensitivity}). Pass any parameters as the "args" object.`,
        inputSchema: { args: z.record(z.any()).optional() },
      },
      async ({ args }: { args?: Record<string, unknown> }) => {
        const r: any = await fetch(`${HUB}/call`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: nameToMethod.get(name), args: args ?? {} }),
        }).then((x) => x.json()).catch((e) => ({ status: "error", error: String(e) }));
        const payload = r.status === "ok" ? r.result : { error: r.error ?? r };
        return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
      },
    );
  }

  await server.connect(new StdioServerTransport());
  process.stderr.write(`phone-mcp: ${caps.length} tools, hub ${HUB}\n`);
}

void main();
