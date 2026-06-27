# Plan — Web chat page + agent-as-orchestrator (resumable)

**Status:** Quick Launch deleted (done). Chat page + agent dropdown = NOT built yet.
**Owner-facing goal:** open a chat **session** in the web UI with any agent, optionally **as an
orchestrator** (it can then delegate to the other, regular agents). This replaces the old hardcoded
"Quick launch · orchestrator & workers" section entirely.

This doc is written so a fresh session can pick it up cold. Read it top-to-bottom.

---

## 0. The decision: what chat page are we building?

**Hand-rolled, no library.** A chat page here is a scrolling message list + a textarea + a `fetch()`
loop — ~150 lines of vanilla HTML/JS in the exact `panel.ts` template-literal style. Reasons a library
(incl. Deep Chat) lost:

- The hub is deliberately **no build step, no deps, server-rendered template literals**. A vendored
  web-component bundle means shipping a few-hundred-KB opaque blob + a new `GET /public/*` static route
  the hub doesn't have. For an MVP that's *more* moving parts, not fewer.
- The features a library gives "free" don't pay off here: file upload + streaming are **deferred**
  (Phase D); markdown is the one real win and it's small (ship `white-space: pre-wrap` first, add a
  tiny markdown pass when it reads badly); and the parts that are actually custom — the agent dropdown,
  Regular/Orchestrator mode — live *outside* any widget anyway.
- The phone app already covers rich attachments/voice. Reach for a library only if we later need that
  *in the browser specifically*; the hand-rolled page is the lazy + coherent choice now.

---

## 1. The orchestration model (this is the important part)

### The one architectural truth
**"Orchestrator" is a launch-time property, not a runtime toggle.** An agent becomes an orchestrator
because its process was started with `AGENT_HUBS=self=http://127.0.0.1:8123`, which makes
`agent-runner` wire in the `hub` MCP server (`list_agents` / `ask_agent`) + an orchestration system
prompt. You cannot flip a *running* agent into orchestrator mode — the tool is injected at spawn.

Consequence — **"mode" is a property of an agent instance/session start, not a live switch:**
- **Local agents** (Claude / omp / any local CLI): the hub *can* start an orchestrator instance on
  demand → `spawnAgent(kind, { orchestrator: true })` already exists (`backbone/src/panel.ts`). So
  "open agent X as orchestrator" = spawn X with the flag, then point the chat session at it.
- **Remote / external agents** (e.g. a Hermes on a cloud box that dials in itself): the hub *cannot*
  reach in and add the tool. Such an agent is an orchestrator only if **it** connected as one. UI must
  *reflect* this, not pretend it can toggle it. → see open question Q1.

### The two modes, concretely
Every agent the user interacts with is started in one of two modes:
- **Regular** — answers its own turns; no `hub` tool. The default.
- **Orchestrator** — same agent + the `hub` tool + orchestration prompt; can `list_agents` and
  `ask_agent` the **regular** agents to delegate subtasks.

### Loop prevention (user's rule: an orchestrator cannot control another orchestrator)
Three layers, two already exist:
1. **(exists)** Hop-depth limit — `/ask` rejects past `MAX_ASK_DEPTH` (8) with `508`
   (`backbone/src/panel.ts`, header `x-ask-depth`).
2. **(exists)** Self-delegation guard — `/ask` 400s when target is the active phone-facing agent.
3. **(NEW — build this)** Orchestrators are invisible to each other:
   - Roster (`/status`) gains `orchestrator: boolean` per agent.
   - `hub-mcp` `list_agents` **filters out** agents where `orchestrator === true` (an orchestrator
     only ever sees regular agents as delegation targets).
   - `/ask` returns `409` if the resolved target is an orchestrator (defense in depth).

This is small and makes the user's "no orchestrator-controls-orchestrator → no weird loops" guarantee
explicit on top of the existing depth cap.

---

## 2. Where this lives in the UI

The agent dropdown + mode selector belongs in the **chat page's "new session" control**, NOT on
Connections. Connections is now just *Your agents* + *Pair your phone*.

New-session control (top of `/chat`):
- **Agent dropdown** — populated from `/status` (connected agents), **default = first active agent**.
- **Mode** — `Regular | Orchestrator` (segmented control or a checkbox "as orchestrator").
- **[ New session ]** — opens a chat thread bound to (agent, mode).
- A small `ⓘ` tooltip (reuse the existing `.info` CSS, kept in `SETUP_PAGE`) explaining orchestrator
  mode.

Behaviour when "Orchestrator" is chosen:
- Target is a **local** agent → ensure an orchestrator instance is running
  (`spawnAgent(kind,{orchestrator:true})` if not already), bind the session to it.
- Target is a **remote** agent already connected as an orchestrator → just bind.
- Target is a **remote** agent NOT an orchestrator → disabled with a hint (see Q1).

---

## 3. Backend work (endpoints + hub changes)

All in `backbone/src/panel.ts` unless noted. What already exists vs. what's new:

| Need | Exists? | Action |
|------|---------|--------|
| Mark orchestrators in roster | no | Add `orchestrator` to each `/status` agent. Managed: store on the `managed` map from spawn opts. External: from `m.orchestrator` in the agent's `hello` (agent-runner sets it when `AGENT_HUBS` present). |
| `list_agents` hides orchestrators | no | In `backbone/src/hub-mcp.ts`, filter `a.orchestrator !== true`. |
| `/ask` rejects orchestrator targets | no | After `resolveAgentId`, `409` if the resolved target is an orchestrator. |
| Chat send | **reuse `/say`** | Web chat talks to whoever's in the **driver seat** (active agent) via the existing, tested `/say`. The dropdown's job is to *put the chosen agent in the driver seat* (`/agent/select`), in the chosen mode. No new send endpoint, no `/public` route, no library. |
| Launch agent as orchestrator on demand | yes | `spawnAgent(kind,{orchestrator:true})` + `/agent/start` already accept `orchestrator`. Orchestrator mode for a regular local agent = spawn an orchestrator sibling via `/agent/start`, poll `/status` until it connects, `/agent/select` it. |
| Sessions sidebar / history replay | deferred | Phase D. Browser chat starts empty per load for now (`/say` still records turns via `addTurn`). |
| File upload, streaming | deferred | Phase D. |

---

## 4. Build phases (each independently shippable + testable)

**Phase A — orchestration plumbing (backend only, no chat needed).**
- Add `orchestrator` to the roster + `hello`.
- `hub-mcp.list_agents` filters orchestrators; `/ask` 409s on orchestrator targets.
- Tests: extend `backbone/test/hub-mcp.test.ts` + `orchestrator-hubs.test.ts` — an orchestrator's
  `list_agents` omits other orchestrators; `/ask` to an orchestrator → 409.
- Verifiable today: start two orchestrators + one worker, confirm neither orchestrator can see/ask the
  other (curl `/status`, `/ask`).

**Phase B — chat page MVP (hand-rolled, active agent, non-streaming).**
- Rebuild `/chat` (currently a placeholder via `shellDoc`) into a real chat: a scrolling message list,
  a textarea + Send, talking to the **active agent** via the existing `POST /say`.
- Render replies as escaped text with `white-space: pre-wrap` (markdown deferred). Disable input while
  awaiting; show an empty-state when no agent is connected.
- Verify: type a message in the browser, get the active agent's reply rendered.

**Phase C — agent dropdown + regular/orchestrator.**
- Add the new-session control above the message list: agent dropdown (from `/status`, **default = the
  active agent, else first connected**) + a Regular|Orchestrator segmented control.
- Picking (agent, mode) binds the driver seat: **Regular** → `POST /agent/select`. **Orchestrator** →
  if the agent is already an orchestrator, select it; if it's a local/managed agent, `POST /agent/start
  {type:kind, orchestrator:true}`, poll `/status` until it connects, then select it. The original
  regular agent stays connected as a delegation target.
- **Q1:** Orchestrator is **disabled with a hint** for a remote/external agent that isn't already an
  orchestrator (the hub can't reach in to add the tool).
- Verify: open a session with an agent as orchestrator; ask it something spanning two workers; it
  delegates (quiet sub-answers) and replies once.

**Phase D — sessions sidebar, file uploads, streaming (later).**
- Wire Deep Chat history to the hub session HTTP routes (one store shared with the phone).
- `POST /chat/upload` → path → included in send.
- Streaming via `claude -p --output-format stream-json` + Deep Chat `stream` mode. Optional.

---

## 5. Open questions — RESOLVED (decided for this loop)

- **Q1 — remote agents + orchestrator mode.** RESOLVED → **disabled + hint** ("remote agent — start it
  with `AGENT_HUBS` on its host to use it as an orchestrator"). Copy-paste relaunch command is a later
  nicety.
- **Q2 — streaming.** RESOLVED → **later (Phase D)**. Non-streaming `/say` ships first.
- **Q3 — one session store.** RESOLVED → **shared, deferred.** Web reuses `addTurn` (so turns land in
  the same store), but the session *sidebar / history replay* in the browser is Phase D.

---

## 8. Stop criteria (definition of done — the loop ends when ALL are green)

This loop is **done** when every box below passes. Run the checks; don't stop early.

**A — orchestration plumbing**
- [ ] `GET /status` returns `orchestrator: boolean` on every agent entry (connected + managed-starting).
- [ ] An agent launched with `AGENT_HUBS` declares `orchestrator:true` in its `hello`; managed
      orchestrators (spawned with `{orchestrator:true}`) report `orchestrator:true` too.
- [ ] `hub-mcp` `list_agents` omits agents where `orchestrator === true`.
- [ ] `POST /ask` returns **409** when the resolved target is an orchestrator.
- [ ] New/updated tests cover both: `list_agents` hides orchestrators; `/ask`→orchestrator is 409.

**B — chat page**
- [ ] `GET /chat` renders a working chat (message list + composer) in the app shell, no library, no new
      static route.
- [ ] Sending a message POSTs `/say`, appends the user bubble + the active agent's reply; input is
      disabled while awaiting; replies render with `white-space: pre-wrap` (escaped).
- [ ] Empty-state shown when no agent is connected.

**C — dropdown + modes**
- [ ] New-session control: agent dropdown (default = active agent, else first connected) + Regular|
      Orchestrator segmented control.
- [ ] Regular → `/agent/select`. Orchestrator(local) → ensure an orchestrator instance (reuse if one
      already exists, else `/agent/start {orchestrator:true}` + poll `/status` + select).
- [ ] Orchestrator disabled + hint for a remote/external non-orchestrator agent.

**Global gates (must hold at the end)**
- [ ] `pnpm -C backbone typecheck` exits 0.
- [ ] `pnpm -C backbone test` — all green (no regressions; new tests included).
- [ ] Hub boots; `GET /chat` is HTTP 200; a manual `curl /say` round-trips a reply with a live agent.
- [ ] Phase D items (sessions sidebar, uploads, streaming, markdown) are explicitly **out of scope**
      and left as Phase D — not half-built.

---

## 6. Key files / anchors (for a cold start)

- `backbone/src/panel.ts` — the hub. `PAGE` (Control Panel), `SETUP_PAGE` (Connections), `shellDoc`
  (Chat/Settings + sidebar shell), routes (`/status`, `/ask`, `/say`, `/agent/start`, `/chat`,
  `/settings`), `spawnAgent` (has `orchestrator`/`desc`), `managed` map, session funcs.
- `backbone/src/hub-mcp.ts` — `list_agents` / `ask_agent` (the orchestrator's tools).
- `backbone/src/agent-runner.ts` — `buildHubServers` turns `AGENT_HUBS` into the `hub` MCP server;
  `hello` payload (add `orchestrator` flag here).
- `backbone/src/delegate.ts` — addressed, askId-correlated delegation core.
- `backbone/src/agent-cli.ts` / `agent-omp.ts` — the `AGENT_HUBS` → orchestration prompt wiring.
- `docs/orchestration.md` — the driver/brain contract (`list_agents` + `ask_agent`).

## 7. Already done (don't redo)

- App shell: shared sidebar (Control Panel / Connections / Chat / Settings) wraps every page.
- Connections = single centered column: *Your agents* + *Pair your phone*. Quick Launch deleted.
- `spawnAgent` + `/agent/start` accept `orchestrator` (sets `AGENT_HUBS=self`) and `desc` (`AGENT_DESC`).
- `hub-mcp` (`list_agents`/`ask_agent`), `AGENT_HUBS` wiring, hop-depth + self-delegation guards.

### Built + verified this pass (Phases A, B, C — DONE)

- **Phase A — orchestration plumbing.** `agent-runner` hello now sends `orchestrator:!!AGENT_HUBS`;
  `panel.ts` tracks it (managed map authoritative, else hello flag) via `isOrchestrator(id)`; `/status`
  carries `orchestrator` on every agent; `hub-mcp.list_agents` filters orchestrators; `POST /ask`
  returns **409** on an orchestrator target. Tests added in `hub-mcp.test.ts` + `orchestrator-ask.test.ts`.
- **Phase B — chat page (hand-rolled).** `GET /chat` is a real chat (`CHAT_BODY` + `CHAT_CSS` in
  `panel.ts`): dropdown + Regular|Orchestrator header, scrolling bubbles, composer → `POST /say`.
  Escaped `pre-wrap` text, busy-disable, adaptive empty-state. No library, no new static route.
- **Phase C — dropdown + modes.** Default = active agent else first connected. Regular → `/agent/select`.
  Orchestrator(local) → reuse-or-spawn an orchestrator sibling (`/agent/start{orchestrator:true}` →
  poll `/status` → `/agent/select`). Orchestrator disabled+hint for remote/external non-orchestrators.
- **Verified:** typecheck 0, 71/71 tests, hub boots, `/chat` 200; live CDP drive — regular send renders
  user+bot bubbles; orchestrator-mode send spawned the sibling, seated it, original stayed a worker;
  `/ask`→orchestrator = 409.

### Still Phase D (out of scope, not started)
- Sessions sidebar / history replay in the browser, file uploads, streaming, markdown rendering.
