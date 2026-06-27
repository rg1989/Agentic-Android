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
        const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] =
          [{ type: "text" as const, text: JSON.stringify(payload) }];
        // If the phone returned an image blob (camera/screenshot), fetch its bytes and hand the model the
        // ACTUAL pixels — the JSON only carries a blob id, so without this the model is blind to the photo.
        const blobId = (payload as { blob_id?: string })?.blob_id;
        const ct = (payload as { content_type?: string })?.content_type;
        if (blobId && typeof ct === "string" && ct.startsWith("image/")) {
          try {
            const bytes = await fetch(`${HUB}/blob/${blobId}?mime=${encodeURIComponent(ct)}`).then((x) => x.arrayBuffer());
            content.unshift({ type: "image" as const, data: Buffer.from(bytes).toString("base64"), mimeType: ct });
          } catch { /* fall back to text-only — the agent still has the blob id */ }
        }
        return { content };
      },
    );
  }

  // Hub-owned scheduler (Phase 9), exposed to the key-free agent too via the hub's HTTP endpoints.
  const jtext = (r: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(r) }] });
  server.registerTool(
    "schedule",
    {
      description: "Schedule a phone action to run later (the hub owns the timer and survives restarts). Give the phone `method`, optional `args`, and either `delayMs` or `atMs` (epoch ms); `everyMs` repeats.",
      inputSchema: { method: z.string(), args: z.record(z.any()).optional(), delayMs: z.number().optional(), atMs: z.number().optional(), everyMs: z.number().optional() },
    },
    async (p: Record<string, unknown>) => jtext(await fetch(`${HUB}/schedule`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) }).then((x) => x.json()).catch((e) => ({ error: String(e) }))),
  );
  server.registerTool(
    "list_scheduled",
    { description: "List pending scheduled tasks.", inputSchema: {} },
    async () => jtext(await fetch(`${HUB}/scheduled`).then((x) => x.json()).catch((e) => ({ error: String(e) }))),
  );
  server.registerTool(
    "cancel_scheduled",
    { description: "Cancel a scheduled task by id.", inputSchema: { id: z.string() } },
    async (p: { id: string }) => jtext(await fetch(`${HUB}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) }).then((x) => x.json()).catch((e) => ({ error: String(e) }))),
  );

  await server.connect(new StdioServerTransport());
  process.stderr.write(`phone-mcp: ${caps.length + 3} tools, hub ${HUB}\n`);
}

void main();
