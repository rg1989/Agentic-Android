# External Integrations

**Analysis Date:** 2026-06-26

## APIs & External Services

**Anthropic Claude LLM:**
- Service: Claude API (Anthropic)
- What it's used for: Intelligent agent loop; receives user messages from phone, invokes phone capabilities, and generates responses
- SDK/Client: `@anthropic-ai/sdk@^0.105.0` (TypeScript)
- Auth: `ANTHROPIC_API_KEY` environment variable (or custom name in agent.json brain.apiKeyEnv)
- Files: `backbone/src/brain.ts` (anthropicLoop function), `backbone/src/agent.ts` (uses brain), `backbone/src/agent-cli.ts` (invokes claude CLI with MCP tools, no key in this process)
- Integration method: Direct HTTP via @anthropic-ai/sdk; agent.ts spawns subprocess in agent-cli.ts; key never exposed to hub or phone

**Vosk Speech Recognition:**
- Service: Open-source offline wake-word detection (no external API)
- What it's used for: On-device wake-word listening (offline)
- SDK/Client: `com.alphacephei:vosk-android:0.3.47` (Android native)
- Auth: None
- Model source: Fetched at build time from https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip (~40MB, excluded from git)
- Files: `android/app/build.gradle.kts` (ensureVoskModel task, pre-build download), `android/app/src/main/java/com/agenticandroid/WakePhrase.kt` (usage)
- Fallback: If model missing at build time, download is attempted via ant.get/unzip

## Data Storage

**Databases:**
- None: Agentic-Android is stateless at the relay level. The hub holds all persistent state (events, chat, media) as local files

**File Storage:**
- Local filesystem only:
  - Hub config + state: `~/.agentic-android/` (configurable via `AGENTIC_HOME`)
    - `agent.json` - Identity keypair and agent config
    - `panel-events.jsonl` - Event log (persistent, append-only)
    - `sessions/` - Chat sessions (one .jsonl per session)
    - `media/photos/` - Photos captured from phone
    - `media/files/` - Files uploaded from phone
  - Relay: Optional on-disk blob storage (currently in-memory; TODO: Redis/persistent backing)
  - Android: SharedPreferences + local media cache (via AndroidX Security Crypto for encrypted storage of pairing key)

**Caching:**
- In-memory queues (relay.ts): Per-peer offline envelopes (default 1000 max per peer, configurable), blob TTL 5min (configurable)
- No Redis, Memcached, or external cache layer

## Authentication & Identity

**Auth Provider:**
- Custom end-to-end: No third-party auth service
- Architecture:
  1. **Ed25519 identity keypair** per device (phone, hub, relay-aware agent):
     - Generated in `backbone/src/crypto.ts` via libsodium `crypto_sign_keypair()`
     - Stored in `agent.json` (hub/agent side)
     - Stored encrypted in Android SharedPreferences (phone side)
     - Fingerprint = `generichash(edPub)` as a stable device identifier
  2. **Relay authentication**: Challenge-response signing
     - On connection: relay sends a random nonce
     - Client responds: `sign(edSec, nonce)` proves possession of private key
     - Relay verifies: `verify(edPub, signature, nonce)` without decrypting
  3. **E2E encryption**: X25519 (converted from Ed25519) + XSalsa20-Poly1305
     - All messages encrypted with `crypto_box_easy(message, nonce, recipientCurvePub, senderCurveSec)`
     - Relay sees only from/to fingerprints and envelope sizes, never contents

**OAuth for Headless CLI:**
- agent-cli.ts (key-free agent) stores OAuth token in `agent.json brain.oauthToken`
- Token read from env `CLAUDE_CODE_OAUTH_TOKEN` or agent.json
- Whitespace stripped from token (terminal copy/paste often wraps tokens)
- Token used to authenticate to claude CLI without embedding API key in relay/hub

## Monitoring & Observability

**Error Tracking:**
- None: All errors logged locally to stderr and event log

**Logs:**
- Persistent event log: `panel-events.jsonl` (JSONL, in `~/.agentic-android/panel-events.jsonl`)
  - Events: request, response, error, phone_event, agent_run, connection, config, user_message, assistant_message, llm, tool
  - Max in-memory: 5000 events; older events persisted to disk
- Service logs (launchd): `~/.logs/service.out.log`, `~/.logs/service.err.log` (macOS)
- Console: agent.ts, agent-cli.ts log to stderr (`console.error`)

## CI/CD & Deployment

**Hosting:**
- Self-hosted only:
  - **Relay**: Node.js process on a VPS or home server (can be behind Tailscale, firewall, or public IP)
  - **Hub**: launchd service on macOS or systemd on Linux; runs locally on the user's machine
  - **Agent**: Subprocess on user's machine or anywhere with access to hub WS + Claude CLI

**Deployment Model:**
- Relay: `PORT=8787 pnpm relay` (single-node; TODO: Redis/disk for persistence)
- Hub: `pnpm panel` or via launchd service (auto-restart on crash, auto-start at login)
- Agent: `pnpm agent` (internal Anthropic provider) or `pnpm agent:claude` (key-free, spawns claude CLI)
- Bridge (MCP): `pnpm bridge` or registered with Claude Code `.mcp.json`

**CI Pipeline:**
- None detected in repo: Backbone has 36 tests (pnpm test) but no GitHub Actions/CI service
- Android: Scaffold unverified; relies on local gradle build

## Environment Configuration

**Required env vars (relay):**
- `PORT` - Listen port for relay (no default, must be set)

**Required env vars (hub/panel):**
- None; all config in agent.json

**Required env vars (agent):**
- `ANTHROPIC_API_KEY` - If using anthropic provider in agent.json brain config
- `AGENT_NAME` - Optional: override agent display name
- `AGENT_PORT` - Optional: hub agent WS port (default 8124)
- `HUB_URL` - Optional: hub WS URL (default ws://127.0.0.1:8124)

**Optional env vars (agent-cli):**
- `CLAUDE_CODE_OAUTH_TOKEN` - OAuth token for headless claude CLI
- `AGENT_CLI` - Custom CLI command (default "claude")
- `HUB_HTTP` - Hub HTTP base (default http://127.0.0.1:8123)
- `AGENTIC_HOME` - Config directory (default ~/.agentic-android)

**Secrets location:**
- `~/.agentic-android/agent.json` - Identity keypair (edPub/edSec base64), relay URL, agent config
- Android SharedPreferences - Pairing keypair (encrypted via AndroidX Security Crypto)
- Never committed to git

## Webhooks & Callbacks

**Incoming:**
- FCM (Firebase Cloud Messaging): Hub listens for wake-up pushes (phone registers with FCM, relay sends FCM on offline queue)
  - Implemented in Android via `com.google.firebase:firebase-messaging-ktx`
  - Relay calls optional `onWake(fp)` callback to invoke FCM push (prod integration)
  - Mock: no incoming HTTP callbacks in backbone; test doubles inject wake behavior

**Outgoing:**
- Relay → Phone: WebSocket envelope delivery (deliverOrQueue in relay.ts)
- Hub → Phone: Request forwarding via relay
- Hub → Agent: WebSocket catalog, result, ready messages (panel.ts sends via WS to agent)
- Agent → Phone (via hub): Tool requests mapped to hub HTTP POST /call (phone-mcp.ts)
- Scheduler callbacks: Hub → Phone on deferred task fire (scheduler.ts)
- No external webhook endpoints

---

*Integration audit: 2026-06-26*
