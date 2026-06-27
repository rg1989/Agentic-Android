import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHubServers } from "../src/agent-runner.ts";

test("parses AGENT_HUBS into hub_<label> servers", () => {
  const s = buildHubServers("self=http://127.0.0.1:8123,cloud=http://box:8123", "/bin/tsx", "/x/hub-mcp.ts");
  assert.deepEqual(Object.keys(s).sort(), ["hub_cloud", "hub_self"]);
  assert.deepEqual(s.hub_self.env, { HUB_HTTP: "http://127.0.0.1:8123", HUB_LABEL: "self", ASK_DEPTH: "0" });
  assert.equal(s.hub_self.args[0], "/x/hub-mcp.ts");
  assert.equal(s.hub_self.command, "/bin/tsx");
});

test("empty / malformed AGENT_HUBS yields no servers", () => {
  assert.deepEqual(buildHubServers(undefined, "tsx", "h"), {});
  assert.deepEqual(buildHubServers("  ,nourl=,=nolabel", "tsx", "h"), {});
});
