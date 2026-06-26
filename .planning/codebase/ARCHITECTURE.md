# Architecture

**Analysis Date:** 2026-06-26

## Pattern Overview

**Overall:** Three-tier event-driven system with an untrusted relay, a stateful hub, and pluggable agent processes.

**Key Characteristics:**
- Phone–Hub–Agent layers communicate through an E2E-encrypted relay (the relay cannot read payloads)
- Hub owns all persistent state: chat history, identity, media, scheduling, and agent registry
- Agents are replaceable processes that connect to the hub as clients (no state ownership)
- Pairwise authentication using ed25519 public-key cryptography (no passwords, no secrets in relay)
- Offline-first design: relay queues messages for disconnected peers; FCM wake hooks restore connectivity

## Layers

**Relay (Untrusted Post Office):**
- Purpose: Route opaque E2E-encrypted envelopes by destination fingerprint; queue for offline peers; serve out-of-band blobs with TTL
- Location: `backbone/src/relay.ts`
- Contains: WebSocket handshake (hello/challenge/auth), envelope routing, per-peer queues (in-memory in ponytail), blob storage with TTL sweeper, HTTP blob endpoint
- Depends on: `protocol.ts` (frame parsing), `crypto.ts` (fingerprint verification, signature verification)
- Used by: Phone (via `BusEndpoint`), hub (via `BusEndpoint`), agents (via `BusEndpoint`)
- Threat model: Relay is explicitly untrusted. It sees only sender/recipient fingerprints and message sizes, never contents. E2E encryption prevents any reading of payloads.

**Hub (Persistent Glue):**
- Purpose: Own the phone connection and all state; route messages between phone and active agent; execute phone capabilities; persist chat history, media, and configuration
- Location: `backbone/src/panel.ts`
- Contains: 
  - Relay client connection (`BusEndpoint`) speaking as the phone's paired identity
  - Agent roster (multiple agents may connect; one is active and receives messages)
  - Chat session management (multi-session support with JSONL persistence)
  - Capability registry and request dispatch
  - HTTP server (`:8123` for web UI / control panel)
  - WebSocket server (`:8124` for agents to connect)
  - Scheduler (hub-owned, survives agent restarts)
  - Event log (persistent JSONL for audit)
- Depends on: `peer.ts` (`BusEndpoint`), `protocol.ts`, `crypto.ts`, `scheduler.ts`, `brain.ts` (for stub responses)
- Used by: Phone (connects to relay), agents (connect to hub's WebSocket), web UI (HTTP), pairing process

**Phone (Android App):**
- Purpose: Foreground service that maintains relay connection; render chat UI; dispatch capability requests; manage consent policies; handle wake words and voice input
- Location: `android/app/src/main/java/com/agenticandroid/`
- Contains:
  - `PhoneAgentService.kt`: Foreground service holding the relay connection; request handler; consent dispatch
  - `MainActivity.kt`: Compose chat UI; message rendering; media picker; session switcher
  - `BusEndpoint.kt`: Relay client (Kotlin mirror of `backbone/src/peer.ts`)
  - `Capabilities.kt`: Capability registry; Tier-1 implementations (camera, location, SMS, notifications, device info, flashlight, ring, vibrate, UI automation)
  - `Consent.kt` / `ConsentPolicy`: Policy engine (DENY/ASK/ALLOW per agent per capability)
  - `Crypto.kt`: E2E encryption (libsodium via JNI)
  - Voice pipeline: `WakeWordService.kt`, `VoiceInput.kt`, `SpeechText.kt`, `Chimes.kt`
  - `Agents.kt`: Multi-agent roster state (which agents have paired, which is active)
  - `SettingsStore.kt`: UI state (relay URL, wake-word enabled, connection switch)
- Depends on: `BusEndpoint` (relay client), `Crypto` (libsodium), Android capabilities (Compose, Camera, Location, etc.)
- Used by: User (Compose UI); relay (envelopes in/out); capabilities (listen to requests)

**Agent (Pluggable Brain):**
- Purpose: Connect to hub; receive user messages + capability catalog; run LLM reasoning loop; emit tool calls and replies
- Location: `backbone/src/agent.ts` (generic loop), `backbone/src/brain.ts` (Claude/stub brain impl), `backbone/src/agent-cli.ts` (key-free variant using `claude` CLI)
- Contains:
  - Hub connection (WebSocket to hub's `:8124`)
  - Message correlation (pending tool requests)
  - `makeBrain()`: Agentic loop factory (Anthropic SDK or keyword stub)
  - Tool call to hub request bridge
  - Agent display name + registry
- Depends on: `@anthropic-ai/sdk` (if real key present), `ws` (WebSocket), hub's public contract
- Used by: User messages (routed by hub); hub (WebSocket connection)

**Phone MCP Bridge:**
- Purpose: Expose phone capabilities as Model Context Protocol tools to ANY MCP host (the user's own `claude` on subscription, no key needed in app)
- Location: `backbone/src/phone-mcp.ts`
- Contains: MCP stdio server; capability → tool adapter; hub HTTP client (`GET /catalog`, `POST /call`)
- Depends on: `@modelcontextprotocol/sdk`, hub HTTP
- Used by: User's `claude` CLI (spawned by `agent-cli.ts` or standalone)

## Data Flow

**Send Message (User → Hub → Agent):**

1. User types in `MainActivity` (chat UI)
2. Phone calls `BusEndpoint.request("assistant", { prompt_text })`
3. Relay routes encrypted envelope to hub
4. Hub receives, decrypts, logs `user_message` event
5. Hub pushes message + catalog to active agent WebSocket
6. Agent (running in `makeBrain()`) receives message and starts agentic loop

**Tool Call (Agent → Hub → Phone):**

1. Agent's LLM chooses a tool (`camera.capture`, `ui.screenshot`, etc.)
2. Agent calls `bus.request("camera.capture", { width, height })`
3. Hub routes to phone's `BusEndpoint.onRequest`
4. Phone's `PhoneAgentService.onRequest` handler:
   - Looks up capability in registry
   - Checks consent policy (DENY/ASK/ALLOW)
   - If ALLOW, executes capability (e.g., `Capabilities.camera.execute()`)
   - Wraps result in `ResponseMsg` (status + result or error)
5. Phone sends response back through relay to hub
6. Hub's pending map delivers to agent, unblocking `bus.request()` promise

**Agent Reply (Agent → Hub → Phone):**

1. Agent's LLM finishes agentic loop, emits `assistant_message` event
2. Agent calls `bus.event("assistant_message", { text, parts? })`
3. Hub receives event, logs it, broadcasts to chat UI via WebSocket
4. Phone updates chat display with assistant message

**State Management:**
- Hub is the source of truth: owns sessions, media, event log, agent roster
- Phone mirrors chat state in memory (UI list); persists nothing except pairing identity
- Agents own no state: they read the current message context and emit decisions
- Scheduler lives in hub, survives agent/phone process death; tasks persist to disk

## Key Abstractions

**Envelope (Protocol Outer Layer):**
- Purpose: Relay-visible routing wrapper (cleartext structure, encrypted payload)
- Examples: `backbone/src/protocol.ts` (TypeScript), `android/app/src/main/java/com/agenticandroid/Protocol.kt` (Kotlin)
- Pattern: JSON `{ v, id, from (fingerprint), to (fingerprint), ts, enc (base64 ciphertext) }`

**Inner Message (Protocol Inner Layer, E2E-Encrypted):**
- Purpose: Application message types the relay cannot read
- Pattern: Discriminated union (Zod schema in TypeScript):
  - `RequestMsg`: `{ type: "request", method, params }`
  - `ResponseMsg`: `{ type: "response", reply_to (envelope id), status, result?, error? }`
  - `EventMsg`: `{ type: "event", topic, data }`
  - `AckMsg`: `{ type: "ack", ack (envelope id) }` (v1 reserved, unused)

**BusEndpoint (Peer Abstraction):**
- Purpose: Unified relay client API (both phone and agents use the same pattern)
- Examples: `backbone/src/peer.ts` (TypeScript), `android/app/src/main/java/com/agenticandroid/BusEndpoint.kt` (Kotlin)
- Pattern:
  - Constructor: `self` (local Identity), `peerEdPub` (remote public key), `relayUrl`
  - `connect()`: Handshake (hello → challenge → auth → welcome)
  - `request(method, params)`: Send RequestMsg, correlate by envelope id, wait for ResponseMsg (timeout 30s)
  - `event(topic, data)`: Fire-and-forget EventMsg
  - Handlers: `onRequest`, `onEvent` callbacks for inbound messages

**Identity (Cryptographic Anchor):**
- Purpose: One ed25519 keypair per device; serves as both signing key (relay auth) and encryption key (E2E)
- Pattern: `{ edPub (base64), edSec (base64 64-byte secret), fp (hex fingerprint of edPub hash) }`
- Generated at pairing; stored in phone's `agent.json`; shared with hub during setup; never transmitted to relay in plaintext

**Capability (Executable Action):**
- Purpose: A method the phone exposes; agent can request it
- Pattern: `{ method (string), sensitivity (string: "public" | "internal" | "tier-1" | "tier-2"), summary (string) }`
- Examples: `camera.capture`, `ui.screenshot`, `device.info`, `location.get`, `phone.ring`, `vibrate`
- Registry lives on phone; catalog sent to agent and hub; hub uses it to route and validate requests

**Consent Policy:**
- Purpose: Decide DENY/ASK/ALLOW for each agent-method pair
- Pattern: Per-agent state (trusted / untrusted); per-method sensitivity (public → auto-allow; tier-1 → ask; tier-2 → deny)
- Example: User marks agent as "trusted" → all public methods auto-allow; tier-1 still prompt. Untrusted agent → all tier-1+ are denied.

**Chat Session:**
- Purpose: Named conversation thread with persistence
- Pattern: `{ id (UUID), title (string), createdAt, lastTs, turns: ChatTurn[] }`
- Turns persisted per-session to `~/.agentic-android/sessions/{id}.jsonl`; index in `sessions.jsonl`

**Scheduler Task:**
- Purpose: Deferred or recurring phone action
- Pattern: `{ id, fireAt (epoch ms), method, args, everyMs? (recurrence), agentId? (who scheduled), createdAt }`
- Persisted to disk; re-armed on hub startup; fires via capability request to phone

## Entry Points

**Phone App:**
- Location: `android/app/src/main/java/com/agenticandroid/MainActivity.kt`
- Triggers: User launches app or system boot (BootReceiver)
- Responsibilities: 
  - Start `PhoneAgentService` (foreground service with relay connection)
  - Render chat UI in Compose
  - Handle user input (text, voice, media attach)
  - Display capability status / responses
  - Switch sessions and agents

**Hub (Panel / Web Server):**
- Location: `backbone/src/panel.ts` main() or `pnpm panel` / `pnpm hub`
- Triggers: Manual `pnpm panel`
- Responsibilities:
  - Start HTTP server (`:8123` web UI)
  - Start WebSocket server (`:8124` for agents)
  - Connect to relay as phone's paired identity
  - Load/restore state from disk
  - Forward messages between phone and agent

**Agent (Brain Process):**
- Location: `backbone/src/agent.ts` main() or `pnpm agent`
- Triggers: Manual `pnpm agent` (or spawned by hub/CLI wrapper)
- Responsibilities:
  - Connect to hub's WebSocket (`:8124`)
  - Announce display name to hub
  - Run agentic loop on user messages
  - Call hub tools (phone capabilities)
  - Emit replies and events

**Agent CLI (Key-Free Variant):**
- Location: `backbone/src/agent-cli.ts` main() or `pnpm agent:claude`
- Triggers: Manual run or spawn by framework
- Responsibilities:
  - Spawn user's `claude` CLI with phone-mcp.ts as MCP server
  - Relay hub WebSocket messages to/from CLI
  - Translate CLI prompts ↔ hub messages
  - Auth via user's own Claude account (no app key needed)

**Relay:**
- Location: `backbone/src/relay.ts` + test/relay.test.ts for example
- Triggers: `new createRelay(opts); relay.listen(8799)`
- Responsibilities:
  - Accept WebSocket connections from phone/hub/agents
  - Handshake & signature-verify
  - Queue envelopes for offline peers
  - Route envelopes by fingerprint
  - Serve blobs over HTTP

## Error Handling

**Strategy:** Typed errors (code + message + retriable flag) propagate through the wire protocol. Handlers log and respond.

**Patterns:**

1. **Relay Errors:**
   - Handshake failure (bad signature, fp mismatch) → send `{ ctl: "error", message }` and close
   - Routing error (from-spoofing, not authenticated) → drop message, log

2. **Phone Errors:**
   - Capability execute failure → return `CapResult(error = TypedError("METHOD_FAILED", ...))`
   - Consent denied → `TypedError("CONSENT_DENIED", ...)`
   - Permission not granted → `TypedError("PERMISSION_NOT_GRANTED", ...)`
   - Wrapped in `ResponseMsg { status: "error", error }`

3. **Agent Errors:**
   - Brain execution error (LLM or tool failure) → catch, log, emit `error` event
   - Tool request timeout (40s, configurable) → `TypedError("TIMEOUT", method, retriable: true)`
   - Hub connection lost → exit process (hub restarts agent if needed)

4. **Hub Errors:**
   - Agent disconnects → remove from roster; next message adds new roster state
   - Phone offline → envelopes queue in relay (per-peer max 1000)
   - Capability not found → `TypedError("UNKNOWN_METHOD", method)`

## Cross-Cutting Concerns

**Logging:** Event log (JSONL to disk) on hub (`logEvent(type, summary, detail?)`). Each event is typed (`user_message`, `assistant_message`, `llm`, `tool`, `request`, `response`, `error`, `phone_event`, `agent_run`, `connection`, `config`). Rotation at 5000 in-memory, all written to disk.

**Validation:** 
- Protocol frames validated via Zod schemas (`protocol.ts`)
- Envelope signature verified on relay (ed25519 challenge-response)
- Crypto (libsodium): X25519 key derivation from ed25519, XSalsa20-Poly1305 box encryption
- Capability methods validated against registry

**Authentication:**
- Relay: Challenge-response with ed25519 signature (stateless per connection)
- Hub ↔ Phone: Symmetric; both have the pairing identity (generated at setup)
- Agent ↔ Hub: Optional; agents announce a name but hub trusts its own WebSocket (localhost by default)
- Agent ↔ LLM: API key stored in `agent.json` or env var; not transmitted to hub or phone

**Consent:**
- Per-agent policy (trusted / untrusted)
- Per-method sensitivity (public / internal / tier-1 / tier-2)
- Enforcement: DENY (never allow), ASK (prompt user), ALLOW (execute)
- UI: `Confirmer.ask()` modal on phone

---

*Architecture analysis: 2026-06-26*
