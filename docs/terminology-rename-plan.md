# Terminology Rename Plan — agent → harness

_Date: 2026-06-27_

Reconciles the per-surface terminology audit with adversarial verdicts. A `should-keep`
verdict moves the occurrence to **Leave as-is**; an `ask-user` / ambiguous verdict moves it to
**Open questions**; only `confirm-rename` (and non-risky renames) land in the apply-ready tables.

Vocabulary: **Harness** = the connected AI framework/CLI the user installs, pairs, and picks
(Claude Code, Hermes, OMP, Cursor, Codex, your own script). **Agent** = something a harness
spins up internally. **Sub-agent** = something an agent spins up. **Orchestrator / worker /
active** = roles a harness plays. See `CONTEXT.md` for the glossary.

Global consistency rule applied: a connected participant (roster entry, worker, the thing you
install/pair/pick, a hub-spawned or dial-in CLI) is a HARNESS in every file. Where two finders
disagreed on the same concept, the ruling was resolved toward the glossary and noted.

---

## Tier A — user-facing copy (apply-ready)

| file:line | current | proposed |
|---|---|---|
| backbone/src/panel.ts:395 | `aria-label="Agent"` (chat harness selector) | `aria-label="Harness"` |
| backbone/src/panel.ts:396 | `aria-label="Agent mode"` | `aria-label="Harness mode"` |
| backbone/src/panel.ts:411 | `placeholder="Message the agent…"` | `placeholder="Message the harness…"` |
| backbone/src/panel.ts:423 | `…plus the internal subagents an agent reports about itself.` | `…plus the internal sub-agents a harness reports about itself.` (rename the reporter "agent"→"harness"; keep "sub-agents") |
| backbone/src/panel.ts:542 | `agent → relay … → phone · N capabilities` | `harness → relay … → phone · N capabilities` |
| backbone/src/panel.ts:546 | `<label>Agent</label>` (preset selector) | `<label>Harness</label>` |
| backbone/src/panel.ts:814 | `Link your phone and your agents to this hub.` | `Link your phone and your harnesses to this hub.` |
| backbone/src/panel.ts:823 | `<h2>Your agents</h2>` | `<h2>Your harnesses</h2>` |
| backbone/src/panel.ts:824 | `Agents are the brains that talk to you and act on your phone. Connect one or several — then switch between them anytime…` | `Harnesses are the brains that talk to you and act on your phone. Connect one or several — then switch between them anytime…` |
| backbone/src/panel.ts:827 | `Add an agent` | `Add a harness` |
| backbone/src/panel.ts:830 | `Open-source coding agent. Full phone control via MCP.` | `Open-source coding harness. Full phone control via MCP.` |
| backbone/src/panel.ts:832 | `Other local agent` | `Other local harness` |
| backbone/src/panel.ts:833 | `Remote / cloud agent` | `Remote / cloud harness` |
| backbone/src/panel.ts:841 | `a remote agent connects itself. Send the prompt below to your cloud agent` | `a remote harness connects itself. Send the prompt below to your cloud harness` |
| backbone/src/panel.ts:843 | `Waiting for a remote agent to connect…` | `Waiting for a remote harness to connect…` |
| backbone/src/panel.ts:845 | `Add agent` (button) | `Add harness` |
| backbone/src/panel.ts:970 | `Cloud / external agent — it connected to this hub on its own…` | `Cloud / external harness — it connected to this hub on its own…` |
| backbone/src/panel.ts:985 | `No agents connected yet — add one below.` | `No harnesses connected yet — add one below.` |
| backbone/src/panel.ts:995 | `No agent connected` | `No harness connected` |
| backbone/src/panel.ts:1006 | `N remote/external agent(s) connected — pick one in the list above to make it active.` | `N remote/external harness(es) connected — pick one in the list above to make it active.` |
| backbone/src/panel.ts:1007 | `remote/external agent connected — pick one in the list above to make it active` | `remote/external harness connected — pick one in the list above to make it active` |
| backbone/src/panel.ts:1111 | `${row("bolt", "Agent socket", s.agentSocket)}` | `${row("bolt", "Harness socket", s.agentSocket)}` (label only; field stays Tier C) |
| backbone/src/panel.ts:1120 | `Limits for agent-to-agent delegation.` | `Limits for harness-to-harness delegation.` |
| backbone/src/panel.ts:1122 | `When an agent holds the driver seat it can delegate to your other agents;…` | `When a harness holds the driver seat it can delegate to your other harnesses;…` |
| backbone/src/panel.ts:1652 | `agent WebSocket on ws://127.0.0.1:${AGENT_PORT}` (event log) | `harness WebSocket on ws://127.0.0.1:${AGENT_PORT}` |
| backbone/src/panel.ts:2060 | `that agent is user-facing — delegate to a worker` | `that harness is user-facing — delegate to a worker` |
| backbone/src/panel.ts:2062 | `that agent is an orchestrator — orchestrators don't delegate to each other` | `that harness is an orchestrator — orchestrators don't delegate to each other` |
| backbone/public/chat.js:153 | `No agent connected. Start one in Connections; it'll appear here.` | `No harness connected. Start one in Connections; it'll appear here.` |
| backbone/public/chat.js:211 | `Orchestrator: this agent takes the hub driver seat and can delegate to your other (regular) agents.` | `Orchestrator: this harness takes the hub driver seat and can delegate to your other (regular) harnesses.` |
| backbone/public/chat.js:211 | `Remote agent — start it with AGENT_HUBS on its own host to use it as an orchestrator.` | `Remote harness — start it with AGENT_HUBS on its own host to use it as an orchestrator.` |
| backbone/public/chat.js:214 | `No agent in the driver seat` | `No harness in the driver seat` |
| backbone/public/chat.js:399 | `Open a session with an agent as Orchestrator and ask it to delegate — the live tree builds here.` | `Open a session with a harness as Orchestrator and ask it to delegate — the live tree builds here.` |
| backbone/src/hub-mcp.ts:22 | `List the worker agents on this hub… Prefer an agent's id when two share a name.` | `List the worker harnesses on this hub… Prefer a harness's id when two share a name.` |
| backbone/src/hub-mcp.ts:34 | `Delegate a subtask to a WORKER agent on this hub… Never target the agent marked active…` | `Delegate a subtask to a WORKER harness on this hub… Never target the harness marked active…` |
| backbone/src/agent-cli.ts:49 | `You also coordinate other agents. … ask_agent to delegate a subtask (use the agent's id…)` | `You also coordinate other harnesses. … ask_agent to delegate a subtask to a harness (use the harness id…)` |
| backbone/src/agent-cli.ts:50 | `delegate to the best-suited workers… Never delegate to the agent marked active — that is you.` | `delegate to the best-suited worker harnesses… Never delegate to the harness marked active — that is you.` |
| backbone/src/agent-omp.ts:38 | `You also coordinate other agents. … ask_agent to delegate a subtask (use the agent's id…)` | `You also coordinate other harnesses. … ask_agent to delegate a subtask to a harness (use the harness id…)` |
| backbone/src/agent-omp.ts:39 | `delegate to the best-suited workers… Never delegate to the agent marked active — that is you.` | `delegate to the best-suited worker harnesses… Never delegate to the harness marked active — that is you.` |
| android/app/src/main/res/values/strings.xml:3 | `Lets your paired agent operate the phone` | `Lets your paired harness operate the phone` |
| android/app/src/main/java/com/agenticandroid/MainActivity.kt:224 | `if (paired) "your agent" else "no agent"` | `if (paired) "your harness" else "no harness"` |
| android/app/src/main/java/com/agenticandroid/MainActivity.kt:377 | `contentDescription = "Chats & agents"` | `contentDescription = "Chats & harnesses"` |
| android/app/src/main/java/com/agenticandroid/MainActivity.kt:393 | `contentDescription = "Switch agent"` | `contentDescription = "Switch harness"` |
| android/app/src/main/java/com/agenticandroid/MainActivity.kt:451 | `"Cloud agent — connects from elsewhere" / "Local agent"` | `"Cloud harness — connects from elsewhere" / "Local harness"` |
| android/app/src/main/java/com/agenticandroid/MainActivity.kt:516 | `"This is $who — it can see and control this phone…"` ($who carries the harness name) | (no literal "agent"; ensure $who uses the harness variant from line 224) |
| android/app/src/main/java/com/agenticandroid/MainActivity.kt:692 | `if (paired) "Message $shortWho…" else "Pair an agent first"` | `…else "Pair a harness first"` |
| android/app/src/main/java/com/agenticandroid/MainActivity.kt:1376 | `contentDescription = part.alt ?: "image from the agent"` | `… ?: "image from the harness"` |
| android/app/src/main/java/com/agenticandroid/MainActivity.kt:1385 | `contentDescription = part.alt ?: "image from the agent"` | `… ?: "image from the harness"` |
| android/app/src/main/java/com/agenticandroid/SettingsActivity.kt:163 | `Linked to your agent. Tap to disconnect quickly.` | `Linked to your harness. Tap to disconnect quickly.` |
| android/app/src/main/java/com/agenticandroid/SettingsActivity.kt:462 | `SectionLabel("Actions the agent can use")` | `SectionLabel("Actions the harness can use")` |
| android/app/src/main/java/com/agenticandroid/SettingsActivity.kt:465 | `Connect to your agent to load its actions.` | `Connect to your harness to load its actions.` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:363 | `.setContentText("Connected to your agent")` | `.setContentText("Connected to your harness")` |
| README.md:3 | `Connect **any agent** (Claude Code, your Claude subscription, or your own script)` | `Connect **any harness** (Claude Code, your Claude subscription, or your own script)` |
| README.md:6 | `**Agent → phone** — the agent drives the phone` | `**Harness → phone** — the harness drives the phone` |
| README.md:9 | `**Phone → agent** — you talk to the agent from the phone` | `**Phone → harness** — you talk to the harness from the phone` |
| README.md:10 | `and the agent replies in chat or out loud` | `and the harness replies in chat or out loud` |
| README.md:21 | `**Phone capabilities the agent can call**` | `**Phone capabilities the harness can call**` |
| README.md:34 | `**Multiple hubs & agents** — pair several hubs…` | `**Multiple hubs & harnesses** — pair several hubs…` |
| README.md:35 | `the header agent picker lists every agent across all online hubs… Per-agent color themes` | `the header harness picker lists every harness across all online hubs… Per-harness color themes` |
| README.md:38 | `**Consent engine** — per-agent × per-capability` | `**Consent engine** — per-harness × per-capability` |
| README.md:42 | `**The agent side** — three ways to attach a brain` | `**The harness side** — three ways to attach a brain` |
| README.md:69 | `an **agent WebSocket on :8124**` | `a **harness WebSocket on :8124**` |
| README.md:92 | `One agent you talk to can know about your other agents and delegate work to them by strength — an orchestrator` | `One harness you talk to can know about your other harnesses and delegate work to them by strength — an orchestrator` |
| README.md:126 | `and the agent socket on :8124` | `and the harness socket on :8124` |
| README.md:182 | `a rogue client could impersonate an agent` | `a rogue client could impersonate a harness` |
| README.md:185 | `Consent is still enforced **on the phone** per agent and capability` | `Consent is still enforced **on the phone** per harness and capability` |
| README.md:196 | `Key-free agent (agent:claude)` | `Key-free harness (agent:claude)` (text only; script id stays Tier C) |
| README.md:197 | `multi-agent, sessions, Tier-1` | `multi-harness, sessions, Tier-1` |
| README.md:203 | `wire protocol, E2E crypto, relay, hub, agents, MCP server` | `wire protocol, E2E crypto, relay, hub, harnesses, MCP server` |
| DESIGN.md:3 | `connects **any agent** (Claude Code or otherwise) to an **Android phone**` | `connects **any harness** (Claude Code or otherwise) to an **Android phone**` |
| DESIGN.md:4 | `the agent can invoke phone actions… the phone can initiate events to the agent` | `the harness can invoke phone actions… the phone can initiate events to the harness` |
| DESIGN.md:15 | `**(A) Agent → phone control** — the agent drives the phone` | `**(A) Harness → phone control** — the harness drives the phone` |
| DESIGN.md:16 | `**(B) Phone → agent channel** — you talk to the agent through the phone` | `**(B) Phone → harness channel** — you talk to the harness through the phone` |
| DESIGN.md:92 | `The agent can request anything; the phone decides` | `The harness can request anything; the phone decides` |
| DESIGN.md:93 | `Never trust the agent side for authorization` | `Never trust the harness side for authorization` |
| DESIGN.md:96 | `**Per-(agent × capability) policy**… A second, sketchier agent doesn't inherit full control` | `**Per-(harness × capability) policy**… A second, sketchier harness doesn't inherit full control` |
| docs/orchestration.md:4 | `an **orchestrator agent** can occupy a driver seat too — so a single agent you talk to can see your other agents…` | `an **orchestrator harness** can occupy a driver seat too — so a single harness you talk to can see your other harnesses…` |

---

## Tier B — comments & system prompts

| file:line | current | proposed |
|---|---|---|
| backbone/src/panel.ts:1198 | `// the ACTIVE agent's socket — all existing routing uses this` | `// the ACTIVE harness's socket — all existing routing uses this` |
| backbone/src/panel.ts:1204 | `// Phase 8: the hub can hold several agents at once. agentSock stays the active one (single-agent` | `// Phase 8: the hub can hold several harnesses at once. agentSock stays the active one (single-harness` |
| backbone/src/panel.ts:1219 | `// currently making that agent work, so a worker's own delegations/subagents nest under it.` | `// currently making that harness work, so a worker harness's own delegations/sub-agents nest under it.` |
| backbone/src/panel.ts:1392 | `// list_agents / ask_agent the other agents on this hub. Loopback…` | `// list_agents / ask_agent the other harnesses on this hub. Loopback…` |
| backbone/src/panel.ts:1632 | `// fail in-flight asks before dropping the worker` | `// fail in-flight asks before dropping the worker harness` |
| backbone/src/panel.ts:1679 | `// root of the orchestration tree: your prompt → the driver-seat agent` | `// root of the orchestration tree: your prompt → the driver-seat harness` |
| backbone/src/panel.ts:1694 | `// Phase 8: tell the phone which agents are connected right now` | `// Phase 8: tell the phone which harnesses are connected right now` |
| backbone/src/panel.ts:1702 | `// Phase 8: the phone picked which connected agent should be active; route to its socket.` | `// Phase 8: the phone picked which connected harness should be active; route to its socket.` |
| backbone/src/agent-runner.ts:52 | `// …shown in the hub roster so an orchestrator can delegate by strength` | `// …shown in the hub roster so a harness can delegate to other harnesses by strength` |
| backbone/src/agent-runner.ts:86 | `// orchestrator = launched with AGENT_HUBS … hide orchestrators from each other's list_agents…` | `// orchestrator harness = launched with AGENT_HUBS … hide orchestrator harnesses from each other's list_agents…` |
| backbone/src/delegate.ts:4 | `// …forward a user turn to a NAMED worker agent and await that worker's reply` | `// …forward a user turn to a NAMED worker harness and await that worker's reply` |
| backbone/src/delegate.ts:5 | `// …per worker (CLI agents keep a single --resume/--continue session` | `// …per worker (CLI-backed harnesses keep a single --resume/--continue session` |
| backbone/src/delegate.ts:6 | `// Different workers run in parallel.` | `// Different worker harnesses run in parallel.` |
| backbone/src/delegate.ts:13 | `// Deliver a delegated turn. MUST throw if the agent's socket is missing/closed.` | `// Deliver a delegated turn. MUST throw if the worker harness's socket is missing/closed.` |
| backbone/src/bridge.ts:3 | `// An LLM agent (Claude Code / any MCP host) calls a tool` | `// An LLM harness (Claude Code / any MCP host) calls a tool` |
| backbone/src/bridge.ts:164 | `// Spawn claude -p to drive the agent on an inbound phone event (Mode 1, Q9).` | `// Spawn claude -p (the Claude harness) on an inbound phone event (Mode 1, Q9).` |
| android/app/src/main/java/com/agenticandroid/MainActivity.kt:620 | `// browse the agent's skills & commands, like the TUI.` | `// browse the harness's skills & commands, like the TUI.` |
| android/app/src/main/java/com/agenticandroid/Agents.kt:31 | `// The phone's list of paired agents + which one is active` | `// The phone's list of paired harnesses + which one is active` |
| android/app/src/main/java/com/agenticandroid/Agents.kt:32 | `// each agent knows the phone's pubkey` | `// each harness knows the phone's pubkey` |
| android/app/src/main/java/com/agenticandroid/Agents.kt:77 | `// The phone's own identity (shared across all agents)` | `// The phone's own identity (shared across all harnesses)` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:20 | `// A line in the on-phone chat with the agent` | `// A line in the on-phone chat with the harness` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:23 | `// An agent connected to a hub` | `// A harness connected to a hub` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:24 | `// …list agents across all online hubs and group them` | `// …list harnesses across all online hubs and group them` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:32 | `// Hub's verdict on whether this agent really answers` | `// Hub's verdict on whether this harness really answers` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:37 | `// A chat session with the agent (Phase: multi-session)` | `// A chat session with the harness (Phase: multi-session)` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:40 | `// A file being uploaded to the agent right now` | `// A file being uploaded to the harness right now` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:43 | `// A slash command/skill the connected agent exposes` | `// A slash command/skill the connected harness exposes` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:60 | `// …keyed by the calling agent's fingerprint` | `// …keyed by the calling harness's fingerprint` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:150 | `// …switching hub == switching the active "agent" tab` | `// …switching hub == switching the active "harness" tab` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:166 | `// Push the foreground hub's name/agent into the shared header flows…` | `// Push the foreground hub's name/harness into the shared header flows…` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:174 | `// …all-agents union…` | `// …all-harnesses union…` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:201 | `// Phone-initiated message to the agent (the user typed/spoke it)` | `// Phone-initiated message to the harness (the user typed/spoke it)` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:217 | `// Upload bytes as an E2E blob sealed for the foreground hub's agent; returns its id` | `// …sealed for the foreground hub's harness; returns its id` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:221 | `// Pick a connected agent WITHIN the foreground hub (Settings roster)` | `// Pick a connected harness WITHIN the foreground hub (Settings roster)` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:226 | `// Pick an agent on ANY online hub (the header picker)…` | `// Pick a harness on ANY online hub (the header picker)…` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:245 | `// …stops any in-progress reply (the agent` | `// …stops any in-progress reply (the harness` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:280 | `// …an image/file the agent sent` | `// …an image/file the harness sent` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:282 | `// …survives the relay's short TTL — the agent's` | `// …survives the relay's short TTL — the harness's` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:305 | `// Human-readable name of the paired agent, announced over the connection` | `// …name of the paired harness, announced over the connection` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:311 | `// Slash commands/skills the connected agent exposes, for the / menu` | `// …the connected harness exposes, for the / menu` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:313 | `// Agents on the FOREGROUND hub — for the Settings in-hub roster` | `// Harnesses on the FOREGROUND hub — for the Settings in-hub roster` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:317 | `// Every agent across all ONLINE hubs (tagged with its hub)…` | `// Every harness across all ONLINE hubs (tagged with its hub)…` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:321 | `// Chat sessions for the active agent + which one is open` | `// Chat sessions for the active harness + which one is open` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:326 | `// Files being uploaded to the agent right now…` | `// Files being uploaded to the harness right now…` |
| android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt:330 | `// …recording voice… The agent` | `// …recording voice… The harness` |
| android/app/src/main/java/com/agenticandroid/HubConnection.kt:21 | `// …its connection/online state, and its agent roster` | `// …its connection/online state, and its harness roster` |
| android/app/src/main/java/com/agenticandroid/HubConnection.kt:39 | `// Agents currently connected to THIS hub…` | `// Harnesses currently connected to THIS hub…` |
| android/app/src/main/java/com/agenticandroid/HubConnection.kt:41 | `// The active agent name this hub last announced…` | `// The active harness name this hub last announced…` |
| android/app/src/main/java/com/agenticandroid/Consent.kt:4 | `// …the trust boundary. The agent can REQUEST anything; the phone decides` | `// …the trust boundary. The harness can REQUEST anything; the phone decides` |
| android/app/src/main/java/com/agenticandroid/Consent.kt:5 | `// Policy is keyed by (agent fingerprint x capability method)` | `// Policy is keyed by (harness fingerprint x capability method)` |
| android/app/src/main/java/com/agenticandroid/Consent.kt:21 | `// Apply a default profile when a new agent pairs (Q8…)` | `// Apply a default profile when a new harness pairs (Q8…)` |
| README.md:68 | `the agent roster, chat sessions, media, the event log, and a persistent scheduler` | `the harness roster, chat sessions, media, the event log, and a persistent scheduler` |
| README.md:71 | `**Agent** (backbone/src/agent.ts / agent-cli.ts) — a replaceable process that connects to the hub` | `**Harness** (backbone/src/agent.ts / agent-cli.ts) — a replaceable process that connects to the hub` |
| README.md:85 | `so the agent can **chain and recover**` | `so the harness can **chain and recover**` |
| README.md:184 | `runs the agent with --dangerously-skip-permissions` | `runs the harness with --dangerously-skip-permissions` |
| DESIGN.md:28 | `non-LLM agents speak the raw WS bus directly (no MCP)` | `non-LLM harnesses speak the raw WS bus directly (no MCP)` |
| DESIGN.md:33 | `Non-LLM agents skip MCP and speak the bus directly` | `Non-LLM harnesses skip MCP and speak the bus directly` |
| DESIGN.md:46 | `Agent adapter | MCP (LLM hosts) + raw WS (scripted agents)` | `Harness adapter | MCP (LLM hosts) + raw WS (scripted harnesses)` |
| DESIGN.md:63 | `"1 phone ↔ 3 agents" or "1 agent ↔ 2 phones"…` | `"1 phone ↔ 3 harnesses" or "1 harness ↔ 2 phones"…` |
| DESIGN.md:73 | `wakes the agent**. Deferred results and phone-initiated events reuse one inbound path` | `wakes the harness**. Deferred results and phone-initiated events reuse one inbound path` |
| DESIGN.md:77 | `so the agent can **chain and recover**` | `so the harness can **chain and recover**` |
| DESIGN.md:107 | `the agent-adapter seam; no protocol change` | `the harness-adapter seam; no protocol change` |
| DESIGN.md:108 | `**Memory is the agent's job**` | `**Memory is the harness's job**` |
| DESIGN.md:128 | `the agent's reply is a speak action` | `the harness's reply is a speak action` |
| DESIGN.md:144 | `a **raw-WS non-MCP agent adapter**` | `a **raw-WS non-MCP harness adapter**` |
| docs/orchestration.md:22 | `The orchestrator is just an agent that holds one extra tool` | `The orchestrator is just a harness that holds one extra tool` |
| docs/orchestration.md:23 | `Worker agents never get that tool, so they cannot enumerate or drive each other` | `Worker harnesses never get that tool, so they cannot enumerate or drive each other` |
| docs/orchestration.md:90 | `{ hub, agents: [...] } — connected agents + their strengths` (prose) | `…— connected harnesses + their strengths` (prose only; JSON key `agents` is the wire field, Tier C) |
| docs/orchestration.md:102 | `only an agent given the hub tool can delegate` | `only a harness given the hub tool can delegate` |
| docs/orchestration.md:103 | `The driver/agent ports being exposed to the LAN` | `The driver/harness ports being exposed to the LAN` |
| docs/orchestration.md:106 | `A CLI agent's single resumed session being corrupted by concurrent turns` | `A CLI harness's single resumed session being corrupted by concurrent turns` |
| docs/orchestration.md:108 | `when target is the active agent on a phone-backed hub` | `when target is the active harness on a phone-backed hub` |
| docs/orchestration.md:109 | `or (agent disconnected)` | `or (harness disconnected)` |

> Note on `ask_agent` / `list_agents` / JSON `agents`: these are wire-protocol identifiers
> (Tier C). Prose around them is renamed to "harness"; the literal tool/field names are NOT
> changed in this pass. docs/orchestration.md:91 proposed renaming `ask_agent`→`ask_harness` —
> that is a protocol rename, deferred to Open questions.

---

## Tier C — code identifiers (inventory only, NOT changing now)

Aggregated; ~80+ uses across the codebase. Leave all as-is in this pass.

- **backbone/src/panel.ts**: `agentsel` (id), `agentSock`, `activeAgentId`, `agents` Map, `managed` Map, `AGENT_PORT`, `spawnAgent`, `stopAgent`, `isOrchestrator`, `rosterList`, `announceRoster`, `OrchNode` (`kind:"subagent"`/`"delegation"`, `agentId`, `agentName`), `agentSocket` (SettingsInfo field), `ext` local. — code identifiers, ~50 uses.
- **backbone/src/agent-runner.ts**: `AgentAdapter`, `orchestrator` JSON key (`!!process.env.AGENT_HUBS`). — protocol/type identifiers.
- **backbone/src/hub-mcp.ts**: `s.agents` data structure, `ask_agent`/`list_agents` tool names. — wire identifiers.
- **backbone/src/bridge.ts**: `AgentRunner` type, `agentRunner` callback. — type/callback identifiers.
- **android …/Agents.kt**: `Agents` object, `agents_store`, `KEY_PROFILES`, `KEY_ACTIVE`, `activeId`, `profiles`, `agents` Map. — file/constant/var identifiers.
- **android …/PhoneAgentService.kt**: `PhoneAgentService` class, `agentName`, `lastAgentName`, `selectAgent`, `selectAgentOnHub`, `activeId`, `roster`, `allAgents`. — class/fn/var identifiers.
- **android …/HubConnection.kt**: `AgentProfile`, `lastAgentName`, `agentFp`. — data-class/var identifiers.
- **android …/MainActivity.kt, AgentTheme.kt**: `agentName`, `AgentTheme`, etc. — identifiers; `AgentTheme.kt`/`Protocol.kt` had no prose to change.
- **README.md / docs**: `pnpm agent:claude`, `agent:orchestrator`, `agent:*` scripts, `AGENT_HUBS`, `AGENT_HOST`, `agent:claude` table cell. — package/script/env identifiers.
- **Product / file names (leave, never rename now)**: `com.agenticandroid`, `Agents.kt`, `AgentTheme.kt`, `PhoneAgentService.kt`, `agent-bootstrap`, "Agentic Android".

---

## Leave as-is — genuine agent / sub-agent references

These are the lower internal level (a harness's own agents/sub-agents/brain/model) or were
resolved `should-keep`. Renaming any of these would violate the hard constraint.

| file:line | text | why keep |
|---|---|---|
| backbone/src/panel.ts:398 | `Orchestrator` (mode tab) | Role word — a role a harness plays, not a type. |
| backbone/src/panel.ts:402 | `Orchestration — watch delegations live` | "delegations" already correct (harness→harness); feature name. |
| backbone/src/panel.ts:816 | `Agent` status chip on Connections | should-keep: connection status of the agent process layer; not renamed this pass (see Open questions for the tension with the surrounding harness copy). |
| backbone/src/panel.ts:996 | `Active: <name> + <count> more` | No literal "agent"; harness is implicit from context. |
| backbone/src/panel.ts:1217 | `// internal subagents an agent reports about itself (agent_activity)` | Genuine internal sub-agents a harness narrates — correct already. |
| backbone/src/panel.ts:1294–1349 | remote-agent-prompt body (protocol/loop instructions) | The "agent"/"model" wording describes the LLM/brain inside the harness and the background client loop — correct in this protocol context. |
| backbone/src/panel.ts:1210 | `// orchestrator = holds driver seat (list_agents/ask_agent)` | Orchestrator role + wire tool names — correct. |
| backbone/src/panel.ts:1216 | `// Orchestration monitor … (ask_agent)` | Correct: ask_agent is the delegation method. |
| backbone/src/panel.ts:1221,1227,1249 | `OrchNode kind "delegation"/"subagent"`, `agents.get(...)` | `delegation` (harness↔harness) and `subagent` (internal agent) are both correct; identifiers are Tier C. |
| backbone/src/panel.ts:1610 | `// The agent narrates its OWN internals (e.g. Claude Task subagents + tool calls)` | Genuine internal agent + sub-agents — correct. |
| backbone/src/panel.ts:1621,1623 | `kind === "subagent"` | Internal agent activity — correct. |
| backbone/src/panel.ts:2061 | `// orchestrators are invisible to each other…` | Orchestrator role behavior — correct. |
| backbone/public/chat.js:214 | `Driver seat: <name>` | Metaphor clear; no terminology change. |
| backbone/public/chat.js:232 | `orchestrator did not connect in time` | should-keep: a spawned orchestrator child process (internal), not a connected harness. |
| backbone/public/chat.js:248 | `could not start an orchestrator` | should-keep: internal hub-spawned orchestrator child process. |
| backbone/public/chat.js:399 | `…list_agents/ask_agent narrative` (line 124 of orchestration.md analog) | Wire tool names kept; surrounding prose handled in Tier A. |
| backbone/src/agent-runner.ts:2 | `the shared WebSocket harness every CLI-backed agent uses…` | Already correct: runner is the harness; the CLI-backed agent is the internal brain. |
| backbone/src/agent-runner.ts:4 | `boilerplate copy-pasted into each agent` | The internal agent/brain — correct. |
| backbone/src/agent-runner.ts:7 | `The brain itself is an AgentAdapter` | Internal brain — correct. |
| backbone/src/agent-runner.ts:44 | `A within-agent activity… (subagent spawn / tool call)` | Genuine sub-agent activity inside an agent — correct. |
| backbone/src/agent-cli.ts:86 | `discovered brain — built-in one is a keyword fallback` | Internal brain — correct. |
| backbone/src/brain.ts:20 | `The agent reaches the phone ONLY through the hub` | The internal brain/agent — correct. |
| backbone/src/bridge.ts:7 | `…drives the agent via agentRunner` | Internal agent/brain consumer — correct. |
| backbone/src/bridge.ts:34 | `Drives the agent on inbound events.` | Internal agent/brain — correct. |
| backbone/src/bridge.ts:171 | `[agentRunner] failed to spawn claude` | `agentRunner` is the callback identifier (Tier C). |
| android …/MainActivity.kt:542 | `contentDescription = "Photo the agent took"` | should-keep: part of the harness's own reply stream (m.role != "user"); the model/agent inside the harness, not a connected participant. |
| android …/SettingsActivity.kt:332 | `Reads the agent's replies aloud…` | should-keep: replies from the bridge/brain inside the harness. |
| android …/HubConnection.kt:26 | `PhoneAgentService orchestrates the set` | Appropriate use of "orchestrates" describing the service's role. |
| README.md:198 | `Concierge ask_agent (one agent routing to another)` | should-keep: describes the agent-level delegation contract; wire verb `ask_agent`. |
| README.md:136 | `pnpm agent:claude, pnpm agent:orchestrator` | Script identifiers (Tier C). |
| docs/orchestration.md:124 | `it will list_agents, split the task, ask_agent each by name…` | Wire tool names in narrative — kept (Tier C); prose around them is harness-level. |

---

## Open questions (need the user's decision)

1. **backbone/src/panel.ts:1308 — "ghost agents".** `do NOT reconnect per message (that spawns
   duplicate ghost agents)`. In this protocol prompt "agent" usually means the brain/client, but
   here it means duplicate *connections* (= duplicate harnesses). Options: keep "ghost agents",
   use "ghost harnesses", or "duplicate connections". Author intent unclear.

2. **android …/SettingsActivity.kt:162 — "your agents are kept".** `!connectionEnabled -> "Off
   for now — your agents are kept. Tap to reconnect."` Adversarial verdict says the right
   user-facing word here is **"hubs"** (matching the Settings "Hubs" section), NOT "harnesses".
   Decide: "your harnesses are kept" vs "your hubs are kept". Left unchanged pending decision.

3. **android …/SettingsActivity.kt:415 — wake phrases.** `listOf("hey agent", "okay agent",
   "computer", "jarvis", "hey phone")`. Are these labels for the connected harness (rename to
   "hey harness") or voice-assistant flavor terms the user speaks (keep)? Recommend keep unless
   product wants the harness vocabulary spoken aloud.

4. **docs/orchestration.md:91 — `ask_agent(agent, message)` → `ask_harness(harness, message)`?**
   A finder proposed renaming the wire tool itself. That is a protocol/API change (affects
   hub-mcp.ts tool name, agent-cli/omp prompts, README). Out of scope for a copy pass — confirm
   whether the protocol verb should also be renamed.

5. **backbone/src/panel.ts:816 — "Agent" status chip.** Resolved `should-keep` (connection
   status of the agent-process layer), yet it sits among Connections-page copy that is being
   renamed to "harness" (814, 823, 824, 827, 995). Either keep as the one deliberate
   agent-layer label, or rename for page consistency. Flagging the tension; left unchanged.
