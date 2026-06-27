# Design: Agent Orchestrator via the Hub's Driver Seat

**Date:** 2026-06-27
**Status:** Approved design, revised after adversarial verification — pending spec review, then plan
**Topic:** Let an agent occupy a hub's *driver* seat (today only the phone does), so a single
orchestrator agent can see a hub's roster and delegate subtasks to the worker agents on it — by name/id,
by strength — and reply to the user with the synthesis.

> **Revision note:** §6.2's correlation, §6.2's reply routing, §2/§11's security claim, §4's multi-hub
> boot, and the self-delegation guard were all corrected after a code-grounded adversarial review found
> the first draft's queue-position correlation unsound and its localhost-binding claim false. See §13.

---

## 1. Motivation

Today:

```
phone ──relay (E2E)──▶ HUB ◀──local WS :8124── agent(s)
```

The phone occupies the hub's **north / driver seat**; one or more agents occupy the **south / brain
seat**, of which exactly one is *active* and receives the phone's messages. Siblings on the south seat do
not know about each other.

We want **a single agent the user talks to that knows about the user's other agents and can trigger
them** — an orchestrator that, on a big task, splits the work, dispatches subtasks to workers by strength,
and synthesizes one answer.

The realization that keeps this small: **the orchestrator is just an agent that occupies a hub's driver
seat.** An agent that drives a hub *is* a phone, as far as the hub is concerned. The hub already has a
driver-over-HTTP path (`POST /say`, `GET /status`); we add an *addressed* sibling (`POST /ask`), wrap it
as MCP tools, and any CLI agent becomes an orchestrator by config.

## 2. Core decision: roster access is an opt-in *tool*, not an ambient hub power

The user's constraint: workers must **not** all become orchestrators ("if it's just a sibling, every
sibling could do this, and our siblings don't know about each other").

We honor it by making delegation a **tool the orchestrator holds**, not a capability the hub grants
whoever connects. Workers A and B are ordinary brains; they were never handed the `hub` MCP server, so
they cannot enumerate or drive siblings. The orchestrator is special only because its config includes that
tool. The hub's trust model is unchanged.

> **Security — what is and isn't true (corrected).** This asymmetry is an **authoring grant**, not a
> hub-enforced boundary. And the network boundary is *not* where the first draft claimed: today
> `panel.ts` binds **all interfaces** — `server.listen(PORT, cb)` (`panel.ts:1641`) and
> `new WebSocketServer({ port: AGENT_PORT })` (`panel.ts:1171`) pass no host, so `:8123` (the phone
> driver, incl. `POST /call`) and `:8124` (the agent bus) are already reachable from the LAN/public,
> while the startup log misleadingly prints `http://127.0.0.1:8123`. `POST /ask` widens an
> already-open surface. **This design therefore includes a real fix (§6.6): default-bind `127.0.0.1`
> (`PANEL_HOST`/`AGENT_HOST`), making wide exposure an explicit opt-in for federation rather than an
> accident.** Enforced per-agent ACLs remain out of scope (§11); cross-untrusted-network federation is the
> §10 relay/paired path.

## 3. The seam: a two-verb Driver contract

```
list_agents()            -> { hub, agents: [{ id, name, description, active, connected }] }
ask_agent(agent, text)   -> { reply }        // agent = id OR name; addressed to a worker; awaits its answer
```

| Driver | Transport | Role |
|--------|-----------|------|
| **Phone** | E2E relay | the human driver (unchanged) |
| **Orchestrator** | HTTP `:8123` via the `hub` MCP server | the agent driver (this design) |
| **Orchestrator (future, §10)** | E2E relay, paired | same two verbs, untrusted networks |

Both verbs are realized hub-side, so swapping transport later (the §10 "B" upgrade) never touches the
orchestrator — it only ever sees `list_agents` / `ask_agent`.

## 4. Topology — same tool, different URL

The orchestrator reaches workers through `ask_agent` whether they share its hub or sit on another. That is
the modularity: change a base URL, not code.

```
v1 — single hub (fully works as specified):        Increment — multi-hub federation (§6.5/§6.6):

  phone ─relay─▶ HUB ◀─:8124─ orchestrator           phone ─relay─▶ HUB-0 ◀─ orchestrator
                 │  ▲ (active brain; holds                                    │ holds `hub` MCP
                 │  │  `hub` MCP → POST /ask{agent})                          ▼ (HTTP :8123 over Tailscale)
                 └──┴ A, B  (non-active siblings)                          HUB-1 ◀─:8124─ A, B
```

- **v1 single-hub (recommended start, no new infra):** the orchestrator is the *active* brain of the
  user's hub; workers A/B are connected non-active siblings on the same hub. The orchestrator's `hub` MCP
  points back at its **own** hub (`http://127.0.0.1:8123`) and delegates to A/B by id/name. Everything in
  §6.1–§6.4 + §6.6 delivers this.
- **Multi-hub increment:** workers live on a phoneless HUB-1 whose only driver is the orchestrator over
  HTTP. This needs three additional pieces, specced in §6.5/§6.6 and marked as the increment:
  1. **`startPanel(opts)` + a driver-only boot** so HUB-1 can serve `:8123`/`:8124` without an online
     phone (today `main()` hard-exits without a paired identity and blocks on `bus.connect()`; §6.5).
  2. **`PANEL_HOST`** set to the Tailscale IP so HUB-1's `:8123` is reachable cross-host (§6.6).
  3. **A hop-count loop-breaker** (§6.4), because the single-hub `activeAgentId` guard is meaningless on a
     phoneless hub (its first worker is always "active").

Recursion (orchestrators of orchestrators) is the multi-hub case applied twice; the **hop-count** is its
real stop condition.

## 5. Current code this rides on (verified 2026-06-27 against working tree)

| Anchor | Location | Role |
|--------|----------|------|
| `POST /say {text}` → await active agent's reply (60s) | `panel.ts:1520` | existing driver-over-HTTP "ask + await" (kept **unchanged**) |
| `pendingSay` single global resolver | `panel.ts:948, 1213–1218, 1529–1530` | correlates `/say` with the active agent's next reply (kept for the no-`askId` path) |
| `rosterList()` → `{id,name,active,external}` | `panel.ts:955` | per-connected-agent roster (already emits `id`) |
| `GET /status` (async via `ensurePairCode().then`) → `agents[]`, `hubName`, `pairCode` | `panel.ts:1372` | the roster + hub-identity surface (existing; we add `description`) |
| agent `hello` handler; `agents.set(id,{ws,name})` | `panel.ts:1175–1181` | external agents register raw `m.name`, **no de-dup** |
| `uniqueAgentName()` (managed agents only) | `panel.ts:1022–1024, 1043` | de-dup applies to hub-spawned agents only, never to external `hello` |
| agent `assistant_message` handler | `panel.ts:1213–1219` | today broadcasts every reply to the phone + resolves `pendingSay` |
| agent ws **`close`** handler (`agents.delete(id)`) | `panel.ts:1222–1239` | roster cleanup on disconnect (**not** 1159) |
| `select_agent` (phone) / `/agent/select` (web) / close-promotion | `panel.ts:1272 / 1425 / 1229` | the three places `activeAgentId` mutates |
| `hub_identity` / `hubName()` | `panel.ts:1250, ~210` | hub display name (new this week) |
| `main()` boot: exit if no `peerEdPub`; `await bus.connect()` | `panel.ts:904–912` | requires a paired identity + reachable relay (blocks headless) |
| HTTP / agent-WS bind (no host → all interfaces) | `panel.ts:1641 / 1171` | the §2/§6.6 bind fix targets these |
| `phone-mcp.ts` (McpServer + stdio, `registerTool`, proxies hub HTTP) | `phone-mcp.ts` | the pattern `hub-mcp.ts` mirrors |
| `mcpConfig()` / `.mcp.json` injection of `HUB_HTTP` | `agent-cli.ts:135`, `agent-omp.ts` | how CLI agents get MCP servers |
| `runAgent` `hello` send + `{t:"user"}` handling | `agent-runner.ts:57, 68–87` | where `description` is announced and where `askId` is read/echoed |
| test runner | `package.json` → `tsx --test test/*.test.ts` (node:test) | tests are `backbone/test/*.test.ts` |

## 6. The changes

### 6.1 Roster carries a one-line strength description

So the orchestrator can delegate *by strength*.

- **Announce.** Agents send optional `description` in `hello`. `agent-runner.ts:57` adds
  `description: process.env.AGENT_DESC ?? adapter.description`; `AgentAdapter` gains
  `description?: string`. `agent.ts`'s hand-rolled `hello` gets the same `AGENT_DESC`.
- **Store.** In the `hello` handler (`panel.ts:1175`), read `m.description` and store
  `agents.set(id, { ws, name, description })`; the map value grows `{ws,name}` → `{ws,name,description?}`.
  *(Optional readability: also pass external names through `uniqueAgentName()` here so two "Hermes"
  workers render as "Hermes"/"Hermes (2)" — see §6.6/F6. This does not replace `id` as the disambiguator.)*
- **Surface.** `rosterList()` (`panel.ts:955`) adds `description`; the **existing**
  `ensurePairCode().then(...)` `/status` payload at `panel.ts:1372` includes it (purely additive — this
  payload already exists; §6.1 only adds a field).

### 6.2 `POST /ask {agent, text}` — addressed, awaited, **askId-correlated**, quiet delegation

A **new** route (leaving `/say` untouched). It routes a user turn to a *named/id'd* worker, awaits that
worker's reply, and returns it — **without** broadcasting to the phone or writing a chat turn.

**Request:** `POST /ask` body `{ "agent": "<id-or-name>", "text": "<subtask>" }`, optional header
`X-Ask-Depth: <n>` (§6.4).
**Response:** `{ "reply": "..." }` or `{ "error": "...", "available": [{id,name}...] }` (4xx).

**Target resolution** (`resolveAgentId`): exact `id` wins; else case-insensitive **unique** `name`; else
404 `{error, available}` (ambiguous name → 404 listing the colliding **ids** — external agents self-name
and the remote-agent prompt literally suggests "Hermes", so collisions are *normal*, not an edge case; the
orchestrator disambiguates with the `id` that `list_agents` surfaces, §6.3/F6).

**Guards:**
- **Single-hub convenience:** if this hub has a paired phone (`cfg.peerEdPub` set) and the target ===
  `activeAgentId`, reject 400 `{error:"that agent is user-facing — delegate to a worker"}`. Skipped on a
  phoneless/driver-only hub, where the "active" agent is just whichever worker connected first (§6.4/F11).
- **Loop-breaker (all hubs):** `X-Ask-Depth > MAX_ASK_DEPTH` (default 8) → 508. This, not `activeAgentId`,
  is what stops orchestrator→orchestrator cycles across hubs.

**Correlation — by `askId`, not by queue position.** Each delegated `{t:"user"}` frame carries an
`askId`; the worker echoes it on its `assistant_message`; the delegator matches replies to jobs by
`askId`. This is the load-bearing correction: queue-position matching deterministically mis-delivers when
a turn times out and the late reply lands on the next job, and when a worker emits twice (e.g. a `/clear`
confirmation, or a preliminary-then-final brain). `agent-runner` does **not** await `runTurn`
(`agent-runner.ts:82`), so a "timed-out" turn *will* still emit — only `askId` makes that safe.

> `// ponytail: one additive field (askId). The phone/`/say` path sends none and ignores the echoed one.`
> `// ponytail: first reply bearing an askId resolves it; a brain that emits preliminary-then-final`
> `//           resolves on the preliminary. Fine — agent-cli/omp emit exactly once per turn.`

Per-agent **serialization** is still kept (one in-flight `{t:"user"}` per worker) — not for correctness
(askId handles that) but because CLI agents keep one `--resume`/`--continue` session and concurrent turns
would corrupt it. Different workers run in parallel; same worker queues.

Extracted as an **I/O-free** module `backbone/src/delegate.ts` (unit-testable without the panel/relay):

```ts
// delegate.ts — addressed, serialized, askId-correlated delegation. No sockets, no globals.
export interface DelegateDeps {
  send: (agentId: string, text: string, askId: string) => void; // MUST throw if the socket isn't OPEN
  newId: () => string;                                           // panel: randomUUID; tests: a counter
  timeoutMs?: number;                                            // default 60_000
}
interface Job { askId: string; text: string; resolve: (r: string) => void; timer: ReturnType<typeof setTimeout> | null; sent: boolean }
export function makeDelegator(deps: DelegateDeps) {
  const queues = new Map<string, Job[]>();                       // agentId -> FIFO; ≤1 `sent` job in flight
  const finish = (id: string, askId: string, reply: string) => {
    const q = queues.get(id); if (!q) return;
    const i = q.findIndex((j) => j.askId === askId); if (i < 0) return; // unknown/stale (late or dup) → ignore
    const [job] = q.splice(i, 1); if (job.timer) clearTimeout(job.timer); job.resolve(reply);
    if (q.length) pump(id); else queues.delete(id);
  };
  const pump = (id: string) => {
    const q = queues.get(id); if (!q?.length) return;
    const job = q[0]; if (job.sent) return;                      // already in flight → wait
    job.sent = true;
    try { deps.send(id, job.text, job.askId); }                  // send BEFORE arming the timer
    catch { finish(id, job.askId, "(agent disconnected)"); return; }
    job.timer = setTimeout(() => finish(id, job.askId, "(no reply within timeout)"), deps.timeoutMs ?? 60_000);
  };
  return {
    ask(id: string, text: string) {
      const askId = deps.newId();
      return new Promise<string>((resolve) => {
        const q = queues.get(id) ?? []; queues.set(id, q);
        q.push({ askId, text, resolve, timer: null, sent: false });
        pump(id);                                                // no-op if another job is in flight
      });
    },
    // true ⇒ matched an outstanding ask (caller suppresses the phone broadcast). No askId ⇒ not ours.
    onReply(id: string, askId: string | undefined, reply: string): boolean {
      if (!askId) return false;
      const q = queues.get(id); if (!q?.some((j) => j.askId === askId)) return false;
      finish(id, askId, reply); return true;
    },
    onGone(id: string) { const q = queues.get(id); if (!q) return; queues.delete(id); for (const j of q) { if (j.timer) clearTimeout(j.timer); j.resolve("(agent disconnected)"); } },
    pending(id: string) { return queues.get(id)?.length ?? 0; },
  };
}
```

**Panel wiring:**
- Construct once (throwing `send` so a closing socket fails the job fast, never rejects `/ask`):
  ```ts
  const delegator = makeDelegator({
    newId: () => randomUUID(),
    send: (id, text, askId) => {
      const a = agents.get(id);
      if (!a || a.ws.readyState !== WebSocket.OPEN) throw new Error("agent not connected");
      a.ws.send(JSON.stringify({ t: "user", text, askId }));
    },
  });
  ```
- `POST /ask`: `resolveAgentId` → guards → `const reply = await delegator.ask(targetId, text)` →
  `json({ reply })`. Log as `request`/`response`, **not** `user_message` (it is not the user's turn).
- **Reply routing keyed on `askId`, not on `activeAgentId`** (`panel.ts:1213`). This survives an
  `activeAgentId` flip mid-ask (phone `select_agent`/`/agent/select`/close-promotion):
  ```ts
  else if (topic === "assistant_message") {
    const id = (ws as any)._agentId as string | undefined;
    const askId = typeof (data as any).askId === "string" ? (data as any).askId : undefined;
    if (id && delegator.onReply(id, askId, String(data.text ?? ""))) return; // delegated → quiet
    bus.event("assistant_message", data);                                    // user-facing → unchanged
    logEvent("assistant_message", String(data.text ?? "").slice(0, 200), data);
    const parts = Array.isArray((data as any).parts) ? ((data as any).parts as MsgPart[]) : undefined;
    addTurn("assistant", String(data.text ?? ""), parts);
    pendingSay?.(String(data.text ?? "")); pendingSay = null;
  }
  ```
  A reply that echoes a live `askId` is delegated regardless of whether that agent just became active; a
  reply with no/unknown `askId` is user-facing regardless of whether the agent was just demoted. Disjoint
  by construction.
- **`close` handler (`panel.ts:1222`)**: call `delegator.onGone(id)` for the disconnecting id
  **unconditionally**, right beside the existing `if (id) agents.delete(id)` at `panel.ts:1224` — *not*
  inside the `agentSock === ws` promotion block (a worker is never active, so it would be skipped there and
  its in-flight asks would hang to timeout).
- **`select_agent`/`/agent/select` (`panel.ts:1272/1425`)**: if `delegator.pending(id) > 0`, log and
  either defer the switch or `delegator.onGone(id)` first, so a socket with outstanding delegations isn't
  silently repurposed as the user-facing brain.

**`agent-runner.ts` / `agent.ts`:** read `const askId = typeof m.askId === "string" ? m.askId : undefined`
from the inbound `{t:"user"}` frame and echo it on **both** emit sites (the `/clear|/reset|/new`
short-circuit at `agent-runner.ts:76` *and* the normal reply at `:86`):
`emit("assistant_message", { text, ...(askId ? { askId } : {}) })`. Purely additive.

> **Why a new route, not an extended `/say`:** `/say` is used by remote drivers to talk to the active
> brain and its reply *should* show in the phone chat. `/ask` is quiet, addressed, askId-correlated.
> Separate routes = zero risk to the working `/say` path; the no-askId reply path keeps `pendingSay`.

### 6.3 `backbone/src/hub-mcp.ts` — a hub's driver seat as MCP tools

New file, sibling of `phone-mcp.ts`, ~50 lines. Stdio MCP server for one hub base URL:

- **`list_agents`** (no args) → `GET {HUB}/status`, returns
  `{ hub, agents: [{ id, name, description, active, connected, kind }] }` filtered to connected agents.
  **Includes `id`** (matches §3's contract) so the model can target unambiguously when names collide.
  Reuses the existing `/status`; no new GET route.
- **`ask_agent`** `{ agent, message }` → `POST {HUB}/ask { agent, text: message }` with
  `X-Ask-Depth: <inbound+1>` (read from `ASK_DEPTH` env the parent passes, default 0), returns `reply`
  (or surfaces `{error, available}` so the model retries with a valid id/name).

Tool text: *"Delegate a subtask to a WORKER and get its answer. Call `list_agents` first; pass an agent's
`id` (preferred when names repeat) or `name`. Never target the agent marked `active` on a phone-backed
hub — that is the user-facing brain."* Env: `HUB_HTTP` (default `http://127.0.0.1:8123`), `HUB_LABEL`,
`ASK_DEPTH`.

### 6.4 Loop-breaker: `X-Ask-Depth`

`hub-mcp` increments and forwards a depth header on every `POST /ask`; the hub rejects `> MAX_ASK_DEPTH`
(default 8) with 508. This is the transport-level cycle breaker that works across hubs — unlike the
`activeAgentId` guard, which is only meaningful on a phone-backed hub (§6.2 guard #1, F11). Single-hub v1
also benefits: a misconfigured self-loop dies at depth, not by hanging.

### 6.5 `startPanel(opts)` + driver-only boot *(needed for the integration test; prerequisite for multi-hub)*

`panel.ts` currently exports nothing and `main()` hard-exits without a paired identity then blocks on
`await bus.connect()` (`panel.ts:904–912`), so neither a test harness nor a phoneless HUB-1 can boot the
servers. Extract the server construction into:

```ts
export async function startPanel(opts?: {
  identity?: Identity; relayUrl?: string; peerEdPub?: string;   // inject for tests / headless
  host?: string; httpPort?: number; agentPort?: number;
}): Promise<{ http: http.Server; agentWss: WebSocketServer; delegator: Delegator; close(): Promise<void> }>
```

- `main()` becomes a thin wrapper: load `agent.json` + cfg, call `startPanel`.
- **Driver-only / headless:** when no `peerEdPub` (or `HUB_HEADLESS=1`), skip the exit and make the relay
  connection **optional and non-fatal** — `bus` may be null; every later `bus.*` call becomes `bus?.*`,
  and the phone-facing branches (broadcast/`addTurn`/`pendingSay`) no-op. The `:8123`/`:8124` servers come
  up regardless — exactly the surface `list_agents`/`ask_agent` need. **Also gate first-agent
  auto-promotion (`panel.ts:1183`)**: on a phoneless hub, leave `activeAgentId` null so no worker is
  spuriously "active" (this is what makes §6.2 guard #1 correctly skip and §6.4 the sole loop-breaker).

v1 single-hub does not exercise headless, but the `startPanel` export is done in v1 because the §9
integration test requires it; the headless/null-bus branch is the multi-hub increment.

### 6.6 Bind to loopback by default *(security fix, v1)*

`panel.ts:1641` → `const HOST = process.env.PANEL_HOST ?? "127.0.0.1"; server.listen(PORT, HOST, () => …)`
(and fix the log to print the real `HOST`). `panel.ts:1171` →
`new WebSocketServer({ port: AGENT_PORT, host: process.env.AGENT_HOST ?? "127.0.0.1" })`. This closes the
current silent LAN/public exposure of both the phone driver and the agent bus. Multi-hub federation sets
`PANEL_HOST` to the Tailscale IP — wide binding becomes explicit opt-in, not an unbound-port accident.

### 6.7 Running an orchestrator (no new agent process)

An orchestrator is an existing CLI agent (`agent-cli`/`agent-omp`) whose MCP config adds one or more `hub`
servers. Extend the shared MCP-config construction to read `AGENT_HUBS` (`label=url,label=url`):

- `agent-cli.ts:mcpConfig()` and the `agent-omp.ts` `.mcp.json` writer add, per entry,
  `hub_<label>: { command: tsxBin(), args: [hub-mcp.ts], env: { HUB_HTTP: <url>, HUB_LABEL: <label>, ASK_DEPTH: "<inherited>" } }`.
- When `AGENT_HUBS` is set, append an orchestrator paragraph to `SYSTEM`: *"You also coordinate other
  agents. Use the `hub_*` tools: `list_agents` to see who's available and their strengths; `ask_agent` to
  delegate a subtask (by `id` when names repeat) and get its answer. For a large task, split it, delegate
  to the best-suited workers (in parallel when independent), then synthesize one reply. Never delegate to
  the agent marked active — that's you."*
- Optional: `"agent:orchestrator": "AGENT_HUBS=self=http://127.0.0.1:8123 tsx src/agent-cli.ts"`.

Reuses all existing auth, session-resume, and slash machinery. `~10` lines per CLI agent.

## 7. Data flow (single-hub v1)

1. Phone → `user_message` "plan and build X" → hub → **active** agent = orchestrator (unchanged path; no
   `askId`).
2. Orchestrator turn: `list_agents()` → `[{id:"a1",name:"A",description:"backend/SQL",active:false},
   {id:"b1",name:"B",description:"UI",active:false}, {id:"o1",name:"<self>",active:true}]`.
3. Fires `ask_agent("a1", …)` + `ask_agent("b1", …)` — independent tool calls, concurrent. Each →
   `POST /ask` → `delegator.ask` mints an `askId`, sends `{t:"user",text,askId}` to A's and B's sockets
   (separate queues → parallel).
4. A and B run; each emits `assistant_message` echoing its `askId`. The handler matches by `askId` →
   `delegator.onReply` resolves the waiting `/ask` → **quiet** (no phone broadcast, no chat turn), even if
   the phone happened to select A as active in between.
5. Each `ask_agent` resolves with its worker's reply. Orchestrator synthesizes and emits its own
   `assistant_message` (no `askId`) → user-facing → broadcast to the phone as the single answer.

## 8. Error handling & edge cases

| Case | Behavior |
|------|----------|
| Unknown / typo agent | `/ask` 404 `{error, available:[{id,name}]}`; `ask_agent` surfaces it for retry. |
| **Name collision (normal for external agents)** | 404 lists colliding **ids**; orchestrator targets by `id` from `list_agents`. |
| Target is active **on a phone-backed hub** | 400 self-delegation guard (skipped on phoneless hubs). |
| **Active flips mid-ask** (phone selects the worker) | Reply still matches its `askId` → routed to the waiter, no phone spam, no hang. `select_agent` also refuses to steal a socket with `pending>0`. |
| Orchestrator demoted before its own reply | Reply has no `askId` → falls through to user-facing broadcast (not dropped). |
| Two asks to the **same** worker | Serialized (one in flight; session safety) + askId-matched. |
| Asks to **different** workers | Separate queues → parallel. |
| **Timeout then late reply** | Timeout resolves the job by its `askId`; the late reply's `askId` is no longer outstanding → ignored (no mis-delivery). Queue advances. |
| Worker emits **twice** (`/clear` confirm, preliminary+final) | First reply bearing the `askId` resolves; the second's `askId` is gone → ignored. |
| **`send` throws / socket closing** | `pump` catches → job resolves `"(agent disconnected)"`; no leaked timer; `/ask` never rejects. |
| Worker disconnects mid-ask | `close` → `delegator.onGone(id)` rejects all its queued asks with `"(agent disconnected)"`. |
| Cross-hub cycle / runaway recursion | `X-Ask-Depth > MAX_ASK_DEPTH` → 508. |
| `/ask` to a not-connected agent | 404/503 `{error}`; the throwing `send` also fails fast. |

## 9. Testing (node:test, `backbone/test/*.test.ts`)

**Must-have — `test/delegate.test.ts`** (pure module, no panel/relay; `newId` = injectable counter,
`send` = a spy):
- single ask resolves with the reply matched by `askId`;
- two asks same id → one `send` in flight; serialized; each resolves with its own askId's reply;
- two asks different ids → both `send` immediately (parallel);
- **timeout then late reply**: ask1 times out; a later reply bearing ask1's askId is ignored; ask2 (if
  queued) still resolves with *its own* reply;
- **double emit**: a second reply with an already-resolved askId is a no-op;
- `send` throws on the 2nd job → it resolves `"(agent disconnected)"`, no pending timer, no throw;
- `onGone(id)` rejects all queued asks and clears timers; `onReply` with no/unknown askId → `false`.

**Should-have — `test/orchestrator.test.ts`** (uses **`startPanel(opts)`** from §6.5 in-process: real
`createRelay()`, a `PhoneSim` as the paired phone, two raw ws clients on the injected agent port):
- worker `hello` with `description` → appears in `GET /status` with `id` + `description`;
- `POST /ask {agent:"<id>"}` → that worker's socket gets `{t:"user",text,askId}`; it replies echoing
  `askId` → `/ask` resolves with its text; **assert `PhoneSim` received no `assistant_message`** for it;
- **active-flip**: `/ask` to B in flight → phone `select_agent(B)` → B replies → `/ask` resolves (not
  timeout) and PhoneSim still sees no broadcast for it;
- `POST /ask {agent:<active>}` on the phone-backed hub → 400; `X-Ask-Depth: 9` → 508.

**`test/hub-mcp.test.ts`:** point `hub-mcp` at a canned HTTP stub (`/status`, `/ask`); assert `list_agents`
returns the roster **with `id`**, and `ask_agent` posts `{agent,text}` + `X-Ask-Depth` and returns `reply`.

**Regression:** the full existing suite (`relay`, `e2e`, `agent-cli`, `raw-agent`, `pairing`, `protocol`,
`scheduler`, `crypto`) must still pass — `/say` and the phone path are untouched; `main()` keeps its
behavior via the `startPanel` wrapper.

## 10. The "B" upgrade path (documented, not built)

To drive a hub across an **untrusted** network, swap transport, not the orchestrator. It pairs like a real
phone (reusing the new manual pairing code to pair headlessly), runs a `BusEndpoint`, and speaks driver
events over the E2E relay. The verbs map: `list_agents` → the `agents_roster` event (now with
`description`); `ask_agent` → add an optional `agent` + `askId` to the `user_message` event and reuse the
**same** hub-side `delegator`, giving both transports identical addressed routing. Because the delegation
core (`delegate.ts`) is transport-agnostic, B is mostly a new driver client.

## 11. Out of scope (YAGNI)

- **E2E for the driver HTTP** — relies on the §6.6 loopback/Tailscale binding; §10 is the untrusted-network
  upgrade.
- **Enforced per-agent ACLs on `/ask`** — v1's asymmetry is config (who holds the `hub` tool) + the §6.6
  bind, not hub enforcement. Add ACLs only when exposing hubs you don't control.
- **A parallel fan-out engine** — the orchestrating LLM firing multiple `ask_agent` calls *is* the fan-out.
- **A third agent process** — orchestration is `AGENT_HUBS` + the existing CLI agents.
- **Changing `/say`, the phone app, or the relay protocol** in v1.

## 12. Summary of the diff

| File | Change | Size |
|------|--------|------|
| `backbone/src/delegate.ts` | **new** — I/O-free, askId-correlated, serialized delegation core | ~45 lines |
| `backbone/src/hub-mcp.ts` | **new** — `list_agents`(+id) + `ask_agent`(+X-Ask-Depth) MCP server | ~50 lines |
| `backbone/src/panel.ts` | `description` in hello/roster/`/status`; **`export startPanel(opts)` + optional/null `bus` + gated auto-promotion**; `POST /ask` + guards + `X-Ask-Depth`; wire `delegator`; **askId** reply routing (`1213`); `onGone` in `close` (`1222/1224`); `select_agent`/`/agent/select` pending-guard; **bind `127.0.0.1` by default** (`1641/1171`) | ~90 lines |
| `backbone/src/agent-runner.ts` | `description`(+`AGENT_DESC`) in `hello`; read+echo `askId` on both emit sites; `AgentAdapter.description?` | ~6 lines |
| `backbone/src/agent.ts` | `AGENT_DESC` in `hello`; read+echo `askId` | ~3 lines |
| `backbone/src/agent-cli.ts` / `agent-omp.ts` | `AGENT_HUBS` → `hub_<label>` MCP servers + orchestrator system addendum + `ASK_DEPTH` | ~10 lines each |
| `backbone/test/{delegate,orchestrator,hub-mcp}.test.ts` | new tests | — |
| `backbone/package.json` | optional `agent:orchestrator` script | 1 line |

No Android changes. No crypto. No new transport. Net new machinery: two small files; the panel grows to
host an exported, testable, optionally-headless server plus the addressed-delegation route.

## 13. Revision log (post adversarial verification, 2026-06-27)

A 4-dimension code-grounded review (`verify-orchestrator-spec`) confirmed 13 findings against the first
draft; all are folded in above:

1. **Unsound correlation (high ×2).** Queue-position matching mis-delivers on timeout-then-late-reply and
   on double-emit. → **`askId` correlation** (§6.2), relaxing the first draft's "no new fields" note.
2. **Routing keyed on `activeAgentId` (high ×2).** It can flip mid-ask → phone spam + hung ask. → route by
   **`askId` presence** (§6.2), plus a `select_agent` pending-guard.
3. **`send` hardening (medium).** Send-before-timer + try/catch + throwing (non-silent) `send` (§6.2).
4. **`onGone` placement (medium).** Must run in the `close` handler for *any* agent, not only the active
   branch (§6.2); anchor corrected to `panel.ts:1222`.
5. **`list_agents` must surface `id` (medium).** External agents self-name and collide ("Hermes"); id is
   the only stable disambiguator (§6.3/§8).
6. **Security claim false (high).** Servers bind all interfaces today. → **default loopback bind**
   `PANEL_HOST`/`AGENT_HOST` (§2/§6.6).
7. **Headless hub can't boot (high).** `main()` exits without `peerEdPub` and blocks on `bus.connect()`. →
   **`startPanel(opts)` + optional bus + gated auto-promotion** (§6.5).
8. **Self-delegation guard breaks multi-hub (high).** Phoneless HUB-1's first worker is "active". →
   **`X-Ask-Depth` loop-breaker** (§6.4); `activeAgentId` guard demoted to single-hub convenience.
9. **Integration test unbuildable (medium).** `panel.ts` had zero exports. → `startPanel` export (§6.5/§9).
10. **Typos/anchors (medium).** `ensurePailCode`→`ensurePairCode` (`1372`, payload is *existing* not new);
    close handler `1159`→`1222`.
