# Codebase Structure

**Analysis Date:** 2026-06-26

## Directory Layout

```
Agentic-Android/
├── backbone/                      # TypeScript hub, relay, agents, bridges
│   ├── src/
│   │   ├── relay.ts              # Untrusted post office (Q2/Q5)
│   │   ├── panel.ts              # Hub (the glue; owns phone + state)
│   │   ├── peer.ts               # BusEndpoint (unified relay client)
│   │   ├── protocol.ts           # Wire protocol (Zod schemas)
│   │   ├── crypto.ts             # Session crypto (ed25519 + X25519)
│   │   ├── agent.ts              # Agent entry point (generic loop)
│   │   ├── brain.ts              # Claude/stub brain implementation
│   │   ├── agent-cli.ts          # Key-free agent (wraps `claude` CLI)
│   │   ├── phone-mcp.ts          # MCP server for ANY MCP host
│   │   ├── parts.ts              # Rich message types (markdown, table, image, file)
│   │   ├── phone-sim.ts          # Phone simulator for testing
│   │   ├── pairing.ts            # Pairing handshake (QR + manual code)
│   │   ├── scheduler.ts          # Hub-owned task scheduler
│   │   ├── bridge.ts             # (Legacy or internal)
│   │   └── ...
│   ├── test/
│   │   ├── relay.test.ts
│   │   ├── agent-cli.test.ts
│   │   ├── e2e.test.ts
│   │   ├── pairing.test.ts
│   │   ├── crypto.test.ts
│   │   ├── scheduler.test.ts
│   │   └── ...
│   ├── examples/
│   │   └── raw-agent.ts          # Example: simple agent without Claude
│   └── package.json
├── android/                       # Kotlin Android app
│   ├── app/
│   │   ├── src/main/java/com/agenticandroid/
│   │   │   ├── MainActivity.kt                # Compose chat UI
│   │   │   ├── PhoneAgentService.kt           # Foreground service (orchestrates all hub connections)
│   │   │   ├── HubConnection.kt               # Per-hub connection (one BusEndpoint + roster/online state)
│   │   │   ├── BusEndpoint.kt                 # Relay client (Kotlin mirror)
│   │   │   ├── Crypto.kt                      # E2E encryption (libsodium)
│   │   │   ├── Capabilities.kt                # Registry + Tier-1 implementations
│   │   │   ├── Consent.kt                     # Consent policy engine
│   │   │   ├── Protocol.kt                    # Wire protocol (Kotlin)
│   │   │   ├── Agents.kt                      # Multi-agent roster state
│   │   │   ├── SettingsStore.kt               # UI state persistence
│   │   │   ├── SettingsActivity.kt            # Settings screen
│   │   │   ├── WakeWordService.kt             # Always-on wake word
│   │   │   ├── VoiceInput.kt                  # Speech-to-text (Vosk)
│   │   │   ├── SpeechText.kt                  # Text-to-speech
│   │   │   ├── WakePhrase.kt                  # Wake phrase logic
│   │   │   ├── Chimes.kt                      # Audio / haptic feedback
│   │   │   ├── Photos.kt                      # Photo gallery access
│   │   │   ├── MsgPart.kt                     # Rich message rendering
│   │   │   ├── Markdown.kt                    # Markdown → Compose
│   │   │   ├── CodeHighlight.kt               # Code syntax highlighting
│   │   │   ├── Themes.kt                      # UI themes
│   │   │   ├── AgentTheme.kt                  # Per-agent color themes
│   │   │   ├── BootReceiver.kt                # System boot auto-start
│   │   │   ├── WakeMessagingService.kt        # FCM wake hook
│   │   │   ├── WakeWindow.kt                  # Battery-aware reconnect window
│   │   │   ├── Haptics.kt                     # Haptic feedback
│   │   │   ├── Markdown.kt
│   │   │   ├── capabilities/
│   │   │   │   └── registerTier1.kt           # Tier-1 capability setup
│   │   │   ├── pairing/
│   │   │   │   └── Confirmer.kt               # User consent UI modal
│   │   │   ├── voice/
│   │   │   │   └── TextToSpeech.kt            # TTS provider
│   │   │   ├── automation/
│   │   │   │   └── (UI automation helpers)
│   │   │   └── ...
│   │   ├── src/test/java/com/agenticandroid/
│   │   │   ├── MarkdownTest.kt
│   │   │   ├── CodeHighlightTest.kt
│   │   │   ├── WakeWindowTest.kt
│   │   │   └── ...
│   │   ├── src/main/res/
│   │   │   ├── values/                        # Strings, colors, dimens
│   │   │   ├── drawable/                      # Icons, vectors
│   │   │   ├── xml/                           # App shortcuts, providers
│   │   │   └── mipmap-anydpi-v26/             # Adaptive icon
│   │   ├── src/main/assets/
│   │   │   └── vosk-model-small-en-us-0.15/  # Wake-word model (offline)
│   │   └── build.gradle.kts
│   ├── gradle/                    # Gradle wrapper config
│   └── build.gradle.kts
├── launchd/                       # macOS launchd plist + wrapper (for hub service)
├── .planning/
│   ├── codebase/                  # This analysis
│   │   ├── ARCHITECTURE.md
│   │   ├── STRUCTURE.md
│   │   ├── CONVENTIONS.md         # (Coding style)
│   │   ├── TESTING.md             # (Test patterns)
│   │   └── ...
│   └── (phase docs, run journals, etc.)
└── README.md, package.json, tsconfig.json, etc.
```

## Directory Purposes

**backbone/ (TypeScript Server Tier)**
- Purpose: Hub, relay, agents, bridges — the "always-on" part running on user's machine
- Contains: TypeScript source, tests, examples
- Key files: `relay.ts`, `panel.ts`, `agent.ts`, `brain.ts`, `peer.ts`, `protocol.ts`, `crypto.ts`

**backbone/src/ (Implementation)**
- `relay.ts`: Untrusted message router (Q2/Q5). Stateless; only sees fingerprints. WebSocket + HTTP for blobs. Also hosts the pair-code rendezvous (`POST /pair-code` → 8-char code; `GET /pair-code/:code` → non-secret pairing payload, ~10 min TTL).
- `panel.ts`: Hub — owns phone connection, agent roster, chat sessions, media, event log, scheduler. HTTP `:8123` + WebSocket `:8124`.
- `peer.ts`: BusEndpoint class — unified relay client used by phone, hub, and agents. Handshake, E2E encryption, request/response correlation.
- `panel.ts` (web UI): hub control panel. Shows QR + manual pairing code (`host/CODE`), hub name editor (`POST /hub-name`). Hub name defaults to `os.hostname()`, stored as `hubName` in agent.json.
- `protocol.ts`: Zod schemas for Envelope (relay-visible) and InnerMessage (E2E). parseFrame(), encodeInner(), newId().
- `crypto.ts`: libsodium wrapper. generateIdentity(), fingerprint(), sign/verify (relay auth), sealFor/openFrom (E2E encryption), sealString/openString (JSON convenience).
- `agent.ts`: Agent entry point. Connects to hub WebSocket, receives messages, calls makeBrain(), correlates tool requests, reports status.
- `brain.ts`: makeBrain() factory. Real Claude via Anthropic SDK (if API key) or stub keyword router. Agentic loop: LLM → tools → results → reply.
- `agent-cli.ts`: Key-free wrapper. Spawns user's `claude` CLI with phone-mcp.ts as MCP server. Auth via user's own account.
- `phone-mcp.ts`: MCP stdio server. Exposes phone capabilities as Model Context Protocol tools. Fetches catalog from hub, proxies tool calls via HTTP.
- `parts.ts`: Rich message types. MsgPart (markdown, image, file, table). AssistantMessage (text + optional parts). spokenText() for TTS.
- `scheduler.ts`: Hub-owned task manager. Deferred and recurring actions. Persists to disk. Survives hub restart.
- `pairing.ts`: Pairing handshake (generating shared identity, QR encoding, manual pair-code). Payload carries the hub name and a `hub_identity` event.
- `phone-sim.ts`: Phone mock for testing (simulator).
- `bridge.ts`: (Internal or legacy, check recent commits for status).

**backbone/test/ (Test Suites)**
- `relay.test.ts`: Relay handshake, routing, offline queue, blob storage, pair-code rendezvous.
- `agent-cli.test.ts`: Agent CLI message round-trip.
- `e2e.test.ts`: Full-stack: phone → relay → hub → agent → reply.
- `pairing.test.ts`: Pairing QR generation and manual pair-code.
- `crypto.test.ts`: Ed25519, fingerprinting, E2E encryption round-trips.
- `scheduler.test.ts`: Scheduler persistence and timing.

**backbone/examples/ (Reference Implementations)**
- `raw-agent.ts`: Minimal agent (no Claude). Demonstrates the bus API and tool correlation.

**android/app/src/main/java/com/agenticandroid/ (Kotlin Android App)**

**Top-level UI & Services:**
- `MainActivity.kt`: Compose chat UI. Entry point. Message list, input field, media picker, session switcher, settings drawer. Drawer hub list is info-only (online/offline dots, no switching); header agent picker lists agents across all online hubs (grouped by hub, via `selectAgentOnHub`).
- `PhoneAgentService.kt`: Foreground service (prevents system kill). Orchestrates a `Map<hubId, HubConnection>` — stays connected to all paired hubs at once. Implements `onRequest` handler (consent dispatch). API: `switchHub`/`switchAgent` (re-point foreground hub, no reconnect), `selectAgent`, `selectAgentOnHub`, `forgetHub`, `ensureConnections`. State flows: `onlineHubs`, `allAgents`, `unreadHubs`.
- `HubConnection.kt`: One paired hub's connection. Owns its BusEndpoint plus that hub's roster and online state. A hub is "online" only once it answers the phone's whoami (a live relay socket alone is not enough).
- `SettingsActivity.kt`: Settings screen. Relay URL, wake-word toggle, connection enable/disable, and Hubs section (rename a hub via local label, Forget/unpair via `forgetHub`, Pair another hub).

**Networking & Crypto:**
- `BusEndpoint.kt`: Relay client (Kotlin mirror of `backbone/src/peer.ts`). Handshake, E2E encryption, request correlation.
- `Crypto.kt`: libsodium bindings. Ed25519, X25519, box encryption, detached signatures.
- `Protocol.kt`: Wire protocol. Envelope, InnerMessage types.

**Capabilities & Requests:**
- `Capabilities.kt`: Capability registry. Tier-1 implementations (camera, location, SMS, notifications, device info, flashlight, ring, vibrate, UI automation). Dispatch logic.
- `Consent.kt`: Consent policy (DENY/ASK/ALLOW). Per-agent trust state, per-method sensitivity.

**State & Persistence:**
- `Agents.kt`: Multi-agent roster + paired-hub records. `AgentProfile` holds the hub `name` (from pairing) and an optional per-phone `localName`; `display()` = `localName ?: name`.
- `SettingsStore.kt`: UI state (relay URL, wake-word enabled, connection toggle). Flows for reactive updates.
- `MsgPart.kt`: Rich message rendering (markdown, image, file, table).

**Voice & Audio:**
- `WakeWordService.kt`: Always-on wake-word listener (offline, via Vosk model).
- `VoiceInput.kt`: Speech-to-text (Vosk or system ASR).
- `SpeechText.kt`: Text-to-speech provider.
- `WakePhrase.kt`: Wake phrase matching logic (customizable phrase).
- `Chimes.kt`: Chime/alert sounds and haptics.

**UI Rendering & Styling:**
- `Markdown.kt`: Markdown → Compose Composable converter.
- `CodeHighlight.kt`: Syntax highlighting for code blocks.
- `Themes.kt`: Material Design theme setup.
- `AgentTheme.kt`: Per-agent color theme assignment.

**Lifecycle & Boot:**
- `BootReceiver.kt`: System boot event. Auto-start PhoneAgentService if enabled.
- `WakeMessagingService.kt`: FCM wake hook (so backgrounded app can reconnect).
- `WakeWindow.kt`: Smart reconnect window based on battery and network state.

**Utilities:**
- `Photos.kt`: Gallery / photo picker integration.
- `Haptics.kt`: Haptic feedback API.

**Subdirectories:**
- `capabilities/registerTier1.kt`: Tier-1 capability registration (camera, location, SMS, notifications).
- `pairing/Confirmer.kt`: User consent modal (Compose).
- `pairing/PairingActivity.kt`, `pairing/Pairing.kt`: Pairing screen — scan QR or "Enter code instead" to redeem a manual pair-code.
- `voice/TextToSpeech.kt`: TTS provider abstraction.
- `automation/`: UI automation helpers (if any).

**android/app/src/test/ (Unit Tests)**
- `MarkdownTest.kt`: Markdown parser tests.
- `CodeHighlightTest.kt`: Syntax highlighting tests.
- `WakeWindowTest.kt`: Reconnect logic tests.
- `ConsentTest.kt`: Consent policy tests.
- `SpeechTextTest.kt`: TTS tests.
- `WakePhrase.Test.kt`: Wake phrase matching tests.

**android/app/src/main/res/ (Android Resources)**
- `values/`: Strings, colors, dimensions, theme attrs.
- `drawable/`: Vector icons, drawables.
- `xml/`: App shortcuts, file providers, widget config.
- `mipmap-anydpi-v26/`: Adaptive app icon.

**android/app/src/main/assets/ (Bundled Assets)**
- `vosk-model-small-en-us-0.15/`: Offline speech recognition model for wake word.

**launchd/ (macOS Integration)**
- Plist for running hub as a managed launchd service.
- Wrapper script to start/stop the hub gracefully.

**.planning/codebase/ (This Analysis)**
- `ARCHITECTURE.md`: Layers, patterns, data flow, entry points.
- `STRUCTURE.md`: Directory layout and file purposes.
- `CONVENTIONS.md`: Naming, style, import patterns (if written).
- `TESTING.md`: Test frameworks and patterns (if written).
- `CONCERNS.md`: Technical debt, known issues (if written).

## Key File Locations

**Entry Points:**
- Phone app: `android/app/src/main/java/com/agenticandroid/MainActivity.kt`
- Hub: `backbone/src/panel.ts` (run via `pnpm panel` or `pnpm hub`)
- Agent: `backbone/src/agent.ts` (run via `pnpm agent`)
- Agent CLI (key-free): `backbone/src/agent-cli.ts` (run via `pnpm agent:claude`)
- Relay: `backbone/src/relay.ts` (demo/test; prod usually external service)

**Configuration:**
- Phone pairing identity: `~/.agentic-android/agent.json` (JSON, contains `phone.edPub/edSec/fp` and `hub.edPub/edSec/fp`)
- Hub config: `~/.agentic-android/agent.json` (shares with phone; agent settings, relay URL, brain config, `hubName`)
- Chat history: `~/.agentic-android/sessions/*.jsonl` (per-session turns)
- Event log: `~/.agentic-android/panel-events.jsonl` (hub audit log)
- Scheduled tasks: `~/.agentic-android/scheduled-tasks.jsonl` (persistent scheduler state)

**Core Logic:**
- Relay routing: `backbone/src/relay.ts` (handleHttp, deliverOrQueue, flush)
- Hub message dispatch: `backbone/src/panel.ts` (phone connection, agent roster, hub.ws "message" handler)
- Agent reasoning: `backbone/src/brain.ts` (anthropicLoop, stubLoop)
- Phone request handler: `android/app/src/main/java/com/agenticandroid/PhoneAgentService.kt` (onRequest lambda)
- Capability dispatch: `android/app/src/main/java/com/agenticandroid/Capabilities.kt` (registry.get, execute)

**Testing:**
- Protocol validation: `backbone/test/crypto.test.ts`, `backbone/test/pairing.test.ts`
- E2E flow: `backbone/test/e2e.test.ts`
- Phone unit tests: `android/app/src/test/java/com/agenticandroid/*.kt`

**Wire Protocol & Crypto:**
- Message structure: `backbone/src/protocol.ts` (Zod Envelope, InnerMessage schemas)
- Encryption: `backbone/src/crypto.ts` (sealString, openString, E2E authentication)
- Phone crypto mirror: `android/app/src/main/java/com/agenticandroid/Crypto.kt` (libsodium via JNI)

## Naming Conventions

**Files:**
- TypeScript (backbone): camelCase.ts (e.g., `relay.ts`, `panel.ts`, `phoneAgentService.ts`)
- Kotlin (Android): PascalCase.kt (e.g., `MainActivity.kt`, `PhoneAgentService.kt`)
- Tests: *.test.ts (TypeScript), *.Test.kt (Kotlin)
- Utilities: utils.ts, helpers.ts
- Types/interfaces: protocol.ts, parts.ts

**Directories:**
- Feature grouping: `capabilities/`, `pairing/`, `voice/`, `automation/` (Android)
- Layers: `src/`, `test/`, `examples/` (backbone)
- Config: `~/.agentic-android/` (user home)

**TypeScript Functions:**
- API endpoints: `handleHttp()`, `onEnvelope()`, `onRequest()`
- Factories: `makeBrain()`, `createRelay()`
- Getters: `readBrainCfg()`, `displayName()`
- Converters: `toName()`, `encodeInner()`

**Kotlin Classes:**
- Activities: `MainActivity`, `SettingsActivity`, `BootReceiver`
- Services: `PhoneAgentService`, `WakeWordService`, `WakeMessagingService`
- Data classes: `ChatMsg`, `RosterAgent`, `SessionInfo`, `CapInfo`
- Registries/managers: `CapabilityRegistry`, `ConsentPolicy`, `SettingsStore`

**Variables:**
- TypeScript: camelCase (e.g., `hubBus`, `pending`, `pendingUpload`)
- Kotlin: camelCase (e.g., `relayUrl`, `peerFp`, `onRequest`)
- Constants: UPPERCASE_SNAKE_CASE (e.g., `PROTOCOL_VERSION`, `MAX_MEM`, `DEFAULT_SYSTEM`)

**Types:**
- TypeScript: PascalCase (Envelope, ResponseMsg, Identity, Cap)
- Kotlin: PascalCase (BusEndpoint, ChatMsg, CapResult, Sensitivity)

## Where to Add New Code

**New Capability (Phone-side Action):**
- Implement execute logic in `android/app/src/main/java/com/agenticandroid/capabilities/registerTier1.kt` (or new file in `capabilities/`)
- Register in `CapabilityRegistry` in `Capabilities.kt`
- Add test case in `android/app/src/test/java/com/agenticandroid/CapabilitiesTest.kt` (if test exists)
- Document sensitivity level (public / internal / tier-1 / tier-2)

**New Agent Brain (LLM or Logic):**
- Implement a variant of `makeBrain()` in `backbone/src/brain.ts` (new branch in the provider switch)
- OR create a new file `backbone/src/brain-*.ts` and import in `agent.ts`
- Update config schema if needed (agent.json `brain.provider` field)
- Add tests in `backbone/test/` (agent behavior, tool correlation)

**New MCP Tool:**
- Add to `phone-mcp.ts` `server.registerTool()` calls
- Fetch capability from hub catalog or hard-code
- Proxy to hub HTTP endpoint (`POST /call`)
- Document input schema (Zod for validation)

**New Chat Session Feature:**
- Update `Session` interface in `panel.ts`
- Persist to `~/.agentic-android/sessions.jsonl`
- Update phone UI in `MainActivity.kt` (session list, selector)
- Ensure migration logic if schema changes (see `loadConversation()`)

**New Event Type:**
- Add to `EventType` discriminated union in `panel.ts` (type safety)
- Emit via `bus.event(topic, data)` from agent or phone
- Add log entry via `logEvent(type, summary, detail)`
- Handle in web UI / phone display (topic-specific rendering)

**New Scheduled Task Type:**
- Add to `scheduler.ts` Task interface if new fields needed
- Schedule via hub HTTP `POST /schedule` endpoint
- Phone executes via `request()` when fireAt reached
- Persist to `~/.agentic-android/scheduled-tasks.jsonl`

**New E2E Encrypted Message:**
- Add variant to `InnerMessage` discriminated union in `protocol.ts`
- Implement `parseInner()` and `encodeInner()` handling
- Update `BusEndpoint` to route new message type
- Mirror in Kotlin if needed (`Protocol.kt`)
- Add test in `backbone/test/protocol.test.ts`

## Special Directories

**backbone/node_modules/:**
- Generated by `npm install` / `pnpm install`
- Not committed; gitignored
- Contains @anthropic-ai/sdk, ws, zod, libsodium-wrappers, etc.

**android/.gradle/, android/build/, android/app/build/:**
- Build cache and output directories
- Generated by Gradle
- Not committed; gitignored

**android/app/src/main/assets/vosk-model-*:**
- Offline speech-recognition model (bundled in APK)
- Large; committed to repo (or downloaded at build time)
- Used by `WakeWordService.kt` for always-on listening

**.planning/:**
- Orchestrator output and phase journals
- Committed to repo for audit trail
- User-editable roadmaps, notes, etc.

**.logs/:**
- Runtime logs (if any)
- Not committed

---

*Structure analysis: 2026-06-26*
