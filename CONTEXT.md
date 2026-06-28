# Agentic Android

A self-hosted, end-to-end-encrypted bridge that connects an AI framework on your computer to your Android phone, both ways: the framework can drive the phone (camera, screen, SMS, location…) and you can talk to it from the phone.

## Language

**Harness**: A connected AI framework or CLI that attaches to the hub over a WebSocket — Claude Code, Hermes, OMP, Cursor, Codex, or your own script. It is the thing the user installs, runs, pairs, and picks in the roster.
_Avoid_: "agent" when you mean the connected tool the user installs/picks.

**Agent**: Something a harness spins up internally to do a piece of work. One level below a harness.
_Avoid_: using "agent" for the connected participant — that is a harness.

**Sub-agent**: Something an agent spins up — one level below an agent. The genuine lowest level reported as "internal subagent activity".
_Avoid_: conflating with a harness or with a delegated worker.

**Orchestrator**: A role a harness plays when it holds the hub's driver seat and delegates work to other harnesses via the `hub` tool. A role word, not a kind of thing.
_Avoid_: treating "orchestrator" as a separate entity type instead of a role on a harness.

**Worker**: A harness on the hub that receives a delegated job from an orchestrator. Also a role word.
_Avoid_: implying a worker is an internal agent rather than another connected harness.

**Hub**: The persistent bridge/glue process running on the user's computer. It holds phone state, the roster, sessions, and the WebSocket harnesses connect to.

**Phone**: The controlled Android device — the usual "driver seat" that issues instructions and the device whose capabilities harnesses call.

**Roster**: The hub's live list of connected harnesses (with id, name, strengths, active flag). Surfaced in the setup page, chat picker, and the phone's cross-hub header picker.

**Brain**: Informal term for the reasoning model inside a harness — the part that "talks to you and acts on your phone."

**Driver seat / brain seat**: The two symmetric seats on a hub — driver gives instructions (usually the phone, or an orchestrator harness), brain answers. Only one harness occupies the active seat at a time.

**Delegation**: A hub-mediated, harness-to-harness hand-off of a turn (via `list_agents` / `ask_agent`). Distinct from the internal sub-agents a harness spawns on its own and reports as "internal subagent activity".
