import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { makeHubMcpServer } from "../src/hub-mcp.ts";

let stub: http.Server; let base: string; let lastAsk: { body: any; depth?: string } | null = null;

before(async () => {
  stub = http.createServer((req, res) => {
    if (req.url === "/status") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ hubName: "testhub", agents: [
        { id: "a1", name: "A", description: "backend", active: false, connected: true, kind: "external" },
        { id: "b1", name: "B", active: true, connected: true, kind: "external" },
        { id: "c1", name: "C", active: false, connected: false, kind: "managed" },
        { id: "o1", name: "Orch", active: false, connected: true, kind: "managed", orchestrator: true },
      ] }));
      return;
    }
    if (req.url === "/ask" && req.method === "POST") {
      let b = ""; req.on("data", (c) => (b += c));
      req.on("end", () => { lastAsk = { body: JSON.parse(b || "{}"), depth: req.headers["x-ask-depth"] as string }; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ reply: "done by " + JSON.parse(b || "{}").agent })); });
      return;
    }
    res.statusCode = 404; res.end("{}");
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(stub.address() as any).port}`;
});
after(() => stub.close());

async function client(askDepth = 0) {
  const server = makeHubMcpServer({ hubHttp: base, askDepth });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), c.connect(b)]);
  return c;
}
const txt = (r: any) => JSON.parse((r.content as any)[0].text);

test("list_agents returns CONNECTED agents with id + description + hub name", async () => {
  const c = await client();
  const r = txt(await c.callTool({ name: "list_agents", arguments: {} }));
  assert.equal(r.hub, "testhub");
  assert.deepEqual(r.agents.map((a: any) => a.id).sort(), ["a1", "o1"]); // c1 not connected; b1 is the active driver seat
  assert.equal(r.agents.find((a: any) => a.id === "a1").description, "backend");
});

test("list_agents hides the driver-seat (active) agent, shows everyone else who can delegate", async () => {
  const c = await client();
  const r = txt(await c.callTool({ name: "list_agents", arguments: {} }));
  assert.equal(r.agents.find((a: any) => a.id === "b1"), undefined); // b1 is active → it's the caller, can't delegate to itself
  assert.ok(r.agents.find((a: any) => a.id === "o1"), "a non-active orchestrator is now a valid worker target");
});

test("ask_agent posts {agent,text} with incremented X-Ask-Depth and returns reply", async () => {
  const c = await client(2);
  const r = txt(await c.callTool({ name: "ask_agent", arguments: { agent: "a1", message: "do X" } }));
  assert.equal(r.reply, "done by a1");
  assert.deepEqual(lastAsk?.body, { agent: "a1", text: "do X" });
  assert.equal(lastAsk?.depth, "3");
});
